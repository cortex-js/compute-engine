import type {
  FunctionSignature,
  NamedElement,
  Type,
} from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';
import { signatureArms } from '../common/type/utils.js';
import type { MathJsonExpression } from '../math-json/types.js';
import {
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import { isLiteralParamName } from '../math-json/symbols.js';

// Type-only import: like `execute-epsil.ts`, this module never statically
// imports the engine — the engine is injected at call time. `common/type` is
// an engine-free leaf, so importing it at runtime preserves that rule.
import type { ComputeEngine } from '../compute-engine.js';

import type { DefinitionSite } from './definition-sites.js';
import type { DiagnosticNote } from './diagnostics.js';
import { traceFrames, type ErrorFrameRef } from './error-location.js';

/** The engine's boxed-expression type, named without a static engine import
 * (same containment as the `ComputeEngine` type-only import above). */
type BoxedExpr = ReturnType<ComputeEngine['box']>;

/**
 * The error codes that mean "the call did not match the callee's signature",
 * and nothing else: the three `boxed-expression/validate.ts` mints while
 * checking an application's arguments against the operator's signature.
 *
 * The restriction is what makes {@link signatureNotes} sound. For these codes
 * the innermost breadcrumb frame is, by construction, the CALLEE being
 * validated and its index an ARGUMENT POSITION of that callee — so naming the
 * frame's signature explains the error. An error merely raised *inside* some
 * function's body carries the same frame shape but has nothing to do with
 * that function's signature, so those codes are left alone.
 */
const SIGNATURE_ERROR_CODES = new Set([
  'missing',
  'unexpected-argument',
  'incompatible-type',
]);

/**
 * Explanatory notes for an `["Error", …]` value whose cause is a call that did
 * not match its callee's signature — the context that turns "a required
 * argument is missing" into something actionable:
 *
 * 1. the callee's signature, and what the faulted argument position is in it;
 * 2. where the callee was defined, when this program defines it
 *    (`definitionSites`; a library operator has no source site).
 *
 * Best-effort throughout: an error with no identifiable callee, a callee that
 * resolves to no definition, or a definition with no readable signature all
 * yield `[]` rather than a guess. The notes never change what the diagnostic
 * means — see {@link DiagnosticNote}.
 */
export function signatureNotes(
  ce: ComputeEngine,
  error: MathJsonExpression,
  options?: {
    /** Where this program binds its names, from `definitionSites()`. */
    definitionSites?: ReadonlyMap<string, DefinitionSite>;
    /** The range the diagnostic itself points at. A definition site
     * overlapping it is dropped rather than pointing twice at one place (an
     * error *inside* the definition of the function it names). */
    primaryRange?: readonly [number, number];
    /** The call the error sits in, for an error that carries no breadcrumb —
     * see `enclosingFrame()` in `error-location.ts`. Consulted only as a
     * fallback: an error that BUBBLED knows its own origin, and the tree
     * position it ended up in would name the wrong callee. */
    enclosingFrame?: ErrorFrameRef;
    /** The RAW call node the error sits in (`locateError().call`), when the
     * caller located one. Read only by the provenance note's FALLBACK route,
     * which needs the faulted argument AS WRITTEN — a bare symbol — to look
     * up how that symbol's type was inferred. */
    call?: MathJsonExpression;
    /** The BOXED error value, when the caller holds one. The preferred
     * provenance route: since 2026-08-13 the engine attaches the faulted
     * operand itself as the error's site operand, so a symbol operand still
     * carries its own binding (`.valueDefinition`) — scope-accurate even
     * for a parameter or local whose scope is gone by diagnostic time. */
    boxedError?: BoxedExpr;
  }
): DiagnosticNote[] {
  if (!SIGNATURE_ERROR_CODES.has(errorCodeOf(error))) return [];

  const frame = innermostFrame(error) ?? options?.enclosingFrame;
  if (frame === undefined) return [];

  const notes: DiagnosticNote[] = [];

  const arms = signatureArms(calleeType(ce, frame.name));
  if (arms !== undefined && arms.length > 1)
    // An overload set: every arm, since the breadcrumb does not say which one
    // the engine was checking.
    notes.push({
      message: `\`${frame.name}\` has ${arms.length} overloads: ${arms
        .map((arm) => `\`${signatureText(arm)}\``)
        .join(', ')}`,
    });
  else if (arms !== undefined && arms.length === 1) {
    const clause = argumentClause(error, arms[0], frame.index);
    if (clause !== undefined)
      notes.push({
        message: `\`${frame.name}\` has signature \`${signatureText(arms[0])}\`${clause}`,
      });
  }

  const site = options?.definitionSites?.get(frame.name);
  if (site !== undefined && !overlaps(site.name, options?.primaryRange))
    notes.push({
      message: `\`${frame.name}\` is defined here`,
      range: site.name,
    });

  const provenance = provenanceNote(
    ce,
    error,
    frame,
    options?.call,
    options?.boxedError
  );
  if (provenance !== undefined) notes.push(provenance);

  return notes;
}

