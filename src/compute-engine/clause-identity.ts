import type {
  DeclarationOrigin,
  FunctionSignature,
  Type,
} from '../common/type/types.js';
import { isSubtype } from '../common/type/subtype.js';

/**
 * CLAUSE IDENTITY — when two clauses of a multi-clause function are the SAME
 * clause, so that defining the second one REPLACES the first instead of adding
 * an arm to the dispatch
 * (`docs/TYPE-SYSTEM.md`).
 *
 * Extracted into this module because two tiers need the answer and they live on
 * opposite sides of the engine boundary: `multi-clause.ts` applies it when it
 * installs a clause, and the Epsil static checker (`src/epsil/
 * static-diagnostics.ts`) applies it to report a duplicated clause BEFORE the
 * program runs (the redefinition discipline's static tier —
 * `docs/TYPE-SYSTEM.md`). The checker may only
 * import engine-free leaves at runtime, since the engine itself is injected
 * there, so the shared test cannot live in `multi-clause.ts`.
 *
 * This module is therefore a LEAF: it imports nothing but the type layer.
 */

/**
 * Definition records whose canonicalization-time clause install was SKIPPED.
 *
 * Skipping one clause of a name obliges the canonical route to skip every
 * later clause of that name too, or its picture of the definition diverges
 * from what the program will actually build. Concretely: a generic first
 * clause is skipped (see `isGenericTarget`, `multi-clause.ts`); if a plain
 * second clause were then installed, canonicalization would believe the target
 * is that plain clause, while the run rejects the second clause under rule G2
 * and keeps the generic one — and every later call would be checked against a
 * signature the program never has. Skipping both leaves the target at the top
 * `function` type, which checks nothing and so cannot be wrong.
 *
 * The Epsil static checker reads the same marker for a related reason: a clause
 * the canonical route refused to install (`x := 5` then `x(n) = …`) is not this
 * program's first definition of anything, so a SECOND clause at the same
 * parameter list must not be reported as a redefinition of it — the run reports
 * both clauses under the real cause instead.
 *
 * Weakly keyed on the definition RECORD, which is mutated in place across
 * installs and dies with its scope. Typed on `object` rather than on
 * `BoxedDefinition` to keep this module free of expression types; the engine
 * re-exports both functions from `multi-clause.ts`.
 */
const CANON_INSTALL_SKIPPED = new WeakSet<object>();

export function noteCanonInstallSkipped(def: object | undefined): void {
  if (def !== undefined) CANON_INSTALL_SKIPPED.add(def);
}

export function canonInstallSkipped(def: object | undefined): boolean {
  return def !== undefined && CANON_INSTALL_SKIPPED.has(def);
}

/**
 * CLAUSE PROVENANCE — the two side-channels that describe a LONE clause, which
 * `multi-clause.ts` §4.2 keeps in the plain single-function representation
 * rather than in clause storage, so neither has anywhere else to live:
 * which statement defined it ({@link singleClauseOrigin}) and which declaration
 * governs it ({@link singleClauseDeclared}).
 *
 * They live here, beside {@link CANON_INSTALL_SKIPPED}, because all three are
 * keyed on the same object and share one lifetime rule — see
 * {@link clearClauseProvenance}, which the assignment path in
 * `engine-declarations.ts` calls when an `Assign` replaces the whole
 * definition (design rule D6).
 */
const SINGLE_CLAUSE_ORIGIN = new WeakMap<object, DeclarationOrigin>();
const SINGLE_CLAUSE_DECLARED = new WeakMap<object, FunctionSignature>();

export function noteSingleClauseOrigin(
  def: object | undefined,
  origin: DeclarationOrigin | undefined
): void {
  if (def === undefined) return;
  if (origin === undefined) SINGLE_CLAUSE_ORIGIN.delete(def);
  else SINGLE_CLAUSE_ORIGIN.set(def, origin);
}

export function singleClauseOrigin(
  def: object | undefined
): DeclarationOrigin | undefined {
  return def === undefined ? undefined : SINGLE_CLAUSE_ORIGIN.get(def);
}

export function noteSingleClauseDeclared(
  def: object | undefined,
  declared: FunctionSignature | undefined
): void {
  if (def === undefined) return;
  if (declared === undefined) SINGLE_CLAUSE_DECLARED.delete(def);
  else SINGLE_CLAUSE_DECLARED.set(def, declared);
}

