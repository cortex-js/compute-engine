import type { Type } from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import type { Expression, IComputeEngine } from '../global-types.js';
import { isSubtype, widen } from '../../common/type/subtype.js';
import { isFunction, isFreeCallHead } from './type-guards.js';
import {
  beginSignatureDerivation,
  calleeHomesDeclarationCount,
  callsReach,
  collectCalleeHomes,
  declaredResultMemoKey,
  endSignatureDerivation,
  homeScopeOf,
  inListHypothesisPass,
  listHypothesisOf,
  mentionsUnknown,
  bareArmsOf,
  RECURSION_FALLBACK_TYPES,
  resultUnderDeclaredParameters,
  signatureWorkCounts,
  withProvisionalResults,
  type HomeScope,
  type SignatureDerivationFrame,
} from './declared-parameter-result.js';

/**
 * The signatures of the functions of a cycle of calls, derived together.
 *
 * A function whose signature has an `unknown` result (declared `function`
 * or `(unknown) -> unknown`) gets its result derived from its body when its
 * signature is read. When the function calls itself through other such
 * functions, deriving one head types the body of the next, which reads the
 * head after it, around the cycle; the read of a head whose derivation is
 * running answers a provisional signature, and every derivation in between
 * is then not memoized (`noteReentrantSignatureRead`). With three heads,
 * the first read of one of them ran about 18,000 derivations (CE-1518).
 *
 * Here the cycle is found before any derivation runs: it is the strongly
 * connected component of the reader in the static graph of calls between
 * such functions ({@link signatureComponent}). The members of a component
 * of two or more are derived by one fixpoint iteration
 * ({@link deriveSignatureGroup}), and their signatures are stored together,
 * in a memo that is read before the type of the function literal.
 * `docs/TYPE-SYSTEM.md` states the rule.
 */

/** A definition whose signature result is derived from its function
 * literal, as the group derivation needs it. Each definition class builds
 * its own (`_signatureGroupMember`). */
export interface SignatureGroupMember {
  /** The definition: the owner of its derivation frame. */
  readonly owner: object;
  readonly name: string;
  /** The function literal the signature is derived from. */
  readonly literal: Expression;
  /** The signature with placeholders, its result `unknown`. */
  readonly skeleton: Type;
  /** The signature the definition records, with the placeholders. A read
   * of the signature during the group answers it with the candidate as its
   * result. */
  readonly recorded: BoxedType;
  /** Make a read of the signature answer `candidate` as its result, with
   * no derivation (`_derivingSignature` and `_recursionResult`). */
  enter(candidate: Type): void;
  /** Undo {@link enter}. */
  leave(): void;
  /** The signature for the derived `result`, with the parameter slots
   * refined from `literalType`, the type of the function literal. */
  build(literalType: BoxedType, result: Type): BoxedType;
  /** `type`, after recording the home scopes of the declared functions it
   * depends on for a derivation that reads it (`noteCalleeHomes`). */
  noted(type: BoxedType, calleeHomes: readonly HomeScope[]): BoxedType;
  /** The definitions that the free symbols of the literal resolve to from
   * the scope of the read. */
  freeDefinitions(): ReadonlyArray<object | undefined>;
}

/** The definition object behind a call, as `calleeLiteral` in
 * `declared-parameter-result.ts` resolves its literal. */
function calleeDefinition(expr: Expression): object | undefined {
  const opDef = expr.operatorDefinition as
    { _lambdaLiteral?: Expression } | undefined;
  if (opDef?._lambdaLiteral !== undefined) return opDef;
  const valueDef = expr.valueDefinition as { value?: unknown } | undefined;
  if (valueDef?.value !== undefined) return valueDef;
  // A forward reference: the head was not assigned when the call was boxed.
  if ((valueDef !== undefined || isFreeCallHead(expr)) && isFunction(expr)) {
    const current = expr.engine.lookupDefinition(expr.operator);
    if (current !== undefined)
      return 'operator' in current ? current.operator : current.value;
  }
  return undefined;
}

/** The group member of a definition, or `undefined` when its signature is
 * not derived from a literal (`_signatureGroupMember`). */
function memberOf(def: object | undefined): SignatureGroupMember | undefined {
  return (
    def as { _signatureGroupMember?: () => SignatureGroupMember | undefined }
  )?._signatureGroupMember?.();
}

