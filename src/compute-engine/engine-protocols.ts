import type {
  DeclarationOrigin,
  EffectSet,
  FunctionSignature,
  Type,
  TypeParameter,
  TypeReference,
  TypeResolver,
} from '../common/type/types.js';
import {
  checkSameUnitRedefinition,
  isSameStatementReRegistration,
} from './declaration-origin.js';
import { parseType } from '../common/type/parse.js';
import { typeToString } from '../common/type/serialize.js';
import {
  isObjectType,
  isSubtype,
  objectLayoutOfType,
  resolveTypeReference,
  widen,
} from '../common/type/subtype.js';
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
import type { Expression, ObjectInterface } from './types-expression.js';
import type {
  BoxedDefinition,
  OperatorDefinition,
} from './types-definitions.js';
import type { Scope } from './types-evaluation.js';
import {
  isExpression,
  isFunction,
  isObject,
  isString,
  sym,
} from './boxed-expression/type-guards.js';
import { functionLiteralReturnMarker } from './boxed-expression/function-literal.js';
import {
  describeEffects,
  inferFunctionLiteralEffects,
} from './boxed-expression/effects-inference.js';
import {
  isOperatorDef,
  isValueDef,
  updateDef,
} from './boxed-expression/utils.js';
import { checkArity, checkType } from './boxed-expression/validate.js';
import { settleTypeText } from './library/type-value-utils.js';
import { apply, lookup } from './function-utils.js';
import { journalCheckpointMapEntry } from './checkpoint-journal.js';
import { journalDefinitionRecord } from './boxed-expression/boxed-value-definition.js';

//
// PROTOCOLS — declarations, conformance, implementations, and dispatch.
//
// Protocols are engine-global, like types, but protocol names are not types:
// they never
// enter `_typeRegistry`, `knownTypeNames`, or the type resolver.
// `docs/plans/2026-08-12-protocols-design.md` records the full design.
//

/** `Self` is a textual substitution token, never a declarable type. It must
 * not resolve through the engine's registry, so the only place it
 * has a meaning is the wrapper below. */
export const SELF_TYPE_NAME = 'Self';

/** Names a protocol may not take. `Self` is the substitution token; `where` is
 * reserved by the type grammar. */
function isReservedProtocolName(name: string): boolean {
  return name === SELF_TYPE_NAME || isReservedTypeName(name);
}

/**
 * A resolver that additionally recognizes `Self` while validating a protocol
 * member's signature. The stored signature keeps `Self` unsubstituted, so
 * downstream resolution still depends on the receiver type.
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

/** Is `name` a declared type of this engine?
 *
 * The resolver THROWS `protocol-in-type-position` for a name its protocol
 * registry holds — which is exactly the case a re-declaration probes here
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
 * Register a protocol. Host API errors throw. The Epsil statement route passes
 * `fromStatement: true`, allowing a later statement batch to replace its own
 * declaration and converting a thrown error into an error value.
 */
