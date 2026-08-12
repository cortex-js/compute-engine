import type { Type, TypeReference } from '../../common/type/types.js';
import { declarationOf } from '../../common/type/reference.js';
import { resolveTypeForCompilation } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';

import type { IComputeEngine } from '../global-types.js';

/**
 * SUM-TYPE COMPILATION POLICY —
 * `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §B1, amending D11
 * of `docs/plans/2026-08-01-nominal-types-design.md` §4.6.
 *
 * **The tag is erased iff it is statically discharged.** A product type
 * discharges its tag at type-check time and erases (D11, unchanged). A SUM's
 * tag is runtime data as soon as `match` branches on it — unless the variants
 * have pairwise-disjoint JS representations, in which case the value itself IS
 * the tag and nothing needs to be reified.
 *
 * Scope: **sugar-declared sums only**. `declareSumType` is the sole writer of
 * `_sumOf` (on each variant's declaration record) and `_sumVariants` (on the
 * sum's), so a hand-assembled union of nominals carries neither and keeps
 * today's behavior exactly — erased constructors, constructor-pattern `match`
 * failing closed.
 */

/** The JavaScript representation bucket of an erased variant payload. The
 * buckets are the ones a compiled `match` can tell apart with a single total
 * test (`s === null`, `typeof s === 'number'`, `Array.isArray(s)`, …). */
export type SumBucket = 'null' | 'boolean' | 'number' | 'string' | 'array';

/**
 * How a variant's payload erases, read off the variant record's `def` — the
 * same reading `mintTypeConstructor` uses to derive the constructor's arity:
 *
 * - `nothing` — a `nothing` payload: a NULLARY constructor, no operands;
 * - `tuple`   — a `tuple<…>` payload: an N-ARY constructor whose erasure is
 *               the same JS array the equivalent `Tuple` emits;
 * - `value`   — anything else: a UNARY constructor that erases to its operand.
 */
export type SumShape = 'nothing' | 'tuple' | 'value';

export interface SumVariantInfo {
  /** The variant's own name (the constructor's name). */
  name: string;
  /** The name of the sugar-declared sum it belongs to. */
  sum: string;
  /** `'tagged'` when at least two variants of the sum share a representation
   * (or one of them cannot be classified at all); `'erased'` when every
   * variant is classified and all are pairwise distinct. */
  policy: 'tagged' | 'erased';
  shape: SumShape;
  /** Constructor arity: 0 for `nothing`, 1 for `value`, the element count for
   * `tuple`. */
  arity: number;
  /** The erased representation, or `undefined` when unclassifiable (which by
   * itself forces the sum to the tagged policy). */
  bucket: SumBucket | undefined;
  /** `number`-bucket payloads only: the payload type admits COMPLEX values,
   * which the JS target represents as `{re, im}` objects rather than machine
   * numbers — so its representation test has to accept both. (`number` is the
   * top numeric type here: `complex <: number`, and `number <: real` is
   * false.) */
  complexNumber: boolean;
}

/**
 * The erased JS representation of `t`, or `undefined` when this module cannot
 * name it.
 *
 * DELIBERATELY a small whitelist. The classifier is only ever used to prove
 * two variants CANNOT collide, and an unrecognized answer must therefore read
 * as "might collide" — never as a bucket of its own. (A wrong bucket is a
 * miscompile: `match` would pick the wrong arm. An unknown bucket only costs
 * the sum its erasure.) So records, dictionaries, function types,
 * `unknown`/`any`/`never` and every union all return `undefined`.
 */
function bucketOf(t: Type): {
  bucket: SumBucket | undefined;
  complexNumber: boolean;
} {
  const none = { bucket: undefined, complexNumber: false } as const;
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string') {
    if (r === 'nothing') return { bucket: 'null', complexNumber: false };
    if (r === 'boolean') return { bucket: 'boolean', complexNumber: false };
    if (r === 'string') return { bucket: 'string', complexNumber: false };
    // `never` is a subtype of everything — it must not answer `number`.
    if (r === 'never' || r === 'unknown' || r === 'any') return none;
    // The real tower (`integer`, `rational`, `real`, `finite_real`, …) is a JS
    // machine number. `number` and `complex`/`imaginary` may additionally be a
    // `{re, im}` object, which the representation test has to accept.
    if (isSubtype(r, 'real')) return { bucket: 'number', complexNumber: false };
    if (isSubtype(r, 'number'))
      return { bucket: 'number', complexNumber: true };
    return none;
  }
  if (r.kind === 'tuple' || r.kind === 'list')
    return { bucket: 'array', complexNumber: false };
  return none;
}

/** The shape/arity a constructor of `def` is minted with — the reading of
 * `mintTypeConstructor` (`nAry = body.kind === 'tuple'`; a `nothing` body
 * elides its sole inhabitant, so the constructor is nullary). Read off the
 * RAW `def`, not the resolved one: a payload that merely *aliases* a tuple
 * mints a UNARY constructor. */
function shapeOf(def: Type): { shape: SumShape; arity: number } {
  if (def === 'nothing') return { shape: 'nothing', arity: 0 };
  if (typeof def === 'object' && def.kind === 'tuple')
    return { shape: 'tuple', arity: def.elements.length };
  return { shape: 'value', arity: 1 };
}

/** The declaration record for `name`, or `undefined`. */
function record(ce: IComputeEngine, name: string): TypeReference | undefined {
  // `name` is an expression OPERATOR, not necessarily a type: a protocol
  // name here must read as "not a variant", but the resolver throws
  // `protocol-in-type-position` for protocol names (P8/engine-type-resolver).
  let r: Type | undefined;
  try {
    r = ce._typeResolver.resolve(name);
  } catch {
    return undefined;
  }
  return r === undefined ? undefined : declarationOf(r);
}