/** The members called in the literal of `member`, anywhere in it (a nested
 * function literal too), each read once. */
function calledMembers(member: SignatureGroupMember): SignatureGroupMember[] {
  const out = new Map<object, SignatureGroupMember>();
  const read = new Set<Expression>();
  const visit = (expr: Expression): void => {
    if (!isFunction(expr) || read.has(expr)) return;
    read.add(expr);
    const def = calleeDefinition(expr);
    if (def !== undefined && !out.has(def)) {
      const m = def === member.owner ? member : memberOf(def);
      if (m !== undefined) out.set(def, m);
    }
    for (const op of expr.ops) visit(op);
  };
  visit(member.literal);
  return [...out.values()];
}

/** The component of each definition, as the definitions of its members
 * and their literals, with the literal and the engine state it was found in
 * (`declaredResultMemoKey`, which a new definition or assignment moves). The
 * members are built again at each read, so that they hold the current
 * skeletons and recorded signatures. */
const components = new WeakMap<
  object,
  {
    literal: Expression;
    key: string;
    owners: object[];
    literals: Expression[];
  }
>();

/**
 * The members of the strongly connected component of `member` in the graph
 * of calls between definitions whose signature result is derived, in the
 * order of their names, `member` included. A definition with a declared
 * result is not a member: a call of it reads the declaration, so it cuts
 * the cycles through it. A function called through a value (`h(n − 1)`
 * with `h` a parameter) is not an edge: such a cycle is not found, and its
 * reads keep the derivation of one definition.
 *
 * Only a literal that reaches its own name (`callsReach`) is walked; the
 * answer is cached on the definition until the engine state moves.
 */
export function signatureComponent(
  ce: IComputeEngine,
  member: SignatureGroupMember
): SignatureGroupMember[] {
  const key = declaredResultMemoKey(ce, member.literal);
  const cached = components.get(member.owner);
  if (
    cached !== undefined &&
    cached.literal === member.literal &&
    cached.key === key
  ) {
    const members = cached.owners.map((o) =>
      o === member.owner ? member : memberOf(o)
    );
    if (members.every((m, i) => m?.literal === cached.literals[i]))
      return members as SignatureGroupMember[];
  }
  let members: SignatureGroupMember[] = [member];
  if (callsReach(member.literal, member.name)) {
    // Tarjan's algorithm, from `member`.
    const index = new Map<object, number>();
    const low = new Map<object, number>();
    const onStack = new Set<object>();
    const stack: SignatureGroupMember[] = [];
    const edges = new Map<object, SignatureGroupMember[]>();
    let next = 0;
    let found: SignatureGroupMember[] | undefined;
    const strongConnect = (v: SignatureGroupMember): void => {
      index.set(v.owner, next);
      low.set(v.owner, next);
      next += 1;
      stack.push(v);
      onStack.add(v.owner);
      let out = edges.get(v.owner);
      if (out === undefined) {
        out = calledMembers(v);
        edges.set(v.owner, out);
      }
      for (const w of out) {
        if (!index.has(w.owner)) {
          strongConnect(w);
          low.set(v.owner, Math.min(low.get(v.owner)!, low.get(w.owner)!));
        } else if (onStack.has(w.owner))
          low.set(v.owner, Math.min(low.get(v.owner)!, index.get(w.owner)!));
      }
      if (low.get(v.owner) === index.get(v.owner)) {
        const scc: SignatureGroupMember[] = [];
        let w: SignatureGroupMember;
        do {
          w = stack.pop()!;
          onStack.delete(w.owner);
          scc.push(w);
        } while (w.owner !== v.owner);
        if (scc.some((m) => m.owner === member.owner)) found = scc;
      }
    };
    strongConnect(member);
    if (found !== undefined && found.length > 1)
      members = found
        .map((m, i) => ({ m, i }))
        .sort((a, b) =>
          a.m.name < b.m.name ? -1 : a.m.name > b.m.name ? 1 : a.i - b.i
        )
        .map(({ m }) => m);
  }
  components.set(member.owner, {
    literal: member.literal,
    key,
    owners: members.map((m) => m.owner),
    literals: members.map((m) => m.literal),
  });
  return members;
}

/** `t` with each list or collection whose elements are `unknown` or `any`
 * replaced by the same collection with elements `never`, at the top level
 * and in the arms of a union, or `undefined` when `t` has none. */
