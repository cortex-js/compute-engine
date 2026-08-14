import type {
  EffectSet,
  FunctionSignature,
  Type,
  TypeParameter,
  TypeReference,
  TypeResolver,
} from '../common/type/types.js';
import { parseType } from '../common/type/parse.js';
import { typeToString } from '../common/type/serialize.js';
import { isSubtype, widen } from '../common/type/subtype.js';
import { reduceType, typesOverlap } from '../common/type/reduce.js';
import {
  conditionalTargetInstance,
  widestConditionalTarget,
} from '../common/type/conditional-conformance.js';
import {
  isGroupedTypeText,
  isValidTypeName,
  signatureEffects,
} from '../common/type/utils.js';
import {
  effectSetToString,
  isCoFiniteEffects,
  isEffectSubset,
  isPureEffectSet,
  subtractEffects,
  unionEffectSets,
} from '../common/type/effects.js';
import { isValidPrimitiveType } from '../common/type/primitive.js';
import {
  isReservedTypeName,
  substituteTypeVariables,
} from '../common/type/instantiate.js';
import { osaDistance } from '../common/fuzzy-string-match.js';

import type {
  ConformanceRecord,
  IComputeEngine,
  JSImplementation,
  ProtocolImplementationInput,
  ProtocolMember,
  ProtocolHostHandler,
  ProtocolMembersInput,
  ProtocolRecord,
} from './types-engine.js';
import type { Expression } from './types-expression.js';
import type {
  BoxedDefinition,
  OperatorDefinition,
} from './types-definitions.js';
import type { Scope } from './types-evaluation.js';
import {
  isExpression,
  isFunction,
  isString,
  sym,
} from './boxed-expression/type-guards.js';
import { functionLiteralReturnMarker } from './boxed-expression/function-literal.js';
import { inferFunctionLiteralEffects } from './boxed-expression/effects-inference.js';
import {
  isOperatorDef,
  isValueDef,
  updateDef,
} from './boxed-expression/utils.js';
import { checkArity, checkType } from './boxed-expression/validate.js';
import { apply, lookup } from './function-utils.js';

//
// PROTOCOLS — declarations, conformance and implementations (phases 1–2).
//
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A is the surface specification;
// `docs/plans/2026-08-12-protocols-design.md` is the ruling record. Phase 1
// implemented DECLARATIONS and CONFORMANCE; phase 2 adds IMPLEMENTATION
// validation (member coverage, P17 signature matching, property handlers) and
// the host implementation API. Dispatch is phase 3 and property SEMANTICS
// phase 4.
//
// Protocols are engine-global, exactly like types — the second kind of
// registry entry the global-type-registry design pre-writes (its §5), not a
// second scoping regime. Protocol names are NOT types (ruling P8): they never
// enter `_typeRegistry`, `knownTypeNames`, or the type resolver.
//

/** `Self` is a textual substitution token, never a declarable type (P12). It
 * must not be resolvable through the engine's registry, so the ONLY place it
 * has a meaning is the wrapper below. */
export const SELF_TYPE_NAME = 'Self';

/** Names a protocol may not take. `Self` is the substitution token; `where` is
 * reserved by the type grammar. */
function isReservedProtocolName(name: string): boolean {
  return name === SELF_TYPE_NAME || isReservedTypeName(name);
}

/**
 * A resolver that additionally resolves `Self` — the ONLY route by which the
 * token becomes parseable. Used to syntax-check a protocol member's signature
 * at declaration time; the signature is still STORED verbatim, with `Self`
 * unsubstituted (P12), so nothing downstream depends on this record.
 */
function selfAwareResolver(base: TypeResolver): TypeResolver {
  const self: TypeReference = {
    kind: 'reference',
    name: SELF_TYPE_NAME,
    alias: false,
    def: 'any',
  };
  return {
    get names(): string[] {
      return [...base.names, SELF_TYPE_NAME];
    },
    forward: (name: string) =>
      name === SELF_TYPE_NAME ? self : base.forward(name),
    resolve: (name: string) =>
      name === SELF_TYPE_NAME ? self : base.resolve(name),
    conformsTo: base.conformsTo,
  };
}

/** Is `name` a DECLARED type of this engine?
 *
 * The resolver THROWS `protocol-in-type-position` for a name its protocol
 * registry holds — which is exactly the case a re-declaration (P5) probes here
 * — so the miss is caught: "it is a protocol" is the same answer as "it is not
 * a type", which is all this asks.
 */
function isDeclaredTypeName(ce: IComputeEngine, name: string): boolean {
  try {
    return ce._typeResolver.resolve(name) !== undefined;
  } catch {
    return false;
  }
}

/** The message of a thrown parse/validation error, without the class name. */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

//
// ── Protocol declaration ─────────────────────────────────────────────────────
//

/**
 * Register a protocol. THROWS on every error — the host contract (Appendix A
 * "Host API"). The Epsil statement route passes `fromStatement: true`, which
 * makes a re-run REPLACE its own declaration instead (ruling P5), and converts
 * a throw into an error value.
 */
export function declareProtocolImpl(
  ce: IComputeEngine,
  name: string,
  members: ProtocolMembersInput | undefined,
  options?: { fromStatement?: boolean }
): void {
  if (!isValidTypeName(name))
    throw Error(`The protocol name "${name}" is invalid`);
  if (isReservedProtocolName(name))
    throw Error(`The protocol name "${name}" is reserved`);
  // P8, the no-dual-role rule, in the protocol-over-type direction: a protocol
  // name is NOT a type name, so it may not shadow one either — neither a
  // built-in (`protocol string {}`, `protocol collection {}`) nor a declared
  // one. The type-over-protocol direction is enforced in `declareType()`.
  if (isValidPrimitiveType(name) || isDeclaredTypeName(ce, name))
    throw Error(
      `The protocol name "${name}" is already a type; protocols and types share no names`
    );

  const registry = ce._protocolRegistry;
  const existing = registry[name];
  const fromStatement = options?.fromStatement === true;
  if (existing !== undefined) {
    // P5: a record this engine created from a `protocol` STATEMENT is ours to
    // replace (a notebook re-run with an edited declaration). A host
    // declaration is never replaced — it throws, like `ce.declareType()`.
    if (!fromStatement || !existing.declaredByStatement)
      throw Error(`The protocol "${name}" is already declared`);
  }

  // Validate every member BEFORE touching the registry, so a malformed
  // declaration leaves the previous one exactly as it was.
  const validated: Record<string, ProtocolMember> = Object.create(null);
  const resolver = selfAwareResolver(ce._typeResolver);

  for (const [member, signature] of Object.entries(members?.functions ?? {})) {
    if (!isValidTypeName(member))
      throw Error(`The protocol member name "${member}" is invalid`);
    // The accessor prefixes are the mangling an implementation block uses for
    // a PROPERTY handler, so a function requirement spelled with one could
    // never be implemented — validation would read the key as an accessor.
    if (member.startsWith(GET_PREFIX) || member.startsWith(SET_PREFIX))
      throw Error(
        `The protocol member name "${member}" is reserved: the \`${GET_PREFIX}\` and \`${SET_PREFIX}\` prefixes name property accessors`
      );
    let parsed: Type;
    try {
      parsed = parseType(signature, resolver);
    } catch (e) {
      throw Error(
        `The signature of \`${name}.${member}\` does not parse: ${messageOf(e)}`
      );
    }
    if (typeof parsed !== 'object' || parsed.kind !== 'signature')
      throw Error(
        `The member \`${name}.${member}\` must declare a function signature, e.g. \`(self: Self) -> integer\``
      );
    assertSelfFirstParameter(name, member, parsed);
    assertV1MemberShape(name, member, parsed);
    validated[member] = { kind: 'function', signature };
  }

  for (const kind of ['readonly', 'readwrite'] as const) {
    for (const [member, type] of Object.entries(members?.[kind] ?? {})) {
      if (!isValidTypeName(member))
        throw Error(`The protocol member name "${member}" is invalid`);
      if (validated[member] !== undefined)
        throw Error(
          `The protocol "${name}" declares the member "${member}" twice`
        );
      try {
        parseType(type, resolver);
      } catch (e) {
        throw Error(
          `The type of the property \`${name}.${member}\` does not parse: ${messageOf(e)}`
        );
      }
      validated[member] = { kind, type };
    }
  }

  if (existing !== undefined) {
    // Replacing a protocol can WIDEN a dispatcher's effect set — a
    // requirement's ceiling loosened from `pure` to `random`, or a bare
    // requirement whose changed shape now matches an effectful conformer that
    // used to be stranded — and a function annotated `pure` that calls through
    // that dispatcher then declares something that is no longer true. As in
    // `declareConformance`, the declared contracts can only be re-derived
    // against the LIVE registry, so the replacement is applied and undone
    // below if it turns out to have falsified one. A FRESH declaration needs
    // no such guard: it installs dispatchers for a name nothing could already
    // be calling.
    const restore = ce._protocolRegistryRollbackPoint();
    // Records mutate IN PLACE (the type-registry contract, same reason:
    // captured references). The conformance edges survive a re-declaration —
    // conformance is monotone (Appendix A "Conformance").
    existing.members = validated;
    existing.declaredByStatement = fromStatement;
    // A replaced protocol may have gained, lost or RETYPED requirements, so
    // every conformance is revalidated against the new requirement set
    // (Appendix A "Scope and lifecycle"). An implementation that no longer
    // matches leaves its conformance PENDING — the edge survives (conformance
    // is monotone) but is not fulfilled, so the end-of-batch warning fires
    // until the implementation is edited to match.
    for (const c of existing.conformances)
      if (c.impl !== undefined)
        c.pending =
          implementationProblem(
            ce,
            existing,
            c.target,
            c.targetKey,
            c.impl,
            c.where
          ) !== null;
    // …and the implementation-LESS edges are recomputed from what the
    // implementations now cover: an edge that inherited a supertype's
    // implementation goes back to pending when that implementation stops
    // matching the new requirements, and vice versa.
    refreshInheritedPending(existing);
    // A replacement is a `config`-class state event, exactly like a type
    // redefinition: cached decisions taken against the old requirement set
    // must not be left stale (P16).
    ce._noteStateEvent({ kind: 'config' });
    ce._noteConformanceRegistryChange();
    // The requirement set changed: install the dispatchers of the members it
    // gained, refresh the survivors' signatures, and remove the ones it
    // dropped (P13).
    syncProtocolDispatchers(ce);

    const violations = conformanceWideningViolations(ce);
    if (violations.length > 0) {
      // The rollback thunk emits its own `config` state event and bumps the
      // conformance version when it restores anything, so nothing is emitted
      // here on top of that — but it only restores the REGISTRY, so the
      // dispatchers installed against the replaced requirement set are
      // re-synced explicitly against the restored one.
      restore();
      syncProtocolDispatchers(ce);
      throw Error(
        `conformance-widens-declared-contract: ${wideningRejectionMessage(
          violations,
          'replacing this protocol',
          'keep the previous declaration'
        )}`
      );
    }
    return;
  }

  const record: ProtocolRecord = {
    name,
    members: validated,
    conformances: [],
    declaredByStatement: fromStatement,
  };
  registry[name] = record;
  // A FRESH declaration is also a config event: `typesOverlap`/dispatch
  // decisions are keyed on the registry, and phase 3 installs dispatchers here.
  ce._noteStateEvent({ kind: 'config' });
  ce._noteConformanceRegistryChange();
  // P13 — every FUNCTION member becomes callable by its bare name, unless the
  // name is already taken (see `syncProtocolDispatchers`).
  syncProtocolDispatchers(ce);
}

/**
 * The first parameter of a protocol function is the DISPATCH position and must
 * be typed `Self` (Appendix A "`Self`"). Checked by STRING INSPECTION of the
 * parsed parameter — `Self` is a substitution token, not a declared type, so
 * there is nothing to compare identities against.
 */
function assertSelfFirstParameter(
  protocol: string,
  member: string,
  signature: FunctionSignature
): void {
  const first = signature.args?.[0];
  if (first === undefined || typeToString(first.type) !== SELF_TYPE_NAME)
    throw Error(
      `protocol-self-required: the first argument of \`${protocol}.${member}\` must be of type \`Self\``
    );
}

/**
 * P17 — "no optional/variadic/generic protocol members in v1". Enforced HERE,
 * at declaration, because every downstream consumer (the dispatcher's arity,
 * `checkMemberArguments`, the implementation signature check) reads only
 * `signature.args`: a requirement carrying `optArgs`, `variadicArg` or
 * `typeParams` would silently lose them and be matched, dispatched and typed
 * at the wrong arity. Naming the offending feature is what makes the
 * rejection actionable — the prohibition is not spelled anywhere in the
 * surface grammar.
 */
function assertV1MemberShape(
  protocol: string,
  member: string,
  signature: FunctionSignature
): void {
  const feature =
    signature.optArgs !== undefined && signature.optArgs.length > 0
      ? 'an optional argument'
      : signature.variadicArg !== undefined
        ? 'a variadic argument'
        : signature.typeParams !== undefined && signature.typeParams.length > 0
          ? 'a type parameter'
          : undefined;
  if (feature === undefined) return;
  throw Error(
    `The signature of \`${protocol}.${member}\` declares ${feature}; a protocol member may not be optional, variadic or generic`
  );
}

//
// ── Conformance ──────────────────────────────────────────────────────────────
//

/** A conformance target must be NAMED and GROUND (Appendix A "Conformance
 * targets"): a built-in type name or a ground application of one, or a nominal
 * type. Everything else is rejected, with a message that steers. */
function conformanceTargetProblem(
  target: Type,
  source: string,
  protocolNames: readonly string[],
  conditional = false
): string | null {
  if (typeof target === 'string') return null; // A built-in type name.

  switch (target.kind) {
    case 'union':
    case 'intersection':
    case 'negation':
      return `the conformance target \`${source}\` is a ${target.kind} type; a conforming type must be named and ground — declare a nominal type and conform that instead`;

    case 'tuple':
    case 'record':
    case 'signature':
    case 'callback':
      return `the conformance target \`${source}\` is an anonymous structural type; declare a nominal wrapper (\`type Pt = ${source}\`) and conform that instead`;

    case 'variable':
      // A bare variable head has no constructor to dispatch on: `type T is P
      // where T` would claim every type at once.
      return conditional
        ? `the conformance target \`${source}\` is a bare type variable; a conditional conformance must name a type constructor (\`type list<T> is …\`)`
        : `the conformance target \`${source}\` is a type variable; a conditional conformance needs a trailing \`where\` clause to bind it (\`type list<T> is … where T\`)`;

    case 'reference':
      if (target.alias === true)
        return `Use a nominal type (\`type Pt\`) to conform to protocol \`${protocolNames[0] ?? '…'}\`. Structural types (\`type alias\`) cannot conform to protocols.`;
      return null;

    default:
      // A ground application of a built-in constructor (`list<integer>`,
      // `dictionary<string>`), a bounded numeric range (`integer<1..10>`), a
      // literal value type — all named-and-ground.
      return null;
  }
}

//
// ── Conditional conformance (phase 5) ────────────────────────────────────────
//
// `type list<T> is Comparable where T is Comparable { … }`. The head names the
// target's variables and the trailing `where` clause BINDS them — the same
// single-binding-site rule as a function declaration. The clause rides into the
// engine as SOURCE TEXT (the P11 pattern `DeclareType`'s `typeParams` attribute
// uses) and is re-parsed here, so the parser owns no part of its meaning.
//
// The clause and the head are parsed TOGETHER, as one synthetic signature:
// `(self: list<T>) -> nothing where T is Comparable`. That is not a trick for
// its own sake — it is what makes the type grammar's own declaration-time
// validation apply verbatim: a duplicate variable, a non-ground bound, a
// variable the head never mentions ("quantified but never used"), and the `is`
// slot's oracle requirement all come back for free, with the engine's resolver
// supplying `conformsTo`.
//

/** The conformance oracle of `ce`, in the shape the type layer takes it (P36).
 * The engine's resolver is the only implementation; it also owns the
 * re-entrancy guard that keeps a self-referential conditional conformance
 * (`list<T> is P where T is P`) terminating. */
function conformsToOracle(
  ce: IComputeEngine
): (type: Type, protocol: string) => boolean {
  return (type, protocol) =>
    ce._typeResolver.conformsTo?.(type, protocol) ?? false;
}

/** A `where` clause, as it appears in a conformance's `targetKey` and in a
 * diagnostic: `T: number is Comparable & Hashable, U`. */
function clauseToString(params: readonly TypeParameter[]): string {
  return params
    .map((p) => {
      let s = p.name;
      if (p.bound !== undefined) s += `: ${typeToString(p.bound)}`;
      if (p.protocols !== undefined && p.protocols.length > 0)
        s += ` is ${p.protocols.join(' & ')}`;
      return s;
    })
    .join(', ');
}

/** The CONSTRUCTOR identity of a conformance target — what "the same head"
 * means in the one-conditional-per-(head, protocol) rule. Two targets with the
 * same head key are two instantiations of one constructor (`list<string>` and
 * `list<T>`), which is exactly the pair the rule forbids. */
function headKeyOf(target: Type): string {
  if (typeof target === 'string') return target;
  if (target.kind === 'reference') return `reference:${target.name}`;
  return target.kind;
}