export function singleClauseDeclared(
  def: object | undefined
): FunctionSignature | undefined {
  return def === undefined ? undefined : SINGLE_CLAUSE_DECLARED.get(def);
}

/**
 * Drop everything this module remembers about a definition record, because the
 * definition it described has been REPLACED.
 *
 * Called from the assignment path in `engine-declarations.ts` when an
 * `Assign` replaces a binding's definition wholesale. The clause LIST needs no
 * such call — it hangs off the inner operator object and dies when
 * `updateDef()` (`boxed-expression/utils.ts`) swaps that half, which is what
 * makes `Assign`'s full-replace semantics (design rule D6) fall out for free.
 * These three hang off the OUTER record instead, which `updateDef()` mutates in
 * place and therefore survives, so without this they describe a definition that
 * no longer exists. Hooking the clearing into `updateDef()` itself — the
 * tidier-looking choke point — was rejected: `DefineFunction`'s recursion-knot
 * machinery retypes the target through that path while a clause is being
 * installed, so clearing there wiped the stamp mid-definition and let a
 * genuine duplicate clause through. Only ASSIGNMENT means full replacement.
 *
 * The bug that motivated it: `g(n) = 1` then `g = x ↦ 2` then `g(n) = 3` left
 * the first statement's origin stamp on the record, so the third statement was
 * read as REDEFINING a clause that the assignment had already thrown away. It
 * raised a spurious `function-redefinition` and — the part that made this
 * urgent — refused to install, so the program answered 2 where it should
 * answer 3. A stale remembered DECLARATION is the same class of error: it would
 * arm-check a later clause against a contract the binding no longer carries.
 */
export function clearClauseProvenance(def: object | undefined): void {
  if (def === undefined) return;
  SINGLE_CLAUSE_ORIGIN.delete(def);
  SINGLE_CLAUSE_DECLARED.delete(def);
  CANON_INSTALL_SKIPPED.delete(def);
}

/**
 * The clause signature carried by a canonical `Function` literal's TYPE: its
 * arrow with the effects specifier removed (D5 — effects are a property of the
 * SYMBOL, not of an individual clause, so two clauses that differ only in their
 * effects are still the same clause).
 *
 * Takes the type rather than the literal so that this module needs no
 * expression types. A literal always types as a signature; the fallback is a
 * conservative degradation for a literal that somehow does not.
 */
export function clauseSignatureOf(literalType: Type): FunctionSignature {
  if (typeof literalType === 'object' && literalType.kind === 'signature') {
    const sig = { ...literalType };
    delete sig.effects;
    return sig;
  }
  return {
    kind: 'signature',
    variadicArg: { type: 'any' },
    variadicMin: 0,
    result: 'unknown',
  };
}

/**
 * Two clauses are the SAME clause iff their parameter domains coincide:
 * identical arity structure and mutually-subtyped parameter types. Result type
 * and effects are deliberately excluded — a body edit that changes the inferred
 * result must REPLACE its clause, not append one.
 *
 * Parameter NAMES play no part, which is why `g(n) = 1` followed by
 * `g(m) = 2` is a redefinition: dispatch never sees the names.
 */
export function sameParameterDomain(
  a: FunctionSignature,
  b: FunctionSignature
): boolean {
  const aReq = a.args?.length ?? 0;
  const bReq = b.args?.length ?? 0;
  const aOpt = a.optArgs?.length ?? 0;
  const bOpt = b.optArgs?.length ?? 0;
  if (aReq !== bReq || aOpt !== bOpt) return false;
  if ((a.variadicArg === undefined) !== (b.variadicArg === undefined))
    return false;
  if (a.variadicArg && (a.variadicMin ?? 0) !== (b.variadicMin ?? 0))
    return false;

  const mutual = (x: Type, y: Type) => isSubtype(x, y) && isSubtype(y, x);
  for (let i = 0; i < aReq; i++)
    if (!mutual(a.args![i].type, b.args![i].type)) return false;
  for (let i = 0; i < aOpt; i++)
    if (!mutual(a.optArgs![i].type, b.optArgs![i].type)) return false;
  if (a.variadicArg && !mutual(a.variadicArg.type, b.variadicArg!.type))
    return false;
  return true;
}