function emptyElementSeed(t: Type): Type | undefined {
  if (typeof t !== 'object') return undefined;
  if (
    (t.kind === 'list' || t.kind === 'collection') &&
    (t.elements === 'unknown' || t.elements === 'any')
  )
    return { ...t, elements: 'never' };
  if (t.kind === 'union') {
    let changed = false;
    const types = t.types.map((arm) => {
      const s = emptyElementSeed(arm);
      if (s === undefined) return arm;
      changed = true;
      return s;
    });
    return changed ? { kind: 'union', types } : undefined;
  }
  return undefined;
}

/** The seed of the second iteration of {@link deriveSignatureGroup} for
 * the result `t` of the first: its list hypothesis (`listHypothesisOf`)
 * with the elements `unknown` or `any` replaced by `never`. */
function seedBelow(t: Type): Type | undefined {
  return emptyElementSeed(listHypothesisOf(t) ?? t);
}

/** The number of rounds of {@link deriveSignatureGroup} before every member
 * of the group takes the result of its skeleton, `unknown`. */
export const MAX_GROUP_ROUNDS = 8;

/** What the derivation of a group read for one member, which a later read
 * compares. */
type MemberKey = {
  owner: object;
  literal: Expression;
  skeleton: Type;
  recorded: BoxedType;
  key: string;
  freeDefinitions: ReadonlyArray<object | undefined>;
};

/** What the derivation of a group read: the state of every member (the
 * result of one member depends on the bodies of the others), and the
 * declarations along the home scopes of the members and of the functions
 * their bodies call. */
type GroupKey = {
  members: MemberKey[];
  calleeHomes: HomeScope[];
  calleeCount: number;
};

/** The result derived by a group for each member, by definition. The
 * result does not depend on the cached type of any literal: the group types
 * the bodies afresh. */
const groupResults = new WeakMap<object, { key: GroupKey; result: Type }>();

/** The signature of each member, built from its result and from the type of
 * its literal, by definition. */
const groupSignatures = new WeakMap<
  object,
  { key: GroupKey; type: BoxedType }
>();

function groupKeyOf(
  ce: IComputeEngine,
  members: readonly SignatureGroupMember[],
  calleeHomes: HomeScope[]
): GroupKey {
  return {
    members: members.map((m) => ({
      owner: m.owner,
      literal: m.literal,
      skeleton: m.skeleton,
      recorded: m.recorded,
      key: declaredResultMemoKey(ce, m.literal),
      freeDefinitions: m.freeDefinitions(),
    })),
    calleeHomes,
    calleeCount: calleeHomesDeclarationCount(calleeHomes),
  };
}

/** True when nothing that the derivation of `key` read has changed, read
 * for `member`: every member of the group is built again and compared. */
function keyHolds(
  ce: IComputeEngine,
  key: GroupKey | undefined,
  member: SignatureGroupMember
): boolean {
  if (
    key === undefined ||
    calleeHomesDeclarationCount(key.calleeHomes) !== key.calleeCount
  )
    return false;
  return key.members.every((k) => {
    const m = k.owner === member.owner ? member : memberOf(k.owner);
    return (
      m !== undefined &&
      k.literal === m.literal &&
      k.skeleton === m.skeleton &&
      k.recorded === m.recorded &&
      k.key === declaredResultMemoKey(ce, m.literal) &&
      sameDefinitions(k.freeDefinitions, m.freeDefinitions())
    );
  });
}

/**
 * The signature of `member` when it is a member of a cycle of two or more
 * functions ({@link signatureComponent}), or `undefined` when it is not:
 * the caller then derives the signature of the definition alone.
 *
 * The memos of the group are read first, before the type of the literal:
 * reading that type reads the signatures of the other members, which is the
 * work the memos save. When only the result is kept, the signature is built
 * from it and from the type of the literal. Otherwise the whole component
 * is derived ({@link deriveSignatureGroup}).
 */