/** The head pattern and the clause of a conditional conformance, or the message
 * of the first problem. `whereText` is the clause SOURCE, with or without its
 * leading `where` word. */
function parseConditionalTarget(
  ce: IComputeEngine,
  targetSource: string,
  whereText: string
):
  | { head: Type; params: TypeParameter[]; problem?: undefined }
  | { problem: string } {
  const clause = /^\s*where\b/.test(whereText)
    ? whereText.trim()
    : `where ${whereText.trim()}`;
  // The head sits in an ARGUMENT position of the carrier so that a clause
  // variable the head never mentions is reported by the grammar's own
  // result-reachability rule rather than silently accepted.
  const carrier = `(self: ${targetSource}) -> nothing ${clause}`;
  let parsed: Type;
  try {
    parsed = parseType(carrier, ce._typeResolver);
  } catch (e) {
    return {
      problem: `the conditional conformance \`${targetSource} … ${clause}\` does not parse: ${messageOf(e)}. Every variable of the head must be bound by the clause`,
    };
  }
  if (typeof parsed !== 'object' || parsed.kind !== 'signature')
    return { problem: `the conformance target \`${targetSource}\` is invalid` };
  const head = parsed.args?.[0]?.type;
  const params = parsed.typeParams;
  if (head === undefined || params === undefined || params.length === 0)
    return {
      problem: `the \`where\` clause of \`${targetSource}\` binds no type variable`,
    };
  return { head, params };
}

/**
 * The GROUND target a conformance edge stands for at a receiver of type
 * `receiver`, or `null` when the edge does not apply to it.
 *
 * The one admission test both halves of dispatch, property resolution and the
 * `conformsTo` oracle go through, so an unconditional and a conditional edge
 * can never drift apart on what "applies" means. Unconditional: the ordinary
 * `isSubtype(receiver, target)` (P32). Conditional: the receiver must match the
 * head, and every extracted argument must satisfy the clause.
 */
function edgeTargetAt(
  ce: IComputeEngine,
  edge: ConformanceRecord,
  receiver: Type
): Type | null {
  if (edge.where === undefined)
    return isSubtype(receiver, edge.target) ? edge.target : null;
  return conditionalTargetInstance(
    edge.target,
    edge.where,
    receiver,
    conformsToOracle(ce)
  );
}

/** The GROUND type an edge is compared against when there is no receiver in
 * hand: its own target, or — for a conditional edge — the widest instantiation
 * of its head (every variable read as its bound). Open types must never reach
 * `isSubtype`, so every receiver-less comparison goes through this. */
function edgeComparisonTarget(edge: ConformanceRecord): Type {
  if (edge.where === undefined) return edge.target;
  return widestConditionalTarget(edge.target, edge.where);
}

/** Two-way applicability (Appendix A's wording, P35): does the edge apply to
 * `receiver`, or to some subtype of it? Used only by the STATIC advisory
 * verdicts, never to select an implementation. */
function edgeCouldApply(
  ce: IComputeEngine,
  edge: ConformanceRecord,
  receiver: Type
): boolean {
  if (edgeTargetAt(ce, edge, receiver) !== null) return true;
  return isSubtype(edgeComparisonTarget(edge), receiver);
}

/**
 * Register the conformance of `targetSource` to each of `protocolNames`,
 * optionally with an implementation block.
 *
 * Returns an `Error` VALUE on failure and `null` on success — the shared
 * contract of the statement helpers in `library/core.ts` (errors are values,
 * never throws to the host). Used by BOTH the canonical and the evaluate
 * handler of `DeclareConformance`.
 *
 * An implementation block is validated against the protocol's requirements
 * BEFORE anything is stored (phase 2, ruling P17): on any failure the previous
 * implementation — and the edge's `pending` flag — are left exactly as they
 * were, and the first problem comes back as the error value.
 *
 * `options.where` makes it a CONDITIONAL conformance (phase 5): `targetSource`
 * is then a HEAD PATTERN naming the clause's variables (`list<T>`).
 *
 * `options.block` is the implementation block EXPRESSION the statement carries
 * — the identity P47's same-batch duplicate rule is keyed on (see
 * {@link ConformanceRecord._implOrigin}).
 */
export function declareConformance(
  ce: IComputeEngine,
  targetSource: string,
  protocolNames: readonly string[],
  impl?: Record<string, Expression | JSImplementation>,
  options?: { where?: string; block?: Expression }
): Expression | null {
  if (protocolNames.length === 0)
    return ce.error([
      'protocol-conformance-target-invalid',
      'Expected at least one protocol name',
    ]);

  // An implementation block belongs to ONE protocol: with `&` there is no way
  // to say which requirement a member implements (Appendix A).
  if (impl !== undefined && protocolNames.length > 1)
    return ce.error([
      'protocol-implementation-split',
      `provide a separate implementation block for each of \`${protocolNames.join('`, `')}\``,
    ]);

  const records: ProtocolRecord[] = [];
  for (const p of protocolNames) {
    const record = ce._protocolRegistry[p];
    if (record === undefined)
      return ce.error(['protocol-unknown', `the protocol \`${p}\` is unknown`]);
    records.push(record);
  }

  // The target rides as type-expression SOURCE, like `DeclareType`'s body; a
  // CONDITIONAL one is parsed together with its clause, which binds the head's
  // variables.
  const whereText = options?.where;
  let target: Type;
  let params: TypeParameter[] | undefined;
  if (whereText !== undefined) {
    const conditional = parseConditionalTarget(ce, targetSource, whereText);
    if (conditional.problem !== undefined)
      return ce.error([
        'protocol-conformance-target-invalid',
        conditional.problem,
      ]);
    target = conditional.head;
    params = conditional.params;
  } else {
    try {
      target = parseType(targetSource, ce._typeResolver);
    } catch {
      return ce.error([
        'protocol-target-unknown',
        `the type \`${targetSource}\` is unknown`,
      ]);
    }
  }

  const problem = conformanceTargetProblem(
    target,
    targetSource,
    protocolNames,
    params !== undefined
  );
  if (problem !== null)
    return ce.error(['protocol-conformance-target-invalid', problem]);

  const targetKey =
    params === undefined
      ? typeToString(target)
      : `${typeToString(target)} where ${clauseToString(params)}`;

  // Validate the overlap rules against EVERY protocol first, so a rejected
  // multi-protocol conformance registers nothing at all.
  for (const record of records) {
    const headConflict = headConflictOf(record, target, targetKey, params);
    if (headConflict !== null)
      return ce.error(['protocol-conformance-overlap', headConflict]);
    const conflict = overlapConflict(record, target, targetKey, params);
    if (conflict !== null)
      return ce.error([
        'protocol-conformance-overlap',
        `\`${targetKey}\` overlaps \`${conflict.other}\` (meet \`${conflict.meet}\`) for the protocol \`${record.name}\`, and neither contains the other. Conform the common supertype, or disjoint refinements, instead.`,
      ]);
  }

  // P47 — a SECOND implementation block for the same (type, protocol) pair
  // WITHIN ONE BATCH is an error; the same statement re-run in a LATER batch
  // replaces (the notebook pattern). The two are told apart by the batch stamp
  // the install leaves behind, and a re-registration of the SAME block — one
  // statement registers up to three times per batch: the static pre-pass
  // canonicalizes it, then the evaluation loop canonicalizes and evaluates it
  // — is not a second block. Checked BEFORE the block is validated: a second
  // block is inadmissible whatever it contains. `impl` implies a single
  // protocol (checked above).
  const batch = ce._epsilBatchId;
  if (impl !== undefined && batch !== undefined) {
    const origin = records[0]!.conformances.find(
      (c) => c.targetKey === targetKey
    )?._implOrigin;
    if (
      origin !== undefined &&
      origin.batch === batch &&
      origin.block !== options?.block
    )
      return ce.error([
        'protocol-implementation-duplicate',
        `the type \`${targetKey}\` already has an implementation of the \`${records[0]!.name}\` protocol in this batch`,
      ]);
  }

  // The implementation block is validated BEFORE anything is stored: a
  // rejected block must leave the previous implementation (and `pending`)
  // untouched, so that a re-run with an edited, broken block does not destroy
  // a working one (P5 + P17). `impl` implies a single protocol (checked above).
  if (impl !== undefined) {
    const failure = implementationProblem(
      ce,
      records[0]!,
      target,
      targetKey,
      impl,
      params
    );
    if (failure !== null) return ce.error([failure.code, failure.message]);
  }

  // Registering a conformance can WIDEN a dispatcher's DERIVED effect set (the
  // union over the conformers of a bare requirement), and a function annotated
  // `pure` that calls through that dispatcher then declares something that is
  // no longer true. Such a statement is BLOCKED, not merely flagged — the same
  // polarity as an `Assign` that violates a declared type — but the contracts
  // can only be re-derived against the LIVE registry, so the registration
  // happens first and is undone if it turns out to have falsified one
  // (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
  // effect").
  const restore = ce._protocolRegistryRollbackPoint();
  /** Did the loop below actually change the registry? A re-declared
   * conformance with no implementation block is a no-op, and re-deriving every
   * declared contract for it would be pure cost. */
  let mutated = false;

  for (const record of records) {
    const existing = record.conformances.find((c) => c.targetKey === targetKey);
    if (existing !== undefined) {
      // A re-declared conformance is a NO-OP (Appendix A) — except that an
      // implementation block fulfils a pending edge, if it COVERS the
      // requirements.
      if (impl !== undefined) {
        mutated = true;
        existing.impl = impl;
        // The stamp rides with the implementation: an install from outside a
        // batch (the box route, P47) leaves it UNSTAMPED and replaces freely.
        if (batch === undefined) delete existing._implOrigin;
        else existing._implOrigin = { batch, block: options?.block };
        existing.pending = !implCoversRequirements(record.members, impl);
        // The new implementation may also fulfil the impl-less edges of the
        // target's SUBTYPES, which inherit it.
        refreshInheritedPending(record);
        ce._noteStateEvent({ kind: 'config' });
        ce._noteConformanceRegistryChange();
      }
      continue;
    }
    const conformance: ConformanceRecord = {
      target,
      targetKey,
      pending: !implCoversRequirements(record.members, impl),
      declaredByStatement: true,
    };
    if (params !== undefined) conformance.where = params;
    if (impl !== undefined) {
      conformance.impl = impl;
      if (batch !== undefined)
        conformance._implOrigin = { batch, block: options?.block };
    }
    record.conformances.push(conformance);
    mutated = true;
    // The new edge may INHERIT an implementation registered for a supertype,
    // and (with a block of its own) may fulfil impl-less subtype edges.
    refreshInheritedPending(record);
    // P16 — a conformance ADDITION must invalidate cached static-dispatch
    // decisions, so it is a `config` event (all axes), not a `declare`.
    ce._noteStateEvent({ kind: 'config' });
    ce._noteConformanceRegistryChange();
  }

  if (mutated) {
    const violations = conformanceWideningViolations(ce);
    if (violations.length > 0) {
      // The rollback thunk emits its own `config` state event and bumps the
      // conformance version when it restores anything, so the unions derived
      // while the registration stood are not served to the restored world.
      // Nothing is emitted here on top of that.
      restore();
      return ce.error([
        'conformance-widens-declared-contract',
        wideningRejectionMessage(violations),
      ]);
    }
  }

  return null;
}

/** A DECLARED effect contract that a conformance registration has falsified —
 * one entry of the `conformance-widens-declared-contract` diagnostic. */
interface WideningViolation {
  /** The name the contract-holder is bound to. */
  name: string;
  /** The effect set its own declaration states; `undefined` is the empty set,
   * spelled `pure` in the diagnostic. */
  declared: EffectSet | undefined;
  /** What re-deriving its body now yields. */
  inferred: EffectSet | undefined;
  /** The labels of {@link inferred} the ceiling {@link declared} does not
   * admit. */
  exceeding: EffectSet;
}

/**
 * Every DECLARED effect contract this engine currently holds that the registry
 * — as it stands right now — has falsified.
 *
 * A protocol dispatcher's effect set is DERIVED from the conformers of a bare
 * requirement, so registering a conformance can widen it, and a function
 * annotated `pure` that calls through that dispatcher then declares something
 * untrue. The engine therefore re-derives, after a registration, the effect set
 * of every definition that carries an EXPLICIT effect specifier. That index is
 * small by construction: a bare arrow leaves effects on the inferred track, so
 * an annotation is a deliberate act, and a definition with no body of its own —
 * a host-implemented library operator — has nothing to re-derive and cannot be
 * violated by anything in this registry.
 *
 * Transitivity needs no dependency graph: re-derivation walks bodies and reads
 * each callee's effect set through the definition getters, which consult the
 * dispatcher derivers, so a contract that reaches a dispatcher only through
 * intermediate functions is caught as well.
 *
 * A holder whose re-derivation throws, or whose walk hit an unresolved named
 * head, is skipped — the walk has nothing to say about it, the same trusted
 * posture the install-time annotation check takes for an opaque head
 * (`boxed-operator-definition.ts`).
 *
 * (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an effect".)
 */
function conformanceWideningViolations(
  ce: IComputeEngine
): WideningViolation[] {
  const violations: WideningViolation[] = [];
  const seenNames = new Set<string>();
  const seenDefs = new Set<BoxedDefinition>();
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope) {
    for (const [name, def] of scope.bindings) {
      // Innermost binding wins: an outer definition of a shadowed name cannot
      // be called, so its contract cannot be exercised.
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      // One definition record bound under two names is one contract.
      if (seenDefs.has(def)) continue;
      seenDefs.add(def);
      const violation = contractViolation(ce, name, def);
      if (violation !== null) violations.push(violation);
    }
    scope = scope.parent;
  }
  return violations;
}

/** Is `def` a declared-effect contract the current registry has falsified?
 * See {@link conformanceWideningViolations} for the rule; this is the per-
 * definition half, which reads the contract off whichever half of the binding
 * carries it. */
function contractViolation(
  ce: IComputeEngine,
  name: string,
  def: BoxedDefinition
): WideningViolation | null {
  if (isOperatorDef(def)) {
    const operator = def.operator;
    // No body, no re-derivation: a host operator's declared set describes host
    // code, which no conformance can change.
    if (!operator.effectsDeclared) return null;
    const literal = operator._lambdaLiteral;
    if (literal === undefined) return null;
    // For a CONTRACT definition this getter is the stated set verbatim: a
    // declared contract never installs a `_deriveEffects` hook (see
    // `boxed-operator-definition.ts`, "A declared contract never re-derives").
    return exceededContract(ce, name, literal, operator.effects);
  }
  if (isValueDef(def)) {
    const value = def.value;
    if (!value.effectsDeclared) return null;
    const declared = signatureEffects(value.type.type);
    if (declared === undefined) return null;
    const literal = value.value;
    if (literal === undefined || !isFunction(literal, 'Function')) return null;
    return exceededContract(ce, name, literal, declared);
  }
  return null;
}

/** Re-derive `literal`'s effect set and compare it against the `declared`
 * contract, `null` when the contract still holds (or when the walk has nothing
 * to say). `name` rides as the walk's self-name so a recursive body does not
 * read its own head as an unknown. */
function exceededContract(
  ce: IComputeEngine,
  name: string,
  literal: Expression,
  declared: EffectSet | undefined
): WideningViolation | null {
  let inferred: ReturnType<typeof inferFunctionLiteralEffects>;
  try {
    inferred = inferFunctionLiteralEffects(ce, literal, { selfName: name });
  } catch {
    return null;
  }
  if (inferred.unresolvedHead) return null;
  if (isEffectSubset(inferred.effects, declared)) return null;
  const excess = subtractEffects(
    inferred.effects,
    declared === undefined || declared === 'any' ? undefined : declared
  );
  return {
    name,
    declared,
    inferred: inferred.effects,
    // An `'any'` (or co-finite) excess has no enumerable labels: it is the top
    // of the lattice, "unknown effects".
    exceeding:
      excess === undefined || excess === 'any' || isCoFiniteEffects(excess)
        ? 'any'
        : excess,
  };
}

/** The `conformance-widens-declared-contract` message: EVERY violated
 * dependent, with the set it declares, the set it would now infer, and the
 * labels that exceed its ceiling — plus the two remedies Appendix B names
 * ("widen or remove the dependent's annotation, or don't conform").
 *
 * `subject` and `remedy` name the statement being rejected, since the same
 * diagnostic serves a conformance registration (`declareConformance`) and a
 * protocol replacement (`declareProtocolImpl`), which widens through the same
 * derived dispatcher effects. */
function wideningRejectionMessage(
  violations: readonly WideningViolation[],
  subject = 'registering this conformance',
  remedy = 'do not register this conformance'
): string {
  const text = (effects: EffectSet | undefined): string =>
    effects === undefined ? 'pure' : effectSetToString(effects);
  const each = violations
    .map(
      (v) =>
        `\`${v.name}\` declares \`${text(v.declared)}\` but would infer \`${text(v.inferred)}\` (exceeding: \`${text(v.exceeding)}\`)`
    )
    .join('; ');
  return `${subject} would make dispatched calls more effectful than declared contracts allow: ${each}. Widen or remove those effect annotations, or ${remedy}`;
}

