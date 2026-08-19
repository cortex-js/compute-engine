import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typesOverlap } from '../../common/type/reduce.js';

import type { IComputeEngine } from '../global-types.js';
import type { Expression } from '../types-expression.js';
import {
  implementationLiteralAt,
  protocolDispatchCandidates,
  requirementArityOf,
  staticProtocolResolution,
  type DispatchCandidate,
} from '../engine-protocols.js';

import {
  bucketOf,
  sumVariantInfo,
  type SumBucket,
} from '../sum-representation.js';

/**
 * Plan the JavaScript-target lowering of protocol calls.
 *
 * Two tiers, decided here and rendered by `base-compiler.ts`:
 *
 * - **static**: the receiver's static type pins the same implementation the
 *   interpreter would select at every possible runtime receiver — the call
 *   compiles to a direct call of that implementation, no guards.
 * - **dynamic**: the receiver's runtime representation is reified enough
 *   (machine `typeof` classes, `{_tag}` objects) to replicate the
 *   interpreter's selection with a guard chain, most-specific-first.
 *
 * Anything the plan cannot prove faithful returns `undefined`. Like sum
 * compilation, a plan is a snapshot of the protocol registry: a later
 * conformance is a `config` state event, and compiled artifacts bake the
 * candidate set they saw.
 */

/** How the guard chain tests that the receiver takes a candidate's arm. */
export type ReceiverGuard =
  /** A machine-type test rendered by `jsClauseParamGuard` (faithful for the
   * machine numbers, strings and booleans compiled code traffics in). */
  | { kind: 'js-type'; type: Type; family: SumBucket }
  /** A tagged-sum-variant test: `x?._tag === tag`. */
  | { kind: 'tag'; tag: string }
  /** An erased-sum-variant representation test (`sumBucketTest`), plus a
   * length check for a tuple payload. */
  | {
      kind: 'bucket';
      bucket: SumBucket;
      complexNumber: boolean;
      tupleArity?: number;
    };

export type PlannedCandidate = {
  /** The protocol the winning edge belongs to — half of the helper name. */
  protocol: string;
  /** The edge's index in its record's conformance list — the other half. */
  edgeIndex: number;
  /** The ground conformance target. */
  target: Type;
  /** Receiver guard; absent on the static tier (no test needed). */
  guard?: ReceiverGuard;
  /** The implementation, as a RAW function literal with ground (`Self`
   * substituted) annotations. */
  literal: Expression;
};

export type DispatchPlan = {
  implKey: string;
  argc: number;
  /** `static`: exactly one candidate, called directly. `dynamic`: guard
   * chain over the candidates in order, falling through to a runtime throw. */
  tier: 'static' | 'dynamic';
  candidates: PlannedCandidate[];
};

/** The accessor-key prefixes of property implementations (the engine's
 * mangling convention, also spelled out in the Epsil parser/serializer). */
function isAccessorKey(implKey: string): boolean {
  return implKey.startsWith('__get__') || implKey.startsWith('__set__');
}

/**
 * The guard testing that a runtime receiver takes `target`'s arm, or
 * `undefined` when no faithful JS test exists.
 *
 * A sum-variant reference tests its reified tag (tagged policy) or its erased
 * representation bucket (erased policy — faithful under the machine-value
 * trust model compiled `match` constructor patterns already use). A plain
 * machine type tests through `jsClauseParamGuard`. Everything else — opaque
 * non-sum nominals (their erasure is indistinguishable from their
 * definition), parametric collections (`Array.isArray` cannot see element
 * types), records, … — has no faithful test and declines.
 */
function receiverGuardOf(
  ce: IComputeEngine,
  target: Type
): ReceiverGuard | undefined {
  if (typeof target === 'object' && target.kind === 'reference') {
    const info = sumVariantInfo(ce, target.name);
    if (info === undefined) return undefined;
    if (info.policy === 'tagged') return { kind: 'tag', tag: target.name };
    if (info.bucket === undefined) return undefined;
    return {
      kind: 'bucket',
      bucket: info.bucket,
      complexNumber: info.complexNumber,
      tupleArity: info.shape === 'tuple' ? info.arity : undefined,
    };
  }
  const { bucket } = bucketOf(target);
  // `array` admits any array regardless of element type, which is not faithful for a
  // `list<…>`/`tuple<…>` target (a `list<integer>` receiver would take a
  // `list<string>` arm the interpreter refuses).
  if (bucket === undefined || bucket === 'array') return undefined;
  return { kind: 'js-type', type: target, family: bucket };
}

/** Are the two guards satisfiable by disjoint sets of runtime JS values? */
function guardsDisjoint(a: ReceiverGuard, b: ReceiverGuard): boolean {
  // A `{_tag}` object is a plain non-array object with no `re`/`im`, so it
  // fails every bucket and machine-type test; two tag tests are disjoint
  // whenever the tags differ.
  if (a.kind === 'tag' && b.kind === 'tag') return a.tag !== b.tag;
  if (a.kind === 'tag' || b.kind === 'tag') return true;
  const fa = a.kind === 'bucket' ? a.bucket : a.family;
  const fb = b.kind === 'bucket' ? b.bucket : b.family;
  return fa !== fb;
}

/**
 * Plan the compilation of a protocol call.
 *
 * - `implKey`: the implementation key — a function member name, or a mangled
 *   `__get__x`/`__set__x` accessor key.
 * - `argc`: the call site's arity (the receiver included; 1 for a property
 *   GET, 2 for a SET).
 * - `receiverType`: the receiver's STATIC type when the call site has one.
 * - `protocol`: restrict to one protocol — the qualified forms.
 *
 * Returns `undefined` when no faithful plan is available.
 */