export function groupSignature(
  ce: IComputeEngine,
  member: SignatureGroupMember
): BoxedType | undefined {
  const kept = groupSignatures.get(member.owner);
  if (keyHolds(ce, kept?.key, member))
    return member.noted(kept!.type, kept!.key.calleeHomes);
  const result = groupResults.get(member.owner);
  if (keyHolds(ce, result?.key, member))
    return member.noted(
      signatureOf(ce, member, result!.result, result!.key),
      result!.key.calleeHomes
    );
  const members = signatureComponent(ce, member);
  if (members.length < 2) return undefined;
  const derived = deriveSignatureGroup(ce, members);
  const own = derived.get(member.owner)!;
  return member.noted(own.type, own.calleeHomes);
}

/**
 * The signature of `member` for its derived `result`, with the parameter
 * slots refined from the type of its literal. The type of the literal is
 * read with the results of the other members kept, so it reads them. While
 * that type is being computed on the stack, the type cache answers an
 * earlier type: the signature is then built but not kept, and the recorded
 * signature stands for a type that is not a signature.
 */
function signatureOf(
  ce: IComputeEngine,
  member: SignatureGroupMember,
  result: Type,
  key: GroupKey
): BoxedType {
  const inFlight = typeInFlight(member.literal);
  const literalType = member.literal.type;
  const type = member.build(
    isSignature(literalType.type) ? literalType : member.recorded,
    result
  );
  if (!inFlight && !ce._resultMayBeDiscarded() && !inListHypothesisPass())
    groupSignatures.set(member.owner, { key, type });
  return type;
}

function isSignature(t: Type): boolean {
  return typeof t === 'object' && t.kind === 'signature';
}

function sameDefinitions(
  a: ReadonlyArray<object | undefined>,
  b: ReadonlyArray<object | undefined>
): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** True while the type of the literal is being computed on the stack. */
function typeInFlight(literal: Expression): boolean {
  return (
    (literal as { _isTypeInFlight?: () => boolean })._isTypeInFlight?.() ===
    true
  );
}

/**
 * Derive the signatures of `members`, the functions of one cycle of calls,
 * together, and keep them when nothing they read was provisional.
 *
 * Each member has a candidate result, `unknown` at the start: a call typed
 * `unknown` of a function whose result is being computed is left out of
 * the join of a conditional (`unknownCallMayBeRecursive`), so the first
 * round gives the base cases. A round types the body of each member afresh
 * under its declared parameter types (`resultUnderDeclaredParameters` with
 * `rebox`: the cached type of the literal may come from an earlier
 * computation), with every member in computation: a read of the signature
 * of a member answers its candidate, and a call of a member is typed by it
 * (`provisionalRecursionResult`). A result that is not a subtype of the
 * candidate widens it, at once (each member reads the candidates of the
 * members before it in the same round). The iteration stops after a round
 * that widens nothing: then the body of each member, with the calls of the
 * members typed by the candidates, is a subtype of its candidate, and the
 * result of a call that terminates is in that type, by induction on the
 * depth of its recursion. The result of the member is the type of its body
 * in that last round. When no such round comes within
 * {@link MAX_GROUP_ROUNDS}, each member takes the result of its skeleton,
 * `unknown`, which holds every value.
 *
 * A member whose body is typed `unknown` while its candidate is typed, or
 * whose candidate is still `unknown` when a round changes nothing else,
 * read a call that the candidates do not type: its candidate becomes `any`,
 * so that a call of it is joined in the other bodies, not left out.
 *
 * A result that holds an abstract collection, or the open form of a number
 * that may broadcast, is then tried as a list or as that number
 * (`listHypothesisOf`), as `verifiedListHypothesis` does for one function:
 * the hypotheses are kept when one round under them gives, for every
 * member, a subtype of its hypothesis, by the same argument.
 */