/**
 * Does `impl` COVER every requirement of `members`?
 *
 * COVERAGE only — the keys that must be present — never the signature or the
 * type of what they are bound to (that is {@link implementationProblem}). An
 * empty block on a protocol WITH requirements therefore leaves the conformance
 * pending instead of silently fulfilling it. Kept as the cheap PRE-CHECK on
 * the `pending` flag: since phase 2 a stored block has already been validated,
 * so on that path this can only answer `true`.
 *
 * The mangling of the property keys is the design's (`__get__x` / `__set__x`).
 * A SEMANTIC protocol (no members) is covered by every block, and by none.
 */
function implCoversRequirements(
  members: Record<string, ProtocolMember>,
  impl: Record<string, Expression | JSImplementation> | undefined
): boolean {
  const names = Object.keys(members);
  if (names.length === 0) return true;
  if (impl === undefined) return false;

  // The block may come from a host with an ordinary (prototyped) object, so
  // membership is an OWN-key question: `'toString' in impl` must not pass.
  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(impl, key);

  for (const member of names) {
    const kind = members[member]!.kind;
    if (kind === 'function') {
      if (!has(member)) return false;
      continue;
    }
    if (!has(`__get__${member}`)) return false;
    if (kind === 'readwrite' && !has(`__set__${member}`)) return false;
  }
  return true;
}

/**
 * Recompute the `pending` flag of every implementation-LESS conformance edge
 * of `record`.
 *
 * An edge without a block of its own is NOT necessarily pending: an
 * implementation registered for a SUPERTYPE satisfies the completeness
 * requirement (Appendix A "Lattice inheritance and overlap"), so
 * `type integer is Comparable` is complete on the spot when `number` already
 * has a fulfilled implementation. The dependency runs BETWEEN edges, so the
 * whole set is recomputed whenever an implementation lands or the requirement
 * set changes.
 *
 * Every impl-less edge is reset to pending first, then the pass runs to a
 * fixed point (inheritance is transitive: an `integer` edge may inherit from a
 * `number` edge that itself inherits) — starting from `true` keeps a pair of
 * mutually-comparable targets from holding each other non-pending.
 */
function refreshInheritedPending(record: ProtocolRecord): void {
  // A SEMANTIC protocol (no requirements) is covered by the empty block, so
  // none of its edges is ever pending.
  const pendingByDefault = !implCoversRequirements(record.members, undefined);
  const inherited = record.conformances.filter((c) => c.impl === undefined);
  for (const c of inherited) c.pending = pendingByDefault;
  if (!pendingByDefault) return;

  let changed = true;
  while (changed) {
    changed = false;
    for (const c of inherited) {
      if (!c.pending) continue;
      // A CONDITIONAL edge inherits only from an edge whose target contains
      // EVERY instantiation of its head (the widest instantiation is the
      // stand-in); and a conditional edge is never inherited FROM — its
      // implementation applies only under its own condition, which the
      // inheriting edge does not carry.
      const own = edgeComparisonTarget(c);
      const inherits = record.conformances.some(
        (other) =>
          other !== c &&
          !other.pending &&
          other.where === undefined &&
          isSubtype(own, other.target)
      );
      if (inherits) {
        c.pending = false;
        changed = true;
      }
    }
  }
}

/**
 * The one-conditional-per-(head, protocol) rule and its companion, "a
 * conditional conformance excludes an unconditional one on the same head"
 * (Appendix A "Conditional Conformance"). Both orders, since a conformance may
 * arrive in either.
 *
 * `null` when the new target is admissible. Reported as
 * `protocol-conformance-overlap`, the same code the P4 meet rule uses: to an
 * author both are "two conformances of one protocol competing for one value".
 */
function headConflictOf(
  record: ProtocolRecord,
  target: Type,
  targetKey: string,
  params: readonly TypeParameter[] | undefined
): string | null {
  const head = headKeyOf(target);
  for (const c of record.conformances) {
    if (c.targetKey === targetKey) continue; // A duplicate, handled by caller.
    if (params === undefined && c.where === undefined) continue; // The P4 rule's job.
    if (headKeyOf(c.target) !== head) continue;
    const conditional = params !== undefined ? targetKey : c.targetKey;
    const other = params !== undefined ? c.targetKey : targetKey;
    return `\`${conditional}\` is a conditional conformance to \`${record.name}\`, and \`${other}\` already conforms on the same head \`${head}\`. v1 allows at most one conformance per head and protocol — no specialization among conditional witnesses.`;
  }
  return null;
}

/**
 * The P4 overlap rule: a new target that OVERLAPS an existing conforming type
 * for the same protocol without being COMPARABLE to it (neither is a subtype
 * of the other) would make dispatch ambiguous for the values in the
 * intersection.
 *
 * Returns the offending pair, or `null` when the target is admissible.
 */
function overlapConflict(
  record: ProtocolRecord,
  target: Type,
  targetKey: string,
  params?: readonly TypeParameter[]
): { other: string; meet: string } | null {
  // A CONDITIONAL target is not a set of values the meet algebra can weigh: its
  // head-level collisions are ruled by {@link headConflictOf}, and against a
  // DIFFERENT head it cannot overlap at all.
  if (params !== undefined) return null;
  for (const c of record.conformances) {
    if (c.targetKey === targetKey) continue; // A duplicate, handled by caller.
    if (c.where !== undefined) continue; // Ditto, from the other side.
    // Comparable targets are the `number`/`integer` refinement case, which is
    // explicitly allowed: the more specific implementation wins at dispatch.
    if (isSubtype(target, c.target) || isSubtype(c.target, target)) continue;
    if (!typesOverlap(target, c.target)) continue;
    return { other: c.targetKey, meet: meetDescription(target, c.target) };
  }
  return null;
}

/** The meet of two overlapping targets, for the diagnostic's benefit. */
function meetDescription(a: Type, b: Type): string {
  try {
    return typeToString(reduceType({ kind: 'intersection', types: [a, b] }));
  } catch {
    return 'a non-empty intersection';
  }
}

//
// ── Implementation validation (phase 2, ruling P17) ──────────────────────────
//
// An implementation block is checked against the protocol's requirements
// BEFORE it is stored. Everything below is a PURE reader over the block and
// the requirements: it registers nothing, so a caller can reject atomically.
//

/** A rejected implementation: the error code and its message. The statement
 * route turns this into an error VALUE, the host route into a throw. */
type ImplementationProblem = { code: string; message: string };

const GET_PREFIX = '__get__';
const SET_PREFIX = '__set__';

/**
 * A resolver in which `Self` denotes the conformance TARGET (P12). The
 * reference is an ALIAS — structurally transparent, so subtyping sees straight
 * through to the target — and takes the target's own NAME, so a signature
 * serializes with the substitution already applied (`(self: string, other:
 * string) -> string`), which is what the mismatch diagnostic quotes.
 *
 * This is also what makes `Self` and the target's own name synonyms inside an
 * IMPLEMENTATION (Appendix A "Protocol Implementation"): both spellings reach
 * the very same type.
 */
function selfSubstitutingResolver(
  base: TypeResolver,
  target: Type,
  targetKey: string,
  params?: readonly TypeParameter[],
  options?: { opaqueVariables?: boolean }
): TypeResolver {
  const self: TypeReference = {
    kind: 'reference',
    name: targetKey,
    alias: true,
    def: target,
  };
  // The clause variables of a CONDITIONAL conformance, each read as its own
  // BOUND (`any` when unbounded) — the widest instantiation, which is also what
  // `target` is here. An implementation's annotations may spell `list<T>`, and
  // reading `T` as an open variable instead would hand `isSubtype` a
  // non-ground type; at the widest instantiation the P17 check stays exactly
  // the ground signature comparison it is for every other conformance.
  //
  // `opaqueVariables` reads them as NOMINAL references instead — still ground,
  // but a subtype of nothing but themselves, so ordinary subtyping enforces a
  // match up to the clause BINDING rather than at the widest instantiation.
  // That is what a COVARIANT position needs (see {@link clauseVariablePattern}).
  const variables: Record<string, TypeReference> = Object.create(null);
  for (const p of params ?? [])
    variables[p.name] = {
      kind: 'reference',
      name: p.name,
      alias: options?.opaqueVariables !== true,
      def: p.bound ?? 'any',
    };
  const lookupName = (name: string): TypeReference | undefined =>
    name === SELF_TYPE_NAME
      ? self
      : Object.prototype.hasOwnProperty.call(variables, name)
        ? variables[name]
        : undefined;
  return {
    get names(): string[] {
      return [...base.names, SELF_TYPE_NAME, ...Object.keys(variables)];
    },
    forward: (name: string) => lookupName(name) ?? base.forward(name),
    resolve: (name: string) => lookupName(name) ?? base.resolve(name),
    conformsTo: base.conformsTo,
  };
}

/** The type-expression SOURCE carried by an operand — a `{str: …}` node, or a
 * bare symbol (`["Typed", "self", "Self"]` after a round trip). */
function typeTextOf(op: Expression | undefined): string | undefined {
  if (op === undefined) return undefined;
  return isString(op) ? op.string : sym(op);
}

/**
 * The signature an implementation function literal DECLARES.
 *
 * Read STRUCTURALLY off the raw `["Function", body, …params]` expression: the
 * block reaches the handler uncanonicalized (its annotations mention `Self`,
 * which no ordinary type resolver knows), so there is no boxed type to ask.
 * The decomposition of the return marker follows
 * `functionLiteralDeclaredSignature`'s predicate exactly — an ungrouped text
 * that parses to a signature is the literal's own contract, anything else is a
 * plain return-type ascription.
 *
 * Under-declaration is not an error (documented v1 behavior): an unannotated
 * parameter is `any` (so it passes contravariance), and a literal with no
 * return marker declares no result and no effects, which are then left
 * unchecked rather than inferred — inference would require canonicalizing the
 * body.
 */
function declaredImplementationSignature(
  fn: Expression,
  resolver: TypeResolver
): {
  args: Type[];
  result?: Type;
  effects?: EffectSet;
} | null {
  if (!isFunction(fn, 'Function')) return null;

  const args: Type[] = [];
  /** Which positions the literal's own operands left UNANNOTATED — the
   * positions a marker signature is the only remaining source for. */
  const bare: boolean[] = [];
  for (const param of fn.ops.slice(1)) {
    const text = isFunction(param, 'Typed')
      ? typeTextOf(param.ops[1])
      : undefined;
    if (text === undefined) {
      args.push('any');
      bare.push(true);
      continue;
    }
    args.push(parseType(text, resolver));
    bare.push(false);
  }

  // The return marker, read through the shared accessor so the authoring form
  // (`["Function", ["Typed", body, T], …]`, which is what the parse and box
  // routes deliver) and the canonical one (the marker inside the body Block)
  // are recognized identically.
  const marker = functionLiteralReturnMarker(fn);
  const markerText =
    marker === undefined ? undefined : typeTextOf(marker.ops[1]);
  if (markerText === undefined) return { args };

  if (!isGroupedTypeText(markerText)) {
    const declared = parseType(markerText, resolver);
    if (typeof declared === 'object' && declared.kind === 'signature') {
      // A marker signature IS the literal's own contract, so it is also where
      // the declared type of an ERASED parameter survives: under a conditional
      // conformance a parameter whose annotation mentions a clause variable
      // lowers to a bare symbol (§3.1), and without this the P17 check would
      // read it as `any` and accept anything. Clause variables are read as
      // their BOUNDS, keeping every type the subtype check sees ground.
      const marked = declared.args ?? [];
      const quantifiers = declared.typeParams ?? [];
      if (marked.length === args.length)
        for (let i = 0; i < args.length; i++)
          if (bare[i] === true)
            args[i] = widestConditionalTarget(marked[i]!.type, quantifiers);
      return {
        args,
        result: declared.result,
        effects: signatureEffects(declared),
      };
    }
  }
  return { args, result: parseType(markerText, resolver) };
}

/**
 * The clause variables of a conditional conformance as OPAQUE (nominal)
 * references to their own bounds — the P12 substitution trick applied to the
 * clause. A nominal reference is a subtype of nothing but itself, so ordinary
 * subtyping over the substituted head reads as "matches the pattern up to the
 * clause binding": `list<T>` and `Self` are the same type, `list<number>` is
 * not. Ground throughout, so nothing open ever reaches `isSubtype`.
 */
function clauseVariablePattern(
  params?: readonly TypeParameter[]
): Record<string, Type> {
  const variables: Record<string, Type> = Object.create(null);
  for (const p of params ?? [])
    variables[p.name] = {
      kind: 'reference',
      name: p.name,
      alias: false,
      def: p.bound ?? 'any',
    };
  return variables;
}

/**
 * The result an implementation DECLARES, read at the head pattern: `undefined`
 * when it declares none (P28 leaves those trusted).
 *
 * Two spellings of a clause variable reach here. An annotation parsed through
 * `patternResolver` resolves `T` as the opaque reference directly; but the
 * marker signature a lowered conditional implementation carries quotes the
 * conformance's own clause (`(self: list<T>) -> list<T> where T: number`), so
 * there `T` is bound by the signature's own quantifier and stays a type
 * VARIABLE — which is what `patternVariables` substitutes.
 */
function declaredPatternResult(
  fn: Expression,
  patternResolver: TypeResolver,
  patternVariables: Record<string, Type>
): Type | undefined {
  let declared: ReturnType<typeof declaredImplementationSignature>;
  try {
    declared = declaredImplementationSignature(fn, patternResolver);
  } catch {
    // The widest-instantiation parse of the very same signature succeeded (it
    // ran first), so there is nothing this reading could add.
    return undefined;
  }
  if (declared?.result === undefined) return undefined;
  return substituteTypeVariables(declared.result, patternVariables);
}

/**
 * The tail of an effect-CEILING diagnostic: what the implementation carries
 * (`lead` names where that set came from — its declaration, or its body), what
 * the requirement admits, which labels exceed it, and the two ways out.
 *
 * `carried` is known NOT to fit `allowed`; the caller tested it. `'any'` is the
 * top of the effect lattice — "unknown effects", not an enumerable set of
 * labels — so an `'any'` carrier is reported as unknown, and an excess that is
 * `'any'` or co-finite (what `subtractEffects` produces from an `'any'`
 * carrier) is reported as `any` rather than as a list.
 *
 * A requirement's effect specifier is a CEILING, not a prediction, and a
 * rejection must name the exceeded label and point at the ceiling as a possible
 * fix site (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
 * effect").
 */
function effectCeilingDetail(
  lead: string,
  carried: EffectSet,
  allowed: EffectSet,
  site: string
): string {
  const carriedText =
    carried === 'any' ? '`any` (unknown)' : `\`${effectSetToString(carried)}\``;
  const excess = subtractEffects(
    carried,
    allowed === 'any' ? undefined : allowed
  );
  const excessText =
    excess === undefined || excess === 'any' || isCoFiniteEffects(excess)
      ? 'any'
      : effectSetToString(excess);
  return `${lead} ${carriedText}; the requirement's ceiling on \`${site}\` is \`${effectSetToString(allowed)}\` — exceeded by \`${excessText}\`. Make the implementation purer, or widen the ceiling`;
}

/**
 * Match an implementation signature against a requirement: same arity,
 * parameters CONTRAVARIANT, result COVARIANT, effects equal-or-purer (P17).
 *
 * The comparison is componentwise rather than one whole-signature
 * `isSubtype()` so the diagnostic can name the offending position; the
 * verdicts are the same predicate `isSubtype` applies to a signature pair.
 *
 * `site` is the requirement's qualified name (`Comparable.compare`) — the
 * ceiling's own fix site, which the effects diagnostic points at.
 */
function signatureMismatch(
  impl: { args: Type[]; result?: Type; effects?: EffectSet },
  requirement: FunctionSignature,
  site: string,
  options?: { checkResult?: boolean }
): string | null {
  const expected = requirement.args ?? [];
  if (impl.args.length !== expected.length)
    return `it takes ${impl.args.length} parameter${impl.args.length === 1 ? '' : 's'}; the requirement takes ${expected.length}`;

  for (let i = 0; i < expected.length; i++) {
    // CONTRAVARIANT: the implementation must accept everything the
    // requirement may hand it — its parameter may WIDEN, never narrow.
    if (!isSubtype(expected[i]!.type, impl.args[i]!))
      return `argument ${i + 1} is \`${typeToString(impl.args[i]!)}\`; expected \`${typeToString(expected[i]!.type)}\` or a supertype`;
  }

  // COVARIANT: the result may narrow. An implementation that declares no
  // result leaves it unchecked (see `declaredImplementationSignature`).
  if (
    (options?.checkResult ?? true) &&
    impl.result !== undefined &&
    !isSubtype(impl.result, requirement.result)
  )
    return `the result is \`${typeToString(impl.result)}\`; expected \`${typeToString(requirement.result)}\` or a subtype`;

  // Effects: equal or PURER — but only where the requirement actually SPELLS a
  // specifier. A bare requirement imposes no bound at all: a protocol function
  // is a dispatcher over an open set of conforming bodies, so making a
  // requirement anticipate every capability some future conformer might need
  // was rejected as a design (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B,
  // "Changing a field is an effect"; the rejected alternative is named there as
  // "bare-means-pure ceilings on requirements"). The gate therefore tests for
  // `undefined` — nothing spelled — and never for emptiness: an explicit `pure`
  // parses to the STATED empty set, which is a real ceiling, and the strongest
  // one.
  //
  // This clause sees only what the implementation DECLARES. A bare-marker
  // implementation declares nothing, so its BODY is checked separately, by the
  // inferred-effects clause in `implementationProblem`.
  const allowed = signatureEffects(requirement);
  if (allowed !== undefined && !isEffectSubset(impl.effects, allowed))
    return effectCeilingDetail(
      'it declares the effects',
      // Not `undefined`: the empty set fits every ceiling, so the test above
      // could not have failed for it.
      impl.effects!,
      allowed,
      site
    );

  return null;
}