export function declareProtocolImpl(
  ce: IComputeEngine,
  name: string,
  members: ProtocolMembersInput | undefined,
  options?: { fromStatement?: boolean; origin?: DeclarationOrigin }
): void {
  if (!isValidTypeName(name))
    throw Error(`The protocol name "${name}" is invalid`);
  if (isReservedProtocolName(name))
    throw Error(`The protocol name "${name}" is reserved`);
  // Protocols and types share a namespace, so a protocol may not shadow either
  // a built-in or a declared type. `declareType()` enforces the reverse case.
  if (isValidPrimitiveType(name) || isDeclaredTypeName(ce, name))
    throw Error(
      `The protocol name "${name}" is already a type; protocols and types share no names`
    );

  const registry = ce._protocolRegistry;
  const existing = registry[name];
  const fromStatement = options?.fromStatement === true;
  const origin = options?.origin;
  if (existing !== undefined) {
    // A second `protocol` statement declaring this name in the same compilation
    // unit is refused; a later unit may replace it. Check before validating the
    // members because the record is replaced in place below,
    // so a rejected duplicate must not have touched it.
    checkSameUnitRedefinition('protocol', name, existing._declOrigin, origin);
    // A record created from a `protocol` statement may be replaced by a later
    // statement batch, such as an edited notebook cell. A host
    // declaration is never replaced — it throws, like `ce.declareType()`.
    if (!fromStatement || !existing.declaredByStatement)
      throw Error(`The protocol "${name}" is already declared`);
    // The canonical and evaluate handlers of one statement run back-to-back.
    // Their shared origin stamp proves the record already contains this exact
    // registration, so the second pass is a no-op. A rejected replacement
    // restores the previous stamp through the registry rollback point.
    if (isSameStatementReRegistration(existing._declOrigin, origin)) return;
  }

  // Validate every member before touching the registry, so a malformed
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
    // Replacing a protocol can widen a dispatcher's effect set: a
    // requirement's ceiling loosened from `pure` to `random`, or a bare
    // requirement whose changed shape now matches an effectful conformer can
    // invalidate a `pure` caller. As in
    // `declareConformance`, the declared contracts can only be re-derived
    // against the live registry, so the replacement is applied and undone
    // below if it falsifies one. A fresh declaration needs
    // no such guard: it installs dispatchers for a name nothing could already
    // be calling.
    const restore = ce._protocolRegistryRollbackPoint();
    // Mutate records in place so captured references remain valid.
    // Conformance edges survive a re-declaration because conformance is
    // monotone.
    existing.members = validated;
    existing.declaredByStatement = fromStatement;
    // The redefinition stamp belongs to the declaration it describes. A
    // replacement without an origin (the box route, which has no batch) clears
    // it rather than leaving a stale one behind: an unstamped record is
    // one no statement of the current unit owns. Undone by the rollback thunk
    // below if the widening check rejects this replacement.
    if (origin === undefined) delete existing._declOrigin;
    else existing._declOrigin = origin;
    // A replaced protocol may have gained, lost, or retyped requirements, so
    // every conformance is revalidated against the new requirement set.
    // An implementation that no longer matches leaves its conformance pending:
    // the edge survives because conformance is monotone, but is not fulfilled,
    // so the end-of-batch warning fires
    // until the implementation is edited to match.
    // The validator receives only the author's block: the edge's map may also
    // carry accessors the engine synthesized for field-backed properties, and
    // those would read as an author writing an accessor beside a stored field
    // (`object-property-conflict`). They are re-derived right after, against
    // the new requirement set and the target's unchanged layout.
    for (const c of existing.conformances) {
      const authored = c._authored;
      if (authored === undefined) continue;
      const failure = implementationProblem(
        ce,
        existing,
        c.target,
        c.targetKey,
        authored,
        c.where
      );
      // Both halves run: a block that no longer validates still has to have
      // its stale synthesized accessors re-derived, or accessors for a
      // requirement the replacement dropped would keep answering.
      // A replacement that made the protocol object-only (it gained a
      // `readwrite` property, or a member declaring `state`) leaves every
      // value-type edge pending rather than removing it — conformance is
      // monotone, and the replacement itself is not rejected. That verdict
      // comes from `settleFieldBacking`, which reports a gated edge as
      // uncovered, so it reaches the block-less edges below by the same route.
      const covered = settleFieldBacking(ce, existing, c);
      c.pending = failure !== null || !covered;
      // An edge that read fine in the previous cell and is pending now needs
      // to say what moved: the end-of-batch warning names only the (target,
      // protocol) pair, which for a re-settled edge is the least informative
      // half of the story.
      noteEdgePendingReason(ce, existing, c, failure, true);
    }
    // Edges without authored implementations are recomputed from what the
    // implementations now cover: an edge that inherited a supertype's
    // implementation goes back to pending when that implementation stops
    // matching the new requirements, and vice versa.
    //
    // Record a new settlement reason only where the settlement actually
    // moved. Re-executing an identical `protocol` statement re-runs all of
    // this and changes nothing, and a blanket "these were re-settled" would
    // then invent a layout reason on an edge that has simply never been
    // implemented, whose existing warning already explains the whole state.
    const blockLessBefore = existing.conformances
      .filter((c) => c._authored === undefined)
      .map((c) => ({ edge: c, impl: c.impl, pending: c.pending }));
    refreshInheritedPending(ce, existing);
    for (const b of blockLessBefore)
      if (b.edge.impl !== b.impl || b.edge.pending !== b.pending)
        noteEdgePendingReason(ce, existing, b.edge, null, true);
    // A replacement is a `config`-class state event, exactly like a type
    // redefinition: cached decisions taken against the old requirement set
    // must not be left stale.
    ce._noteStateEvent({ kind: 'config' });
    ce._noteConformanceRegistryChange();
    // The requirement set changed: install the dispatchers of the members it
    // gained, refresh the survivors' signatures, and remove the ones it
    // dropped.
    syncProtocolDispatchers(ce);

    const violations = conformanceWideningViolations(ce);
    if (violations.length > 0) {
      // The rollback thunk emits its own `config` state event and bumps the
      // conformance version when it restores anything, so nothing is emitted
      // here on top of that. It only restores the registry, so the
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
  if (origin !== undefined) record._declOrigin = origin;
  registry[name] = record;
  // A fresh declaration is a config event because `typesOverlap` and dispatch
  // decisions are keyed on the registry.
  ce._noteStateEvent({ kind: 'config' });
  ce._noteConformanceRegistryChange();
  // Every function member becomes callable by its bare name unless the
  // name is already taken (see `syncProtocolDispatchers`).
  syncProtocolDispatchers(ce);
}

/**
 * The first parameter of a protocol function is the dispatch position and must
 * be typed `Self`. Check the parsed parameter's spelling because
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
 * Protocol members cannot be optional, variadic, or generic. Enforce this
 * at declaration, because every downstream consumer (the dispatcher's arity,
 * `checkMemberArguments`, the implementation signature check) reads only
 * at declaration because downstream consumers read only `signature.args`; a
 * requirement carrying `optArgs`, `variadicArg`, or
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

/** A conformance target must be named and ground: a built-in type name, a
 * ground application, or a nominal type. */
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

/**
 * Why the primitive `type` (a reified type expression) may not be a
 * conformance target, or `null` when the target is admissible.
 *
 * The primitive `type` declares NO conformances — by ruling, not by accident:
 * `Conforms` reads a type-VALUE subject as asking about the HELD type, and
 * that branch is unambiguous only while the value's own type conforms to
 * nothing (`docs/plans/2026-08-18-first-class-types.md` §3.3).
 *
 * Both routes that create a conformance edge must apply this, or the
 * invariant holds only for the one that does: the Epsil `type X is P`
 * statement (`declareConformanceStatement` in `library/core.ts`, which turns
 * the message into an error VALUE) and the host
 * `ce.declareProtocolImplementation()` (which THROWS, its convention
 * throughout).
 *
 * The test is mutual subtyping against the RESOLVED target, so an alias whose
 * body is `type` is caught too, while a target that does not settle — a
 * conditional-conformance head pattern such as `list<T>`, whose variable is
 * bound by a `where` clause this function does not see — passes through to
 * its own pipeline. Settling (rather than `parseType` on the engine resolver)
 * is what keeps the check free of side effects: it never forward-registers an
 * unknown name.
 */
/**
 * The `type`-primitive conformance guard, shared by BOTH conformance-edge
 * creators (the `DeclareConformance` statement route and the host
 * `declareProtocolImplementation` route — the complete set): a target that
 * is MUTUALLY SUBTYPE with the primitive `type` may not conform to any
 * protocol. `Conforms` reads a type-VALUE subject as asking about the type
 * it HOLDS, and that branch is unambiguous only while the value's own
 * type conforms to nothing
 * (`docs/plans/2026-08-18-first-class-types.md` §3.3).
 *
 * Deliberately NOT caught here, verified harmless: a NOMINAL wrapper
 * (`ce.declareType('TNom', 'type')`) may conform — its values are TAGGED
 * constructor nodes, not bare type values, so `Conforms` never takes the
 * held-type branch for them and the ambiguity cannot arise. A structural
 * ALIAS of `type` never reaches this check: the alias rule in
 * `conformanceTargetProblem` refuses every alias target first. A
 * conditional-conformance head pattern (`list<T>`) does not settle, so the
 * guard skips it (returns null) and its own pipeline validates it.
 */
export function typePrimitiveConformanceProblem(
  ce: IComputeEngine,
  targetSource: string
): string | null {
  const settled = settleTypeText(ce, targetSource);
  if ('error' in settled) return null;
  if (
    !ce.type(settled.type).matches('type') ||
    !ce.type('type').matches(settled.type)
  )
    return null;
  return 'The `type` primitive cannot conform to a protocol: a type-value subject of `Conforms` asks about the type it HOLDS, which is unambiguous only while `type` itself conforms to nothing';
}

//
// ── The mutability gate ──────────────────────────────────────────────────────
//
// A writable property is meaningful only on a mutable object. A protocol that
// can modify object state — through a `readwrite` property or a function member
// with a declared `state` effect — can therefore be adopted only by object
// types. Read-only and semantic protocols remain available to other types.
//
// Two non-obvious boundaries:
//
//   * A bare function requirement never gates. Its effects are derived from
//     whatever conformers exist, so reading `state` off it would make the gate
//     depend on the conformer set rather than on the protocol's declaration
//     alone — and a record may legitimately conform to a bare-function
//     protocol with a pure implementation while object conformers of the same
//     protocol mutate.
//   * An explicit `pure` never gates. It parses to the stated empty set, which
//     is a real (and the strongest) ceiling, not an absence — the same
//     `undefined`-means-bare / `[]`-means-pure discipline the effect ceiling in
//     `signatureMismatch` uses.
//

/** Why a protocol is object-only: the kind of member that gated, and the
 * member names of that kind, in declaration order. A `readwrite` property
 * outranks a declared-`state` function when both are present — a settable
 * property is the more concrete thing to point the author at. */
type MutabilityGate = {
  kind: 'readwrite' | 'state';
  members: string[];
};

/**
 * Memo of {@link mutabilityGate}, keyed on a protocol's MEMBERS object.
 *
 * Deriving the verdict parses every function requirement's signature, and the
 * verdict is asked for on every conformance edge, on every registration, and
 * on every pass of {@link refreshInheritedPending} — so it is worth computing
 * once per requirement set.
 *
 * The key is `record.members`, NOT the record: a protocol record mutates IN
 * PLACE when the protocol is re-declared (`declareProtocolImpl` assigns
 * `existing.members = validated`, keeping the record identity so captured
 * references see the update), so a memo keyed on the record would survive a
 * replacement and answer for the OLD requirement set — precisely the case the
 * gate exists to notice, since a replacement is how a protocol acquires a
 * `readwrite` property in the first place. The members object is freshly
 * allocated by every declaration, so keying on it invalidates by construction,
 * with no hook to keep in sync.
 */
const MUTABILITY_GATE_MEMO = new WeakMap<
  Record<string, ProtocolMember>,
  MutabilityGate | null
>();

/**
 * The members that make `record` conformable only by object types, or `null`
 * when the protocol does not gate at all — the gate's PREDICATE half, with no
 * message built and no target consulted.
 *
 * A function requirement whose signature fails to parse contributes nothing:
 * the signature-mismatch path owns that diagnostic, and a gate derived from an
 * unparseable requirement would report the wrong problem.
 */
function mutabilityGate(
  ce: IComputeEngine,
  record: ProtocolRecord
): MutabilityGate | null {
  const memoized = MUTABILITY_GATE_MEMO.get(record.members);
  if (memoized !== undefined) return memoized;
  const gate = deriveMutabilityGate(ce, record);
  MUTABILITY_GATE_MEMO.set(record.members, gate);
  return gate;
}

function deriveMutabilityGate(
  ce: IComputeEngine,
  record: ProtocolRecord
): MutabilityGate | null {
  const settable: string[] = [];
  const stateful: string[] = [];
  for (const [name, member] of Object.entries(record.members)) {
    if (member.kind === 'readwrite') {
      settable.push(name);
      continue;
    }
    if (member.kind !== 'function') continue;
    const sig = requirementShape(ce, record, name);
    if (sig === null) continue;
    const declared = signatureEffects(sig);
    // `undefined` is exactly "bare" (nothing spelled) and `[]` is exactly
    // `pure`; `isEffectSubset` reads both as the empty set, and also admits the
    // top `any`, which permits `state` and so gates.
    if (declared !== undefined && isEffectSubset(['state'], declared))
      stateful.push(name);
  }
  if (settable.length > 0) return { kind: 'readwrite', members: settable };
  if (stateful.length > 0) return { kind: 'state', members: stateful };
  return null;
}

/**
 * How the gate's diagnostic names `target`: the indefinite-article phrase
 * ("a record", "a tuple", "a builtin type") and whether the author can
 * re-declare the type as an `object{…}`.
 *
 * Only a NOMINAL type is re-declarable. A builtin (`string`), a ground
 * application of a builtin constructor (`list<integer>`) and a conditional
 * head (`list<T>`) all name something the author does not own, so the advice
 * for them is that no re-spelling exists, not that they should edit a
 * declaration they never wrote.
 */
function targetKindPhrase(target: Type): {
  article: string;
  plural: string;
  redeclarable: boolean;
  admitsObject: boolean;
} {
  const redeclarable =
    typeof target === 'object' && target.kind === 'reference';
  // A nominal is described by the body it wraps: `Badge`, declared as
  // `record{id: string}`, is "a record". An unresolvable chain falls through to
  // the generic wording rather than guessing.
  const body = resolveTypeReference(target) ?? target;
  // A type that is not an object type but that an OBJECT nonetheless inhabits
  // — `any`, `unknown`, `expression`, `value`, and any nominal declared as one
  // of them. `conformanceTargetProblem` admits a bare primitive name, so
  // `type any is P` and `ce.declareProtocolImplementation('any', …)` both
  // reach the gate. The verdict is unchanged (such a type is not an object
  // type, and admitting one would let a value conform through a target that
  // decides nothing), but the ordinary wording — "has no state to change" —
  // would be a false statement about it: a value of type `any` may well be an
  // object. Read off the subtype lattice rather than a hardcoded list of
  // names, so a new top type is described correctly without an edit here, and
  // off the RESOLVED body, since a nominal is opaque to `isSubtype` and
  // `type T = any` deserves the same answer as `any`.
  const admitsObject = isSubtype('object', body);
  const kind = typeof body === 'string' ? 'builtin' : body.kind;
  const phrase = (article: string, plural: string) => ({
    article,
    plural,
    redeclarable,
    admitsObject,
  });
  switch (kind) {
    case 'record':
      return phrase('a record', 'records');
    case 'tuple':
      return phrase('a tuple', 'tuples');
    case 'list':
      return phrase('a list', 'lists');
    case 'set':
      return phrase('a set', 'sets');
    case 'dictionary':
      return phrase('a dictionary', 'dictionaries');
    case 'collection':
    case 'indexed_collection':
      return phrase('a collection', 'collections');
    case 'signature':
      return phrase('a function type', 'function types');
    default:
      // A builtin primitive reached directly is "a builtin type"; the same
      // shape reached THROUGH a nominal (`type Nom = integer`) is a value type
      // the author declared, so it is named as one.
      return redeclarable
        ? phrase('a nominal value type', 'nominal value types')
        : phrase('a builtin type', 'builtin types');
  }
}

/**
 * The `protocol-requires-object` message for conforming `target` (spelled
 * `source` in the author's text) to `record`, or `null` when the conformance
 * is admissible — either because the protocol does not gate, or because the
 * target is an object type.
 *
 * A CONDITIONAL conformance is judged on its HEAD, which is the type this
 * function is handed: `Box<T>` resolving to an `object{…}` body is admitted,
 * `list<T>` is refused. That is the same input `fieldBackedProperties` refuses
 * to field-back a conditional edge on — a head is a pattern, not a layout —
 * but the two answer different questions: field backing asks which stored
 * slots satisfy a requirement, while the gate asks only whether the head's
 * constructor produces objects at all, which the head does settle.
 */
function mutabilityGateProblem(
  ce: IComputeEngine,
  record: ProtocolRecord,
  target: Type,
  source: string
): string | null {
  const gate = mutabilityGate(ce, record);
  if (gate === null) return null;
  if (isObjectType(target)) return null;

  const { article, plural, redeclarable, admitsObject } =
    targetKindPhrase(target);
  const cause =
    gate.kind === 'readwrite'
      ? `the \`${record.name}\` protocol has settable properties`
      : `the \`${record.name}\` protocol declares the \`state\` effect on \`${gate.members.join('`, `')}\``;
  // A type an object INHABITS is refused for a different reason than an
  // immutable one, so it is told a different thing: not that it has no state,
  // but that it does not commit to having any.
  if (admitsObject)
    return `${cause}. \`${source}\` is not an object type — a value of that type may or may not be an object — so only an object type can conform.`;
  const remedy = redeclarable
    ? `and ${plural} are immutable; declare \`${source}\` as an object type to conform`
    : `which has no state to change; only an object type can conform`;
  return `${cause}. \`${source}\` is ${article}, ${remedy}.`;
}

//
// ── Conditional conformance ──────────────────────────────────────────────────
//
// `type list<T> is Comparable where T is Comparable { … }`. The head names the
// target's variables and the trailing `where` clause binds them — the same
// single-binding-site rule as a function declaration. The clause rides into the
// engine as source text, like `DeclareType`'s `typeParams` attribute, and is
// re-parsed here so the parser owns no part of its meaning.
//
// The clause and head are parsed together as one synthetic signature:
// `(self: list<T>) -> nothing where T is Comparable`. That is not a trick for
// its own sake — it is what makes the type grammar's own declaration-time
// validation apply verbatim: a duplicate variable, a non-ground bound, a
// variable the head never mentions ("quantified but never used"), and the `is`
// slot's oracle requirement all come back for free, with the engine's resolver
// supplying `conformsTo`.
//

/** The conformance oracle of `ce`, in the shape the type layer expects.
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

/** The constructor identity of a conformance target — what "the same head"
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
 * The ground target a conformance edge stands for at a receiver of type
 * `receiver`, or `null` when the edge does not apply to it.
 *
 * The one admission test both halves of dispatch, property resolution and the
 * `conformsTo` oracle go through, so an unconditional and a conditional edge
 * can never drift apart on what "applies" means. Unconditional: the ordinary
 * `isSubtype(receiver, target)`. Conditional: the receiver must match the
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

/** The ground type an edge is compared against when there is no receiver in
 * hand: its own target, or — for a conditional edge — the widest instantiation
 * of its head (every variable read as its bound). Open types must never reach
 * `isSubtype`, so every receiver-less comparison goes through this. */
function edgeComparisonTarget(edge: ConformanceRecord): Type {
  if (edge.where === undefined) return edge.target;
  return widestConditionalTarget(edge.target, edge.where);
}

/** Does the edge apply to `receiver`, or to some subtype of it? Used only by
 * static advisory
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
 * Returns an `Error` value on failure and `null` on success — the shared
 * contract of the statement helpers in `library/core.ts` (errors are values,
 * never throws to the host). Used by both the canonical and evaluate
 * handler of `DeclareConformance`.
 *
 * An implementation block is validated against the protocol's requirements
 * before anything is stored: on failure the previous
 * implementation — and the edge's `pending` flag — are left exactly as they
 * were, and the first problem comes back as the error value.
 *
 * `options.where` makes it a conditional conformance: `targetSource` is then a
 * head pattern naming the clause's variables (`list<T>`).
 *
 * `options.block` is the implementation-block expression the statement carries
 * and provides identity for the same-batch duplicate rule; see
 * {@link ConformanceRecord._implOrigin}).
 */
export function declareConformance(
  ce: IComputeEngine,
  targetSource: string,
  protocolNames: readonly string[],
  impl?: Record<string, Expression | JSImplementation>,
  options?: {
    where?: string;
    block?: Expression;
    /** True when this registration belongs to an Epsil conformance statement.
     * read from the `_epsilDeclarationRoute` marker by the `DeclareConformance`
     * handlers (`withStatementRoute` in `library/core.ts`). Required by the
     * same-block no-op below: an ambient batch id alone cannot distinguish
     * the statement route's canonical/evaluate pair from a re-entrant
     * box-route `.evaluate()` of the same boxed statement, and only the
     * former is proven redundant. */
    fromStatementRoute?: boolean;
  }
): Expression | null {
  if (protocolNames.length === 0)
    return ce.error([
      'protocol-conformance-target-invalid',
      'Expected at least one protocol name',
    ]);

  // An implementation block belongs to one protocol; with `&` there is no way
  // to say which requirement a member implements.
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

  // The target arrives as type-expression source, like `DeclareType`'s body. A
  // conditional target is parsed with its clause, which binds the head's
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

  // Validate the overlap rules against every protocol first, so a rejected
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
    // A protocol that can modify object state is
    // conformable only by object types. Checked here, in the per-protocol
    // pre-pass, so a multi-protocol `is A & B` whose second arm gates
    // registers nothing at all. Check before `implementationProblem` because
    // the verdict is on the (type, protocol) pair whatever the block contains.
    const gated = mutabilityGateProblem(ce, record, target, targetSource);
    if (gated !== null) return ce.error(['protocol-requires-object', gated]);
  }

  // A second implementation block for the same (type, protocol) pair within one
  // batch is an error; the same statement re-run in a later batch replaces the
  // implementation. The install's batch stamp distinguishes the two. A
  // re-registration of the same block — one
  // statement registers up to three times per batch: the static pre-pass
  // canonicalizes it, then the evaluation loop canonicalizes and evaluates it
  // — is not a second block. Check before validating the block: a second
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
    // The canonical and evaluate handlers pass the same block object, so their
    // repeated registration is a no-op. `fromStatementRoute` keeps this shortcut
    // narrower than a batch-id check: a re-entrant box-route evaluation can use
    // the same batch and object after the registry has changed, and must take
    // the full replacement path. Requiring a real block also prevents unrelated
    // registrations without block identity from aliasing one another.
    if (
      options?.fromStatementRoute === true &&
      origin !== undefined &&
      origin.batch === batch &&
      options.block !== undefined &&
      origin.block === options.block
    )
      return null;
  }

  // Apply `Self` substitution once, before the block is validated or stored.
  // Every downstream consumer — validation, the
  // effect walk, dispatch's `apply()`, the literal's own `.type` arrow — reads
  // the stored literal with an ordinary resolver that does not know `Self`.
  // See {@link groundedImplementationLiteral}.
  if (impl !== undefined)
    impl = groundedImplementationBlock(ce, impl, target, targetKey, params);

  // Validate the implementation block before storing anything: a
  // rejected block must leave the previous implementation (and `pending`)
  // untouched, so that a re-run with an edited, broken block does not destroy
  // a working one. `impl` implies a single protocol (checked above).
  if (impl !== undefined) {
    const failure = implementationProblem(
      ce,
      records[0]!,
      target,
      targetKey,
      impl,
      params
    );
    if (failure !== null)
      return ce.error([
        failure.code,
        ...(failure.errorArgs ?? [failure.message]),
      ] as [string, string, ...string[]]);
  }

  // Registering a conformance can WIDEN a dispatcher's DERIVED effect set (the
  // union over the conformers of a bare requirement), and a function annotated
  // `pure` that calls through that dispatcher then declares something that is
  // no longer true. Such a statement is BLOCKED, not merely flagged — the same
  // polarity as an `Assign` that violates a declared type — but the contracts
  // can only be re-derived against the live registry, so the registration
  // happens first and is undone if it turns out to have falsified one
  // if a contract no longer holds.
  const restore = ce._protocolRegistryRollbackPoint();
  /** Did the loop below actually change the registry? A re-declared
   * conformance with no implementation block is a no-op, and re-deriving every
   * declared contract for it would be pure cost. */
  let mutated = false;

  for (const record of records) {
    const existing = record.conformances.find((c) => c.targetKey === targetKey);
    if (existing !== undefined) {
      // A re-declared conformance is a no-op unless an implementation block
      // fulfils a pending edge by covering the
      // requirements.
      if (impl !== undefined) {
        mutated = true;
        existing._authored = impl;
        existing.impl = impl;
        // The stamp rides with the implementation: an install from outside a
        // batch leaves it unstamped and replaces freely.
        if (batch === undefined) delete existing._implOrigin;
        else existing._implOrigin = { batch, block: options?.block };
        // Field backing is settled against the edge as it now stands: the
        // block just installed replaces whatever accessors the engine had
        // synthesized, and a property the block does not implement may be
        // covered by a stored field of the same name.
        existing.pending = !settleFieldBacking(ce, record, existing);
        // Whatever a previous re-settlement recorded about this edge is now out
        // of date: the block just installed is the new answer. Cleared BEFORE
        // the call, because `noteEdgePendingReason` deliberately leaves an
        // existing reason alone when it is not itself re-settling — otherwise a
        // block that fixes some but not all of the requirements would leave the
        // edge pending while still quoting the layout or signature problem the
        // author has just addressed.
        delete existing._pendingReason;
        noteEdgePendingReason(ce, record, existing, null);
        // The new implementation may also fulfil the impl-less edges of the
        // target's SUBTYPES, which inherit it.
        refreshInheritedPending(ce, record);
        ce._noteStateEvent({ kind: 'config' });
        ce._noteConformanceRegistryChange();
      }
      continue;
    }
    const conformance: ConformanceRecord = {
      target,
      targetKey,
      // Settled below, once the edge exists: field backing is derived from the
      // edge (its target's layout and its own block), and an edge with no
      // block at all is settled by `refreshInheritedPending`.
      pending: true,
      declaredByStatement: true,
    };
    if (params !== undefined) conformance.where = params;
    if (impl !== undefined) {
      conformance._authored = impl;
      conformance.impl = impl;
      if (batch !== undefined)
        conformance._implOrigin = { batch, block: options?.block };
    }
    record.conformances.push(conformance);
    if (impl !== undefined) {
      conformance.pending = !settleFieldBacking(ce, record, conformance);
      noteEdgePendingReason(ce, record, conformance, null);
    }
    mutated = true;
    // The new edge may inherit an implementation registered for a supertype,
    // and (with a block of its own) may fulfil impl-less subtype edges.
    refreshInheritedPending(ce, record);
    // A conformance addition must invalidate cached static-dispatch
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

/** The `conformance-widens-declared-contract` message: every violated
 * dependent, with the set it declares, the set it would now infer, and the
 * labels that exceed its ceiling, followed by the available remedies.
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
 * Does `impl` cover every requirement of `members`?
 *
 * Coverage here means only the keys that must be present, never the signature
 * or the
 * type of what they are bound to (that is {@link implementationProblem}). An
 * empty block on a protocol WITH requirements therefore leaves the conformance
 * pending instead of silently fulfilling it. Kept as the cheap pre-check on
 * the `pending` flag: a stored block has already been validated,
 * so on that path this can only answer `true`.
 *
 * Property keys use the `__get__x` / `__set__x` mangling. A semantic protocol
 * with no members is covered by every block, including no block.
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
    if (!has(`${GET_PREFIX}${member}`)) return false;
    if (kind === 'readwrite' && !has(`${SET_PREFIX}${member}`)) return false;
  }
  return true;
}

/**
 * Which property requirements of `members` the merged implementation map does
 * not answer, named as an author would spell them (`get age`, `set age`).
 *
 * Property requirements only, and that is the point rather than an omission:
 * the one caller ({@link noteEdgePendingReason}) uses this to say that a
 * target's stored-field layout no longer satisfies something, and a function
 * member can never be satisfied by a stored field — naming one there would
 * advise the author to add a field that could not possibly help.
 *
 * Directly below {@link implCoversRequirements}, reading the same
 * `members`/`impl` pair through the same own-key test and the same
 * `GET_PREFIX`/`SET_PREFIX` constants: the two answer halves of one question
 * and a change to the key mangling has to reach both.
 */
function uncoveredPropertyRequirements(
  members: Record<string, ProtocolMember>,
  impl: Record<string, Expression | JSImplementation> | undefined
): string[] {
  const has = (key: string): boolean =>
    impl !== undefined && Object.prototype.hasOwnProperty.call(impl, key);
  const missing: string[] = [];
  for (const [member, requirement] of Object.entries(members)) {
    if (requirement.kind === 'function') continue;
    if (!has(`${GET_PREFIX}${member}`)) missing.push(`get ${member}`);
    if (requirement.kind === 'readwrite' && !has(`${SET_PREFIX}${member}`))
      missing.push(`set ${member}`);
  }
  return missing;
}

//
// ── Field-backed property satisfaction (Appendix B, "Objects and protocols") ─
//
// A property requirement of a protocol is satisfied, with no `get`/`set`
// written, by a STORED FIELD of the same name on a conforming OBJECT type:
// `readwrite` when the field's type is exactly the property's type (the getter
// direction would admit a narrower field and the setter direction a wider one,
// so the only type satisfying both is the property's own), `readonly` when the
// field's type is the property's type or a subtype (only the getter direction
// exists, so the ordinary covariant rule applies).
//
// Satisfaction is implemented by SYNTHESIZING the accessors and registering
// them in the conformance edge's implementation map under the same mangled
// keys an authored block would use, so the INTERPRETED tiers — dispatch
// selection, property reads, property writes — need no special case: they
// find a handler where they always look.
//
// The compiled tier is the exception, and it fails closed. A synthesized
// accessor is a host callback, and the compile planner refuses host
// candidates (`compilation/protocol-dispatch.ts`), so a compiled qualified
// read or write on a field-backed type declines and the expression stays
// interpreted. Until objects themselves compile, there is no field load or
// store representation for the planner to emit.
//

/** An accessor the engine synthesized for a field-backed property, as opposed
 * to one the author wrote. The marker carries the field's name, and is what
 * lets a later re-derivation (a protocol replacement, a new implementation
 * block) tell the engine's own entries from the author's and strip them. */
type FieldBackedImplementation = JSImplementation & { _fieldBacked: string };

function isFieldBacked(
  value: Expression | JSImplementation
): value is FieldBackedImplementation {
  return typeof (value as FieldBackedImplementation)._fieldBacked === 'string';
}

/**
 * Which property requirements of `record` the stored fields of `target`
 * satisfy, and which names are declared BOTH as a stored field and as an
 * explicit accessor in `impl`.
 *
 * Field backing applies to object types only. A record, a primitive, the bare
 * `object` type (which promises that fields exist without naming them, so no
 * field type can be read off it), and a conditional conformance all get none.
 * A conditional conformance's target is a head pattern rather than a ground
 * layout, so there is no single
 * set of stored fields to match a requirement against.
 *
 * A requirement whose type does not parse at `Self = target` is skipped rather
 * than reported here: the signature-mismatch path in
 * {@link implementationProblem} owns that diagnostic.
 */
function fieldBackedProperties(
  ce: IComputeEngine,
  record: ProtocolRecord,
  target: Type,
  impl: Record<string, Expression | JSImplementation> | undefined,
  params?: readonly TypeParameter[]
): { satisfied: Set<string>; conflicts: string[] } {
  const satisfied = new Set<string>();
  const conflicts: string[] = [];
  if (params !== undefined) return { satisfied, conflicts };
  const layout = objectLayoutOfType(target);
  if (layout === undefined) return { satisfied, conflicts };

  const resolver = selfSubstitutingResolver(
    ce._typeResolver,
    target,
    typeToString(target)
  );
  const owns = (host: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(host, key);

  for (const [name, member] of Object.entries(record.members)) {
    if (member.kind === 'function') continue;
    if (!owns(layout.elements, name)) continue;
    const field = layout.elements[name]!;
    if (
      impl !== undefined &&
      (owns(impl, `${GET_PREFIX}${name}`) || owns(impl, `${SET_PREFIX}${name}`))
    ) {
      conflicts.push(name);
      continue;
    }
    let declared: Type;
    try {
      declared = parseType(member.type, resolver);
    } catch {
      continue;
    }
    if (fieldSatisfiesRequirement(field, declared, member.kind))
      satisfied.add(name);
  }
  return { satisfied, conflicts };
}

/**
 * May a stored field of type `field` stand in for a property requirement of
 * type `declared` and the given kind?
 *
 * `readwrite` demands the two types be the same: the getter direction alone
 * would admit a narrower field and the setter direction alone a wider one, so
 * the only type satisfying both is the property's own. `readonly` has only the
 * getter direction, so the ordinary covariant rule applies and a subtype is
 * enough.
 *
 * The single implementation of the rule, so that the two places that ask it
 * cannot drift: {@link fieldBackedProperties}, which decides at registration
 * time whether to synthesize accessors from the type registry's layout, and
 * {@link evaluateProtocolProperty}, which re-asks it at READ time against the
 * layout the receiving instance was constructed with. Should the `readonly`
 * writability axis ever be revisited (the open `readonly` ruling), this is the
 * one function to change.
 */
function fieldSatisfiesRequirement(
  field: Type,
  declared: Type,
  kind: 'readonly' | 'readwrite'
): boolean {
  if (kind === 'readwrite')
    return isSubtype(field, declared) && isSubtype(declared, field);
  return isSubtype(field, declared);
}

/**
 * The synthesized getter of a field-backed property: a pure load of the stored
 * slot, which runs no user code.
 *
 * On the interpreted route, the read path recognizes the `_fieldBacked` marker
 * and loads the slot itself (see {@link evaluateProtocolProperty}), so this
 * callback is the fallback for any other invoker; it answers `undefined` for a
 * receiver that is not an object — or one whose pinned layout has no such
 * slot — which the boxing layer turns into `Nothing`. Declining rather than
 * refusing is appropriate here, unlike in {@link fieldSetter}: a read
 * that cannot be answered has always stayed symbolic, while a write that
 * cannot be performed must not report success.
 *
 * As a host callback, it is refused by the compile planner, so the compiled
 * tier declines until object field loads have a compiled representation.
 */
function fieldGetter(name: string): FieldBackedImplementation {
  return {
    host: (self: Expression) => {
      if (!isObject(self)) return undefined;
      // The receiver's own pinned layout has to carry the slot. The interpreted
      // read path checks admissibility as well (it has the requirement in hand;
      // see `pinnedLayoutRefusal`) and never reaches this callback — but an
      // invoker that does reach it has passed through no such check, and
      // loading a slot off an instance whose layout never declared the field
      // would answer for a name it does not have.
      //
      // A receiver with no introspectable layout at all (the bare `object`
      // type, or a nominal whose definition has gone) is exempt, exactly as it
      // is in `fieldSetter` and `pinnedLayoutRefusal`: the missing field type
      // there means "this layout cannot be read", not "this layout lacks the
      // field", and the slot is the only authority left.
      if (
        objectLayoutOfType(self.type.type) !== undefined &&
        self._fieldType(name) === undefined
      )
        return undefined;
      return self._field(name);
    },
    _fieldBacked: name,
  };
}

/**
 * The synthesized setter of a field-backed `readwrite` property: it stores the
 * value into the slot and returns the RECEIVER.
 *
 * Returning the receiver is a convention rather than a requirement — a store
 * discards whatever a `set` handler returns — but it is the useful one: an
 * authored setter that hands the receiver back can be called directly, and it
 * reads as what the write is, a modification of the object every other
 * reference to it also sees.
 *
 * The value is re-checked against the field's DECLARED type as pinned on the
 * instance. The caller has already checked it against the property's declared
 * type, and for a `readwrite` requirement the two are the same type by
 * construction — this is the second line of defence for the case where the
 * layout and the requirement drift apart (a protocol replaced after the object
 * was constructed), and it is the only check an invoker that reaches this
 * callback directly passes through.
 *
 * Like the getter, this is a host callback, so the compile planner refuses it
 * until object field stores have a compiled representation.
 */
function fieldSetter(
  ce: IComputeEngine,
  name: string
): FieldBackedImplementation {
  return {
    host: (self: Expression, value: Expression) => {
      if (!isObject(self) || value === undefined) return undefined;
      const expected = self._fieldType(name);
      if (expected === undefined) {
        // A receiver whose PINNED layout DOES name its fields and does not
        // include this one is refused rather than given a new slot: it was
        // constructed before a `type` statement added the field this accessor
        // stands for, and storing would give that one instance a slot its own
        // layout does not declare — every read of it through the type would
        // then disagree with every other instance. The read half refuses the
        // mirror case (see `pinnedLayoutRefusal`).
        //
        // A receiver with NO introspectable layout (the bare `object` type, or
        // a nominal whose definition has gone) is a different situation, and
        // the same absence stands for it: nothing here can say the field is
        // wrong, and a message advising the author to "rebuild it from the
        // current declaration of `object`" would name a declaration that does
        // not exist. Such a receiver stores unchecked, exactly as it did before
        // any of this — the value has already been checked against the
        // property's own declared type by every caller.
        if (objectLayoutOfType(self.type.type) === undefined) {
          self._store(name, value);
          return self;
        }
        return ce.error([
          'protocol-implementation-missing',
          `\`${name}\` cannot be written on this value: it was constructed with a layout that has no stored field \`${name}\`. Rebuild it from the current declaration of \`${typeToString(self.type.type)}\`.`,
        ]);
      }
      const checked = checkType(ce, value, expected);
      if (!checked.isValid) return checked;
      self._store(name, value);
      return self;
    },
    _fieldBacked: name,
  };
}

/**
 * Re-derive this edge's field-backed accessors and register them, returning
 * whether the edge's implementation now COVERS the protocol's requirements.
 *
 * Idempotent by construction: the merged map is rebuilt from the author's
 * block ({@link ConformanceRecord._authored}) and the target's layout, so a
 * protocol replacement — which may have retyped or dropped a requirement —
 * re-settles with no accessor left over from the old requirement set. The
 * rebuild also PRESERVES the map when nothing about it changed (same keys,
 * same author entries, same field-backed names): the registry's rollback thunk
 * compares `impl` by reference to decide whether it restored anything, so a
 * fresh-but-equal object on every conformance registration would emit spurious
 * `config` state events and invalidate caches that are still valid.
 *
 * Settling a BLOCK-LESS edge is what lets an object type's stored field beat
 * an accessor it would otherwise inherit: the edge now carries an
 * implementation of that key, and its target is the more specific one, so
 * ordinary selection prefers it over a supertype's written accessor — while
 * every member the fields do not answer is still inherited. Appendix A's "most
 * specific implementation wins" and Appendix B's "satisfied automatically by a
 * stored field" agree here, and the field is what the type itself says the
 * property is.
 *
 * The layout is read from the type registry as it stands at settle time, while
 * an object instance carries the layout it was constructed with. Both halves
 * of a redefinition therefore re-settle: a protocol replacement runs the loop
 * in {@link declareProtocolImpl}, and a cross-batch redefinition of the object
 * TYPE runs {@link resettleTypeConformances} from `declareType`. Objects built
 * earlier keep their pinned layout ("layouts never migrate"), so the READ path
 * re-checks that layout instead of trusting the edge — see
 * `pinnedLayoutRefusal`.
 *
 * An edge the mutability gate would now refuse is never "covered", whatever
 * it carries. Such an edge can only exist because the protocol was REPLACED
 * into a gating one after the edge was registered: conformance is monotone, so
 * the edge survives, but it is left pending rather than removed, and reporting
 * it as uncovered here is also what stops it inheriting a supertype's
 * implementation (see {@link refreshInheritedPending}, whose whole input is
 * this verdict).
 */
function settleFieldBacking(
  ce: IComputeEngine,
  record: ProtocolRecord,
  edge: ConformanceRecord
): boolean {
  /** Would the B1 mutability gate refuse this edge today? Such an edge is
   * never covered, whatever it carries — but the re-derivation below still
   * runs, so a gated edge is left with the accessors its target's layout
   * warrants rather than with stale ones.
   *
   * This uses only the predicate half: it runs on every edge of every
   * registration and
   * on every pass of {@link refreshInheritedPending}, and the message it would
   * otherwise build is discarded. The memoized protocol half is asked first,
   * so the target is only inspected for a protocol that actually gates. */
  const gated =
    mutabilityGate(ce, record) !== null && !isObjectType(edge.target);
  const authored = edge._authored;
  const { satisfied } = fieldBackedProperties(
    ce,
    record,
    edge.target,
    authored,
    edge.where
  );

  if (satisfied.size === 0) {
    // No accessor of the engine's belongs on this edge — the overwhelmingly
    // common case, since only an object target can be field-backed at all.
    // The merged map is then exactly the author's block, and an edge with
    // neither is implementation-LESS, which is what makes it eligible to
    // inherit a supertype's implementation.
    if (authored === undefined) delete edge.impl;
    else edge.impl = authored;
    return !gated && implCoversRequirements(record.members, edge.impl);
  }

  /** The mangled key of each accessor the engine owes this edge → the field
   * it loads. A `readwrite` property needs both halves; a `readonly` one has
   * only the getter direction. */
  const owed = new Map<string, string>();
  for (const name of satisfied) {
    owed.set(`${GET_PREFIX}${name}`, name);
    if (record.members[name]!.kind === 'readwrite')
      owed.set(`${SET_PREFIX}${name}`, name);
  }

  const current = edge.impl;
  if (current !== undefined && mergedMapMatches(current, authored, owed))
    return !gated && implCoversRequirements(record.members, current);

  const next: Record<string, Expression | JSImplementation> =
    Object.create(null);
  if (authored !== undefined)
    for (const [k, v] of Object.entries(authored)) next[k] = v;
  for (const [key, name] of owed) {
    // An accessor already standing for this very field is reused, so a rebuild
    // forced by one changed key does not hand every other consumer a new
    // closure for a handler that did not change.
    const existing = current?.[key];
    next[key] =
      existing !== undefined &&
      isFieldBacked(existing) &&
      existing._fieldBacked === name
        ? existing
        : key.startsWith(GET_PREFIX)
          ? fieldGetter(name)
          : fieldSetter(ce, name);
  }
  edge.impl = next;
  return !gated && implCoversRequirements(record.members, next);
}

/** Is `merged` already exactly the author's block plus the accessors `owed`
 * describes? Answering yes lets {@link settleFieldBacking} keep the existing
 * map, and with it the object identity the rollback thunk compares on. */
function mergedMapMatches(
  merged: Record<string, Expression | JSImplementation>,
  authored: Record<string, Expression | JSImplementation> | undefined,
  owed: ReadonlyMap<string, string>
): boolean {
  const authoredKeys = authored === undefined ? [] : Object.keys(authored);
  if (Object.keys(merged).length !== authoredKeys.length + owed.size)
    return false;
  for (const k of authoredKeys) if (merged[k] !== authored![k]) return false;
  for (const [key, name] of owed) {
    const entry = merged[key];
    if (entry === undefined || !isFieldBacked(entry)) return false;
    if (entry._fieldBacked !== name) return false;
  }
  return true;
}

/**
 * Recompute the `pending` flag of every implementation-less conformance edge
 * of `record`.
 *
 * An edge without a block of its own is not necessarily pending: an
 * implementation registered for a supertype satisfies the completeness
 * requirement, so
 * `type integer is Comparable` is complete on the spot when `number` already
 * has a fulfilled implementation. The dependency runs BETWEEN edges, so the
 * whole set is recomputed whenever an implementation lands or the requirement
 * set changes.
 *
 * Every impl-less edge is reset to pending first, then the pass runs to a
 * fixed point (inheritance is transitive: an `integer` edge may inherit from a
 * `number` edge that itself inherits) — starting from `true` keeps a pair of
 * mutually-comparable targets from holding each other non-pending.
 *
 * "Reset to pending" is a per-edge question rather than one record-wide
 * verdict, because an edge onto an object type may be complete through its own
 * stored fields ({@link settleFieldBacking}) while another edge of the same
 * protocol, onto a
 * type with no such layout, is not.
 */
function refreshInheritedPending(
  ce: IComputeEngine,
  record: ProtocolRecord,
  /** See {@link noteEdgePendingReason}'s parameter of the same name: passed
   * through so a block-less edge re-settled by a protocol replacement or a
   * type redefinition can explain itself, while the same edge settled by an
   * ordinary registration stays unglossed. */
  resettled = false
): void {
  // "No implementation of its own" is asked of the authored block, not of the
  // merged map: an edge whose map holds nothing but engine-synthesized
  // accessors still takes part here, because its author wrote nothing and it
  // may therefore inherit — while an author's EMPTY block claims the edge and
  // keeps it out.
  const inherited = record.conformances.filter(
    (c) => c._authored === undefined
  );
  // Each such edge is pending unless what it carries of its own — nothing at
  // all for most, the synthesized accessors of its stored fields for an object
  // type — already covers the requirements. A SEMANTIC protocol (no
  // requirements) is covered by no block, so none of its edges is ever
  // pending and the inheritance pass below is skipped outright.
  let anyPending = false;
  for (const c of inherited) {
    c.pending = !settleFieldBacking(ce, record, c);
    // Most block-less pending edges are the ordinary P3 notebook pattern and
    // get no reason; one whose OBJECT target's layout stopped satisfying a
    // property requirement does (see {@link noteEdgePendingReason}).
    noteEdgePendingReason(ce, record, c, null, resettled);
    if (c.pending) anyPending = true;
  }
  if (!anyPending) return;

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
        delete c._pendingReason;
        changed = true;
      }
    }
  }
}

