import type { MathJsonExpression } from '../math-json/types.js';
import {
  isDictionaryObject,
  operand,
  operands,
  operator,
  stringValue,
} from '../math-json/utils.js';

// Type-only import: like `execute-epsil.ts`, this module never statically
// imports the engine — the engine is injected at call time.
import type { ComputeEngine } from '../compute-engine.js';

import type { ParsingDiagnostic } from './diagnostics.js';
import { serializeEpsil } from './serialize-epsil.js';

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
 * (`docs/plans/2026-07-31-error-propagation-design.md` §5).
 *
 * Nothing is evaluated. Each top-level statement is boxed canonically, in
 * source order: boxing resolves operators, signatures and types but never
 * runs user code — a `RandomInteger` call stays symbolic, an infinite `while`
 * lowers to a `Loop` that is not iterated, an unknown `print(…)` stays inert.
 *
 * **Anchoring is statement-level (v1).** The canonical tree carries no source
 * offsets, so each diagnostic points at the start of the enclosing
 * statement's `sourceOffsets` range — or at the whole program when the
 * statement carries no offsets, rather than dropping the diagnostic.
 *
 * The caller supplies the engine: `epsil check` uses a fresh one, and
 * `executeEpsil()` uses the session engine (so the pass sees the same
 * library and the declarations of previous cells).
 *
 * **What the pushed scope shields (and what it does not).** The walk runs in a
 * scope pushed on the way in and popped (in a `finally`) on the way out. That
 * contains the **declarations** canonicalization creates: boxing an expression
 * auto-declares the symbols it mentions, and leaving those behind would change
 * how the program then evaluates (a pre-declared `x` makes `let x = 2047`
 * narrow to `finite_integer` instead of declaring `integer`). It does **not**
 * shield definitions that already exist in an outer scope: type inference
 * writes through to them, so a previous cell's symbol left at type `unknown`
 * can be narrowed by the pass (checking `u + 1` types `u` as `number`). Only
 * the declaration set is restored, not the definitions' inferred types.
 *
 * **Prior declarations are not modeled.** Each statement is canonicalized in
 * source order but *without* applying the bindings the preceding statements
 * declare — `Declare`/`Assign` only take effect when they evaluate, which this
 * pass never does. The pass is therefore incomplete rather than unsound: a
 * mistake that depends on a declared type is missed (`let x: string = "a"`
 * followed by `x + 1` checks clean), and the program reports it when it runs.
 */
export function staticDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string
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
  // The engine requires the depth counter IN ADDITION to the frame name (so a
  // host `pushScope(undefined, 'epsil:static-check')` cannot forge the
  // surrogate and smuggle a nested `DeclareType` past the top-level rule).
  ce._staticTypeCheckDepth += 1;
  ce.pushScope(undefined, 'epsil:static-check');
  try {
    return canonicalizationDiagnostics(ce, ast, source);
  } finally {
    ce.popScope();
    ce._staticTypeCheckDepth -= 1;
    rollbackTypes();
  }
}

function canonicalizationDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string
): ParsingDiagnostic[] {
  // The parser wraps a multi-statement program in `Block` (see
  // `executeEpsil()`); a single statement is not wrapped.
  const statements = operator(ast) === 'Block' ? [...operands(ast)] : [ast];

  const diagnostics: ParsingDiagnostic[] = [];
  for (const statement of statements) {
    // Provenance: the `Error` nodes the statement already carries *before*
    // canonicalization are source-authored values, not static problems.
    const authored = authoredErrors(statement);

    let canonical: MathJsonExpression;
    try {
      canonical = ce.box(statement).json;
    } catch {
      // Canonicalization is best-effort: a statement the engine cannot box is
      // left to the run phase rather than crashing the check.
      continue;
    }

    const errors: MathJsonExpression[] = [];
    collectErrors(canonical, errors);
    if (errors.length === 0) continue;

    const [start, end] = statementRange(statement, source);
    const snippet = epsilSnippet(statement);
    // One diagnostic per distinct problem: every error in a statement shares
    // the statement's range, so identical descriptions would be N copies of
    // the same line.
    const seen = new Set<string>();
    for (const error of errors) {
      const code = errorCode(error);
      if (!isCanonicalizationError(code)) continue;
      const description = describeError(error);
      // Subtract the authored errors, one occurrence at a time: a program that
      // builds `Error(ErrorCode("incompatible-type", …))` twice and hits one
      // real type error still gets exactly one diagnostic.
      const authoredCount = authored.get(description);
      if (authoredCount !== undefined && authoredCount > 0) {
        authored.set(description, authoredCount - 1);
        continue;
      }
      if (seen.has(description)) continue;
      seen.add(description);
      diagnostics.push({
        severity: 'error',
        message: ['static-type-error', description, snippet, code],
        range: [start, end, start],
      });
    }
  }

  return diagnostics;
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
    const description = describeError(error);
    result.set(description, (result.get(description) ?? 0) + 1);
  }
  return result;
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
  // common `->`/`|->` typo shapes are recovered by the parser as lambdas
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
function errorCode(error: MathJsonExpression): string {
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
 */
function describeError(error: MathJsonExpression): string {
  const cause = operand(error, 1);
  const where = operand(error, 2);

  let code = 'error';
  const payload: string[] = [];
  if (cause !== null) {
    if (operator(cause) === 'ErrorCode') {
      const parts = [...operands(cause)].map(text);
      code = parts[0] ?? code;
      payload.push(...parts.slice(1));
    } else code = text(cause);
  }

  const detail =
    code === 'incompatible-type' && payload.length === 2
      ? `expected ${payload[0]}, got ${payload[1]}`
      : payload.join(', ');
  const args = [detail, where === null ? '' : `at ${text(where)}`].filter(
    (x) => x !== ''
  );
  return args.length === 0 ? code : `${code} (${args.join('; ')})`;
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