/** The closest member name to `name`, for a did-you-mean. Conservative: a
 * distance of at most 2, and never on a name too short for a typo to be
 * distinguishable from a different word. */
function suggestMemberName(
  name: string,
  candidates: readonly string[]
): string | undefined {
  if (name.length < 3) return undefined;
  const max = name.length >= 6 ? 2 : 1;
  let best: string | undefined = undefined;
  let bestDistance = max + 1;
  for (const candidate of candidates) {
    if (candidate === name) return candidate;
    const d = osaDistance(name.toLowerCase(), candidate.toLowerCase(), max);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

/** `protocol-member-unknown`, with a did-you-mean when a close member exists.
 * `candidates` is EVERY member name, whatever kind the offending key has: a
 * misspelled `function hsah` is a typo of the `readonly hash` requirement, and
 * suggesting it is more useful than staying silent. (An EXACT name of the
 * wrong kind never reaches here — it is steered by its own message above.) */
function unknownMemberProblem(
  protocol: string,
  spelled: string,
  candidates: readonly string[]
): ImplementationProblem {
  const suggestion = suggestMemberName(spelled, candidates);
  return {
    code: 'protocol-member-unknown',
    message:
      `\`${spelled}\` is not a member of the \`${protocol}\` protocol.` +
      (suggestion !== undefined ? ` Did you mean \`${suggestion}\`?` : ''),
  };
}

/**
 * Validate an implementation block against a protocol's requirements, at
 * `Self = target`. Returns the FIRST problem, or `null` when the block is a
 * complete and well-typed implementation.
 *
 * Order of verdicts (Appendix A's example emits them in this order): every key
 * the block provides is checked first — unknown member, then `set` on a
 * `readonly` property, then the signature — and the completeness check comes
 * last, so a misspelled member reports the misspelling rather than the hole it
 * leaves.
 *
 * A HOST callback ({@link JSImplementation}) carries no signature the engine
 * can read and is TRUSTED, like a host-declared operator handler: it takes
 * part in the coverage and unknown-member checks only.
 */
function implementationProblem(
  ce: IComputeEngine,
  record: ProtocolRecord,
  target: Type,
  targetKey: string,
  impl: Record<string, Expression | JSImplementation>,
  params?: readonly TypeParameter[]
): ImplementationProblem | null {
  const members = record.members;
  const memberNames = Object.keys(members);
  // How `Self` is SPELLED in this block's diagnostics: the target's own key, or
  // — for a conditional conformance — its head pattern alone (the key also
  // carries the clause, which is not part of the type).
  const selfName = params === undefined ? targetKey : typeToString(target);
  // A CONDITIONAL conformance is checked at its WIDEST instantiation (every
  // clause variable read as its bound): the check must stay a ground signature
  // comparison, and a signature that holds for the widest instantiation holds
  // for every narrower one — the parameters are contravariant.
  //
  // COVARIANT positions are the exception, and are checked against the head
  // PATTERN instead (`patternResolver`, clause variables opaque): at the widest
  // instantiation an implementation declaring `-> list<number>` satisfies
  // `-> Self`, while dispatch at a `list<integer>` receiver types the call
  // `list<integer>`. Against the pattern, `-> Self` and `-> list<T>` pass and
  // `-> list<number>` does not.
  const patternVariables = clauseVariablePattern(params);
  const patternTarget =
    params === undefined
      ? target
      : substituteTypeVariables(target, patternVariables);
  const patternResolver =
    params === undefined
      ? undefined
      : selfSubstitutingResolver(
          ce._typeResolver,
          patternTarget,
          selfName,
          params,
          { opaqueVariables: true }
        );
  if (params !== undefined) target = widestConditionalTarget(target, params);
  const resolver = selfSubstitutingResolver(
    ce._typeResolver,
    target,
    selfName,
    params
  );

  /** The requirement signature of a member, at `Self = target` — or, with `at`
   * supplied, at whatever that resolver makes of `Self` and the clause
   * variables (the head pattern, for the covariant checks). */
  const requirementOf = (
    member: string,
    accessor: 'get' | 'set' | null,
    at: TypeResolver = resolver
  ): FunctionSignature | ImplementationProblem => {
    const requirement = members[member]!;
    try {
      if (accessor === null) {
        const parsed = parseType(
          (requirement as { signature: string }).signature,
          at
        );
        if (typeof parsed !== 'object' || parsed.kind !== 'signature')
          throw Error('not a signature');
        return parsed;
      }
      const propertyType = parseType(
        (requirement as { type: string }).type,
        at
      );
      const self = { name: 'self', type: parseType(SELF_TYPE_NAME, at) };
      // The `set` handler's result rides as `any` here and is skipped by
      // `checkResult: false`: it is not the property's type, so the ordinary
      // covariant result check has nothing to say about it. What it MUST fit —
      // the receiver, which the write rebinds — is checked separately, and only
      // when the handler declares a result (P25 amendment; P28 keeps an
      // unannotated one trusted).
      return accessor === 'get'
        ? { kind: 'signature', args: [self], result: propertyType }
        : {
            kind: 'signature',
            args: [self, { name: 'value', type: propertyType }],
            result: 'any',
          };
    } catch (e) {
      return {
        code: 'protocol-signature-mismatch',
        message: `the requirement \`${record.name}.${member}\` does not parse at \`Self = ${selfName}\`: ${messageOf(e)}`,
      };
    }
  };

  for (const key of Object.keys(impl)) {
    const accessor = key.startsWith(GET_PREFIX)
      ? 'get'
      : key.startsWith(SET_PREFIX)
        ? 'set'
        : null;
    const member = accessor === null ? key : key.slice(GET_PREFIX.length); // Same length.
    const requirement = members[member];

    if (accessor === null) {
      // A member of the WRONG KIND is not "unknown" in the plain sense, so the
      // message steers to the spelling that would implement it instead of
      // proposing a near-miss name.
      if (requirement !== undefined && requirement.kind !== 'function')
        return {
          code: 'protocol-member-unknown',
          message: `\`${member}\` is a ${requirement.kind} PROPERTY of the \`${record.name}\` protocol, not a function; implement it with \`get ${member}(…)\``,
        };
      if (requirement === undefined)
        return unknownMemberProblem(record.name, member, memberNames);
    } else {
      if (requirement?.kind === 'function')
        return {
          code: 'protocol-member-unknown',
          message: `\`${member}\` is a FUNCTION member of the \`${record.name}\` protocol, not a property; implement it with \`function ${member}(…)\``,
        };
      if (requirement === undefined)
        return unknownMemberProblem(record.name, member, memberNames);
      // A `readonly` property has no `set` handler to implement.
      if (accessor === 'set' && requirement.kind === 'readonly')
        return {
          code: 'protocol-property-readonly-set',
          message: `the property \`${record.name}.${member}\` is \`readonly\`; it has no \`set\` handler`,
        };
    }

    // A host callback is trusted: there is no signature to check.
    const value = impl[key]!;
    if (!isExpressionImplementation(value)) continue;

    const expected = requirementOf(member, accessor);
    if (!('kind' in expected)) return expected;

    let declared: ReturnType<typeof declaredImplementationSignature>;
    try {
      declared = declaredImplementationSignature(value, resolver);
    } catch (e) {
      return {
        code: 'protocol-signature-mismatch',
        message: `the signature of \`${describeMember(accessor, member)}\` does not parse at \`Self = ${selfName}\`: ${messageOf(e)}`,
      };
    }
    const detail =
      declared === null
        ? 'it is not a function literal'
        : signatureMismatch(declared, expected, `${record.name}.${member}`, {
            // A CONDITIONAL conformance's result is a covariant position: it is
            // checked against the head PATTERN below, not at the widest
            // instantiation.
            checkResult: accessor !== 'set' && patternResolver === undefined,
          });
    if (detail !== null)
      return {
        code: 'protocol-signature-mismatch',
        message: `the signature of \`${describeMember(accessor, member)}\` does not match \`${record.name}.${member}\` at \`Self = ${selfName}\` — expected \`${typeToString(expected)}\` (${detail})`,
      };

    // The INFERRED half of the effect ceiling. The clause above compares what
    // the implementation DECLARES, and a bare-marker implementation declares
    // nothing — so under a ceiling its BODY is what must be checked, or a
    // `pure` requirement would accept an implementation that calls `Random()`.
    // Function members only: the property signatures `requirementOf` builds are
    // synthesized here and carry no effect specifier, so they impose no
    // ceiling. (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is
    // an effect".)
    //
    // Like the rest of the loop this runs at `Self = target`; the walk reads
    // heads by name and needs no resolver.
    const ceiling = accessor === null ? signatureEffects(expected) : undefined;
    if (ceiling !== undefined) {
      let inferred: ReturnType<typeof inferFunctionLiteralEffects> | undefined;
      try {
        inferred = inferFunctionLiteralEffects(ce, value);
      } catch {
        // A walk that cannot run says nothing about the body; the declared
        // clause above has already had its say.
        inferred = undefined;
      }
      // An UNRESOLVED named head leaves the walk with `{any}` for a reason it
      // cannot distinguish from "not defined yet", so the check is skipped —
      // the same trusted posture the definition-annotation check takes for an
      // opaque head (`boxed-operator-definition.ts`, the trusted-annotation
      // escape).
      if (
        inferred !== undefined &&
        !inferred.unresolvedHead &&
        !isEffectSubset(inferred.effects, ceiling)
      )
        return {
          code: 'protocol-signature-mismatch',
          message: `the body of \`${describeMember(accessor, member)}\` ${effectCeilingDetail(
            'infers the effects',
            // Not `undefined`: the empty set fits every ceiling.
            inferred.effects!,
            ceiling,
            `${record.name}.${member}`
          )}`,
        };
    }

    // The COVARIANT positions of a CONDITIONAL conformance, at the head pattern
    // (the clause variables opaque). A result the implementation does not
    // declare stays trusted (P28), exactly as at the widest instantiation.
    const patternResult =
      patternResolver === undefined || declared === null
        ? undefined
        : declaredPatternResult(value, patternResolver, patternVariables);
    if (patternResolver !== undefined && accessor !== 'set') {
      const at = requirementOf(member, accessor, patternResolver);
      if (!('kind' in at)) return at;
      if (patternResult !== undefined && !isSubtype(patternResult, at.result))
        return {
          code: 'protocol-signature-mismatch',
          message: `the signature of \`${describeMember(accessor, member)}\` does not match \`${record.name}.${member}\` at \`Self = ${selfName}\` — expected \`${typeToString(at)}\` (the result is \`${typeToString(patternResult)}\`; expected \`${typeToString(at.result)}\` or a subtype at every instantiation of the clause)`,
        };
    }

    // P25 amendment — a setter's result is not the PROPERTY's type: it REBINDS
    // the receiver (P2's assignment sugar), and `ProtocolProperty` types the
    // write as the receiver. An ANNOTATED result must therefore fit the
    // receiver; an unannotated one stays trusted (P28), exactly as every other
    // undeclared result does. Under a conditional conformance the receiver is
    // the head PATTERN, for the same covariance reason as the result above.
    if (accessor === 'set' && declared?.result !== undefined)
      if (!isSubtype(patternResult ?? declared.result, patternTarget))
        return {
          code: 'protocol-signature-mismatch',
          message: `the result of \`${describeMember(accessor, member)}\` is \`${typeToString(patternResult ?? declared.result)}\`; a \`set\` handler rebinds the receiver, so it must be \`${selfName}\` or a subtype`,
        };
  }

  // Completeness, last: a member is missing when the block provides no key for
  // it. A `readwrite` property needs BOTH accessors — a `set` without a `get`
  // is reported as the missing GETTER.
  const missing: string[] = [];
  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(impl, key);
  for (const member of memberNames) {
    const kind = members[member]!.kind;
    if (kind === 'function') {
      if (!has(member)) missing.push(member);
      continue;
    }
    if (!has(`${GET_PREFIX}${member}`)) missing.push(`get ${member}`);
    if (kind === 'readwrite' && !has(`${SET_PREFIX}${member}`))
      missing.push(`set ${member}`);
  }
  if (missing.length > 0)
    return {
      code: 'protocol-implementation-missing',
      message: `the \`${record.name}\` protocol expects a definition of \`${missing.join('`, `')}\``,
    };

  return null;
}

/** `compare`, `get hash`, `set name` — how a member is spelled in a
 * diagnostic. */
function describeMember(
  accessor: 'get' | 'set' | null,
  member: string
): string {
  return accessor === null ? member : `${accessor} ${member}`;
}

/** An Epsil function literal, as opposed to a host callback (P10). */
function isExpressionImplementation(
  value: Expression | JSImplementation
): value is Expression {
  return typeof (value as JSImplementation).host !== 'function';
}

//
// ── Host implementation API ──────────────────────────────────────────────────
//

/**
 * `ce.declareProtocolImplementation()` — the HOST channel (Appendix A "Host
 * API"). THROWS on every error, where the Epsil statement route returns error
 * values; a second host implementation of the same (type, protocol) pair
 * throws rather than replacing (P5).
 *
 * The conformance edge is declared by this very call when it is not already
 * registered — a host implementation IS a conformance declaration.
 */
export function declareProtocolImplementationImpl(
  ce: IComputeEngine,
  targetSource: string,
  protocolName: string,
  impl: ProtocolImplementationInput,
  options?: { where?: string }
): void {
  const whereText = options?.where;
  if (whereText !== undefined && typeof whereText !== 'string')
    throw Error(
      'protocol-conformance-target-invalid: the `where` option must be the clause source text, e.g. `{ where: "T is Comparable" }`'
    );

  const record = ce._protocolRegistry[protocolName];
  if (record === undefined)
    throw Error(
      `protocol-unknown: the protocol \`${protocolName}\` is unknown`
    );

  let target: Type;
  let params: TypeParameter[] | undefined;
  if (whereText !== undefined) {
    const conditional = parseConditionalTarget(ce, targetSource, whereText);
    if (conditional.problem !== undefined)
      throw Error(
        `protocol-conformance-target-invalid: ${conditional.problem}`
      );
    target = conditional.head;
    params = conditional.params;
  } else {
    try {
      target = parseType(targetSource, ce._typeResolver);
    } catch {
      throw Error(
        `protocol-target-unknown: the type \`${targetSource}\` is unknown`
      );
    }
  }
  const problem = conformanceTargetProblem(
    target,
    targetSource,
    [protocolName],
    params !== undefined
  );
  if (problem !== null)
    throw Error(`protocol-conformance-target-invalid: ${problem}`);

  const targetKey =
    params === undefined
      ? typeToString(target)
      : `${typeToString(target)} where ${clauseToString(params)}`;
  const existing = record.conformances.find((c) => c.targetKey === targetKey);
  if (existing?.impl !== undefined)
    throw Error(
      `protocol-implementation-duplicate: the type \`${targetKey}\` already has an implementation of the \`${protocolName}\` protocol`
    );

  if (existing === undefined) {
    const headConflict = headConflictOf(record, target, targetKey, params);
    if (headConflict !== null)
      throw Error(`protocol-conformance-overlap: ${headConflict}`);
    const conflict = overlapConflict(record, target, targetKey, params);
    if (conflict !== null)
      throw Error(
        `protocol-conformance-overlap: \`${targetKey}\` overlaps \`${conflict.other}\` (meet \`${conflict.meet}\`) for the protocol \`${protocolName}\`, and neither contains the other`
      );
  }

  // The three buckets flatten onto the internal keys — the `__get__x` /
  // `__set__x` mangling is not part of the public surface.
  const members: Record<string, JSImplementation> = Object.create(null);
  const add = (key: string, fn: unknown): void => {
    if (typeof fn !== 'function')
      throw Error(
        `The implementation of \`${protocolName}.${key}\` must be a function`
      );
    // The three buckets share one key space once mangled, so
    // `functions['__get__x']` and `getters['x']` collide — silently keeping
    // the last. Rejected rather than resolved: neither spelling is the
    // obvious winner.
    if (members[key] !== undefined)
      throw Error(
        `protocol-implementation-duplicate: the implementation of \`${protocolName}\` provides \`${key}\` more than once`
      );
    members[key] = { host: fn as ProtocolHostHandler };
  };
  for (const [name, fn] of Object.entries(impl.functions ?? {})) add(name, fn);
  for (const [name, fn] of Object.entries(impl.getters ?? {}))
    add(`${GET_PREFIX}${name}`, fn);
  for (const [name, fn] of Object.entries(impl.setters ?? {}))
    add(`${SET_PREFIX}${name}`, fn);

  const failure = implementationProblem(
    ce,
    record,
    target,
    targetKey,
    members,
    params
  );
  if (failure !== null) throw Error(`${failure.code}: ${failure.message}`);

  // The declared-contract widening guard, exactly as on the statement route
  // (see {@link conformanceWideningViolations} and the rollback comment in
  // `declareConformance`): the contracts can only be re-derived against the
  // live registry, so the registration happens and is undone if it falsified
  // one. This route reports by THROWING, its error convention throughout.
  const restore = ce._protocolRegistryRollbackPoint();

  if (existing !== undefined) {
    existing.impl = members;
    existing.pending = false;
  } else {
    const edge: ConformanceRecord = {
      target,
      targetKey,
      impl: members,
      pending: false,
      declaredByStatement: false,
    };
    if (params !== undefined) edge.where = params;
    record.conformances.push(edge);
  }
  // The implementation may fulfil the impl-less edges of the target's
  // SUBTYPES, which inherit it.
  refreshInheritedPending(record);
  // P16 — a conformance addition (and an implementation) invalidates cached
  // static-dispatch decisions: a `config` event, all axes.
  ce._noteStateEvent({ kind: 'config' });
  ce._noteConformanceRegistryChange();

  // This check cannot currently fire through this route's OWN inputs: a
  // `ProtocolImplementationInput` carries host callbacks only, and a host
  // callback contributes the empty set to a bare requirement's derived union
  // (see {@link derivedDispatcherEffects}), so nothing registered here widens
  // a dispatcher. It is kept because the guard belongs to the REGISTRATION,
  // not to the shape of one route's argument: the day
  // `ProtocolImplementationInput` admits an EXPRESSION implementation — the
  // only thing separating this route from the statement one, which does widen
  // — the check would otherwise be silently absent, with nothing failing to
  // signal it.
  const violations = conformanceWideningViolations(ce);
  if (violations.length > 0) {
    // The rollback thunk emits its own `config` event and bumps the
    // conformance version, so nothing is emitted here on top of it.
    restore();
    throw Error(
      `conformance-widens-declared-contract: ${wideningRejectionMessage(violations)}`
    );
  }
}

//
// ── Dispatch (phase 3, rulings P1 / P13 / P14 / P20 / P29) ───────────────────
//
// A protocol's FUNCTION members become callable by installing, for each member
// NAME, one global operator definition — the DISPATCHER (P13). Its `evaluate`
// selects the most specific conformance implementation for the runtime type of
// the first argument (the `Self` position, P1); its `canonical`/`type` handlers
// perform P1's static half, binding `Self` to the first argument's STATIC type
// and checking every other `Self` position against that binding.
//
// The install pattern is `multi-clause.ts`'s `installClauseList`: build an
// `OperatorDefinition`, `ce.declare()` it (or `updateDef()` an existing one)
// and stamp a MARKER on the inner definition object. `updateDef` replaces that
// object wholesale, so a user definition of the same name drops the marker and
// the binding simply stops being ours — the "user shadow wins" half of the
// Appendix A name-resolution pipeline falls out for free.
//

/** Marker on the INNER operator definition object of a dispatcher, exactly
 * like `_mintedTypeConstructor` / `_multiClauseFunction`. It is NOT passed
 * through the `OperatorDefinition` record: `_`-prefixed keys are deliberately
 * exempt from `OPERATOR_DEF_KEYS` validation (a spread of a boxed definition
 * carries them), and every other marker in the engine is stamped post-install
 * for that reason. */
const DISPATCHER = '_protocolDispatcher';

interface DispatcherMarker {
  [DISPATCHER]?: true;
}

/** Is this binding a protocol dispatcher WE installed? Used by the
 * install/removal pass, and by `defineFunctionClause` (multi-clause.ts) to let
 * a user definition of the same name replace it. */
export function isProtocolDispatcher(
  def: BoxedDefinition | undefined
): boolean {
  if (def === undefined || !isOperatorDef(def)) return false;
  return (def.operator as unknown as DispatcherMarker)[DISPATCHER] === true;
}

/**
 * The scope a dispatcher is installed in. The same rule `declareSumType` uses
 * for its minted constructors: the GLOBAL scope, except inside the Epsil
 * static pre-pass, whose surrogate frame is popped afterwards — which is also
 * what rolls a pre-pass dispatcher install back (the protocol-registry
 * rollback restores the registry; the frame pop restores the bindings, exactly
 * as it does for a pre-pass minted constructor).
 */
function dispatcherScope(ce: IComputeEngine): Scope {
  if (ce._staticTypeCheckDepth > 0 && ce.context.name === 'epsil:static-check')
    return ce.context.lexicalScope;
  return ce._evalContextStack[1]?.lexicalScope ?? ce.context.lexicalScope;
}

/** Every protocol that declares `member` as a FUNCTION requirement, in
 * registration order. */
function protocolsWithMember(
  ce: IComputeEngine,
  member: string
): ProtocolRecord[] {
  const records: ProtocolRecord[] = [];
  for (const record of Object.values(ce._protocolRegistry))
    if (record.members[member]?.kind === 'function') records.push(record);
  return records;
}

/** A resolver in which `Self` is an opaque `any`: the shape a requirement has
 * when no receiver is known (the dispatcher's stored signature and effects). */
function requirementShape(
  ce: IComputeEngine,
  record: ProtocolRecord,
  member: string
): FunctionSignature | null {
  return parseRequirement(record, member, selfAwareResolver(ce._typeResolver));
}

/** The requirement of `record.member` at `Self = selfType` (P12: the
 * substitution is performed by the resolver, so `Self` and the target's own
 * name reach the same type and diagnostics quote the substituted spelling). */
function requirementAt(
  ce: IComputeEngine,
  record: ProtocolRecord,
  member: string,
  selfType: Type
): FunctionSignature | null {
  return parseRequirement(
    record,
    member,
    selfSubstitutingResolver(ce._typeResolver, selfType, typeToString(selfType))
  );
}

function parseRequirement(
  record: ProtocolRecord,
  member: string,
  resolver: TypeResolver
): FunctionSignature | null {
  const requirement = record.members[member];
  if (requirement === undefined || requirement.kind !== 'function') return null;
  try {
    const parsed = parseType(requirement.signature, resolver);
    if (typeof parsed !== 'object' || parsed.kind !== 'signature') return null;
    return parsed;
  } catch {
    return null;
  }
}

//
// ── Dispatcher installation ──────────────────────────────────────────────────
//

/**
 * Bring the installed dispatchers in line with the registry (P13). Called
 * after every registry mutation: a fresh or replaced protocol declaration, a
 * conformance, an implementation.
 *
 * - a member name with no binding (or a binding that is already OUR dispatcher)
 *   gets one installed/refreshed;
 * - a member name bound to anything else — a user definition or a builtin — is
 *   LEFT ALONE (Appendix A pipeline step 1: the user shadow wins for bare
 *   calls; the qualified form still reaches the protocol);
 * - a dispatcher whose member name no longer exists in any protocol (a
 *   replacement that removed or renamed the member) is removed.
 *
 * Only `scope` is consulted, never its parents: during the static pre-pass the
 * surrogate frame shadows the global one, so the pass can never mutate a
 * dispatcher the real program installed.
 */
export function syncProtocolDispatchers(ce: IComputeEngine): void {
  const scope = dispatcherScope(ce);

  const needed = new Set<string>();
  for (const record of Object.values(ce._protocolRegistry))
    for (const [member, requirement] of Object.entries(record.members))
      if (requirement.kind === 'function') needed.add(member);

  // Orphans first: a member the replacement dropped must stop being callable
  // before the surviving ones are refreshed.
  for (const [id, binding] of [...scope.bindings])
    if (!needed.has(id) && isProtocolDispatcher(binding)) {
      scope.bindings.delete(id);
      // Removing a binding is a context change the generation caches must see
      // (the same note `removeMintedTypeConstructor` makes).
      ce._noteStateEvent({ kind: 'binding-repair' });
    }

  for (const member of needed) installDispatcher(ce, scope, member);
}

/** True of a binding that is merely an AUTO-declaration from usage (a call
 * site canonicalized before the protocol was declared): value-less and
 * inferred, so `ce.declare()` is licensed to overwrite it. Mirrors the upgrade
 * rule in `declareFn()`. */
function isUpgradableShell(def: BoxedDefinition): boolean {
  if (isValueDef(def))
    return def.value.inferredType && def.value.value === undefined;
  if (isOperatorDef(def))
    return (
      def.operator.inferredSignature &&
      def.operator.evaluate === undefined &&
      def.operator.canonical === undefined
    );
  return false;
}

function installDispatcher(
  ce: IComputeEngine,
  scope: Scope,
  member: string
): void {
  const own = scope.bindings.get(member);
  const ours = isProtocolDispatcher(own);
  if (own !== undefined && !ours && !isUpgradableShell(own)) return; // shadowed

  if (!ours) {
    // A builtin (system scope) or an outer user definition also shadows: the
    // bare name keeps its established meaning, and only the qualified form
    // reaches the protocol. An outer DISPATCHER does not shadow — that is the
    // static pre-pass seeing the real program's install, which this pass must
    // neither reuse nor mutate.
    const outer =
      scope.parent === null ? undefined : lookup(member, scope.parent);
    if (outer !== undefined && !isProtocolDispatcher(outer)) return;
  }

  const def = dispatcherDefinition(ce, member);
  if (def === null) return;

  try {
    if (ours) updateDef(ce, member, own!, def);
    else ce.declare(member, def, scope);
  } catch {
    return; // A name the engine refuses to bind stays uncallable; never throw.
  }

  const installed = scope.bindings.get(member);
  if (installed !== undefined && isOperatorDef(installed)) {
    (installed.operator as unknown as DispatcherMarker)[DISPATCHER] = true;
    // The stored signature carries the DECLARED ceilings, which are fixed at
    // declaration time; the BARE requirements' contribution is the union over
    // the conformers registered at the moment the effects are read, so it is
    // derived lazily rather than baked in here.
    installed.operator._deriveEffects = makeDispatcherDeriver(ce, member);
  }
}

/**
 * The dispatcher's LIVE effect set for `member`: what
 * `_BoxedOperatorDefinition._deriveEffects` returns.
 *
 * Per protocol declaring `member` as a function requirement:
 *
 * - A requirement with a DECLARED effect specifier is a CEILING. Conformers
 *   may only be purer, and callers are entitled to rely on the bound durably,
 *   so the declared set — not what the conformers happen to do today — is that
 *   protocol's contribution.
 * - A requirement with a BARE specifier imposes no bound, and its
 *   contribution is the union over the registered conforming implementations
 *   of what each of them actually does (`docs/TYPE_SYSTEM_ROADMAP.md`,
 *   Appendix B, "Changing a field is an effect"). A host callback contributes
 *   the empty set — the same trust extended to a host operator handler, which
 *   also declares its own effects or none. An Epsil function literal
 *   contributes its DECLARED marker effects unioned with the effects inferred
 *   from its body, the honest latent set (the rule `valueBindingEffects`
 *   applies to ordinary bindings).
 *
 * A literal whose `Self`-mentioning annotations fail to parse contributes
 * `'any'` rather than crashing the deriver: conservative top is always sound.
 */
function derivedDispatcherEffects(
  ce: IComputeEngine,
  member: string
): EffectSet | undefined {
  let union: EffectSet | undefined = undefined;
  for (const record of protocolsWithMember(ce, member)) {
    const shape = requirementShape(ce, record, member);
    if (shape === null) continue;

    const declared = signatureEffects(shape);
    if (declared !== undefined) {
      union = unionEffectSets(union, declared);
      if (union === 'any') return 'any';
      continue;
    }

    for (const edge of record.conformances) {
      // A PENDING edge is not a dispatch candidate — `bestCandidates` skips it,
      // which is what makes a call through one the
      // `protocol-implementation-missing` runtime error — so its
      // implementation is never invoked and must not widen the union. A
      // protocol RE-DECLARATION strands a formerly-matching implementation
      // exactly this way (see `declareProtocolImpl`, which re-runs
      // `implementationProblem` over every conformance).
      if (edge.pending) continue;
      const impl = edge.impl?.[member];
      if (impl === undefined) continue;
      if (!isExpressionImplementation(impl)) continue;
      try {
        union = unionEffectSets(
          union,
          inferFunctionLiteralEffects(ce, impl).effects
        );
        union = unionEffectSets(
          union,
          declaredImplementationSignature(
            impl,
            selfAwareResolver(ce._typeResolver)
          )?.effects
        );
      } catch {
        union = 'any';
      }
      if (union === 'any') return 'any';
    }
  }
  return union;
}

/**
 * The memoized, re-entrancy-guarded deriver installed on the dispatcher
 * definition of `member` — see {@link derivedDispatcherEffects} for what it
 * computes and Appendix B, "Changing a field is an effect", for why the value
 * is derived rather than fixed at protocol-declaration time.
 *
 * The memo is stamped on the two monotone counters that can change the answer:
 * the conformance-registry version (a new conformer enters the union) and the
 * `callable` version (a conformer's body calls a global function that was
 * reassigned). Appendix B's implementation note requires exactly the first of
 * those — "the effects cache's key must include the conformance registry among
 * its axes".
 *
 * While a computation is in flight the closure returns the set it last
 * produced. That is sound: a conformer whose body calls back through this very
 * dispatcher contributes the union under construction, and each of its other,
 * direct contributions has already been unioned in by the time the cycle
 * closes.
 *
 * While an inference ROLLBACK FRAME is open (`inference-rollback.ts`) the
 * closure computes but does NOT stamp: a frame's undo restores definitions
 * through raw slot writes and advances no version counter, so a memo stamped
 * inside the frame would keep serving a union derived from the discarded
 * trial world after the rollback. The first read after the frame closes
 * recomputes against the restored world. (Same rule as
 * `_BoxedOperatorDefinition._makeLiteralEffectsDeriver`.)
 */
function makeDispatcherDeriver(
  ce: IComputeEngine,
  member: string
): () => EffectSet | undefined {
  let stampedConformance = -1;
  let stampedCallable = -1;
  let memo: EffectSet | undefined = undefined;
  let inFlight = false;
  return (): EffectSet | undefined => {
    if (inFlight) return memo;
    if (
      stampedConformance === ce._conformanceVersion &&
      stampedCallable === ce._callableVersion
    )
      return memo;
    inFlight = true;
    try {
      memo = derivedDispatcherEffects(ce, member);
      if (ce._rollbackFrames.length === 0) {
        stampedConformance = ce._conformanceVersion;
        stampedCallable = ce._callableVersion;
      }
      return memo;
    } finally {
      inFlight = false;
    }
  };
}

/**
 * The dispatcher's `OperatorDefinition`.
 *
 * The stored signature is deliberately WIDE in its parameters (`any`): the
 * real parameter types depend on `Self`, which is only known per call site, so
 * the checking happens in the `canonical` handler (P1's static half) and the
 * result in the `type` handler. What the signature DOES carry is the
 * requirement's parameter NAMES, so that a named call can be permuted into
 * declaration order ({@link sharedParameterName}), and its EFFECTS.
 *
 * The effects are a two-part rule (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B,
 * "Changing a field is an effect"):
 *
 * - A requirement that DECLARES an effect specifier states a CEILING —
 *   conformers may be purer, never more effectful — so callers may rely on it
 *   durably. Those ceilings are static, and their union across the protocols
 *   sharing the name is what this function stamps here, as the initial value.
 * - A requirement with a BARE specifier imposes no bound at all. Its
 *   contribution is the union of the effects of the conforming
 *   implementations registered right now, which changes as conformances
 *   register. That part is refreshed on read, through the `_deriveEffects`
 *   hook {@link installDispatcher} attaches — see
 *   {@link derivedDispatcherEffects}.
 */
function dispatcherDefinition(
  ce: IComputeEngine,
  member: string
): OperatorDefinition | null {
  const records = protocolsWithMember(ce, member);
  if (records.length === 0) return null;

  const shapes = records
    .map((r) => requirementShape(ce, r, member))
    .filter((s): s is FunctionSignature => s !== null);
  if (shapes.length === 0) return null;

  const arities = new Set(shapes.map((s) => s.args?.length ?? 0));
  const signature: FunctionSignature =
    arities.size === 1
      ? {
          kind: 'signature',
          args: Array.from({ length: [...arities][0]! }, (_, i) => {
            const name = sharedParameterName(shapes, i);
            return name === undefined
              ? { type: 'any' as Type }
              : { name, type: 'any' as Type };
          }),
          result: 'unknown',
        }
      : {
          kind: 'signature',
          variadicArg: { type: 'any' },
          variadicMin: 1,
          result: 'unknown',
        };

  let effects: EffectSet | undefined = undefined;
  for (const s of shapes)
    effects = unionEffectSets(effects, signatureEffects(s));
  if (effects !== undefined && !isPureEffectSet(effects))
    signature.effects = effects;

  const names = records.map((r) => r.name);
  return {
    description: `Protocol member \`${member}\` (${names.map((n) => `\`${n}\``).join(', ')}); dispatches on the runtime type of its first argument.`,
    ...(effects !== undefined && !isPureEffectSet(effects)
      ? { effects }
      : { pure: true }),
    lazy: false,
    signature,
    canonical: (ops, { engine }) => dispatcherCanonical(engine, member, ops),
    type: (ops, { engine }) => dispatcherResultType(engine, member, null, ops),
    evaluate: (ops, options) =>
      dispatchMember(options.engine, member, null, ops, options),
  };
}

/**
 * The parameter name that EVERY requirement shape declares at position
 * `index`, or `undefined` when they disagree or any of them leaves the
 * position unnamed.
 *
 * The dispatcher erases the requirement's parameter TYPES (they depend on
 * `Self`, known only per call site) but must keep its parameter NAMES: a call
 * that names its arguments — `tag(prefix: "p", self: x)` — is permuted into
 * the callee's declaration order at canonicalization, and the dispatcher's
 * synthesized signature is the only declaration that call has to match names
 * against. Without the names, no name matches and the call is rejected instead
 * of dispatched; with them, `dispatcherCanonical` keeps reading the receiver as
 * `ops[0]` unchanged, whatever position the author wrote it in. See
 * `docs/plans/2026-08-12-named-arguments-design.md` §5 (ruling C6).
 *
 * Several protocols may declare a member of the same name with differently
 * named parameters. One dispatcher serves them all, so a position they do not
 * agree on is left unnamed — positional-only, exactly as before.
 */
function sharedParameterName(
  shapes: ReadonlyArray<FunctionSignature>,
  index: number
): string | undefined {
  const name = shapes[0].args?.[index]?.name;
  if (name === undefined) return undefined;
  for (let i = 1; i < shapes.length; i++)
    if (shapes[i].args?.[index]?.name !== name) return undefined;
  return name;
}

//
// ── Static half (P1) ─────────────────────────────────────────────────────────
//

/**
 * The static type of the receiver of a call, or `undefined` when there is no
 * receiver to read one from (no operands, or an operand that is already an
 * error).
 */
function receiverType(ops: ReadonlyArray<Expression>): Type | undefined {
  const self = ops[0];
  if (self === undefined || !self.isValid) return undefined;
  return self.type.type;
}

/**
 * The protocols declaring `member` that could apply to a receiver of static
 * type `receiver` — Appendix A's "the first argument's static type neither
 * conforms nor has any conforming subtype": a record applies when one of its
 * conformance targets is comparable with the receiver type (the receiver
 * conforms, or some conforming subtype of it does).
 *
 * Every record survives when applicability is UNDECIDABLE — when the receiver
 * type is not decided for dispatch ({@link isDecidedReceiverType}), and when
 * NO candidate protocol carries a conformance at all: an entirely unconformed
 * member refutes nothing, since conformance is monotone and arrives in later
 * batches (Appendix A's notebook posture, "declare in one cell, implement in
 * the next").
 *
 * `null` is the remaining case — a decided receiver that conforms to none of
 * the protocols that DO have conformances: Appendix A's static
 * `protocol-implementation-missing`.
 */
function candidateRecords(
  ce: IComputeEngine,
  member: string,
  receiver: Type | undefined
): ProtocolRecord[] | null {
  const all = protocolsWithMember(ce, member);
  if (all.length === 0) return all;
  if (receiver === undefined || !isDecidedReceiverType(receiver)) return all;

  const applicable = all.filter((r) =>
    r.conformances.some((edge) => edgeCouldApply(ce, edge, receiver))
  );
  if (applicable.length > 0) return applicable;
  return all.every((r) => r.conformances.length === 0) ? all : null;
}

/**
 * P1's static check, shared by the bare dispatcher and the qualified
 * `ProtocolMember` form: exact arity (when the candidate requirements agree on
 * one), then EVERY argument against the requirement's parameter type with
 * `Self` bound to the first argument's STATIC type — so a `Self` position is
 * checked against that binding (no joining of `Self` across arguments), and an
 * ordinary parameter against its own declared type. A mismatch is reported the
 * way every other signature violation is: the offending ARGUMENT is replaced by
 * an `incompatible-type` error (`checkType`), so `compare("a", 3)` names
 * argument 2.
 *
 * With SEVERAL candidate protocols, a position is checked against the JOIN of
 * what they declare there — the same widening {@link dispatcherResultType}
 * applies to the result: any of the candidates may be the one that applies, so
 * a call the qualified form would accept must not be rejected here.
 */
function checkMemberArguments(
  ce: IComputeEngine,
  records: ProtocolRecord[],
  member: string,
  ops: ReadonlyArray<Expression>
): Expression[] {
  const arities = new Set(
    records.map((r) => requirementShape(ce, r, member)?.args?.length)
  );
  let xs: Expression[] = [...ops];
  const arity = arities.size === 1 ? [...arities][0] : undefined;
  if (arity !== undefined) xs = [...checkArity(ce, xs, arity)];

  const selfType = receiverType(xs);
  // An indeterminate receiver binds nothing: every position stays unchecked
  // and the call is decided at run time (Appendix A: "if conformance cannot be
  // decided statically … the call is checked dynamically").
  if (selfType === undefined || !isDecidedReceiverType(selfType)) return xs;

  // The candidate requirements at `Self` = the receiver's static type. One that
  // does not parse there decides nothing about ANY position: leave them all to
  // the run time rather than check against a partial set.
  const requirements = records.map((r) =>
    requirementAt(ce, r, member, selfType)
  );
  if (requirements.some((s) => s === null)) return xs;

  for (let i = 1; i < xs.length; i++) {
    if (!xs[i]!.isValid) continue;
    const declared = requirements.map((s) => s!.args?.[i]?.type);
    // A position beyond some candidate's arity is not one they agree on (their
    // arities differed, so `checkArity` let the call through): unchecked.
    if (declared.some((t) => t === undefined)) continue;
    xs[i] = checkType(ce, xs[i], joinOf(declared as Type[]));
  }

  return xs;
}

/** The JOIN of the types several candidate requirements declare at one
 * position. Deduplicated first, so the overwhelmingly common single-candidate
 * (and unanimous-candidates) case keeps the declared type — and its spelling —
 * verbatim in the diagnostic. */
function joinOf(types: readonly Type[]): Type {
  const distinct = [
    ...new Map(types.map((t) => [typeToString(t), t])).values(),
  ];
  return distinct.length === 1 ? distinct[0]! : (widen(...distinct) as Type);
}

/**
 * The dispatcher's `canonical` handler: the protocols that could apply to the
 * receiver's static type, then {@link checkMemberArguments} against those.
 *
 * A receiver that is DECIDED and matches no candidate is Appendix A's static
 * `protocol-implementation-missing`, reported through the same convention as
 * the `Self` mismatch: the offending argument — here the RECEIVER — carries
 * the error, so the application types `error`.
 */
function dispatcherCanonical(
  ce: IComputeEngine,
  member: string,
  ops: ReadonlyArray<Expression>
): Expression {
  if (protocolsWithMember(ce, member).length === 0)
    return ce._fn(member, [...ops]);

  const selfType = receiverType(ops);
  const records = candidateRecords(ce, member, selfType);
  if (records === null)
    return ce._fn(member, [
      ce.error(
        [
          'protocol-implementation-missing',
          `no implementation of \`${member}\` applies to a value of type \`${typeToString(selfType!)}\``,
        ],
        ops[0]!.toString()
      ),
      ...ops.slice(1),
    ]);

  return ce._fn(member, checkMemberArguments(ce, records, member, ops));
}