export function planProtocolDispatch(
  ce: IComputeEngine,
  req: {
    implKey: string;
    argc: number;
    receiverType?: Type;
    protocol?: string;
  }
): DispatchPlan | undefined {
  const { implKey, argc, receiverType, protocol } = req;
  const cands = protocolDispatchCandidates(ce, implKey, protocol);
  if (cands === null || cands.length === 0) return undefined;

  // The requirement's arity must pin the call site's: `dispatchMember`
  // errors (`protocol-signature-mismatch`) on a mismatch AFTER selection, so
  // a chain that skipped a wrong-arity edge would silently take a different
  // arm. Accessor keys have no function requirement; their arity is fixed by
  // the caller (GET 1, SET 2).
  if (!isAccessorKey(implKey)) {
    for (const record of new Set(cands.map((c) => c.record)))
      if (requirementArityOf(ce, record, implKey) !== argc) return undefined;
  }

  // ── Static resolution ──────────────────────────────────────────────────
  // Only a unique static winner can short-circuit to a direct call. Every
  // other verdict falls through to the dynamic tier: `undecided` by design;
  // `none` because the static type may be a supertype of the admitted
  // targets — the central sum case, where the receiver types as the sum
  // alias `shape` while the conformances sit on its variants (the
  // interpreter keeps such calls alive through `edgeCouldApply` and
  // dispatches on the evaluated value's principal type); `ambiguous`
  // because the dynamic pairwise rule independently declines every
  // ambiguity-capable candidate set.
  if (receiverType !== undefined) {
    const r = staticProtocolResolution(ce, implKey, receiverType, protocol);
    if (r.status === 'unique') {
      const winner = cands.find((c) => c.edge === r.edge);
      if (winner !== undefined && !winner.conditional && !winner.host) {
        // Domination: selection at every runtime `r ≤ receiverType` must
        // still pick this edge. Any other edge either admits no such `r`
        // (no overlap with the receiver type), or is a strict supertype of
        // the winner's target — admitted only where the winner also is, and
        // then eliminated by specificity. A conditional or host edge that
        // overlaps, or an incomparable/more-specific one, breaks the proof.
        let dominated = true;
        for (const c of cands) {
          if (c.edge === r.edge) continue;
          if (!typesOverlap(c.widest, receiverType)) continue;
          if (
            !c.conditional &&
            !c.host &&
            isSubtype(r.target, c.target) &&
            !isSubtype(c.target, r.target)
          )
            continue;
          dominated = false;
          break;
        }
        if (dominated) {
          const literal = implementationLiteralAt(ce, r.edge, implKey);
          if (literal === null) return undefined;
          return {
            implKey,
            argc,
            tier: 'static',
            candidates: [
              {
                protocol: r.record.name,
                edgeIndex: winner.edgeIndex,
                target: r.target,
                literal,
              },
            ],
          };
        }
        // Domination failed → the dynamic tier decides (its pairwise rule
        // declines exactly the unsound cases).
      }
    }
  }

  // ── Tier B — reified dynamic dispatch ──────────────────────────────────
  const planned: (PlannedCandidate & { guard: ReceiverGuard })[] = [];
  for (const c of cands) {
    if (c.conditional || c.host) return undefined;
    const guard = receiverGuardOf(ce, c.target);
    if (guard === undefined) return undefined;
    const literal = implementationLiteralAt(ce, c.edge, implKey);
    if (literal === null) return undefined;
    planned.push({
      protocol: c.record.name,
      edgeIndex: c.edgeIndex,
      target: c.target,
      guard,
      literal,
    });
  }

  // Pairwise rule — no receiver may reach a different arm than the
  // interpreter's selection:
  // - equivalent targets: both would survive specificity → the interpreter
  //   answers `protocol-call-ambiguous`; a chain would silently pick one.
  // - comparable targets: linearized most-specific-first, but ONLY when both
  //   guards are faithful machine-type tests (`js-type`) — a bucket/tag test
  //   over-admits its whole representation class, so putting it above a
  //   wider arm would swallow values the interpreter routes to that arm.
  // - incomparable targets: must be provably runtime-disjoint (different
  //   guard classes AND no type overlap) — otherwise some value admits both
  //   and the interpreter's answer is the ambiguity error.
  for (let i = 0; i < planned.length; i++) {
    for (let j = i + 1; j < planned.length; j++) {
      const ti = planned[i].target;
      const tj = planned[j].target;
      const si = isSubtype(ti, tj);
      const sj = isSubtype(tj, ti);
      if (si && sj) return undefined;
      if (si || sj) {
        if (
          planned[i].guard.kind === 'js-type' &&
          planned[j].guard.kind === 'js-type'
        )
          continue;
        return undefined;
      }
      if (
        guardsDisjoint(planned[i].guard, planned[j].guard) &&
        !typesOverlap(ti, tj)
      )
        continue;
      return undefined;
    }
  }

  // Most-specific-first insertion sort (the multi-clause linearization):
  // stable, so disjoint arms keep registration order.
  const order: number[] = [];
  for (let i = 0; i < planned.length; i++) {
    let at = order.length;
    for (let k = 0; k < order.length; k++) {
      const j = order[k];
      if (
        isSubtype(planned[i].target, planned[j].target) &&
        !isSubtype(planned[j].target, planned[i].target)
      ) {
        at = k;
        break;
      }
    }
    order.splice(at, 0, i);
  }

  return {
    implKey,
    argc,
    tier: 'dynamic',
    candidates: order.map((i) => planned[i]),
  };
}

/** Re-export for the base-compiler hook: is this head shape a protocol call
 * at all? (Cheap pre-check before planning.) */
export type { DispatchCandidate };