export function deriveSignatureGroup(
  ce: IComputeEngine,
  members: readonly SignatureGroupMember[]
): Map<object, { type: BoxedType; calleeHomes: HomeScope[] }> {
  signatureWorkCounts.groups += 1;
  const group = {};
  const frames: SignatureDerivationFrame[] = members.map((m) =>
    beginSignatureDerivation(m.owner, group)
  );
  const candidates = new Map<SignatureGroupMember, Type>(
    members.map((m) => [m, 'unknown'])
  );
  // Run `thunk` with every member answering its candidate.
  const underCandidates = <T>(thunk: () => T): T => {
    for (const m of members) m.enter(candidates.get(m)!);
    try {
      return withProvisionalResults(
        new Map(members.map((m) => [m.literal, candidates.get(m)!])),
        thunk
      );
    } finally {
      for (const m of members) m.leave();
    }
  };
  // The type of the body of `m` under the candidates.
  const bodyResult = (
    m: SignatureGroupMember
  ): { result: Type; homes: HomeScope[] } => {
    signatureWorkCounts.groupBodies += 1;
    const { result, homes } = underCandidates(() =>
      collectCalleeHomes(() =>
        resultUnderDeclaredParameters(ce, m.literal, m.skeleton, {
          rebox: true,
        })
      )
    );
    return { result: result ?? 'unknown', homes };
  };
  const results = new Map<
    SignatureGroupMember,
    { result: Type; homes: HomeScope[] }
  >();
  let store: boolean;
  let literalTypes: Map<SignatureGroupMember, BoxedType> | undefined;
  try {
    // The iteration from the candidates `start`: the results of the last
    // round, or `undefined` when no round widened nothing.
    const iterate = (
      start: (m: SignatureGroupMember) => Type
    ):
      | Map<SignatureGroupMember, { result: Type; homes: HomeScope[] }>
      | undefined => {
      for (const m of members) candidates.set(m, start(m));
      const last = new Map<
        SignatureGroupMember,
        { result: Type; homes: HomeScope[] }
      >();
      for (let round = 0; round < MAX_GROUP_ROUNDS; round++) {
        signatureWorkCounts.groupRounds += 1;
        let converged = true;
        for (const m of members) {
          const r = bodyResult(m);
          last.set(m, r);
          const t = r.result;
          const c = candidates.get(m)!;
          if (t === 'unknown') {
            // A body that holds only calls of members whose candidate is
            // still `unknown` is `unknown` (the calls are left out of the
            // joins): it waits for them, below. A body that is `unknown`
            // under a typed candidate read a call that the candidates do
            // not type: its result is `any`.
            if (c === 'unknown' || c === 'any') continue;
            candidates.set(m, 'any');
            converged = false;
          } else if (c === 'unknown') {
            candidates.set(m, t);
            converged = false;
          } else if (!isSubtype(t, c)) {
            candidates.set(m, widen(c, t));
            converged = false;
          }
        }
        // A round that changes nothing, with a member still `unknown` while
        // another is typed: that member's body is `unknown` for a reason the
        // candidates do not cover (a call of a function that is not defined
        // yet), and a call of it is left out of the joins of the others.
        // Its result is `any`, and the iteration goes on.
        if (converged && members.some((m) => candidates.get(m) !== 'unknown'))
          for (const m of members)
            if (candidates.get(m) === 'unknown') {
              candidates.set(m, 'any');
              converged = false;
            }
        if (converged) {
          // A result equivalent to its candidate keeps the candidate's
          // writing (bare `set` stays `set`, not `set<any>`).
          for (const m of members) {
            const r = last.get(m)!;
            const c = candidates.get(m)!;
            if (isSubtype(c, r.result) && isSubtype(r.result, c))
              last.set(m, { result: c, homes: r.homes });
          }
          return last;
        }
      }
      // No fixpoint was reached: a result nested one level deeper at each
      // round (`m := n ↦ Map(x ↦ If(x < 1, 0, m(x − 1)), [n])`). Each
      // candidate is replaced by a bare type above it, as
      // `verifiedListHypothesis` does for one function: first the bare type
      // of each arm of a union (`integer | list<…>` gives `integer | list`),
      // then each of `RECURSION_FALLBACK_TYPES` that holds it, from the
      // narrowest to the widest. The first set of candidates that one round
      // verifies (every body a subtype of its candidate) gives the results.
      const options = new Map(
        members.map((m) => {
          const c = candidates.get(m)!;
          const out: Type[] = [];
          const arms = bareArmsOf(c);
          if (arms !== undefined) out.push(arms);
          for (const top of RECURSION_FALLBACK_TYPES)
            if (isSubtype(c, top)) out.push(top);
          return [m, out] as const;
        })
      );
      const tries = Math.max(...members.map((m) => options.get(m)!.length));
      for (let j = 0; j < tries; j++) {
        for (const m of members) {
          const list = options.get(m)!;
          candidates.set(m, list[Math.min(j, list.length - 1)] ?? 'any');
        }
        signatureWorkCounts.groupRounds += 1;
        const verified = new Map(members.map((m) => [m, bodyResult(m)]));
        if (
          members.every(
            (m) =>
              verified.get(m)!.result !== 'unknown' &&
              isSubtype(verified.get(m)!.result, candidates.get(m)!)
          )
        )
          return verified;
      }
      for (const m of members)
        results.set(m, { result: 'unknown', homes: last.get(m)!.homes });
      return undefined;
    };
    const first = iterate(() => 'unknown');
    if (first !== undefined) for (const [m, r] of first) results.set(m, r);
    // A collection whose elements are `unknown` or `any` read a call of a
    // member typed by the first candidate, `unknown` (`Join([2], c(n − 1))`
    // is `collection<unknown>` in the first round, and stays so). The
    // iteration is run again from lists with no elements (`list<never>`, the
    // type of an empty list: the list hypothesis of `listHypothesisOf`, with
    // no elements), which gives the elements that the bodies add; its result
    // is kept when it holds no `unknown`. It is a fixpoint like the first
    // one, so it holds every value.
    if (
      first !== undefined &&
      members.some((m) => seedBelow(first.get(m)!.result) !== undefined)
    ) {
      const below = iterate(
        (m) => seedBelow(first.get(m)!.result) ?? first.get(m)!.result
      );
      if (
        below !== undefined &&
        members.every((m) => !mentionsUnknown(below.get(m)!.result))
      )
        for (const [m, r] of below) results.set(m, r);
      else for (const [m, r] of first) results.set(m, r);
    }
    if (first === undefined)
      for (const m of members)
        results.set(m, { result: 'unknown', homes: results.get(m)!.homes });
    else {
      // The list hypotheses, verified by one round under them.
      const hypotheses = new Map(
        members.map((m) => [m, listHypothesisOf(results.get(m)!.result)])
      );
      if ([...hypotheses.values()].some((h) => h !== undefined)) {
        for (const m of members)
          candidates.set(m, hypotheses.get(m) ?? results.get(m)!.result);
        signatureWorkCounts.groupRounds += 1;
        const verified = new Map(members.map((m) => [m, bodyResult(m)]));
        if (
          members.every(
            (m) =>
              verified.get(m)!.result !== 'unknown' &&
              isSubtype(verified.get(m)!.result, candidates.get(m)!)
          )
        )
          for (const m of members) results.set(m, verified.get(m)!);
      }
    }
    for (const m of members) candidates.set(m, results.get(m)!.result);
    store =
      !ce._resultMayBeDiscarded() &&
      !inListHypothesisPass() &&
      !frames.some((f) => f.tainted);
    // When the results are not kept, the parameter slots are read from the
    // types of the literals under the results, before the frames end.
    if (!store)
      literalTypes = underCandidates(
        () => new Map(members.map((m) => [m, m.literal.type]))
      );
  } finally {
    for (const f of frames) endSignatureDerivation(f);
  }
  // The home scopes of the members themselves, and those that the reads of
  // their bodies recorded: a read of a member inside the group records
  // nothing (it answers its candidate).
  const allHomes = [
    ...new Set([
      ...members.flatMap((m) => {
        const home = homeScopeOf(m.literal);
        return home === undefined ? [] : [home as HomeScope];
      }),
      ...members.flatMap((m) => results.get(m)!.homes),
    ]),
  ];
  const out = new Map<object, { type: BoxedType; calleeHomes: HomeScope[] }>();
  if (!store) {
    for (const m of members) {
      const lt = literalTypes!.get(m)!;
      out.set(m.owner, {
        type: m.build(
          isSignature(lt.type) ? lt : m.recorded,
          results.get(m)!.result
        ),
        calleeHomes: allHomes,
      });
    }
    return out;
  }
  // Every result is kept first, so that the type of a literal read below
  // reads the results of the other members.
  const key = groupKeyOf(ce, members, allHomes);
  for (const m of members)
    groupResults.set(m.owner, { key, result: results.get(m)!.result });
  for (const m of members)
    out.set(m.owner, {
      type: signatureOf(ce, m, results.get(m)!.result, key),
      calleeHomes: allHomes,
    });
  return out;
}

/** True when the literal of `member` can be typed afresh in its home
 * scope, which the group derivation needs. */
export function hasHomeScope(literal: Expression): boolean {
  return homeScopeOf(literal) !== undefined;
}