/**
 * `ProtocolMember`'s `canonical` handler (P14/P30): the SAME static half as
 * the bare dispatcher, restricted to the named protocol. Without it a
 * qualified call reached the implementation with neither an arity nor a
 * `Self`-position check.
 *
 * No applicability filtering here: the author named the protocol, so there is
 * nothing to select between — an inapplicable receiver is the ordinary runtime
 * `protocol-implementation-missing`.
 */
export function canonicalProtocolMember(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  const parts = protocolMemberOperandsOf(ops);
  if (parts === null) return ce._fn('ProtocolMember', [...ops]);
  const record = ce._protocolRegistry[parts.protocol];
  if (record === undefined || record.members[parts.member]?.kind !== 'function')
    return ce._fn('ProtocolMember', [...ops]);

  return ce._fn('ProtocolMember', [
    ops[0]!,
    ops[1]!,
    ...checkMemberArguments(ce, [record], parts.member, parts.args),
  ]);
}

/**
 * The result type of a dispatched call: the requirement's result with `Self`
 * bound to the first argument's static type, joined across the protocols that
 * share the member name AND could apply to that receiver (any of them may be
 * the one that applies — but an inapplicable one must not widen the result).
 */
function dispatcherResultType(
  ce: IComputeEngine,
  member: string,
  only: ProtocolRecord | null,
  ops: ReadonlyArray<Expression>
): Type | undefined {
  if (ops.some((x) => !x.isValid)) return 'error';
  const records =
    only !== null ? [only] : candidateRecords(ce, member, receiverType(ops));
  if (records === null || records.length === 0) return undefined;

  const self = ops[0];
  const selfType: Type = self === undefined ? 'unknown' : self.type.type;

  const results: Type[] = [];
  for (const record of records) {
    const requirement = requirementAt(ce, record, member, selfType);
    if (requirement === null) return undefined;
    results.push(unwrapIndeterminateSelf(requirement.result));
  }
  if (results.length === 0) return undefined;
  return results.length === 1 ? results[0] : (widen(...results) as Type);
}