/**
 * Record — or clear — WHY this edge is pending, for the end-of-batch
 * `protocol-implementation-pending` warning to carry.
 *
 * A reason is only worth adding when the edge is pending for a reason the
 * warning's own wording does not already give. "The conformance has no
 * implementation yet" is the P3 notebook pattern and needs no gloss — and that
 * is the case for every edge of a FRESH declaration, whatever its target looks
 * like. Everything else has moved under the author: a block that stopped
 * validating, a target the B1 mutability gate now refuses, or a layout that no
 * longer carries the stored field a property requirement was being satisfied
 * by.
 *
 * `failure` is the verdict {@link implementationProblem} returned for an
 * AUTHORED block, or `null` when there was no block to validate.
 *
 * `resettled` says this edge is being RE-settled — a protocol replacement or a
 * redefinition of the target type — rather than settled for the first time. It
 * is passed down from those two entry points rather than inferred from the
 * edge, because nothing about an edge distinguishes "the layout stopped
 * satisfying this" from "no implementation has been written yet": both leave
 * the same uncovered requirements on the same map. Inferring it from the
 * target's SHAPE (does it have an object layout?) is what made
 * `type T = object{n: integer} is P` on a freshly declared protocol report
 * "the layout of `T` does not satisfy `g`" where the author had simply not
 * written the block yet.
 */
