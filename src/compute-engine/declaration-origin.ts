import type { DeclarationOrigin } from '../common/type/types.js';

/**
 * The REDEFINITION DISCIPLINE's runtime tier, shared by the type registry
 * (`engine-declarations.ts`) and the protocol registry (`engine-protocols.ts`)
 * — `docs/plans/2026-08-14-redefinition-discipline.md`.
 *
 * The rule: within ONE compilation unit (one Epsil program, i.e. one
 * `executeEpsil` batch) a second declaration of a name is an error; ACROSS
 * units it keeps its per-construct replacement semantics (the notebook
 * pattern). The two are told apart by the origin stamp
 * ({@link DeclarationOrigin}) an accepted statement leaves on the registry
 * record.
 *
 * This module is a LEAF: it imports nothing but the origin type, so both
 * registries can use it without an import edge between them.
 */

/** The diagnostic codes the discipline mints — the SAME codes on both tiers
 * (the static pass emits them as `ParsingDiagnostic`s, the statement route as
 * error VALUES), so one problem reads the same wherever it is reported. */
export type RedefinitionCode =
  | 'type-redefinition'
  | 'protocol-redefinition'
  | 'function-redefinition';

/**
 * A declaration refused because the name was already declared by a DIFFERENT
 * statement of the same compilation unit.
 *
 * Thrown (rather than returned) because the registry functions
 * `declareType`/`declareSumType`/`declareProtocolImpl` report every other
 * failure by throwing too; the `Declare*` statement handlers in
 * `library/core.ts` catch it and turn it into an error VALUE carrying
 * {@link code}, so nothing throws to the host.
 */
export class RedefinitionError extends Error {
  readonly code: RedefinitionCode;
  /** The name that was declared twice. (`name` itself is `Error`'s own
   * property, so the declared name needs a distinct one.) */
  readonly declaredName: string;
  constructor(code: RedefinitionCode, declaredName: string, message: string) {
    super(message);
    this.code = code;
    this.declaredName = declaredName;
  }
}

/**
 * Refuse `name` when `existing` and `incoming` are two DIFFERENT statements of
 * the same unit. Call it BEFORE any mutation of the existing record: both
 * registries replace records IN PLACE (captured references must follow a
 * redefinition), so a rejected duplicate that had already started writing
 * would leave the first declaration — and everything holding its record —
 * damaged.
 *
 * `incoming === undefined` means the caller is not on the Epsil statement
 * route (the box route, the host API); those registrations are unstamped and
 * this rule never applies to them.
 */
export function checkSameUnitRedefinition(
  kind: 'type' | 'protocol',
  name: string,
  existing: DeclarationOrigin | undefined,
  incoming: DeclarationOrigin | undefined
): void {
  if (existing === undefined || incoming === undefined) return;
  if (existing.batch !== incoming.batch) return;
  if (existing.statementId === incoming.statementId) return;
  throw new RedefinitionError(
    kind === 'type' ? 'type-redefinition' : 'protocol-redefinition',
    name,
    `The ${kind} "${name}" is already declared${firstSite(existing)} in this program. A second declaration of a name in one program is a mistake; to redefine it interactively, re-run it as a separate program.`
  );
}

/**
 * Refuse a function CLAUSE that replaces a clause defined by a DIFFERENT
 * statement of the same compilation unit (user ruling 2026-08-14, closing the
 * borderline the discipline's v1 deliberately left silent).
 *
 * This is the clause-level twin of {@link checkSameUnitRedefinition}, and the
 * distinction it draws is the one that keeps multi-clause functions working:
 * only a clause with the SAME PARAMETER DOMAIN — the test dispatch itself uses,
 * so what is refused is exactly what would have been silently overwritten — is
 * a redefinition. Clause ADDITION at a distinct parameter list
 * (`fib(0) = 0; fib(1) = 1; fib(n) = …`) is the idiom multi-clause functions
 * exist for and is never affected.
 *
 * ACROSS units it stays last-wins, like every other construct: re-running an
 * edited clause in a later program is the notebook gesture, and the host routes
 * (`ce.parse`/`ce.evaluate`/`ce.declare`) are unstamped, so this never applies
 * to them.
 */
export function checkSameUnitClauseRedefinition(
  name: string,
  existing: DeclarationOrigin | undefined,
  incoming: DeclarationOrigin | undefined
): void {
  if (existing === undefined || incoming === undefined) return;
  if (existing.batch !== incoming.batch) return;
  if (sameStatement(existing, incoming)) return;
  throw new RedefinitionError(
    'function-redefinition',
    name,
    `A clause of "${name}" with this parameter list is already defined${firstSite(existing)} in this program, and this one would silently replace it. Give the clauses different parameter lists to dispatch between them, or edit the existing clause in place; to redefine it interactively, re-run it as a separate program.`
  );
}

/**
 * Are two origin stamps of the same batch the SAME defining statement?
 *
 * Object identity of the anchor is the primary test, but it is NOT sufficient
 * on its own for clauses, because one statement is boxed more than once from
 * the SAME source: the static pre-pass canonicalizes it, and the evaluation
 * loop canonicalizes it again from the original MathJSON. Those two boxings
 * produce DIFFERENT operand objects for the same written statement, so an
 * identity-only test reports a statement as a redefinition of itself — which
 * showed up as an across-program re-run silently failing to install, the
 * second boxing throwing where the first had just replaced the clause.
 *
 * The source RANGE settles it: within one compilation unit two distinct
 * statements always occupy distinct offsets, and every boxing of one statement
 * reports the same ones. Identity remains the fallback for a hand-built
 * MathJSON operand, which carries no offsets at all.
 */
function sameStatement(a: DeclarationOrigin, b: DeclarationOrigin): boolean {
  if (a.statementId === b.statementId) return true;
  const ra = a.firstRange;
  const rb = b.firstRange;
  return (
    ra !== undefined && rb !== undefined && ra[0] === rb[0] && ra[1] === rb[1]
  );
}

/**
 * Where the FIRST declaration of the name sits, for the runtime error message
 * — ` at characters 12-30` when the first declaring statement carried source
 * offsets, and ` earlier` when it did not.
 *
 * The offsets are rendered as NUMBERS rather than as a line/column: this is
 * the engine-side registry, which is handed a `DeclarationOrigin` and nothing
 * else — no source text to count newlines in, and no file identity. (Both live
 * one layer up, in `src/epsil`, where the STATIC tier's diagnostic already
 * renders the same site as a real two-range report; a host that wants
 * line/column from the runtime tier converts these offsets itself.) The
 * rendered form is `characters <start>-<end>`, half-open UTF-16 offsets into
 * the program source, the same convention every `ParsingDiagnostic.range`
 * uses. A hand-built MathJSON operand carries no offsets, hence the fallback.
 *
 * See `docs/plans/2026-08-14-redefinition-discipline.md`.
 */
function firstSite(existing: DeclarationOrigin): string {
  const range = existing.firstRange;
  if (range === undefined) return ' earlier';
  return ` at characters ${range[0]}-${range[1]}`;
}