/**
 * A `Self`-typed RESULT at an INDETERMINATE receiver, unwrapped to the
 * primitive. `requirementAt` substitutes `Self` as an alias `TypeReference`
 * whose `def` is the receiver's static type (P12 — so diagnostics quote the
 * substituted spelling); when that type is `unknown` or `any` the wrapper is
 * a trap: the reference PRINTS like the primitive but defeats every
 * primitive-keyed acceptance gate downstream — `BoxedType.isUnknown` is
 * false for it, so e.g. `checkNumericArgs` (which admits a primitive
 * `unknown` operand as "infer later") rejected `negated(_) * 10` with
 * `incompatible-type number/unknown` while the identical shape through a
 * plain function worked. There is no diagnostic-spelling benefit to keep the
 * wrapper for: its name IS "unknown"/"any". Only the top level needs
 * unwrapping — a reference nested inside a composite (`list<Self>`) is
 * consumed by subtyping, where alias references are transparent.
 */
function unwrapIndeterminateSelf(t: Type): Type {
  if (
    typeof t !== 'string' &&
    t.kind === 'reference' &&
    t.alias &&
    (t.def === 'unknown' || t.def === 'any')
  )
    return t.def;
  return t;
}

//
// ── Dynamic half (P1, P29) ───────────────────────────────────────────────────
//

/** One applicable implementation: the edge that carries it and the protocol it
 * belongs to. */
type Candidate = {
  record: ProtocolRecord;
  edge: ConformanceRecord;
  impl: Expression | JSImplementation;
  /** The GROUND target the edge stands for at this receiver — the edge's own
   * target, or the INSTANTIATED head of a conditional edge. Specificity is
   * compared on this, never on `edge.target` (which may be open). */
  target: Type;
};

/**
 * Dispatch `member` on the runtime type of `ops[0]` (P1).
 *
 * Only IMPLEMENTATION-CARRYING, non-pending edges are candidates: an edge that
 * merely INHERITS its completeness from a supertype's implementation (phase
 * 2's `refreshInheritedPending`) has nothing of its own to call, and
 * inheritance falls out of subtyping anyway — an `integer` value against an
 * implementation registered on `number` admits through `isSubtype`, so the
 * `number` edge is selected. A PENDING edge is likewise not a candidate, which
 * is what makes dispatch through one the `protocol-implementation-missing`
 * runtime error the diagnostics table promises.
 *
 * `only` restricts the search to a single protocol — the qualified call
 * (`Comparable.compare(x, y)`, P14).
 */
function dispatchMember(
  ce: IComputeEngine,
  member: string,
  only: ProtocolRecord | null,
  ops: ReadonlyArray<Expression>,
  options: { numericApproximation?: boolean }
): Expression | undefined {
  const self = ops[0];
  if (self === undefined) return undefined;

  const records = only !== null ? [only] : protocolsWithMember(ce, member);
  if (records.length === 0) return undefined;

  // An operand that is already an error, or one whose type is still open, is
  // not a receiver dispatch can key on: stay symbolic (the engine's "not yet").
  if (!self.isValid) return undefined;
  const runtime = self.type.type;
  if (!isDecidedReceiverType(runtime)) return undefined;

  const best = bestCandidates(ce, records, member, runtime);

  if (best.length === 0)
    return ce.error(
      [
        'protocol-implementation-missing',
        `no implementation of \`${member}\` applies to a value of type \`${typeToString(runtime)}\``,
      ],
      ce.function(member, [...ops], { form: 'raw' }).toString()
    );

  if (best.length > 1) {
    const where = [
      ...new Set(best.map((c) => `${c.record.name}(${c.edge.targetKey})`)),
    ];
    return ce.error(
      [
        'protocol-call-ambiguous',
        `\`${member}\` applies to a value of type \`${typeToString(runtime)}\` through ${where.map((w) => `\`${w}\``).join(' and ')}. Use a qualified name to narrow the one you meant.`,
      ],
      ce.function(member, [...ops], { form: 'raw' }).toString()
    );
  }

  // The SELECTED requirement's arity, enforced here and not only in
  // `checkMemberArguments`: the static check runs on the CANDIDATE set, and
  // when the candidates disagree on arity — or the receiver was undecided —
  // it lets the call through to be decided at run time. Selection has now
  // named one requirement, so its arity is exact; without this, a short call
  // reached `apply` and came back a PARTIAL APPLICATION rather than an error.
  const selected = best[0]!;
  const arity = requirementShape(ce, selected.record, member)?.args?.length;
  if (arity !== undefined && arity !== ops.length)
    return ce.error(
      [
        'protocol-signature-mismatch',
        `\`${selected.record.name}.${member}\` takes ${arity} argument${arity === 1 ? '' : 's'}; it was called with ${ops.length}`,
      ],
      ce.function(member, [...ops], { form: 'raw' }).toString()
    );

  // …and the SELECTED requirement's parameter types, for the same reason: the
  // static check runs on the candidate set (and not at all when the receiver
  // was undecided or the operands arrived raw), so this is the only place an
  // implementation — a host callback in particular, which is trusted with
  // whatever it is handed — is guaranteed to be called within its contract.
  const mismatch = argumentTypeError(
    ce,
    requirementAt(ce, selected.record, member, runtime),
    ops
  );
  if (mismatch !== null) return mismatch;

  return invokeImplementation(ce, selected.impl, ops, options);
}

/**
 * The first argument that the SELECTED requirement refuses, as the ordinary
 * `incompatible-type` error VALUE — or `null` when every one of them fits.
 *
 * The receiver (position 0) is not re-checked: it is `Self` by construction
 * (`assertSelfFirstParameter`), and the edge was selected by admitting it.
 *
 * Only a DECIDED argument type refutes, the same posture the receiver gate
 * (P32) and the setter's result check take: a still-symbolic operand is no more
 * of an answer here than it is anywhere else.
 */
function argumentTypeError(
  ce: IComputeEngine,
  requirement: FunctionSignature | null,
  ops: ReadonlyArray<Expression>
): Expression | null {
  const expected = requirement?.args;
  if (expected === undefined) return null;
  for (let i = 1; i < ops.length; i++) {
    const arg = ops[i];
    const type = expected[i]?.type;
    if (arg === undefined || type === undefined || !arg.isValid) continue;
    if (!isDecidedReceiverType(arg.type.type)) continue;
    const checked = checkType(ce, arg, type);
    if (!checked.isValid) return checked;
  }
  return null;
}

/**
 * The MOST SPECIFIC implementations of `implKey` admitting a receiver of type
 * `runtime` — the selection BOTH dispatch and property access run (P1).
 *
 * Only IMPLEMENTATION-CARRYING, non-pending edges are candidates; the survivors
 * are the minimal targets under subtyping. Several survivors are either two
 * protocols answering the same name, or two incomparable targets a single value
 * inhabits (P29's empty collection, `list<never>` against `list<string>` and
 * `list<integer>`) — the caller reports that as its own ambiguity error.
 *
 * `implKey` is the key the implementation block stores the handler under: a
 * member name for a function, `__get__x` / `__set__x` for a property accessor.
 *
 * A CONDITIONAL edge is admitted through the same {@link edgeTargetAt} gate,
 * and competes for specificity as the INSTANTIATED head it stands for at this
 * receiver (`list<T>` at a `list<string>` receiver competes as `list<string>`)
 * — which is also what keeps an open type out of `isSubtype`.
 */
function bestCandidates(
  ce: IComputeEngine,
  records: readonly ProtocolRecord[],
  implKey: string,
  runtime: Type
): Candidate[] {
  const admitted: Candidate[] = [];
  for (const record of records) {
    for (const edge of record.conformances) {
      if (edge.pending) continue;
      const impl = edge.impl?.[implKey];
      if (impl === undefined) continue;
      const target = edgeTargetAt(ce, edge, runtime);
      if (target !== null) admitted.push({ record, edge, impl, target });
    }
  }
  return admitted.filter(
    (c) =>
      !admitted.some(
        (d) =>
          d !== c &&
          isSubtype(d.target, c.target) &&
          !isSubtype(c.target, d.target)
      )
  );
}