function noteEdgePendingReason(
  ce: IComputeEngine,
  record: ProtocolRecord,
  edge: ConformanceRecord,
  failure: ImplementationProblem | null,
  resettled = false,
  /** See {@link failedInheritanceSource}. Defaults to "assume not", so a caller
   * with no before-state never claims an inheritance was lost. */
  wasFulfilled: (candidate: ConformanceRecord) => boolean = () => false
): void {
  if (!edge.pending) {
    delete edge._pendingReason;
    return;
  }
  if (failure !== null) {
    // The CODE rides in front of the message, as it does on both routes that
    // report an implementation problem directly (`declareConformance` boxes it
    // as the error's code, `declareProtocolImplementationImpl` throws
    // `code: message`). Here the code has nowhere else to go — the warning it
    // rides on is `protocol-implementation-pending` — and it is what
    // `epsil doc <code>` keys on.
    edge._pendingReason = `${failure.code}: ${failure.message}`;
    return;
  }
  // Below the `!resettled` guard, not above it: a pass that is not re-settling
  // this edge has nothing to say about it, and the gate message would otherwise
  // overwrite whatever a pass that WAS re-settling it recorded.
  if (!resettled) return;
  const gated = mutabilityGateProblem(ce, record, edge.target, edge.targetKey);
  if (gated !== null) {
    edge._pendingReason = gated;
    return;
  }
  // The layout reason, and the two remaining things that have to hold for it to
  // be true: the target actually has a stored-field layout that could satisfy a
  // property, and at least one PROPERTY requirement is uncovered (a function
  // member is never field-backed, so a layout is not why it is missing).
  if (objectLayoutOfType(edge.target) === undefined) {
    delete edge._pendingReason;
    return;
  }
  const missing = uncoveredPropertyRequirements(record.members, edge.impl);
  if (missing.length === 0) {
    // Nothing about this target's own fields explains it. An edge with no block
    // of its own may instead have LOST an implementation it was inheriting: the
    // supertype edge it used to take its members from has itself gone pending.
    // Saying "no implementation yet" there would be wrong twice over — there
    // was one, and the thing to fix is not on this edge.
    const source = failedInheritanceSource(record, edge, wasFulfilled);
    if (source !== undefined) {
      edge._pendingReason = `the implementation inherited from \`${source.targetKey}\` no longer applies${
        source._pendingReason === undefined ? '' : `: ${source._pendingReason}`
      }`;
      return;
    }
    delete edge._pendingReason;
    return;
  }
  edge._pendingReason = `the layout of \`${edge.targetKey}\` does not satisfy \`${missing.join('`, `')}\` — write the accessor, or give \`${edge.targetKey}\` a stored field of the property's own type`;
}

/**
 * The edge `edge` would be inheriting its implementation from, if that edge
 * were not itself pending — or `undefined` when inheritance is not the story.
 *
 * Called only for an edge without its own implementation that has just become
 * pending despite having no uncovered requirement of its own. That shape means
 * the edge may have lost an implementation inherited from a supertype.
 *
 * The supertype test matches {@link refreshInheritedPending}, so settlement and
 * diagnostics agree about which edge supplied the inherited implementation.
 */
function failedInheritanceSource(
  record: ProtocolRecord,
  edge: ConformanceRecord,
  /** Whether a candidate was fulfilled before this settlement pass. This keeps
   * an edge that never supplied an implementation from being reported as lost
   * inheritance. */
  wasFulfilled: (candidate: ConformanceRecord) => boolean
): ConformanceRecord | undefined {
  if (edge._authored !== undefined) return undefined;
  const own = edgeComparisonTarget(edge);
  const candidates = record.conformances.filter(
    (other) =>
      other !== edge &&
      other.pending &&
      other.where === undefined &&
      isSubtype(own, other.target) &&
      wasFulfilled(other)
  );
  if (candidates.length === 0) return undefined;
  // The most specific one, matching how selection would have chosen among them.
  return candidates.reduce((best, c) =>
    isSubtype(c.target, best.target) ? c : best
  );
}

/**
 * Recompute protocol conformances after a type-registry change.
 *
 * Field-backed satisfaction uses the target's current stored-field layout. A
 * redefinition can add, remove, or retype a field, so accessors and validation
 * must be derived again. Existing objects are unaffected because they retain
 * their construction layout and property access checks that pinned layout; see
 * {@link evaluateProtocolProperty}.
 *
 * Every edge is revisited because a requirement can refer to an alias whose
 * definition changed even when the target does not name the redefined type.
 * Settlement is idempotent and preserves implementation-map identity when the
 * result is unchanged.
 *
 * A `config` state event and a conformance-version bump are emitted only when
 * something actually moved: the version keys memoized dispatcher effects, and
 * bumping it on every re-run `type` statement would cold those caches for
 * nothing.
 */
export function resettleTypeConformances(ce: IComputeEngine): void {
  // The five steps below establish these invariants in order.
  //
  // (I1) Idempotence. Running the sweep twice with nothing changed in between
  //      leaves the registry as the first run left it: every step re-derives
  //      from the registry and the type layouts (`implementationProblem` is a
  //      pure verdict, `settleFieldBacking` keeps an unchanged map's identity,
  //      the widening refusal is recomputed from scratch, and inheritance is a
  //      deterministic fixpoint), so a second run reaches the same state and
  //      moves nothing.
  // (I2) Announcement economy. The `config` state event and the conformance-
  //      version bump at the end fire iff some edge's implementation-map
  //      identity or `pending` flag differs from before the sweep. A sweep that
  //      re-derives its way back to where it began — including one whose every
  //      re-activation was refused — announces nothing. (The widening walk
  //      bumps the version as it explores; see step 2. What this guard withholds
  //      is the event and the announcement, which is what keys the memos.)
  // (I3) Refusal soundness. No declared effect contract that stood before the
  //      sweep is falsified at exit by an edge this sweep re-activated: every
  //      authored edge that went pending→fulfilled is kept fulfilled only if the
  //      set of contracts it falsifies, given the other kept edges, is empty
  //      (relative to the baseline with every re-activation undone). This rests
  //      on step 1 bumping the conformance version when it moved anything: the
  //      contract re-derivation reads memoized dispatcher effects, so without
  //      that bump step 2 measures the world as step 1 found it and refuses
  //      nothing.
  // (I4) Inheritance consistency. A block-less edge is non-pending iff its own
  //      field backing covers the protocol or a non-pending unconditional
  //      supertype edge exists — computed ONCE, after every authored verdict
  //      and every refusal is final, so no inheritor can be granted from a
  //      source that is later put back.
  // (I5) Reasons. Every pending edge whose settlement this sweep moved carries a
  //      `_pendingReason` describing this sweep's cause; an edge the sweep did
  //      not move keeps whatever it had; a `conformance-widens-declared-contract`
  //      reason exists only on an edge the current sweep refused.
  // (I6) Instance pinning is enforced by the read and write paths
  //      paths' (`pinnedLayoutRefusal`) — but the sweep never touches an
  //      (`pinnedLayoutRefusal`). This sweep never touches an instance.
  //
  // Restores the registry if anything below throws.
  const restore = ce._protocolRegistryRollbackPoint();
  /** One edge's settlement as it stood before the sweep. */
  type Snapshot = {
    record: ProtocolRecord;
    edge: ConformanceRecord;
    impl: Record<string, Expression | JSImplementation> | undefined;
    pending: boolean;
    reason: string | undefined;
    /** The verdict on this edge's authored block, when it has one. */
    failure: ImplementationProblem | null;
  };
  const allSnapshots: Snapshot[] = [];
  /** Did this edge's settlement end up anywhere other than where it started?
   * Asked of the final state, after any refusal has been applied, so a sweep
   * that re-derives its way back to where it began reports nothing (I2). */
  const netMoved = (s: Snapshot): boolean =>
    s.edge.impl !== s.impl || s.edge.pending !== s.pending;
  try {
    // Step 1 — settle the authored edges of every protocol, exactly as the
    // protocol-replacement loop settles them: the block is re-validated against
    // the target's new layout (a field the redefinition added beside an
    // authored accessor is now `object-property-conflict`), and its synthesized
    // accessors are re-derived whether or not it validated — otherwise
    // accessors for a field the new layout dropped would keep answering.
    // Edges without blocks are not touched here; they are computed in step 3,
    // after the refusals of step 2 are final (I4).
    for (const record of Object.values(ce._protocolRegistry)) {
      for (const edge of record.conformances) {
        const snapshot: Snapshot = {
          record,
          edge,
          impl: edge.impl,
          pending: edge.pending,
          reason: edge._pendingReason,
          failure: null,
        };
        allSnapshots.push(snapshot);
        const authored = edge._authored;
        if (authored === undefined) continue;
        snapshot.failure = implementationProblem(
          ce,
          record,
          edge.target,
          edge.targetKey,
          authored,
          edge.where
        );
        const covered = settleFieldBacking(ce, record, edge);
        edge.pending = snapshot.failure !== null || !covered;
      }
    }
    // The verdicts step 1 has just installed have to be VISIBLE to step 2. Its
    // first walk re-derives declared contracts, and that derivation reads a
    // dispatcher's effect union through memos stamped on the conformance and
    // callable versions — so with the counter unmoved it answers with the union
    // as it stood BEFORE this step, and a re-activation that widens is waved
    // through. I3 depends on this bump, not on a caller happening to churn a
    // version first: reproduced by calling the sweep directly after warming the
    // memo, where the refusal was skipped entirely. Consistent with I2, which
    // withholds the EVENT and the announcement, never the counter — and
    // conditional, so a sweep that moved no authored edge still costs nothing.
    if (allSnapshots.some((s) => s.edge.pending !== s.pending))
      ce._noteConformanceRegistryChange();

    // Step 2 — enforce effect contracts (I3). Reactivating an authored edge can
    // widen a dispatcher's derived effect union — the union skips pending
    // edges, so a member whose implementation draws `random` contributes
    // nothing while its edge is pending and everything once it is fulfilled
    // again — and a function already accepted as `pure` because it called
    // through that dispatcher would then be declaring something false. Only
    // Only authored edges can widen anything: an edge without a block carries no
    // implementation of its own (its field-backed accessors are host callbacks
    // with no effects), which is why they need not exist yet at this point.
    //
    // Unlike conformance registration, a type redefinition remains installed
    // when it would widen a declared effect contract; only the conformance
    // reactivation is refused. The type declaration is already complete here,
    // and should not fail because of a contract elsewhere in the program.
    //
    // Nothing is remembered between sweeps. Every sweep re-derives the whole
    // question, so an edge stays refused exactly as long as an offending
    // contract exists, and un-refusing it needs no bookkeeping. The price is
    // one widening walk per sweep that re-activates something — bounded by the
    // number of re-activations, and zero for the overwhelming majority of
    // sweeps, which re-activate nothing.
    const reactivated = allSnapshots.filter(
      (s) => s.edge._authored !== undefined && s.pending && !s.edge.pending
    );
    const explained =
      reactivated.length > 0
        ? refuseWideningReactivations(ce, reactivated, (s) => {
            s.edge.pending = s.pending;
            if (s.impl === undefined) delete s.edge.impl;
            else s.edge.impl = s.impl;
          })
        : new Set<ConformanceRecord>();

    // Step 3 — compute inheritance once over the final authored verdicts (I4). An
    // block-less edge is settled against its own field backing and then
    // granted or denied inheritance from the non-pending supertype edges as
    // they now stand; nothing decided after this point can move an authored
    // edge, so no inheritor is ever left fulfilled by a source that was put
    // back.
    for (const record of Object.values(ce._protocolRegistry))
      refreshInheritedPending(ce, record);

    // An edge counts as having SUPPLIED an implementation if it was fulfilled
    // before the sweep, or if this sweep offered it and then refused it: an
    // inheritor that lost what it was borrowing is in the same position either
    // way, and "no implementation yet" would be the wrong story for both.
    const priorPending = new Map(allSnapshots.map((s) => [s.edge, s.pending]));
    const wasFulfilled = (c: ConformanceRecord): boolean =>
      priorPending.get(c) === false || explained.has(c);

    // STEP 4 — reasons LAST, over the final state (I5): an edge the refusal
    // put back is pending for the widening, and one the sweep moved is pending
    // for whatever its own settlement says. A reason is diagnostic text, so
    // recomputing it is never on its own a reason to bump the version.
    for (const s of allSnapshots)
      // …except the edges the refusal above has already explained: its message
      // names the contract that would have been falsified, which nothing the
      // edge itself says can replace.
      // A `conformance-widens-declared-contract` reason is only true while this
      // sweep is issuing it: nothing is remembered between sweeps, so one left
      // over from an earlier refusal describes a fulfilment nobody is offering
      // now — the edge may since have gone pending on its own merits. Recomputed
      // whenever this sweep did not re-issue it.
      if (
        !explained.has(s.edge) &&
        (netMoved(s) ||
          s.edge._pendingReason !== s.reason ||
          (s.edge.pending &&
            s.edge._pendingReason?.startsWith(
              'conformance-widens-declared-contract:'
            ) === true))
      )
        noteEdgePendingReason(
          ce,
          s.record,
          s.edge,
          s.failure,
          true,
          wasFulfilled
        );
  } catch (e) {
    // Nothing in the re-derivation, the widening analysis or the reason pass is
    // meant to throw — every helper they call returns a verdict — but a
    // half-swept registry would be worse than an unswept one, so the partial
    // sweep is undone before the failure travels.
    // The code is spelled into the message because the only channel out of here
    // is `declareType`'s throw, which `declareTypeStatement` boxes as
    // `invalid-type-declaration`: the TYPE was declared successfully by this
    // point, and the label would otherwise say it was not. Same compromise the
    // protocol path makes for `conformance-widens-declared-contract`.
    restore();
    throw Error(
      `conformance-resettle-failed: the type was declared, but re-running conformance for it failed: ${messageOf(e)}`
    );
  }

  // STEP 5 — the FINAL state against the one this sweep started from (I2). A
  // sweep whose re-activations were all refused lands exactly where it began,
  // and must then announce nothing: the version keys the memos, and colding
  // them for a world that did not move is the invalidation anti-pattern this
  // guard exists to avoid. (The widening analysis above bumps the version as
  // it explores — it has to, or the effect re-derivation it reads would be
  // served from a memo stamped against the world before the revert — so the
  // counter can advance even here; what this withholds is the `config` event
  // and the announcement that something changed.)
  if (!allSnapshots.some(netMoved)) return;
  ce._noteStateEvent({ kind: 'config' });
  ce._noteConformanceRegistryChange();
}