/**
 * The second site of a two-site type conflict: when the faulted argument is a
 * bare symbol whose type the engine committed from earlier evidence, name
 * that evidence — "`v` was inferred to have type `boolean` from its use in
 * `And(v, w)`". The bare `incompatible-type` message shows only the failing
 * use; where the conflicting type CAME from is recorded in the definition's
 * provenance history (`_typeProvenance`, see `TypeProvenanceEntry` in the
 * engine's `types-definitions.ts` and
 * `docs/TYPE-SYSTEM.md`).
 *
 * Two resolution routes, in preference order:
 *
 * 1. **Binding-accurate** (`boxedError`): the engine attaches the faulted
 *    operand itself as the error's site operand, so a symbol operand still
 *    carries its own binding — the provenance is read off
 *    `whereOp.valueDefinition` directly, scope-accurately, even for a
 *    parameter or local whose scope is gone by diagnostic time. When this
 *    route sees a symbol operand it is AUTHORITATIVE: no fallback runs, so
 *    an ambient lookup can never contradict the binding the fault actually
 *    involved.
 * 2. **Fallback** (`call`, raw + ambient lookup): for callers holding only
 *    the error JSON. Guarded against misattribution: the note is minted only
 *    when (a) the raw operand at the faulted position is a bare symbol (a
 *    named-argument call may permute positions — a permuted operand is a
 *    carrier node, not a symbol, and is skipped), and (b) the provenance
 *    entry that would be named installed EXACTLY the type the error reports.
 *    This route can still resolve a same-named outer binding when name AND
 *    type coincide across scopes — which is why route 1 exists and wins.
 */
function provenanceNote(
  ce: ComputeEngine,
  error: MathJsonExpression,
  frame: ErrorFrameRef,
  call: MathJsonExpression | undefined,
  boxedError: BoxedExpr | undefined
): DiagnosticNote | undefined {
  if (errorCodeOf(error) !== 'incompatible-type') return undefined;

  // `["ErrorCode", "'incompatible-type'", expected, actual]` — the actual
  // type is what the definition's provenance must corroborate.
  const cause = operand(error, 1);
  if (operator(cause) !== 'ErrorCode') return undefined;
  const actual = stringValue(operand(cause, 3));
  if (actual === null) return undefined;

  // Route 1: the boxed error's site operand (2nd operand — but the
  // breadcrumb `ErrorTrace` is identified by HEAD, never position, so a
  // trace sitting there means "no site"). `ops` and `symbol` live on
  // narrowed interfaces that only engine-side type guards can prove, and
  // this module may not import engine runtime code — so they are read
  // structurally.
  const whereOp = (boxedError as { ops?: ReadonlyArray<BoxedExpr> } | undefined)
    ?.ops?.[1];
  if (whereOp !== undefined && whereOp.operator !== 'ErrorTrace') {
    const name = (whereOp as { symbol?: string }).symbol;
    if (typeof name === 'string')
      return noteFromHistory(
        name,
        whereOp.valueDefinition?._typeProvenance,
        actual
      );
    // A non-symbol faulted operand has no binding to explain; route 2's
    // raw-position heuristic would be a downgrade, not a fallback.
    return undefined;
  }

  // Route 2: raw call + ambient lookup.
  if (call === undefined) return undefined;
  // `frame.index` is 1-based, matching `locateError`'s consumption.
  const arg = [...operands(call)][frame.index - 1] ?? null;
  const name = arg === null ? null : symbol(arg);
  if (name === null) return undefined;
  const def = ce.lookupDefinition(name);
  const history =
    def !== undefined && 'value' in def ? def.value._typeProvenance : undefined;
  return noteFromHistory(name, history, actual);
}

/** The note for the most recent history entry that (1) resulted from
 * evidence (inference or an assumption — a creation anchor explains
 * nothing), (2) knows what expression committed it, and (3) installed the
 * type the error reports as the actual type. */
function noteFromHistory(
  name: string,
  history: NonNullable<BoxedExpr['valueDefinition']>['_typeProvenance'],
  actual: string
): DiagnosticNote | undefined {
  if (history === undefined) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.kind !== 'inferred' && entry.kind !== 'assumed') continue;
    if (entry.cause === undefined) continue;
    if (entry.type.toString() !== actual) continue;
    return {
      message:
        entry.kind === 'assumed'
          ? `\`${name}\` was assumed to have type \`${actual}\` (from \`${entry.cause.toString()}\`)`
          : `\`${name}\` was inferred to have type \`${actual}\` from its use in \`${entry.cause.toString()}\``,
    };
  }
  return undefined;
}

/** The error code of an `["Error", cause, …]` node — the head of its
 * `ErrorCode` payload, or the bare cause. (A local copy of the same reading
 * `static-diagnostics.ts` does, kept here so this module stands alone.) */