/**
 * Can this receiver type key a dispatch decision? The ONE gate both halves of
 * P1 consult — the static one in {@link dispatcherCanonical} /
 * {@link checkMemberArguments} and the dynamic one in
 * {@link dispatchMember} — so the two can never drift apart on what counts as
 * an answer.
 *
 * Undecided (→ stay symbolic, Appendix A's "if conformance cannot be decided
 * statically … the call is checked dynamically"):
 * - the TOP types (`unknown`, `any`, `value`, `expression`): they answer
 *   "anything", so a value carrying one may still turn out to conform;
 * - COMPOUND types — a `union` (Appendix A's own example: "a union only some
 *   arms of which conform"), an `intersection`, and a type `variable`.
 *   `isSubtype(string | integer, string)` is false for EVERY candidate
 *   target, so committing here would report a miss for a receiver that
 *   conforms on one of its arms.
 *
 * Decided: a single ground primitive, reference or application type — the
 * shape an EVALUATED receiver's synthesized (principal) type has, where a
 * failed subtype test is a genuine refutation (P32).
 */
function isDecidedReceiverType(t: Type): boolean {
  if (typeof t === 'string')
    return (
      t !== 'unknown' && t !== 'any' && t !== 'value' && t !== 'expression'
    );
  return (
    t.kind !== 'union' && t.kind !== 'intersection' && t.kind !== 'variable'
  );
}

/** Invoke one implementation. An Epsil function literal goes through the
 * engine's standard application (`apply`, as `multi-clause.ts`'s
 * `selectAndApply` does); a host callback is called with the boxed operands
 * and its result is boxed. */
function invokeImplementation(
  ce: IComputeEngine,
  impl: Expression | JSImplementation,
  ops: ReadonlyArray<Expression>,
  options: { numericApproximation?: boolean }
): Expression | undefined {
  if (isExpressionImplementation(impl))
    return apply(impl, ops, {
      numericApproximation: options.numericApproximation,
    });

  let result: unknown;
  try {
    result = impl.host(...ops);
  } catch (e) {
    return ce.error(['protocol-implementation-missing', messageOf(e)]);
  }
  return boxHostResult(ce, result);
}

/** Box the result of a host implementation. A JS string is a STRING value
 * here, not a symbol: a host callback returns data, and `ce.box("<")` would
 * read it as a symbol name. */
function boxHostResult(ce: IComputeEngine, value: unknown): Expression {
  if (isExpression(value)) return value;
  if (typeof value === 'string') return ce.string(value);
  if (typeof value === 'boolean') return value ? ce.True : ce.False;
  if (typeof value === 'number' || typeof value === 'bigint')
    return ce.number(value);
  if (value === undefined || value === null) return ce.Nothing;
  return ce.box(value as Parameters<IComputeEngine['box']>[0]);
}

//
// ── Qualified calls (P14) ────────────────────────────────────────────────────
//
// `Comparable.compare(x, y)` parses as `Apply(Field(Comparable, "compare"), x,
// y)` with no parser change at all. `Field` recognizes a base symbol that
// names a protocol and hands back a FUNCTION VALUE — a literal whose body is
// the `ProtocolMember` application that dispatches inside that one protocol.
// So the qualified name is also a first-class value (`[a, b] |> Map(…)`), and
// it works whether or not the bare name is shadowed or ambiguous.
//

/** The protocol a base operand names, or `undefined`. Keyed off the REGISTRY
 * (never off a declaration): a protocol name is not a value, and a bare
 * `Comparable` elsewhere stays an ordinary undeclared symbol. */
export function protocolOfSymbol(
  ce: IComputeEngine,
  base: Expression
): ProtocolRecord | undefined {
  const name = sym(base);
  if (name === undefined) return undefined;
  // A symbol that HOLDS a value is that value, not a protocol name: the
  // evaluate route never sees one (the operand evaluated to the value), and
  // this keeps the `type` route agreeing with it.
  if (base.valueDefinition?.value !== undefined) return undefined;
  return ce._protocolRegistry[name];
}

/** The signature of `P.m` — the requirement with `Self` left opaque. `null`
 * when `m` is not a FUNCTION member of `P`. */
export function protocolMemberSignature(
  ce: IComputeEngine,
  record: ProtocolRecord,
  member: string
): FunctionSignature | null {
  return requirementShape(ce, record, member);
}

/**
 * The requirement signature behind a QUALIFIED protocol call, for the
 * named-argument seam (`makeCanonicalFunction`, box.ts): given the two names
 * of a raw `Apply(Field(P, "m"), …)` or `ProtocolMember(P, m, …)` callee,
 * the signature whose parameter names a named call is checked against —
 * `compare(self, other: Self)` carries `self`/`other`, so
 * `Comparable.compare(other: y, self: x)` can be permuted into declaration
 * order before the carriers canonicalize (a carrier that reaches
 * canonicalization reports `argument-names-unavailable`).
 *
 * `null` when the names do not designate a protocol requirement: `P` is not
 * in the registry, `m` is not one of its FUNCTION members, or — when
 * `shadowScope` is given (the `Field` route, whose base is a SYMBOL) — the
 * symbol `P` holds a value, in which case `Field` reads that value's field at
 * evaluation instead of the protocol ({@link protocolOfSymbol}'s guard,
 * mirrored here by name because the seam runs before anything is boxed). A
 * `null` leaves the call exactly as it was: the carriers decline as before.
 */
export function qualifiedMemberRequirementShape(
  ce: IComputeEngine,
  protocolName: string,
  member: string,
  shadowScope?: Scope
): FunctionSignature | null {
  const record = ce._protocolRegistry[protocolName];
  if (record === undefined) return null;
  if (record.members[member]?.kind !== 'function') return null;
  if (shadowScope !== undefined) {
    const def = lookup(protocolName, shadowScope);
    if (def !== undefined && isValueDef(def) && def.value.value !== undefined)
      return null;
  }
  return requirementShape(ce, record, member);
}

/** The value of `P.m`: a function literal that dispatches inside `P` only. */
export function protocolMemberValue(
  ce: IComputeEngine,
  record: ProtocolRecord,
  member: string
): Expression | undefined {
  const shape = requirementShape(ce, record, member);
  if (shape === null) return undefined;
  const arity = shape.args?.length ?? 0;
  const params = parameterNames(shape, arity);
  return ce.box([
    'Function',
    [
      'ProtocolMember',
      { str: record.name },
      { str: member },
      ...params,
    ] as unknown as Parameters<IComputeEngine['box']>[0],
    ...params,
  ] as unknown as Parameters<IComputeEngine['box']>[0]);
}

/** Parameter names for the wrapper literal: the requirement's own names when
 * they are all present and distinct (so `Comparable.compare` reads as
 * `(self, other) |-> …`), else positional placeholders. The body mentions
 * nothing else, so no capture is possible either way. */
function parameterNames(shape: FunctionSignature, arity: number): string[] {
  const declared = (shape.args ?? []).map((a) => a.name);
  const fallback = Array.from({ length: arity }, (_, i) => `x${i + 1}`);
  if (declared.length !== arity) return fallback;
  if (declared.some((n) => n === undefined)) return fallback;
  const names = declared as string[];
  if (new Set(names).size !== names.length) return fallback;
  return names;
}

/** The three parts of a `ProtocolMember(P, m, args…)` application — the
 * lowering of a qualified protocol call. */
function protocolMemberOperandsOf(
  ops: ReadonlyArray<Expression>
): { protocol: string; member: string; args: Expression[] } | null {
  const protocol = isString(ops[0]) ? ops[0].string : sym(ops[0]);
  const member = isString(ops[1]) ? ops[1].string : sym(ops[1]);
  if (protocol === undefined || member === undefined) return null;
  return { protocol, member, args: ops.slice(2) };
}

/** `ProtocolMember`'s `evaluate`: P1 dispatch restricted to one protocol. */
export function evaluateProtocolMember(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  options: { numericApproximation?: boolean }
): Expression | undefined {
  const parts = protocolMemberOperandsOf(ops);
  if (parts === null) return undefined;
  const record = ce._protocolRegistry[parts.protocol];
  if (record === undefined)
    return ce.error([
      'protocol-unknown',
      `the protocol \`${parts.protocol}\` is unknown`,
    ]);
  if (record.members[parts.member]?.kind !== 'function')
    return ce.error(['unknown-field', parts.member], parts.protocol);
  return dispatchMember(ce, parts.member, record, parts.args, options);
}

/** `ProtocolMember`'s `type`: the requirement's result at `Self` = the static
 * type of the first argument. */
export function protocolMemberResultType(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Type | undefined {
  const parts = protocolMemberOperandsOf(ops);
  if (parts === null) return undefined;
  const record = ce._protocolRegistry[parts.protocol];
  if (record === undefined) return undefined;
  return dispatcherResultType(ce, parts.member, record, parts.args);
}

//
// ── Properties (phase 4, rulings P18 / P2 / P6) ──────────────────────────────
//
// A protocol PROPERTY rides the `Field` operator: `person.name` resolves
// through the conformance registry when the ordinary field routes (a record
// body, a named-tuple body, a dictionary) have nothing to say. Selection is
// P1's — the most specific non-pending conformance whose implementation
// carries `__get__<name>`, inheritance included — and several applicable
// protocols are `protocol-property-ambiguous`.
//
// Assignment is REBINDING SUGAR (P2): `p.name = v` canonicalizes to
// `p = «__set__name»(p, v)`, so the immutable value model is preserved.
//

/** How `(receiver type, property name)` resolved against the registry. */
type PropertyResolution =
  | {
      status: 'found';
      record: ProtocolRecord;
      edge: ConformanceRecord;
      /** `readonly` or `readwrite` — the requirement's own kind. */
      kind: 'readonly' | 'readwrite';
      /** The property's declared type, as source text (with `Self`). */
      declared: string;
    }
  /** Several protocols answer the same property name for this receiver. */
  | { status: 'ambiguous'; through: string[] }
  /** The receiver's type cannot decide the question (P32's gate): stay
   * symbolic, exactly as a dispatched call does. */
  | { status: 'undecided' }
  /** No protocol declares this property, or none applies. */
  | { status: 'none' };

/** Every protocol declaring `name` as a PROPERTY requirement. `only`
 * restricts the search to one protocol — the qualified form `p.(P.name)`. */
function protocolsWithProperty(
  ce: IComputeEngine,
  name: string,
  only?: ProtocolRecord
): ProtocolRecord[] {
  const all = only !== undefined ? [only] : Object.values(ce._protocolRegistry);
  return all.filter((r) => {
    const m = r.members[name];
    return m !== undefined && m.kind !== 'function';
  });
}

/**
 * Resolve the property `name` on a receiver of type `receiver` (P18).
 *
 * The getter is what makes a candidate: an edge whose implementation carries
 * `__get__<name>`. A `readwrite` property's edge always carries the setter too
 * — validation demands both accessors — so the setter is read off the same
 * winning edge.
 */
function resolveProtocolProperty(
  ce: IComputeEngine,
  receiver: Type,
  name: string,
  only?: ProtocolRecord
): PropertyResolution {
  const records = protocolsWithProperty(ce, name, only);
  if (records.length === 0) return { status: 'none' };
  if (!isDecidedReceiverType(receiver)) return { status: 'undecided' };

  const best = bestCandidates(ce, records, `${GET_PREFIX}${name}`, receiver);
  if (best.length === 0) return { status: 'none' };
  if (best.length > 1)
    return {
      status: 'ambiguous',
      through: [
        ...new Set(best.map((c) => `${c.record.name}(${c.edge.targetKey})`)),
      ],
    };

  const winner = best[0]!;
  const requirement = winner.record.members[name]!;
  if (requirement.kind === 'function') return { status: 'none' };
  return {
    status: 'found',
    record: winner.record,
    edge: winner.edge,
    kind: requirement.kind,
    declared: requirement.type,
  };
}

/** `protocol-property-ambiguous`, the shared error value. */
function ambiguousPropertyError(
  ce: IComputeEngine,
  name: string,
  receiver: Type,
  through: string[]
): Expression {
  return ce.error([
    'protocol-property-ambiguous',
    `the property \`${name}\` applies to a value of type \`${typeToString(receiver)}\` through ${through.map((w) => `\`${w}\``).join(' and ')}. Qualify it — \`x.(${through[0]?.split('(')[0] ?? 'Protocol'}.${name})\` — to narrow the one you meant.`,
  ]);
}

/**
 * The declared type of the protocol property `base.name`, or `undefined` when
 * no protocol answers for it (the caller's existing `unknown-field` path).
 *
 * `Self` is substituted by the RECEIVER's type (P12), so a property declared
 * `readonly clone: Self` types as the receiver.
 */
export function protocolPropertyType(
  ce: IComputeEngine,
  base: Expression,
  name: string,
  only?: ProtocolRecord
): Type | undefined {
  if (!base.isValid) return undefined;
  const receiver = base.type.type;
  const resolved = resolveProtocolProperty(ce, receiver, name, only);
  if (resolved.status === 'undecided') return 'unknown';
  if (resolved.status === 'ambiguous') return 'error';
  if (resolved.status === 'none') return undefined;
  try {
    return parseType(
      resolved.declared,
      selfSubstitutingResolver(
        ce._typeResolver,
        receiver,
        typeToString(receiver)
      )
    );
  } catch {
    return 'error';
  }
}

/**
 * Read the protocol property `base.name` — the `evaluate` half of P18.
 *
 * `undefined` means "not a protocol property": the caller keeps its existing
 * behavior (`unknown-field`, or staying symbolic).
 */
export function evaluateProtocolProperty(
  ce: IComputeEngine,
  base: Expression,
  name: string,
  options: { numericApproximation?: boolean },
  only?: ProtocolRecord
): Expression | undefined {
  if (!base.isValid) return undefined;
  const receiver = base.type.type;
  const resolved = resolveProtocolProperty(ce, receiver, name, only);
  if (resolved.status === 'none') return undefined;
  if (resolved.status === 'undecided') return undefined; // stay symbolic
  if (resolved.status === 'ambiguous')
    return ambiguousPropertyError(ce, name, receiver, resolved.through);

  const getter = resolved.edge.impl?.[`${GET_PREFIX}${name}`];
  if (getter === undefined) return undefined;
  return invokeImplementation(ce, getter, [base], options);
}

//
// ── The `ProtocolProperty` operator (P6 / D16 amendment) ─────────────────────
//
// `person.(Nameable.name)` lowers to `ProtocolProperty("Nameable", "name",
// person)` — the qualified READ, restricted to the named protocol. A fourth
// operand is the setter invocation the `Assign` sugar builds (P2); it has no
// surface spelling (qualified property ASSIGNMENT is v1-out).
//

/** The parts of a `ProtocolProperty(P, name, base, value?)` application. */
function protocolPropertyOperandsOf(ops: ReadonlyArray<Expression>): {
  protocol: string;
  name: string;
  base: Expression;
  value?: Expression;
} | null {
  const protocol = isString(ops[0]) ? ops[0].string : sym(ops[0]);
  const name = isString(ops[1]) ? ops[1].string : sym(ops[1]);
  const base = ops[2];
  if (protocol === undefined || name === undefined || base === undefined)
    return null;
  return { protocol, name, base, value: ops[3] };
}