/**
 * Put back any re-activation in `reactivated` that would make a dispatched call
 * more effectful than a declared contract allows, calling `revert` on each one
 * refused and recording the reason on its edge; returns the refused edges.
 *
 * ONE procedure, a greedy hitting set, and its correctness argument. Derived
 * dispatcher effects are MONOTONE in the set of fulfilled edges: fulfilling
 * one more edge can only add implementations to a union, so the set of
 * declared contracts the registry falsifies — and how far each is exceeded —
 * can only grow. Start from the state with EVERY re-activation undone and
 * measure the BASELINE there: the violations that stand with nothing this
 * sweep re-activated, which are nobody's fault here (a contract that was
 * already falsified before this sweep is laid at no edge's door). Then hand
 * the edges back one at a time, in registry order, KEEPING each one iff the
 * baseline-relative violations stay empty with it applied on top of the edges
 * kept so far, and refusing it otherwise. Two properties follow directly:
 *
 * - SOUND — after every step the introduced set is empty, so it is empty at
 *   exit (invariant I3 of {@link resettleTypeConformances}).
 * - MINIMAL AGAINST THE KEPT SET — a refused edge introduced a violation when
 *   applied over a SUBSET of the final kept set, so by monotonicity it would
 *   introduce one over the whole of it: no refused edge can be added back. An
 *   innocent edge swept up in the same declaration is kept, because it
 *   introduces nothing.
 *
 * There is no JOINT case to handle, and none can arise: a contract is falsified
 * when the union over the non-pending conformers escapes a FIXED declared
 * ceiling, and a union cannot escape a ceiling that both of its parts respect.
 * So two edges that each introduce nothing cannot introduce something together,
 * and the verdict does not depend on the order they are handed back in — which
 * also makes the kept set canonical, not merely deterministic. Several edges
 * may be refused by one declaration; each is an independent culprit, and each
 * one's reason names exactly the contracts ITS return would falsify given the
 * kept set.
 *
 * Cost: one widening walk for the baseline plus one per re-activated edge.
 * Every apply/revert bumps the conformance version, because the walk reads
 * dispatcher effects through memos stamped on it and would otherwise be served
 * a verdict from the previous state.
 */
function refuseWideningReactivations(
  ce: IComputeEngine,
  reactivated: readonly {
    edge: ConformanceRecord;
    impl: Record<string, Expression | JSImplementation> | undefined;
    pending: boolean;
  }[],
  revert: (s: (typeof reactivated)[number]) => void
): Set<ConformanceRecord> {
  const explained = new Set<ConformanceRecord>();
  // The common case, checked first because it is one walk: with everything
  // this sweep re-activated in place, no declared contract is falsified at
  // all — so nothing below could be, and there is nothing to attribute.
  if (conformanceWideningViolations(ce).length === 0) return explained;

  const states = reactivated.map((s) => ({ s, fulfilled: s.edge.impl }));
  const undo = (e: (typeof states)[number]): void => {
    revert(e.s);
    ce._noteConformanceRegistryChange();
  };
  const apply = (e: (typeof states)[number]): void => {
    if (e.fulfilled === undefined) delete e.s.edge.impl;
    else e.s.edge.impl = e.fulfilled;
    e.s.edge.pending = false;
    ce._noteConformanceRegistryChange();
  };

  // The BASELINE: what stands with every re-activation undone. Measured rather
  // than assumed — de-activations only ever narrow an effect union, so nothing
  // else this sweep did can be a cause.
  for (const e of states) undo(e);
  const baseline = new Map(
    conformanceWideningViolations(ce).map((v) => [
      v.name,
      effectSetToString(v.exceeding),
    ])
  );
  /** The violations standing now that the baseline does not account for — a
   * contract that was fine before, or one whose exceeding set has grown. A
   * violation is compared by identity AND extent, so a re-activation that
   * pushes an already-falsified contract further counts as introducing. */
  const introduced = (): WideningViolation[] =>
    conformanceWideningViolations(ce).filter(
      (v) => baseline.get(v.name) !== effectSetToString(v.exceeding)
    );

  const refused: {
    e: (typeof states)[number];
    culprit: WideningViolation[];
  }[] = [];
  for (const e of states) {
    apply(e);
    const gained = introduced();
    if (gained.length === 0) continue;
    undo(e);
    refused.push({ e, culprit: gained });
  }

  // Each refused edge is refused on its OWN account — there is no joint cause
  // to report. A contract is falsified when the union over the non-pending
  // conformers escapes a FIXED declared ceiling, and a union cannot escape a
  // ceiling that both of its parts respect, so two edges that each introduce
  // nothing can never introduce something together. The plural case is simply
  // several independent culprits in one declaration, and each is told what IT
  // exceeded.
  for (const { e, culprit } of refused) {
    explained.add(e.s.edge);
    e.s.edge._pendingReason = `conformance-widens-declared-contract: ${wideningRejectionMessage(
      culprit,
      'satisfying this conformance again',
      'leave it unsatisfied'
    )}`;
  }
  return explained;
}

/**
 * Enforce at most one conformance for each type head and protocol. A
 * conditional conformance also excludes an unconditional conformance on the
 * same head. Check both orders because declarations may arrive in either.
 *
 * `null` when the new target is admissible. Reported as
 * `protocol-conformance-overlap`: both cases represent two conformances of one
 * protocol competing for the same value.
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
    if (params === undefined && c.where === undefined) continue; // Checked by overlapConflict.
    if (headKeyOf(c.target) !== head) continue;
    const conditional = params !== undefined ? targetKey : c.targetKey;
    const other = params !== undefined ? c.targetKey : targetKey;
    return `\`${conditional}\` is a conditional conformance to \`${record.name}\`, and \`${other}\` already conforms on the same head \`${head}\`. v1 allows at most one conformance per head and protocol — no specialization among conditional witnesses.`;
  }
  return null;
}

/**
 * Reject a target that overlaps an existing conforming type without being
 * comparable to it (neither is a subtype of the other). Dispatch would be
 * ambiguous for values in the intersection.
 *
 * Returns the offending pair, or `null` when the target is admissible.
 */