function errorCodeOf(error: MathJsonExpression): string {
  const cause = operand(error, 1);
  if (cause === null) return '';
  if (operator(cause) === 'ErrorCode')
    return stringValue(operand(cause, 1)) ?? '';
  return stringValue(cause) ?? '';
}

/**
 * The innermost frame of an error's breadcrumb — the call the error was
 * raised in.
 *
 * Only the innermost frame is considered, and only when it is a real call:
 * `Block` and `Function` are evaluation structure the engine inserted, and an
 * outer frame's index counts arguments of a DIFFERENT call, so falling
 * through to it would attribute the fault to the wrong argument.
 */
function innermostFrame(error: MathJsonExpression): ErrorFrameRef | undefined {
  const frame = traceFrames(error)[0];
  if (frame === undefined) return undefined;
  return frame.name === 'Block' || frame.name === 'Function'
    ? undefined
    : frame;
}

/** The callable type of `name`: an operator definition's signature, or the
 * type of a value definition holding a function literal (`let f = (x) => …`).
 */
function calleeType(ce: ComputeEngine, name: string): Type | undefined {
  let def: ReturnType<ComputeEngine['lookupDefinition']>;
  try {
    def = ce.lookupDefinition(name);
  } catch {
    return undefined;
  }
  if (def === undefined) return undefined;
  if ('operator' in def) return def.operator.signature.type;
  return def.value.type.type;
}

/**
 * What the faulted argument position is in the callee's signature — the
 * second half of the note, e.g. "; argument 2 (`n: integer`) was not
 * supplied".
 *
 * `undefined` — meaning "say nothing at all", suppressing the whole note —
 * when the signature has nothing to say about the faulted position. That is
 * the guard against naming an operator the reader never wrote: `"a" + 1`
 * faults inside `Add`, whose signature is the fully variadic
 * `(value+) -> value`, so a note would announce an operator the source
 * spells `+` and then fail to explain anything about it. A signature earns
 * the note only by declaring the parameter that faulted (`missing`,
 * `incompatible-type`) or a bounded arity to have exceeded
 * (`unexpected-argument`).
 */
function argumentClause(
  error: MathJsonExpression,
  sig: FunctionSignature,
  index: number
): string | undefined {
  const required = sig.args?.length ?? 0;
  const optional = sig.optArgs?.length ?? 0;
  const param =
    sig.args?.[index - 1] ?? sig.optArgs?.[index - 1 - required] ?? undefined;
  const described = param === undefined ? '' : ` (\`${elementText(param)}\`)`;

  switch (errorCodeOf(error)) {
    case 'missing':
      return param === undefined
        ? undefined
        : `; argument ${index}${described} was not supplied`;
    case 'unexpected-argument':
      return sig.variadicArg !== undefined
        ? undefined
        : `; it takes ${countText(required, optional)}, so argument ${index} is extra`;
    default:
      // `incompatible-type`: the message already says which type was expected
      // and which arrived, so the note only has to say which parameter that
      // was.
      return param === undefined
        ? undefined
        : `; argument ${index} is \`${elementText(param)}\``;
  }
}

/** "2 arguments" / "1 to 3 arguments" — the arity a non-variadic signature
 * admits, in words. */
function countText(required: number, optional: number): string {
  const plural = (n: number) => `${n} argument${n === 1 ? '' : 's'}`;
  return optional > 0
    ? `${required} to ${plural(required + optional)}`
    : plural(required);
}

/** A signature in its source spelling — `(x: string, n: integer) -> string`.
 *
 * The engine's own rendering, except that the synthetic names a multi-clause
 * definition gives its literal patterns (`literalParam_1`, from a clause
 * written `function fib(0)`) are dropped: they are an implementation detail of
 * clause dispatch and name nothing the reader wrote. */
function signatureText(sig: FunctionSignature): string {
  return typeToString({
    ...sig,
    args: sig.args?.map(anonymizeLiteralParam),
    optArgs: sig.optArgs?.map(anonymizeLiteralParam),
    variadicArg:
      sig.variadicArg === undefined
        ? undefined
        : anonymizeLiteralParam(sig.variadicArg),
  });
}

function anonymizeLiteralParam(element: NamedElement): NamedElement {
  return element.name !== undefined && isLiteralParamName(element.name)
    ? { type: element.type }
    : element;
}

/** A parameter as `name: type`, or just its type when unnamed. */
function elementText(element: NamedElement): string {
  const anonymous = anonymizeLiteralParam(element);
  return anonymous.name === undefined
    ? typeToString(anonymous.type)
    : `${anonymous.name}: ${typeToString(anonymous.type)}`;
}

function overlaps(
  a: readonly [number, number],
  b: readonly [number, number] | undefined
): boolean {
  return b !== undefined && a[0] < b[1] && b[0] < a[1];
}
