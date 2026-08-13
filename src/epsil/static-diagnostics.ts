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

// RUNTIME imports, but not of the engine: `type-compatibility-error.ts` and
// `type-guards.ts` are engine-free leaves (their only runtime dependency is
// `common/type`), so the injected-engine rule above is preserved.
// `unboundSignatureHint` supplies the same near-miss wording the runtime
// declared-type check uses, so the static and runtime messages never drift.
import { unboundSignatureHint } from '../compute-engine/boxed-expression/type-compatibility-error.js';
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
import { signatureNotes } from './signature-notes.js';

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
  // The PROTOCOL registry needs the identical transaction, for the identical
  // reason: `DeclareProtocol`/`DeclareConformance` register at canonicalization
  // time so later statements of the same program check against them, and a
  // checked-but-never-run program must not mutate the engine's protocols.
  const rollbackProtocols = ce._protocolRegistryRollbackPoint();
  // The FORWARD-REFERENCE registry needs the same transaction, and for a
  // reason the other two do not have: canonicalizing a `function` definition
  // installs a definition object (so that later statements' calls validate
  // against its signature), and a definition whose body reads a not-yet-known
  // symbol registers itself there to be re-derived later. That registry is
  // keyed by ENGINE, not by scope, so popping this pass's scope does not
  // remove it — and the program's real definition of the same function would
  // then be the second entry waiting on the same callee.
  const rollbackProvisional = ce._provisionalRegistryRollbackPoint();
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
    rollbackProtocols();
    rollbackProvisional();
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

  // Where this program binds each of its names, for the "defined here" note a
  // signature error carries (see `signatureNotes()`).
  const defSites = definitionSites(ast);

  const diagnostics: ParsingDiagnostic[] = [];
  for (const statement of statements) {
    // Provenance: the `Error` nodes the statement already carries *before*
    // canonicalization are source-authored values, not static problems.
    const authored = authoredErrors(statement);

    let canonical: MathJsonExpression;
    let boxed: ReturnType<ComputeEngine['box']> | undefined;
    try {
      boxed = ce.box(statement);
      canonical = boxed.json;
    } catch {
      // Canonicalization is best-effort: a statement the engine cannot box is
      // left to the run phase rather than crashing the check.
      continue;
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
        const values = (node as { values?: readonly typeof node[] }).values;
        if (Array.isArray(values))
          for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
        const ops = (node as { ops?: readonly typeof node[] }).ops;
        if (ops !== undefined)
          for (let i = ops.length - 1; i >= 0; i--) stack.push(ops[i]);
      }
    }
    // A declaration whose initializer PROVABLY cannot satisfy the annotation
    // is a static problem too, even though `Declare` only enforces it at
    // evaluation time (see `declaredTypeMismatch`).
    const declMismatch = declaredTypeMismatch(ce, boxed);
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
        [start, end]
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
    case 'invalid-symbol':
      detail =
        payload.length === 0
          ? 'invalid symbol'
          : `invalid symbol \`${payload.join(', ')}\``;
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