function overlapConflict(
  record: ProtocolRecord,
  target: Type,
  targetKey: string,
  params?: readonly TypeParameter[]
): { other: string; meet: string } | null {
  // A conditional target is not a set of values the meet algebra can weigh. Its
  // head-level collisions are ruled by {@link headConflictOf}, and against a
  // different head it cannot overlap at all.
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
// ── Implementation validation ────────────────────────────────────────────────
//
// An implementation block is checked against the protocol's requirements
// before it is stored. Everything below only reads the block and
// the requirements: it registers nothing, so a caller can reject atomically.
//

/** A rejected implementation: the error code and its message. The statement
 * route turns this into an error VALUE, the host route into a throw.
 *
 * `errorArgs` overrides the error VALUE's arguments on the statement route, for
 * a problem whose code renders its own message from a fixed argument list
 * (`incompatible-type` reads two: expected, then got). `message` stays the
 * prose the host route throws, so both routes still say the same thing. */
type ImplementationProblem = {
  code: string;
  message: string;
  errorArgs?: [string, ...string[]];
};

const GET_PREFIX = '__get__';
const SET_PREFIX = '__set__';

/**
 * A resolver in which `Self` denotes the conformance target. The reference is
 * a structurally transparent alias, so subtyping sees through to the target,
 * and takes the target's name so a signature
 * serializes with the substitution already applied (`(self: string, other:
 * string) -> string`), which is what the mismatch diagnostic quotes.
 *
 * This also makes `Self` and the target's own name synonyms inside an
 * implementation: both spellings resolve to the same type.
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
  // Read each conditional-conformance variable as its bound (`any` when
  // unbounded), which is the widest instantiation and also what
  // `target` is here. An implementation's annotations may spell `list<T>`, and
  // reading `T` as an open variable instead would hand `isSubtype` a
  // non-ground type. At the widest instantiation the implementation check stays
  // the ground signature comparison it is for every other conformance.
  //
  // `opaqueVariables` reads them as nominal references instead — still ground,
  // but a subtype of nothing but themselves, so ordinary subtyping enforces a
  // match up to the clause binding rather than at the widest instantiation.
  // Covariant positions need that behavior; see {@link clauseVariablePattern}.
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
 * The GROUND spelling of one type-annotation text, or `undefined` when the text
 * must be kept exactly as the author wrote it.
 *
 * `undefined` for two different reasons, both of which mean "leave it alone":
 * the text already parses against the engine's own resolver (so it mentions no
 * `Self` and rewriting it would only churn the author's spelling), or it parses
 * against neither resolver (not a type at all — reporting that is the P17
 * validation's job, not this rewrite's).
 *
 * GROUPING is preserved. A fully parenthesized annotation is this repo's
 * spelling for "the value here IS a function", as opposed to the literal's own
 * contract: `["Typed", body, "'((integer) -> Box)'"]` is a return type, while
 * the same text ungrouped is the marker signature of the enclosing literal
 * (`isGroupedTypeText` / `returnTypeText` in `common/type/utils.ts`, and the
 * gate in `bodySlotSignature`). `typeToString` always emits the UNGROUPED
 * spelling, so re-wrapping is what keeps a grouped annotation from being
 * re-read as a contract it never was.
 */
function groundTypeText(
  ce: IComputeEngine,
  text: string,
  resolver: TypeResolver
): string | undefined {
  try {
    parseType(text, ce._typeResolver);
    return undefined; // Already ground; keep the author's spelling.
  } catch {
    /* Falls through to the `Self`-substituting attempt. */
  }
  try {
    const s = typeToString(parseType(text, resolver));
    return isGroupedTypeText(text) ? `(${s})` : s;
  } catch {
    return undefined; // Not a type either way — P17 reports it.
  }
}

/**
 * One implementation function literal with every `Self`-mentioning type
 * annotation REWRITTEN to name the conformance target (P12's substitution
 * applied once, at registration, instead of per dispatch).
 *
 * `Self` is a substitution token no ordinary type resolver knows, so a stored
 * literal that still spells it is unreadable by every consumer OUTSIDE this
 * module, in three ways that matter:
 *
 * - A body-slot MARKER signature — what an effect specifier lowers to
 *   (`function size(self: Self) pure -> integer` becomes
 *   `["Typed", body, "'(self: Self) pure -> integer'"]`) — is signature-shaped,
 *   so `canonicalFunctionLiteral` parses it and, when it does not parse,
 *   REPLACES the body with an error expression. The literal then has no Block
 *   for a body and every dispatch to it failed with
 *   `Error("Function body must be a scoped Block expression")`. A member with
 *   any effect specifier was therefore uncallable.
 * - The effect walk and the literal's own `.type` arrow (read by
 *   `protocolAccessorEffects` in `effects-of.ts`) saw a `self: Self` receiver
 *   as `unknown`, so a store the body performs on it — `self.n = v` in an
 *   authored `set` accessor — looked like no effect at all.
 * - An annotation INSIDE the body (`let s: Self = self`) failed to parse where
 *   the same annotation spelled with the target's own name succeeded.
 *
 * The rewrite is therefore RECURSIVE over the whole literal: every node that
 * carries a type-expression source text, wherever it sits. That covers the
 * parameter slots, both marker shapes (`["Function", ["Typed", body, sig], …]`
 * as the Epsil parser and the raw MathJSON box route deliver it, and the
 * CANONICAL form where the marker has moved inside the Block and wraps its
 * last statement — `bodySlotSignature` reads both, so a hand-authored
 * canonical-form literal reaches the same failure), a `let`'s annotation
 * inside the body, and the annotations of any nested literal.
 */
function groundedImplementationLiteral(
  ce: IComputeEngine,
  fn: Expression,
  resolver: TypeResolver
): Expression {
  if (!isFunction(fn, 'Function') || fn.nops === 0) return fn;

  /** Which operand of `node`, if any, carries a type-expression SOURCE text.
   * Two shapes reach here: `["Typed", value, T]` — a parameter annotation, a
   * return/marker ascription, or a cast — and `["Declare", name, T?, attrs?]`,
   * which is how a body's `let s: Self = self` rides. `Declare`'s type operand
   * is optional and its slot may instead hold the attributes dictionary, so
   * the slot is claimed only when {@link typeTextOf} actually reads text out
   * of it. */
  const typeSlot = (node: Expression): number | undefined => {
    if (isFunction(node, 'Typed') && node.nops === 2) return 1;
    if (isFunction(node, 'Declare') && node.nops >= 2) return 1;
    return undefined;
  };

  const rewrite = (node: Expression): Expression => {
    if (!isFunction(node)) return node;
    const slot = typeSlot(node);
    const ops = node.ops.map((op, i) =>
      i === slot ? op : rewrite(op)
    ) as Expression[];
    if (slot !== undefined) {
      const text = typeTextOf(node.ops[slot]);
      const g =
        text === undefined ? undefined : groundTypeText(ce, text, resolver);
      if (g !== undefined) ops[slot] = ce.string(g);
    }
    if (ops.every((op, i) => op === node.ops[i])) return node;
    return ce._fn(node.operator, ops, { canonical: false });
  };

  return rewrite(fn);
}

/**
 * {@link groundedImplementationLiteral}, memoized on the RAW literal's identity
 * and the conformance target.
 *
 * One Epsil statement registers its implementation block up to three times per
 * batch (the static pre-pass canonicalizes it, then the evaluation loop
 * canonicalizes and evaluates it — the same reason ruling P47's duplicate check
 * keys on the block expression's identity). Grounding mints fresh nodes, and
 * `settleFieldBacking` compares the author's entries by REFERENCE to decide
 * whether the merged map changed (`mergedMapMatches`); without the memo every
 * pass would hand it new objects, rebuild `edge.impl`, and emit the spurious
 * `config` state events that comparison exists to avoid.
 *
 * Safe to keep across batches: the grounded text names a TYPE, and the name is
 * re-resolved wherever it is read, so a later redefinition of that type is
 * picked up without invalidating the memo.
 */
const groundedLiteralMemo = new WeakMap<Expression, Map<string, Expression>>();

function memoizedGroundedLiteral(
  ce: IComputeEngine,
  fn: Expression,
  resolver: TypeResolver,
  targetKey: string
): Expression {
  let perTarget = groundedLiteralMemo.get(fn);
  if (perTarget === undefined) {
    perTarget = new Map();
    groundedLiteralMemo.set(fn, perTarget);
  }
  const hit = perTarget.get(targetKey);
  if (hit !== undefined) return hit;
  const grounded = groundedImplementationLiteral(ce, fn, resolver);
  perTarget.set(targetKey, grounded);
  return grounded;
}

/**
 * An implementation block with every Epsil function literal in it grounded at
 * `Self = target` — see {@link groundedImplementationLiteral} for why the
 * substitution has to happen on the STORED literal rather than per dispatch.
 *
 * Returns the input map unchanged when nothing needed rewriting, so the object
 * IDENTITY that `settleFieldBacking`/`mergedMapMatches` compare on survives.
 *
 * A CONDITIONAL conformance is returned unchanged: its `Self` is a head PATTERN
 * (`list<T>`), so the only ground stand-in is the widest instantiation
 * (`list<number>`), and P17 checks the implementation's COVARIANT positions
 * against the pattern instead — a stored literal ground to the widest
 * instantiation would fail that check. The same reason `implementationLiteralAt`
 * declines a conditional edge.
 */
function groundedImplementationBlock(
  ce: IComputeEngine,
  impl: Record<string, Expression | JSImplementation>,
  target: Type,
  targetKey: string,
  params?: readonly TypeParameter[]
): Record<string, Expression | JSImplementation> {
  if (params !== undefined) return impl;
  const resolver = selfSubstitutingResolver(
    ce._typeResolver,
    target,
    targetKey
  );
  let changed = false;
  const out: Record<string, Expression | JSImplementation> =
    Object.create(null);
  for (const [key, value] of Object.entries(impl)) {
    if (!isExpressionImplementation(value)) {
      out[key] = value;
      continue;
    }
    const grounded = memoizedGroundedLiteral(ce, value, resolver, targetKey);
    if (grounded !== value) changed = true;
    out[key] = grounded;
  }
  return changed ? out : impl;
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
 * Order of verdicts. `object-property-conflict` comes FIRST, because it is a
 * verdict on the DECLARATION rather than on any one key: writing an accessor
 * beside a stored field of the same name is refused whatever that accessor
 * says, so it outranks even the per-key checks — a `set` accessor for a
 * `readonly` property that is also a stored field reports the conflict, not
 * `protocol-property-readonly-set`. Then every key the block provides is
 * checked (Appendix A's example emits these in this order): unknown member,
 * then `set` on a `readonly` property, then the signature. The completeness
 * check comes last, so a misspelled member reports the misspelling rather than
 * the hole it leaves.
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
  // Which property requirements the target's stored fields answer on their own
  // (Appendix B), read BEFORE the conditional widening below rewrites
  // `target`. Two verdicts come out of it: a name declared as both a stored
  // field and an explicit accessor is refused outright, and a name the fields
  // satisfy is not a hole for the completeness check at the end.
  const fieldBacked = fieldBackedProperties(ce, record, target, impl, params);
  if (fieldBacked.conflicts.length > 0) {
    const name = fieldBacked.conflicts[0]!;
    const accessor = Object.prototype.hasOwnProperty.call(
      impl,
      `${GET_PREFIX}${name}`
    )
      ? 'get'
      : 'set';
    return {
      code: 'object-property-conflict',
      message: `\`${name}\` is a stored field of \`${typeToString(target)}\` and also has an explicit \`${accessor}\` accessor in this implementation of \`${record.name}\`. A property is field-backed or computed, never both — drop the accessor, or rename the stored field.`,
    };
  }
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
      // covariant result check has nothing to say about it — and nothing else
      // constrains it either, because the store DISCARDS it (see the note where
      // the result check used to be, further down this function).
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
    // A CONDITIONAL conformance refuses an effect specifier outright, at
    // DECLARATION time (ruled 2026-08-16: fail closed at registration rather
    // than accept the block and fail at the call).
    //
    // The mechanism it would need is the one thing a conditional edge cannot
    // have. An effect specifier lowers to a full marker signature stamped on
    // the literal's body, and that signature mentions `Self` — which
    // `canonicalFunctionLiteral` cannot parse, so it replaces the body with an
    // error and every dispatch dies with "Function body must be a scoped Block
    // expression". `declareConformance` fixes that for a GROUND target by
    // substituting `Self` on the stored literal
    // ({@link groundedImplementationBlock}); a conditional target has no ground
    // substitution to make — its `Self` is a head pattern (`list<T>`), and the
    // widest instantiation P17 would have to use for it (`list<number>`) is
    // exactly what the covariant head-pattern check below must NOT see.
    //
    // Refusing here, before anything is stored, is what keeps that internal
    // failure off the author's screen.
    if (params !== undefined && declared?.effects !== undefined)
      return {
        code: 'protocol-conditional-member-effects',
        message: `a member of a conditional conformance cannot carry an effect specifier (\`${describeEffects(
          declared.effects
        )}\` on \`${describeMember(accessor, member)}\`); remove it — the member's effects are inferred. A conformance to a ground type (\`type Box = object{…} is ${record.name} { … }\`) accepts specifiers.`,
      };

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
    // The member's OWN effect specifier is a contract on its body, held to the
    // same `declared ⊇ inferred` rule as a top-level definition: writing
    // `function h() pure -> number { Random() }` at the top level is refused
    // with `incompatible-type`, and the same member inside an implementation
    // block must be refused the same way. Unlike the requirement ceiling above
    // this applies to a `get`/`set` accessor too — an accessor is where a
    // `pure` annotation could otherwise conceal a store into the receiver.
    //
    // PRECEDENCE: the requirement's ceiling is tested first, so a body that
    // breaks both bounds reports `protocol-signature-mismatch` naming the
    // protocol's ceiling — the outer contract, and the one whose fix site is
    // not this block. The member's own annotation is reported only once that
    // ceiling is satisfied or absent.
    const stated = declared?.effects;
    if (ceiling !== undefined || stated !== undefined) {
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
      if (inferred !== undefined && !inferred.unresolvedHead) {
        if (ceiling !== undefined && !isEffectSubset(inferred.effects, ceiling))
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
        if (stated !== undefined && !isEffectSubset(inferred.effects, stated))
          return {
            code: 'incompatible-type',
            message: `the body of \`${describeMember(accessor, member)}\` infers the effects \`${describeEffects(
              inferred.effects
            )}\`, which the effects it declares (\`${describeEffects(stated)}\`) do not cover`,
            // The two arguments `incompatible-type` renders as
            // "expected `…`, got `…`" — the shape a violated top-level effect
            // annotation produces (`effectContractErrorValue`).
            errorArgs: [
              `${describeEffects(stated)} effects`,
              `${describeEffects(inferred.effects)} effects`,
            ],
          };
      }
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

    // A `set` handler's RESULT is unchecked, whether or not it is annotated.
    // The property store discards it: `p.name = v` stores through the handler
    // and evaluates to `v` (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B,
    // "Assigning to a property"). It used to be checked against the receiver,
    // because the assignment REBOUND the target to whatever the handler
    // returned; that lowering retired with Appendix A's rebinding sugar, and an
    // undeclared result is trusted here exactly as every other one is (P28).
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
    // A property a stored field of the target answers needs no accessor at
    // all: the engine synthesizes both halves for it.
    if (fieldBacked.satisfied.has(member)) continue;
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

  // A host implementation IS a conformance declaration, so it is bound by the
  // same `type`-primitive prohibition as the statement route — reported by
  // throwing, this route's convention for every invalid target.
  const typeProblem = typePrimitiveConformanceProblem(ce, targetSource);
  if (typeProblem !== null)
    throw Error(`protocol-conformance-target-invalid: ${typeProblem}`);

  // The B1 mutability gate applies to the host channel on the same terms as
  // the statement route — a host implementation IS a conformance declaration.
  const gated = mutabilityGateProblem(ce, record, target, targetSource);
  if (gated !== null) throw Error(`protocol-requires-object: ${gated}`);

  const targetKey =
    params === undefined
      ? typeToString(target)
      : `${typeToString(target)} where ${clauseToString(params)}`;
  const existing = record.conformances.find((c) => c.targetKey === targetKey);
  // What P5 refuses to replace is an implementation somebody WROTE — an
  // AUTHORED block, empty or not. An edge carrying nothing but the accessors
  // the engine synthesized for its stored fields (Appendix B) has no author to
  // displace, so a host implementation may still land on it.
  if (existing?._authored !== undefined)
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
    existing._authored = members;
    existing.impl = members;
    // The block was validated as complete above, but a property requirement it
    // leaves to a stored field still needs its synthesized accessors installed
    // before anything can dispatch to it (Appendix B).
    existing.pending = !settleFieldBacking(ce, record, existing);
    // Whatever a previous re-settlement recorded about this edge is now out of
    // date: the block just installed is the new answer. See the same two
    // deletions on the statement route in `declareConformance`.
    delete existing._pendingReason;
    noteEdgePendingReason(ce, record, existing, null);
  } else {
    const edge: ConformanceRecord = {
      target,
      targetKey,
      _authored: members,
      impl: members,
      pending: false,
      declaredByStatement: false,
    };
    if (params !== undefined) edge.where = params;
    record.conformances.push(edge);
    edge.pending = !settleFieldBacking(ce, record, edge);
    noteEdgePendingReason(ce, record, edge, null);
  }
  // The implementation may fulfil the impl-less edges of the target's
  // SUBTYPES, which inherit it.
  refreshInheritedPending(ce, record);
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
      // Checkpoint journal (funnel 4): dispatcher bindings are direct map
      // surgery, like the minted constructors.
      journalCheckpointMapEntry(ce, scope.bindings, id, id, 'declare');
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
    // Checkpoint journal (funnel 5): the dispatcher marker and the lazy
    // effects deriver are written onto the operator half after the declare
    // installed it — the same post-install shape as the minted-constructor
    // markers in `type-constructors.ts`, and journaled for the same reason:
    // the half is window-created only as long as `updateDef` keeps
    // constructing a fresh one for every plain-object definition.
    journalDefinitionRecord(ce, installed.operator, 'redefine');
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
 * `(self, other) => …`), else positional placeholders. The body mentions
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
 * restricts the search to one protocol — the qualified form `p.(P.name)`.
 *
 * Exported so a caller can ask the CHEAP half of the question — "could any
 * protocol claim this name at all?" — without paying for the full resolution
 * in {@link protocolPropertyStore}, which needs the evaluated right-hand side
 * in order to type-check it. `Assign` uses it to refuse a hopeless field target
 * before evaluating that right-hand side. */
export function protocolsWithProperty(
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

/**
 * Is the property `name`, on a receiver of type `receiver`, answered by an
 * accessor the ENGINE synthesized from a stored field rather than by one an
 * author wrote?
 *
 * Consulted only when a read has already declined, to tell "this conformance
 * has no implementation" from "this field-backed property had no slot to
 * load" — the two need opposite answers, an error and staying symbolic.
 */
function isFieldBackedProperty(
  ce: IComputeEngine,
  receiver: Type,
  name: string,
  only?: ProtocolRecord
): boolean {
  const resolved = resolveProtocolProperty(ce, receiver, name, only);
  if (resolved.status !== 'found') return false;
  const getter = resolved.edge.impl?.[`${GET_PREFIX}${name}`];
  return getter !== undefined && isFieldBacked(getter);
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
  // The ONLY decline: no protocol claims this name for this receiver, so the
  // caller's remaining rungs own the verdict (`unknown-field` on an object).
  if (resolved.status === 'none') return undefined;
  // Not reachable for an object receiver — a nominal object type is a decided
  // type — but the "cannot decide" posture is to stay symbolic, never to
  // report a defect.
  if (resolved.status === 'undecided') return undefined; // stay symbolic
  if (resolved.status === 'ambiguous')
    return ambiguousPropertyError(ce, name, receiver, resolved.through);

  const getter = resolved.edge.impl?.[`${GET_PREFIX}${name}`];
  if (getter === undefined) return undefined;
  // A FIELD-BACKED property is a slot load, and only an actual object value
  // has slots. The receiver's static type is not enough to promise one: a
  // nominal object type is a DECIDED type, so a declared-but-unassigned
  // binding, or a call that stayed symbolic, reaches here typed `Person` while
  // its value is a symbol. Loading the slot directly — rather than through the
  // host callback, whose `undefined` the boxing layer would turn into
  // `Nothing` — lets both that case and a name the instance has no slot for
  // stay SYMBOLIC, which is what every other undecided receiver does. The load
  // records the per-object cache dependency, exactly as a `Field` read does.
  if (isFieldBacked(getter)) {
    if (!isObject(base)) return undefined;
    const refusal = pinnedLayoutRefusal(
      ce,
      base,
      getter._fieldBacked,
      resolved,
      true
    );
    if (refusal !== null) return refusal;
    return base._field(getter._fieldBacked);
  }
  return invokeImplementation(ce, getter, [base], options);
}

/**
 * Would loading `field` off this object answer the property requirement the
 * conformance edge promised? `null` when it would; the refusal to report
 * otherwise.
 *
 * The edge was settled against the layout the type REGISTRY held at settle
 * time, while an object carries the layout it was CONSTRUCTED with
 * (`BoxedObject._type` — "layouts never migrate", `docs/TYPE_SYSTEM_ROADMAP.md`
 * Appendix B). The two can disagree in both directions once a `type` statement
 * is re-run in a later cell: an instance built before the redefinition has no
 * slot for a field the new layout added, and one built after may hold a
 * differently-TYPED value under a name whose accessor was synthesized for the
 * old declaration. Trusting the edge in the second case is a soundness hole —
 * the read is statically typed by the requirement and would deliver whatever
 * the new field holds — so the pinned layout is re-checked here, by the same
 * rule that decided field backing in the first place
 * ({@link fieldSatisfiesRequirement}).
 *
 * Two stages, in this order. The pinned LAYOUT decides admissibility: does this
 * instance declare a field of that name, and does its declared type satisfy the
 * requirement? Then — on the READ path only, and only once the layout has
 * passed — the value actually in the slot is checked, because a pin is SHALLOW
 * and a field typed through a transparent alias follows that alias when it is
 * re-declared (see {@link valueOutOfContract}). An EMPTY slot is neither: the
 * read stays symbolic, which is what it has always done for a receiver that
 * cannot produce a value.
 */
function pinnedLayoutRefusal(
  ce: IComputeEngine,
  base: Expression & ObjectInterface,
  field: string,
  resolved: Extract<PropertyResolution, { status: 'found' }>,
  /** Ask the stored VALUE question too. A read has to deliver what the property
   * promises, so what is in the slot is exactly its subject; a WRITE's contract
   * question is about the right-hand side, which the setter has already checked
   * against the property's declared type, and judging the value being replaced
   * would refuse a perfectly good store (`p.(P.a) = 5` after the field's alias
   * was re-declared to `integer`). Layout admissibility is asked on both. */
  checkStoredValue = false
): Expression | null {
  const pinned = base._fieldType(field);
  const receiver = base.type.type;
  // A receiver whose pinned type names no fields at all (the bare `object`
  // type, or a nominal whose definition has gone) is exempt: the absence of a
  // field type means "this layout cannot be introspected", not "this layout
  // lacks the field", and refusing it would advise the author to rebuild the
  // value "from the current declaration of `object`" — a declaration that does
  // not exist. Decided HERE so that all three write routes and the read path
  // agree; `fieldSetter`'s own arm is then the backstop it claims to be.
  if (objectLayoutOfType(receiver) === undefined) return null;
  if (pinned !== undefined) {
    // FAST PATH, which is the overwhelmingly common one: the object's pinned
    // field type is the very same type object the type REGISTRY holds for that
    // field today. Pinning copies an object body ONE level deep and shares the
    // field types on purpose (`detachDefinitionBody`, `boxed-object.ts`), so
    // identity here means "this instance predates no redeclaration of this
    // field".
    //
    // What makes that sufficient is that the registry's current layout is also
    // what the edge was last settled against: every protocol replacement and
    // every type redefinition re-settles the edge, and the accessor survives
    // only where the layout satisfied the requirement. The one exception is an
    // edge whose re-activation was REFUSED for widening a declared effect
    // contract (see {@link resettleTypeConformances}) — but such an edge is left
    // PENDING, so it is not a dispatch candidate and no accessor of its is ever
    // selected to reach this check.
    //
    // An OWN-key test on both sides, like `fieldBackedProperties`: an object
    // layout's `elements` may be an ordinary prototyped record, so a field
    // named `toString` must not read a value off `Object.prototype` and
    // compare it (against `undefined`, which is also what `_fieldType`
    // answers for a name the pinned layout does not carry — two absences that
    // would then look like a match).
    const settledLayout = objectLayoutOfType(resolved.edge.target);
    if (
      settledLayout !== undefined &&
      Object.prototype.hasOwnProperty.call(settledLayout.elements, field) &&
      settledLayout.elements[field] === pinned
    )
      // The pinned field type is a cheap PRE-FILTER, not the verdict: a value
      // it admits is one the requirement admits (the edge exists only because
      // `field ⊑ requirement`), so passing here needs no parse at all. Failing
      // it does NOT mean the requirement is violated — under `readonly` the
      // field may be strictly narrower than the property — so that case falls
      // through to the requirement itself, and the message names the property's
      // declared type rather than the field's.
      return checkStoredValue
        ? valueOutOfContract(ce, base, field, resolved, undefined, pinned)
        : null;
    // SLOW PATH: this instance predates a redeclaration of the field, so the
    // requirement has to be re-derived at this receiver. Memoized on the
    // conformance and callable versions — an instance that survives a
    // redefinition stays on this path for the rest of its life, and a loop
    // reading one such object would otherwise re-parse the requirement's type
    // text on every iteration.
    const declared = memoizedRequirementType(
      ce,
      resolved.record.name,
      field,
      resolved.declared,
      receiver
    );
    // The requirement does not parse at this receiver: a diagnostic of its
    // own, owned by the signature-mismatch path, and not a reason to refuse a
    // read the edge says is satisfied.
    if (declared === undefined) return null;
    if (fieldSatisfiesRequirement(pinned, declared, resolved.kind))
      return checkStoredValue
        ? valueOutOfContract(ce, base, field, resolved, declared)
        : null;
  }
  return ce.error([
    'protocol-implementation-missing',
    `no implementation of the \`${resolved.record.name}.${field}\` property applies to this value: it was constructed with a layout in which \`${field}\` ${
      pinned === undefined
        ? 'is not a stored field'
        : `is declared \`${typeToString(pinned)}\``
    }, which does not satisfy the requirement. Rebuild it from the current declaration of \`${typeToString(receiver)}\`.`,
  ]);
}

/**
 * The last line of the pinned-layout defence: does the value actually IN the
 * slot deliver what the property promises?
 *
 * A pinned layout is shallow. `detachDefinitionBody` (`boxed-object.ts`) copies
 * the object body one level deep and SHARES the field types, so a field typed
 * through a transparent ALIAS still holds the very same alias reference the
 * registry does — and re-declaring that alias in a later cell moves the pinned
 * layout with it. `type alias A = string`, an object with `a: A` holding
 * `"s"`, then `type alias A = integer`: the layout comparison above sees the
 * identical `A` on both sides and passes, while the read is statically typed
 * `integer` and would hand back a string. The same is true of a NOMINAL field
 * type whose own layout is redeclared.
 *
 * Comparing the stored value's type against the requirement closes that whole
 * class rather than the alias case alone: whatever route the layouts drifted
 * by, a read may not deliver a value the property's declared type does not
 * admit. `declared` is passed when the caller has already parsed it and
 * `undefined` when it has not (the layout fast path), in which case it is
 * resolved here.
 *
 * The subtype direction is the read direction for BOTH kinds of property: a
 * `readwrite` requirement constrains the FIELD's declared type exactly, but the
 * value living in that field need only be something the declared type admits.
 */
function valueOutOfContract(
  ce: IComputeEngine,
  base: Expression & ObjectInterface,
  field: string,
  resolved: Extract<PropertyResolution, { status: 'found' }>,
  declared: Type | undefined,
  /** A type known to be AT LEAST AS TIGHT as the requirement — the receiver's
   * pinned field type, on the path where identity has established it is the one
   * the edge was settled against. A value it admits is a value the requirement
   * admits, so passing it short-circuits the parse; failing it decides nothing
   * and the requirement is consulted. */
  prefilter?: Type
): Expression | null {
  const value = base._field(field);
  // No value to judge: the read stays symbolic, as it always has.
  if (value === undefined || !value.isValid) return null;
  // An UNDECIDED value type is not evidence of anything. A stored field may
  // legitimately hold a symbolic value — Appendix B allows it, and an
  // unevaluated application types `unknown` — so comparing it against the
  // requirement would refuse `T(a: sqrt(2))` and blame a redefinition that
  // never happened. Same "nothing to say" posture as a requirement that does
  // not parse at this receiver, below.
  if (!isDecidedReceiverType(value.type.type)) return null;
  if (prefilter !== undefined && isSubtype(value.type.type, prefilter))
    return null;
  const receiver = base.type.type;
  const requirement =
    declared ??
    memoizedRequirementType(
      ce,
      resolved.record.name,
      field,
      resolved.declared,
      receiver
    );
  if (requirement === undefined) return null;
  if (isSubtype(value.type.type, requirement)) return null;
  return ce.error([
    'protocol-implementation-missing',
    `no implementation of the \`${resolved.record.name}.${field}\` property applies to this value: its stored \`${field}\` holds \`${typeToString(value.type.type)}\`, which the property's \`${typeToString(requirement)}\` does not admit. It was built before \`${typeToString(receiver)}\` — or a type its layout refers to — was re-declared; rebuild it from the current declaration.`,
  ]);
}

/** The {@link memoizedRequirementType} cache, keyed on the RECEIVER's type
 * OBJECT rather than on its spelling, with an inner map per (protocol, member)
 * and the usual two version stamps. `undefined` values are cached too — "does
 * not parse here" is as stable an answer as a type.
 *
 * Identity, not serialization, for two reasons. It keeps `typeToString` — which
 * walks the whole layout — off a path every field-backed READ now runs, and it
 * is exact: a spelled key had to carry both the receiver's name AND its layout
 * to separate two instances pinned at different layouts (same name) from two
 * distinct nominal types with identical bodies (same layout), and even then it
 * was only as precise as the printer.
 *
 * The cache is therefore PER INSTANCE: `detachNominalType` mints a fresh type
 * object at every construction, so two objects of one type share no entry and
 * each pays one parse. Accepted, because the parse is what makes the verdict
 * correct: the fast path uses the pinned field type only as a pre-filter, and a
 * value that fails it still has to be judged against the REQUIREMENT (under
 * `readonly` the field may be strictly narrower than the property, so the field
 * would over-refuse). Entries die with the instance. */
const requirementTypeMemo = new WeakMap<
  object,
  Map<
    string,
    { conformance: number; callable: number; value: Type | undefined }
  >
>();

/**
 * The property requirement `record.member`, parsed with `Self` bound to
 * `receiver` — or `undefined` when it does not parse there.
 *
 * Asked by {@link pinnedLayoutRefusal} on both of its paths: the slow one needs
 * it to judge a drifted layout, and the fast one needs it to judge the stored
 * VALUE. A receiver whose layout has drifted never returns to the fast path
 * (its layout is fixed for life), so without a memo the requirement's source
 * text would be re-parsed on every read of every such instance.
 */
function memoizedRequirementType(
  ce: IComputeEngine,
  protocol: string,
  member: string,
  declared: string,
  receiver: Type
): Type | undefined {
  const parse = (): Type | undefined => {
    try {
      return parseType(
        declared,
        selfSubstitutingResolver(
          ce._typeResolver,
          receiver,
          typeToString(receiver)
        )
      );
    } catch {
      return undefined;
    }
  };
  // A builtin receiver is a bare string and cannot key a WeakMap. It also
  // cannot be an object type, so it never reaches here through the field-backed
  // paths; parsing uncached is the safe answer rather than a second cache.
  if (typeof receiver !== 'object' || receiver === null) return parse();

  let perReceiver = requirementTypeMemo.get(receiver);
  if (perReceiver === undefined) {
    perReceiver = new Map();
    requirementTypeMemo.set(receiver, perReceiver);
  }
  const key = `${protocol}\u0000${member}`;
  const cached = perReceiver.get(key);
  if (
    cached !== undefined &&
    cached.conformance === ce._conformanceVersion &&
    cached.callable === ce._callableVersion
  )
    return cached.value;
  const value = parse();
  perReceiver.set(key, {
    conformance: ce._conformanceVersion,
    callable: ce._callableVersion,
    value,
  });
  return value;
}

//
// ── The `ProtocolProperty` operator (P6 / D16 amendment) ─────────────────────
//
// `person.(Nameable.name)` lowers to `ProtocolProperty("Nameable", "name",
// person)` — the qualified READ, restricted to the named protocol. A fourth
// operand makes it the qualified WRITE: `person.(Nameable.name) = v` lowers to
// `ProtocolProperty("Nameable", "name", person, v)`, the same store the
// unqualified `person.name = v` performs, restricted to the named protocol.
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
  // A SET evaluates to the value ASSIGNED, not to whatever the `set` handler
  // returns (which is discarded) and not to the receiver — the same answer
  // `objectFieldStore()` in `library/collections.ts` gives for a stored field.
  // So its type is the VALUE's own type, exactly as `Assign`'s type handler
  // reports the type of its right-hand side: `p.(P.value) = 1` types `integer`,
  // not the `number` the property is declared as. (The value still has to FIT
  // the property, but that check belongs to evaluation, and widening the static
  // type to the declared one would throw away what the operand actually is.)
  if (parts.value !== undefined) return parts.value.type.type;
  return protocolPropertyType(ce, parts.base, parts.name, record) ?? 'error';
}

/** `ProtocolProperty`'s `evaluate` handler: the qualified property READ
 * (`p.(P.name)`), or — with a fourth operand — the qualified property STORE
 * (`p.(P.name) = v`). */
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
    const read = evaluateProtocolProperty(
      ce,
      parts.base,
      parts.name,
      options,
      record
    );
    if (read !== undefined) return read;
    // The read declined. For a FIELD-BACKED property that means the receiver
    // never produced the slot to load — its static type is the object type
    // (decided, so resolution committed) while its VALUE is still a symbol, or
    // the instance carries no such slot. Nothing is wrong with the conformance
    // in either case, so the call stays SYMBOLIC, exactly as an undecided
    // receiver does above; reporting a missing implementation would be a
    // verdict on a conformance that is in fact complete.
    if (isFieldBackedProperty(ce, parts.base.type.type, parts.name, record))
      return undefined;
    return missingPropertyError(ce, parts.base, parts.name, record);
  }

  // The SET half — a property STORE, written through the protocol view.
  const base = parts.base;
  if (!base.isValid) return undefined;
  const receiver = base.type.type;
  // A receiver whose TYPE is `error` — a binding whose initializer failed —
  // has a real diagnostic of its own, and calling it "not an object type" would
  // report a second, wrong defect on top of it. Stay symbolic, the same posture
  // `fieldAssignmentVerdict` (`library/collections.ts`) takes for it.
  if (receiver === 'error') return undefined;
  const decided = isDecidedReceiverType(receiver);
  // Assigning to a property is a MODIFICATION, and only a mutable object can be
  // modified (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Assigning to a
  // property"). A value receiver is nonetheless reachable here — this operator
  // is applied directly by the box route, and the receiver is re-read at every
  // evaluation — so it is REFUSED rather than assumed away, with the refusal
  // `Assign` makes for the same target (`immutableValueAssignmentError()` in
  // `library/collections.ts`).
  //
  // Asked BEFORE `readonly`, so that the two spellings of the same write agree:
  // the unqualified `x.name = v` reports the target's type without ever
  // consulting a protocol, and a reader who reaches for the qualified form must
  // not be told the property is read-only when the real obstacle is that
  // nothing about `x` can be written.
  if (decided && !isObjectType(receiver))
    return immutableValueAssignmentError(ce, parts.name, receiver);
  // `readonly` is a property of the REQUIREMENT, not of the receiver, so it is
  // answered whatever the receiver's type turns out to be — including an
  // undecided one, which the dispatch below has to leave symbolic.
  if (requirement.kind === 'readonly')
    return readonlyPropertyError(ce, record.name, parts.name);
  if (!decided) return undefined;
  // A store needs an actual object to store INTO, and the receiver's static
  // type does not promise one: a nominal object type is a decided type, so a
  // declared-but-unassigned binding, or a call that stayed symbolic, arrives
  // here typed `Person` while its value is still a symbol. Invoking an authored
  // setter on that would run the handler against a symbol and then answer as if
  // the store had happened. Stay SYMBOLIC instead — exactly what the READ path
  // does for the same receiver (see {@link evaluateProtocolProperty}).
  if (!isObject(base)) return undefined;
  // Resolution is restricted to the protocol NAMED, exactly as the qualified
  // read is: `p.(Nameable.name) = v` means "write the `Nameable` view of `p`",
  // and a receiver that does not conform to `Nameable` is a missing
  // implementation of THAT protocol, never a silent redirection to some other
  // protocol that happens to declare a property of the same name.
  //
  // It did once fall back across every protocol declaring the property (ruling
  // P41, 2026-08-12). That existed for the retired rebinding sugar, which
  // resolved a winner off the receiver's type at CANONICALIZATION and baked its
  // name into this node, while the receiver was re-read at every evaluation: a
  // canonical `Assign` re-run after its root was rebound to a type conforming
  // through a different protocol would otherwise have kept targeting the stale
  // one. Nothing bakes a protocol name any more — the unqualified `p.name = v`
  // keeps its `Field` target and resolves from the receiver at every
  // evaluation (`protocolPropertyStore`) — so the only remaining source of a
  // name here is an author who wrote one, and honouring it is the whole point
  // of writing it. Ruling: 2026-08-16, with the sugar's retirement.
  const best = bestCandidates(
    ce,
    [record],
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
  // refused here rather than passed on.
  const winner = best[0]!;
  const declared = winner.record.members[parts.name];
  const refused =
    declared === undefined || declared.kind === 'function'
      ? null
      : propertyValueError(ce, receiver, declared.type, parts.value);
  if (refused !== null) return refused;
  // A FIELD-BACKED setter writes a slot, so the receiver's own PINNED layout
  // has to admit the requirement. Asked here as well as in
  // {@link protocolPropertyStore} because the two spellings of a write reach
  // the setter by different routes — `p.(P.a) = v` through this operator,
  // `p.a = v` through `Assign` — and a receiver refused a READ must not be
  // granted a write by either of them.
  if (
    isFieldBacked(winner.impl) &&
    declared !== undefined &&
    declared.kind !== 'function' &&
    isObject(base)
  ) {
    const refusal = pinnedLayoutRefusal(ce, base, winner.impl._fieldBacked, {
      status: 'found',
      record: winner.record,
      edge: winner.edge,
      kind: declared.kind,
      declared: declared.type,
    });
    if (refusal !== null) return refusal;
  }

  const result = invokeImplementation(
    ce,
    winner.impl,
    [base, parts.value],
    options
  );

  // The handler's result is DISCARDED: a store evaluates to the value assigned,
  // exactly as `objectFieldStore()` (`library/collections.ts`) answers for a
  // stored field, and `protocolPropertyResultType` types this application that
  // way. Two results are not discarded: a FAILED handler still has something to
  // say, and an implementation that DECLINED (`undefined` — an expression
  // implementation that could not be applied) never performed the store, so
  // this application stays symbolic rather than claiming a write happened.
  if (result === undefined) return undefined;
  if (!result.isValid) return result;
  return parts.value;
}