/** `ProtocolProperty`'s `type` handler. */
export function protocolPropertyResultType(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Type | undefined {
  const parts = protocolPropertyOperandsOf(ops);
  if (parts === null) return undefined;
  const record = ce._protocolRegistry[parts.protocol];
  if (record === undefined) return 'error';
  // A SET invocation returns whatever the handler returns; its result is
  // deliberately unchecked (P25), and the value it rebinds is the receiver.
  if (parts.value !== undefined) return parts.base.type.type;
  return protocolPropertyType(ce, parts.base, parts.name, record) ?? 'error';
}

/** `ProtocolProperty`'s `evaluate` handler: the qualified read, or the setter
 * invocation the `Assign` sugar lowers to. */
export function evaluateProtocolPropertyOperator(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  options: { numericApproximation?: boolean }
): Expression | undefined {
  const parts = protocolPropertyOperandsOf(ops);
  if (parts === null) return undefined;
  const record = ce._protocolRegistry[parts.protocol];
  if (record === undefined)
    return ce.error([
      'protocol-unknown',
      `the protocol \`${parts.protocol}\` is unknown`,
    ]);
  const requirement = record.members[parts.name];
  if (requirement === undefined || requirement.kind === 'function')
    return ce.error(['unknown-field', parts.name], record.name);

  if (parts.value === undefined) {
    // An operand whose type cannot decide the question leaves the call
    // symbolic (P32), exactly as a qualified CALL does; only a settled
    // receiver with no implementation is the missing-implementation error.
    if (!parts.base.isValid) return undefined;
    if (!isDecidedReceiverType(parts.base.type.type)) return undefined;
    return (
      evaluateProtocolProperty(ce, parts.base, parts.name, options, record) ??
      missingPropertyError(ce, parts.base, parts.name, record)
    );
  }

  // The SET half. `readonly` is refused at canonicalization (P2), so reaching
  // here with one means the registry changed under a canonicalized program.
  if (requirement.kind === 'readonly')
    return ce.error([
      'protocol-property-readonly-set',
      `the property \`${record.name}.${parts.name}\` is \`readonly\``,
    ]);
  const base = parts.base;
  if (!base.isValid) return undefined;
  const receiver = base.type.type;
  if (!isDecidedReceiverType(receiver)) return undefined;
  // P41 — the protocol name here was BAKED at canonicalization (P2's rebinding
  // sugar resolved the winner off the receiver's type THEN), while the receiver
  // is read again at every evaluation. A canonical `Assign` re-run after its
  // root was rebound to a type conforming through a DIFFERENT protocol would
  // otherwise keep targeting the stale one and report a missing implementation.
  // So a baked protocol with no applicable edge falls back to full resolution
  // across every protocol declaring the property — the dynamic read path's own
  // rule, ambiguity included.
  let best = bestCandidates(
    ce,
    [record],
    `${SET_PREFIX}${parts.name}`,
    receiver
  );
  if (best.length === 0)
    best = bestCandidates(
      ce,
      protocolsWithProperty(ce, parts.name),
      `${SET_PREFIX}${parts.name}`,
      receiver
    );
  if (best.length === 0)
    return missingPropertyError(ce, base, parts.name, record);
  if (best.length > 1)
    return ambiguousPropertyError(
      ce,
      parts.name,
      receiver,
      best.map((c) => `${c.record.name}(${c.edge.targetKey})`)
    );
  // The value the setter is handed must fit the PROPERTY's declared type at
  // `Self` = the receiver: the handler is written against that type (and a host
  // setter is trusted with whatever it is given), so an out-of-contract write is
  // refused here rather than passed on. Read off the WINNING record, which the
  // P41 fallback above may have changed.
  const winner = best[0]!;
  const declared = winner.record.members[parts.name];
  const refused =
    declared === undefined || declared.kind === 'function'
      ? null
      : propertyValueError(ce, receiver, declared.type, parts.value);
  if (refused !== null) return refused;

  const result = invokeImplementation(
    ce,
    winner.impl,
    [base, parts.value],
    options
  );

  // P25 amendment — the setter's result REBINDS the receiver (P2's sugar), and
  // `protocolPropertyResultType` types this application as the receiver, so a
  // result of an unrelated type would silently retype the binding behind the
  // static claim. A refuted result is the ordinary `incompatible-type` value
  // instead. Only a DECIDED result type refutes: a symbolic or unknown one is
  // no more of an answer here than it is anywhere else.
  if (result === undefined || !result.isValid) return result;
  const resultType = result.type.type;
  if (isDecidedReceiverType(resultType) && !isSubtype(resultType, receiver))
    return ce.typeError(receiver, result.type, base);
  return result;
}

/**
 * The value of a property WRITE, checked against the property's declared type
 * at `Self` = the receiver (P12): the ordinary `incompatible-type` error value
 * when it is refused, `null` when it fits — or when nothing decides the
 * question (an invalid or still-symbolic value, a requirement that does not
 * parse at this receiver), the same posture the argument check takes.
 */
function propertyValueError(
  ce: IComputeEngine,
  receiver: Type,
  declared: string,
  value: Expression
): Expression | null {
  if (!value.isValid || !isDecidedReceiverType(value.type.type)) return null;
  let expected: Type;
  try {
    expected = parseType(
      declared,
      selfSubstitutingResolver(
        ce._typeResolver,
        receiver,
        typeToString(receiver)
      )
    );
  } catch {
    return null;
  }
  const checked = checkType(ce, value, expected);
  return checked.isValid ? null : checked;
}

/** No conformance of `record` carries an implementation of the property for
 * this receiver — the property analog of a missed dispatch. */
function missingPropertyError(
  ce: IComputeEngine,
  base: Expression,
  name: string,
  record: ProtocolRecord
): Expression {
  return ce.error([
    'protocol-implementation-missing',
    `no implementation of the \`${record.name}.${name}\` property applies to a value of type \`${typeToString(base.type.type)}\``,
  ]);
}

//
// ── Property ASSIGNMENT (P2) ─────────────────────────────────────────────────
//

/** What `Assign`'s canonical handler should do with a `Field`/`ProtocolProperty`
 * left-hand side. `undefined` = not a protocol property; the caller keeps its
 * existing behavior. */
export type PropertyAssignment =
  /** Rebind `symbol` to the setter invocation (P2's sugar). */
  | { kind: 'rebind'; symbol: string; setter: Expression }
  /** An error VALUE to return in place of the assignment. */
  | { kind: 'error'; error: Expression }
  /** The name IS a protocol property somewhere, but the target's type is not
   * settled yet — the Epsil static pre-pass canonicalizes a whole batch
   * before anything runs, so `p` is routinely still untyped at `p.name = v`.
   * The caller keeps the `Field` target RAW and asks again from `evaluate`,
   * where the type is known. */
  | { kind: 'defer' };

/**
 * P2 — `p.name = v` ⇝ `p = «set name»(p, v)`.
 *
 * `lhs` is the RAW (unbound, uncanonicalized) left operand of `Assign`, so the
 * receiver's type is read off its DEFINITION rather than off a canonicalized
 * copy: canonicalizing a bare symbol here would fold a single-letter target
 * into the constant of that name, which is exactly why `Assign` keeps its
 * left operand raw.
 *
 * Three verdicts, in the order the design fixes them:
 * - a `readwrite` property on a bare-symbol root → the rebinding;
 * - a `readonly` one → `protocol-property-readonly-set`;
 * - a protocol property reached through anything BUT a bare symbol (a
 *   `Field`/`At` chain, a qualified `p.(P.name)`) →
 *   `property-assignment-target-invalid`. A NON-protocol field assignment is
 *   left alone: it keeps the `incompatible-type` it has always produced.
 */
export function protocolPropertyAssignment(
  ce: IComputeEngine,
  lhs: Expression,
  value: Expression
): PropertyAssignment | undefined {
  // The qualified form is a valid READ and never a valid target (v1).
  if (isFunction(lhs, 'ProtocolProperty')) {
    const parts = protocolPropertyOperandsOf(lhs.ops);
    if (parts === null) return undefined;
    return {
      kind: 'error',
      error: invalidTargetError(ce, `${parts.protocol}.${parts.name}`),
    };
  }

  if (!isFunction(lhs, 'Field')) return undefined;
  const name = isString(lhs.ops[1]) ? lhs.ops[1].string : undefined;
  if (name === undefined) return undefined;
  const root = lhs.ops[0];
  if (root === undefined) return undefined;
  // A name no protocol declares as a property is not ours at all — checked
  // FIRST so an ordinary `Field` assignment (the overwhelming majority, and
  // every one of them on an engine with no protocols) pays nothing and, in
  // particular, does not canonicalize its root here.
  if (protocolsWithProperty(ce, name).length === 0) return undefined;

  const rootName = sym(root);
  if (rootName === undefined) {
    // A non-variable target. Only claim it when the property COULD be a
    // protocol property of the (canonicalized) root's type — otherwise the
    // ordinary `Field`-assignment error must stand. The predicate is
    // deliberately lax here: no implementation is selected, so an absence
    // marker (`xs[i]` types `missing | string`) must not make the verdict
    // silently revert to `incompatible-type`.
    let rootType: Type;
    try {
      rootType = root.canonical.type.type;
    } catch {
      return undefined;
    }
    if (!couldBeProtocolProperty(ce, rootType, name)) return undefined;
    return { kind: 'error', error: invalidTargetError(ce, name) };
  }

  const def = ce.lookupDefinition(rootName);
  const rootType: Type | undefined = isValueDef(def)
    ? def.value.type.type
    : undefined;

  // A root with no binding YET is the ordinary pre-pass shape (`let p = …`
  // declares nothing until it runs), so it is deferred, not refused — but only
  // when the name is a protocol property somewhere. Otherwise the existing
  // `Field`-assignment error must stand.
  const resolved =
    rootType === undefined
      ? ({ status: 'undecided' } as const)
      : resolveProtocolProperty(ce, rootType, name);
  if (resolved.status === 'none') return undefined;
  if (resolved.status === 'undecided')
    return protocolsWithProperty(ce, name).length > 0
      ? { kind: 'defer' }
      : undefined;
  if (resolved.status === 'ambiguous')
    return {
      kind: 'error',
      error: ambiguousPropertyError(
        ce,
        name,
        rootType ?? 'unknown',
        resolved.through
      ),
    };
  if (resolved.kind === 'readonly')
    return {
      kind: 'error',
      error: ce.error([
        'protocol-property-readonly-set',
        `the property \`${resolved.record.name}.${name}\` is \`readonly\`; it cannot be assigned`,
      ]),
    };

  // The value must fit the property's declared type at `Self` = the receiver:
  // the lowering hands it straight to the setter, so a mistyped write is
  // refused here — a STATIC diagnostic, like every other argument mismatch —
  // rather than reaching the handler at evaluation.
  const refused = propertyValueError(
    ce,
    rootType!,
    resolved.declared,
    value.canonical
  );
  if (refused !== null) return { kind: 'error', error: refused };

  // The winner is resolved HERE, at canonicalization: the assignment lowers to
  // a qualified setter invocation naming the protocol it selected.
  return {
    kind: 'rebind',
    symbol: rootName,
    setter: ce.function('ProtocolProperty', [
      ce.string(resolved.record.name),
      ce.string(name),
      ce.symbol(rootName),
      value,
    ]),
  };
}

/**
 * COULD `name` be a protocol property of a value of type `t`?
 *
 * The lax counterpart of {@link resolveProtocolProperty}, used only for the
 * `property-assignment-target-invalid` verdict — where no implementation is
 * selected and the question is merely "is this a protocol property at all".
 * Applicability is two-way (Appendix A's wording, P35), and a UNION is tried
 * arm by arm: `xs[i]` types `missing | string`, which the strict receiver gate
 * (P32) declines outright.
 */
function couldBeProtocolProperty(
  ce: IComputeEngine,
  t: Type,
  name: string
): boolean {
  const records = protocolsWithProperty(ce, name);
  if (records.length === 0) return false;
  const arms = typeof t === 'object' && t.kind === 'union' ? t.types : [t];
  return records.some((r) =>
    r.conformances.some((edge) =>
      arms.some((arm) => edgeCouldApply(ce, edge, arm))
    )
  );
}

/** `property-assignment-target-invalid` — P2's non-variable-root verdict. */
function invalidTargetError(ce: IComputeEngine, name: string): Expression {
  return ce.error([
    'property-assignment-target-invalid',
    `the protocol property \`${name}\` can only be assigned through a variable: \`p.${name.split('.').pop()} = …\` rebinds \`p\`, and only a binding can be rebound`,
  ]);
}

//
// ── Compilation planning ─────────────────────────────────────────────────────
//
// Read-only views over the registry for `compilation/protocol-dispatch.ts`
// (the JS dispatch planner). They reuse the SAME selection machinery the
// interpreter runs (`bestCandidates`, `edgeTargetAt`), so the compiled tier
// cannot drift from `dispatchMember` on what applies. Everything here is a
// SNAPSHOT of the registry at compile time: a later conformance is a `config`
// state event, and compiled artifacts bake the candidate set they saw (the
// sum-representation posture).
//

/** The property name of a mangled accessor key, or `null` for a function
 * member key. */
function propertyNameOfKey(implKey: string): string | null {
  if (implKey.startsWith(GET_PREFIX)) return implKey.slice(GET_PREFIX.length);
  if (implKey.startsWith(SET_PREFIX)) return implKey.slice(SET_PREFIX.length);
  return null;
}

/** One conformance edge as the compilation planner sees it. */
export type DispatchCandidate = {
  record: ProtocolRecord;
  edge: ConformanceRecord;
  /** Index of the edge in `record.conformances` — stable within a compile,
   * used to mint a deterministic helper name. */
  edgeIndex: number;
  /** The edge's own target. OPEN for a conditional edge — specificity and
   * guard planning must use `widest` or an instantiation, never this. */
  target: Type;
  /** The widest GROUND type the edge can stand for
   * ({@link edgeComparisonTarget}). */
  widest: Type;
  conditional: boolean;
  host: boolean;
};

/**
 * Every non-pending conformance edge carrying an implementation of `implKey`
 * (a function member name, or a mangled `__get__x`/`__set__x` accessor key),
 * across every protocol declaring the member — or only `only`, the qualified
 * form. Returns `null` when NO protocol declares such a member (or `only` is
 * unknown / declares it with the wrong kind): "not a protocol call at all",
 * as opposed to `[]`, "a protocol call with nothing to dispatch to".
 */
export function protocolDispatchCandidates(
  ce: IComputeEngine,
  implKey: string,
  only?: string
): DispatchCandidate[] | null {
  const propertyName = propertyNameOfKey(implKey);
  const memberName = propertyName ?? implKey;
  let records: ProtocolRecord[];
  if (only !== undefined) {
    const record = ce._protocolRegistry[only];
    const m = record?.members[memberName];
    if (m === undefined) return null;
    if (propertyName === null ? m.kind !== 'function' : m.kind === 'function')
      return null;
    records = [record!];
  } else {
    records =
      propertyName === null
        ? protocolsWithMember(ce, memberName)
        : protocolsWithProperty(ce, memberName);
    if (records.length === 0) return null;
  }

  const out: DispatchCandidate[] = [];
  for (const record of records) {
    record.conformances.forEach((edge, edgeIndex) => {
      if (edge.pending) return;
      const impl = edge.impl?.[implKey];
      if (impl === undefined) return;
      out.push({
        record,
        edge,
        edgeIndex,
        target: edge.target,
        widest: edgeComparisonTarget(edge),
        conditional: edge.where !== undefined,
        host: !isExpressionImplementation(impl),
      });
    });
  }
  return out;
}

/**
 * The implementation `dispatchMember` would select for a receiver whose type
 * IS `receiver` — the static half of the compiled tier's "tier A" decision.
 * `ambiguous` mirrors the interpreter's `protocol-call-ambiguous`;
 * `undecided` is the P32 gate.
 */
export function staticProtocolResolution(
  ce: IComputeEngine,
  implKey: string,
  receiver: Type,
  only?: string
):
  | { status: 'undecided' | 'none' | 'ambiguous' }
  | {
      status: 'unique';
      record: ProtocolRecord;
      edge: ConformanceRecord;
      /** The GROUND target the winning edge stands for at `receiver`. */
      target: Type;
    } {
  if (!isDecidedReceiverType(receiver)) return { status: 'undecided' };
  const cands = protocolDispatchCandidates(ce, implKey, only);
  if (cands === null || cands.length === 0) return { status: 'none' };
  const records = [...new Set(cands.map((c) => c.record))];
  const best = bestCandidates(ce, records, implKey, receiver);
  if (best.length === 0) return { status: 'none' };
  if (best.length > 1) return { status: 'ambiguous' };
  const b = best[0];
  return { status: 'unique', record: b.record, edge: b.edge, target: b.target };
}

/**
 * The arity a call to the FUNCTION member `member` of `record` must have, or
 * `undefined` when the requirement does not pin one (unparseable, optional or
 * variadic parameters) — the planner declines those.
 */
export function requirementArityOf(
  ce: IComputeEngine,
  record: ProtocolRecord,
  member: string
): number | undefined {
  const sig = requirementShape(ce, record, member);
  if (sig === null) return undefined;
  if ((sig.optArgs?.length ?? 0) > 0 || sig.variadicArg !== undefined)
    return undefined;
  return sig.args?.length ?? 0;
}

/**
 * The stored implementation of `implKey` on `edge`, rebuilt as a RAW function
 * literal whose type annotations are GROUND — every `Self`-bearing annotation
 * re-parsed at `Self = edge.target` (P12's substitution, via the same
 * {@link selfSubstitutingResolver} the P17 validation uses) and re-serialized.
 *
 * The interpreter never enforces these annotations: `apply()` runs the stored
 * literal with its `Self` annotations unparseable (so effectively
 * unannotated), after `dispatchMember` has checked the arguments at
 * `Self = runtime type`. Substituting the edge's target — a SUPERTYPE of every
 * runtime receiver the edge admits — is therefore sound for the compiled
 * body: it admits everything the interpreter admits.
 *
 * Returns `null` for a host callback, a conditional edge (the v1 compiler
 * declines those before asking), or an annotation that fails to re-parse.
 */
export function implementationLiteralAt(
  ce: IComputeEngine,
  edge: ConformanceRecord,
  implKey: string
): Expression | null {
  const impl = edge.impl?.[implKey];
  if (impl === undefined) return null;
  if (!isExpressionImplementation(impl)) return null;
  if (edge.where !== undefined) return null;
  if (!isFunction(impl, 'Function')) return null;

  const resolver = selfSubstitutingResolver(
    ce._typeResolver,
    edge.target,
    edge.targetKey
  );
  const ground = (text: string): string | null => {
    try {
      return typeToString(parseType(text, resolver));
    } catch {
      return null;
    }
  };

  const params: Expression[] = [];
  for (const param of impl.ops.slice(1)) {
    if (!isFunction(param, 'Typed')) {
      params.push(param);
      continue;
    }
    const text = typeTextOf(param.ops[1]);
    if (text === undefined) {
      params.push(param);
      continue;
    }
    const g = ground(text);
    if (g === null) return null;
    params.push(
      ce._fn('Typed', [param.ops[0], ce.string(g)], { canonical: false })
    );
  }

  // The body-slot return ascription (`["Typed", body, text]`) may be a plain
  // return type or the literal's full marker signature — both re-parse and
  // re-serialize the same way.
  let body = impl.ops[0];
  if (isFunction(body, 'Typed')) {
    const text = typeTextOf(body.ops[1]);
    if (text !== undefined) {
      const g = ground(text);
      if (g === null) return null;
      body = ce._fn('Typed', [body.ops[0], ce.string(g)], {
        canonical: false,
      });
    }
  }

  return ce._fn('Function', [body, ...params], { canonical: false });
}