/**
 * The name of the sugar-declared sum that OWNS the variant `name`, or
 * `undefined`.
 *
 * The `_sumOf` back-pointer is only trusted when the sum's CURRENT
 * `_sumVariants` still lists the variant: the two fields are written by
 * `declareSumType` and a re-declaration that DROPS a variant leaves the
 * dropped record behind (it is still a perfectly good nominal type — only its
 * membership ended). Reading the back-pointer alone would compile that
 * orphan's constructor under the NEW variant set's policy, which is a
 * miscompile whenever the policy flipped (a `plus`/`times` sum re-declared
 * disjoint turns an orphaned `plus(a, b)` into a bare array, colliding with
 * whatever else erases to one). `declareSumType` also clears the stale
 * back-pointer; this is the belt to that suspenders.
 */
function ownerSumOf(
  ce: IComputeEngine,
  name: string,
  variant: TypeReference | undefined
): string | undefined {
  const sum = variant?._sumOf;
  if (sum === undefined) return undefined;
  const variants = record(ce, sum)?._sumVariants;
  if (variants === undefined) return undefined;
  return variants.some((v) => v.name === name) ? sum : undefined;
}

/**
 * The compile-time policy for the sugar-declared sum `sumName`, or `undefined`
 * when the name is not a sugar-declared sum.
 *
 * ERASED requires every variant to classify AND all classifications to be
 * pairwise distinct; anything else is TAGGED. Tagging is always sound (the tag
 * is explicit runtime data), so "cannot classify" and "collides" collapse into
 * the same, conservative answer.
 */
export function sumPolicy(
  ce: IComputeEngine,
  sumName: string
): 'tagged' | 'erased' | undefined {
  const sum = record(ce, sumName);
  const variants = sum?._sumVariants;
  if (variants === undefined) return undefined;
  const seen = new Set<SumBucket>();
  for (const v of variants) {
    const def = record(ce, v.name)?.def;
    if (def === undefined) return 'tagged';
    const { bucket } = bucketOf(def);
    if (bucket === undefined || seen.has(bucket)) return 'tagged';
    seen.add(bucket);
  }
  return 'erased';
}

/**
 * Everything the constructor emitter and the `match` lowering need about
 * `name`, or `undefined` when `name` is not a variant of a sugar-declared sum
 * (the D11-erasure path, unchanged).
 */
export function sumVariantInfo(
  ce: IComputeEngine,
  name: string
): SumVariantInfo | undefined {
  const variant = record(ce, name);
  const sum = ownerSumOf(ce, name, variant);
  if (variant === undefined || sum === undefined || variant.def === undefined)
    return undefined;
  const policy = sumPolicy(ce, sum);
  if (policy === undefined) return undefined;
  return {
    name,
    sum,
    policy,
    ...shapeOf(variant.def),
    ...bucketOf(variant.def),
  };
}

/**
 * §B2 — the engine⇄compiled boundary. The name of a TAGGED sum (or of one of
 * its variants) reachable at the TOP LEVEL of `t`, or `undefined`.
 *
 * `{_tag}` objects are an implementation detail of one compiled unit: they are
 * not boxable values and v1 does not marshal them, so a unit whose RESULT type
 * admits one declines compilation. A `signature` is followed through its
 * RESULT only — sum-typed PARAMETERS are allowed, because an in-unit recursive
 * function (`ev(n: node)`) needs them; the tagged representation is then the
 * caller's contract, and the only callers are inside the same compiled unit.
 *
 * The walk never follows a reference's `def`: a nominal's representation is
 * opaque by construction (D3), and a transparent sum alias is recognized by
 * its `_sumVariants` record rather than by unfolding it.
 */
export function taggedSumInType(
  ce: IComputeEngine,
  t: Type
): string | undefined {
  const visit = (x: Type): string | undefined => {
    if (typeof x === 'string') return undefined;
    switch (x.kind) {
      case 'reference': {
        const decl = declarationOf(x);
        const sum =
          decl._sumVariants !== undefined
            ? x.name
            : ownerSumOf(ce, x.name, decl);
        if (sum !== undefined && sumPolicy(ce, sum) === 'tagged') return x.name;
        for (const a of x.args ?? []) {
          const r = visit(a);
          if (r !== undefined) return r;
        }
        return undefined;
      }
      case 'union':
      case 'intersection':
        for (const y of x.types) {
          const r = visit(y);
          if (r !== undefined) return r;
        }
        return undefined;
      case 'list':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
      case 'set':
        return visit(x.elements);
      case 'negation':
        return visit(x.type);
      case 'tuple':
        for (const e of x.elements) {
          const r = visit(e.type);
          if (r !== undefined) return r;
        }
        return undefined;
      case 'record':
        for (const y of Object.values(x.elements)) {
          const r = visit(y);
          if (r !== undefined) return r;
        }
        return undefined;
      case 'dictionary':
        return visit(x.values);
      case 'signature':
        return x.result === undefined ? undefined : visit(x.result);
      case 'callback':
        // A contextual callback wraps a signature — the RESULT rule applies to
        // it exactly as it does to a bare `signature`.
        return visit(x.signature);
      default:
        // The remaining kinds carry no `Type` payload to descend into
        // (`variable`, `symbol`, `expression`, `numeric`, `value`). Every
        // CONTAINER-like kind is enumerated above: a new one must be added
        // here, because falling through silently lets a `{_tag}` value escape
        // the boundary rather than declining.
        return undefined;
    }
  };
  return visit(t);
}