/**
 * `immutable-value-assignment` — a property store into something that cannot
 * hold one.
 *
 * The message names both ways out that Appendix B names, because the fix
 * depends on what the author meant: a record is a value (build an updated
 * copy), and an object is the shape that supports stores (declare the type as
 * one). `immutableTargetError()` in `library/collections.ts` phrases the same
 * refusal for the `Assign` route and delegates to this builder, so the two
 * routes cannot drift; the builder lives HERE because that module already
 * imports this one and the reverse import would close a dependency cycle.
 */
export function immutableValueAssignmentError(
  ce: IComputeEngine,
  name: string,
  t: Type
): Expression {
  return ce.error([
    'immutable-value-assignment',
    `\`${typeToString(t)}\` is not an object type, and only an object's fields can be assigned. Build an updated copy with the new \`${name}\`, or declare the type as \`object{…}\``,
  ]);
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
// ── Property STORE ───────────────────────────────────────────────────────────
//

/**
 * Perform `p.name = v` through a protocol's `set` accessor, from `Assign`'s
 * EVALUATE handler — the route where a real receiver is in hand.
 *
 * Only an OBJECT receiver is served. Assignment to a property is a
 * modification, and a modification is meaningful on nothing but a mutable
 * object (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Assigning to a
 * property"); the conformance registry cannot even hold a `readwrite` property
 * on a value type, since registration refuses one (`protocol-requires-object`).
 * A non-object receiver therefore DECLINES here rather than refusing, and the
 * caller's last rung — `fieldStoreRefusal()` in `library/collections.ts` —
 * makes the `immutable-value-assignment` refusal, so that the answer is the
 * same whether the target's type was settled at canonicalization or only at
 * evaluation.
 *
 * `rhs` is the ALREADY EVALUATED right-hand side: the setter receives the
 * evaluated value, exactly as a stored field does (Appendix B, "A store writes
 * the evaluated value").
 *
 * The handler's own result is DISCARDED. It used to rebind the receiver, and
 * that is what retired: the assignment stores, and its value is the value
 * assigned — the same answer `objectFieldStore()` gives for a stored field.
 *
 * `undefined` means "no protocol property answers here"; every other outcome
 * is the expression the assignment evaluates to.
 */
/** `protocol-property-readonly-set` — the shared wording for a write to a
 * property the protocol declares `readonly`. One builder, so the three routes
 * that can reach the refusal (the qualified operator, the store, and the
 * value-independent pre-check `Assign` runs) cannot phrase it differently. */
function readonlyPropertyError(
  ce: IComputeEngine,
  protocol: string,
  name: string
): Expression {
  return ce.error([
    'protocol-property-readonly-set',
    `the property \`${protocol}.${name}\` is \`readonly\`; it cannot be assigned`,
  ]);
}

/**
 * The refusal a QUALIFIED property write earns from the NAME alone: the
 * protocol does not exist, or it declares no property by that name.
 *
 * Asked by `Assign` before it evaluates the right-hand side, for the same
 * reason as {@link protocolPropertyWriteRefusal} — neither verdict can change
 * once the value is known, so neither may cost the value its effects. The two
 * checks mirror the ones the `ProtocolProperty` operator makes first.
 */
export function protocolNamedPropertyRefusal(
  ce: IComputeEngine,
  protocol: string,
  name: string
): Expression | undefined {
  const record = ce._protocolRegistry[protocol];
  if (record === undefined)
    return ce.error([
      'protocol-unknown',
      `the protocol \`${protocol}\` is unknown`,
    ]);
  const requirement = record.members[name];
  if (requirement === undefined || requirement.kind === 'function')
    return ce.error(['unknown-field', name], record.name);
  return undefined;
}

/**
 * The refusal a property write earns from the RECEIVER and the requirement
 * alone, before any value is in hand.
 *
 * Asked by `Assign` BEFORE it evaluates the right-hand side, on both spellings
 * of the write: a refusal that does not depend on the value must not fire the
 * value's effects, so `b.name = bump()` on a `readonly` property reports the
 * refusal and never calls `bump()`.
 *
 * Two refusals qualify. A receiver whose type is DECIDED and is not an object
 * cannot be written at all, whichever property is named. And a `readonly`
 * property is read-only whatever value is offered — `only` restricts that
 * question to one protocol, which is what the qualified spelling
 * `p.(P.name) = v` means. AMBIGUITY is deliberately NOT reported here: it is
 * value-independent too, but it is the unqualified route's error and reporting
 * it before the store route has had its turn would pre-empt an object whose own
 * layout owns the name (a slot store never consults a protocol at all).
 *
 * `undefined` means "nothing refuses it here", which includes every case that
 * is not this check's to answer: a receiver that is not an object VALUE yet
 * (its type may still promise one — the write stays symbolic), a name no
 * protocol declares, an ambiguous one.
 */
export function protocolPropertyWriteRefusal(
  ce: IComputeEngine,
  receiver: Expression,
  name: string,
  only?: ProtocolRecord
): Expression | undefined {
  if (!receiver.isValid) return undefined;
  const t = receiver.type.type;
  // A receiver whose type is `error` has a real diagnostic of its own; calling
  // it "not an object type" would bury it under a second, wrong one.
  if (t !== 'error' && isDecidedReceiverType(t) && !isObjectType(t))
    return immutableValueAssignmentError(ce, name, t);
  if (!isObject(receiver)) return undefined;
  const resolved = resolveProtocolProperty(ce, t, name, only);
  if (resolved.status !== 'found') return undefined;
  if (resolved.kind === 'readonly')
    return readonlyPropertyError(ce, resolved.record.name, name);
  // The PINNED-LAYOUT refusal belongs here too, and for the same reason the
  // `readonly` one does: it depends only on the receiver and the requirement,
  // never on the value, so asking it before the right-hand side is evaluated is
  // what keeps `p.(P.a) = bump()` from firing `bump()` on an instance the store
  // cannot serve. `protocolPropertyStore` and the four-operand operator ask it
  // again once they have the value — they are reachable directly from the box
  // route, which never passes through this pre-check.
  const setter = resolved.edge.impl?.[`${SET_PREFIX}${name}`];
  if (setter === undefined || !isFieldBacked(setter)) return undefined;
  return (
    pinnedLayoutRefusal(ce, receiver, setter._fieldBacked, resolved) ??
    undefined
  );
}

export function protocolPropertyStore(
  ce: IComputeEngine,
  receiver: Expression,
  name: string,
  rhs: Expression,
  options: { numericApproximation?: boolean }
): Expression | undefined {
  if (!receiver.isValid || !isObject(receiver)) return undefined;
  const type = receiver.type.type;
  const resolved = resolveProtocolProperty(ce, type, name);
  if (resolved.status === 'none') return undefined;
  if (resolved.status === 'undecided') return undefined;
  if (resolved.status === 'ambiguous')
    return ambiguousPropertyError(ce, name, type, resolved.through);
  if (resolved.kind === 'readonly')
    return readonlyPropertyError(ce, resolved.record.name, name);

  // The value the setter is handed must fit the PROPERTY's declared type at
  // `Self` = the receiver: the handler is written against that type (and a host
  // setter is trusted with whatever it is given), so an out-of-contract write is
  // refused before the handler runs.
  const refused = propertyValueError(ce, type, resolved.declared, rhs);
  if (refused !== null) return refused;

  // Past this point a protocol DOES claim the name, so declining would send the
  // caller's last rung (`fieldStoreRefusal`) to report `unknown-field` — which
  // would be false: the object has the property, its implementation is what
  // could not be applied. That is a missed dispatch, and it gets the property
  // analog of one. Only `status === 'none'` above declines, and only that case
  // is genuinely "this object has no such name".
  const setter = resolved.edge.impl?.[`${SET_PREFIX}${name}`];
  if (setter === undefined)
    return missingPropertyError(ce, receiver, name, resolved.record);
  // A FIELD-BACKED setter writes a slot, so the receiver's own PINNED layout
  // has to admit the requirement — the same question the read path asks, asked
  // the same way, so that a stale instance cannot be refused a read and then
  // granted the write that would make the two disagree further.
  if (isFieldBacked(setter)) {
    const refusal = pinnedLayoutRefusal(
      ce,
      receiver,
      setter._fieldBacked,
      resolved
    );
    if (refusal !== null) return refusal;
  }
  const result = invokeImplementation(ce, setter, [receiver, rhs], options);
  // A handler that FAILED still has something to say; one that DECLINED
  // (`undefined` — an expression implementation that could not be applied)
  // performed no store.
  if (result === undefined)
    return missingPropertyError(ce, receiver, name, resolved.record);
  if (!result.isValid) return result;
  return rhs;
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
 * The interpreter does not enforce these annotations either: `apply()` runs the
 * stored literal after `dispatchMember` has checked the arguments at
 * `Self = runtime type`. Substituting the edge's target — a SUPERTYPE of every
 * runtime receiver the edge admits — is therefore sound for the compiled body:
 * it admits everything the interpreter admits.
 *
 * The pass below is a SECOND grounding: `declareConformance` already grounds
 * the block it stores ({@link groundedImplementationBlock}), so for a ground
 * edge this normally finds nothing left to substitute. It is kept because it is
 * the one that FAILS CLOSED — an annotation that does not re-parse makes the
 * whole literal `null`, so the compiler declines instead of emitting a body
 * whose contract it could not read, whereas the registration-time rewrite
 * deliberately leaves such a text verbatim for P17 to report.
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
  // GROUPING is preserved: a fully parenthesized annotation says "this value IS
  // a function", and `typeToString` emits the ungrouped spelling, which
  // `bodySlotSignature` would re-read as the literal's OWN contract. Same rule
  // as {@link groundTypeText}.
  const ground = (text: string): string | null => {
    try {
      const s = typeToString(parseType(text, resolver));
      return isGroupedTypeText(text) ? `(${s})` : s;
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
