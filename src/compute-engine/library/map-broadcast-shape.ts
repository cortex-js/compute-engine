import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';

import type { Type } from '../../common/type/types.js';

import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards.js';
import { functionLiteralParameterType } from '../boxed-expression/function-literal.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  collectionElementType,
  resolveTypeForCompilation,
} from '../../common/type/utils.js';

/**
 * The *broadcast shape* of a single lazy-`Map` level — the structural gate
 * shared by the two drain-time optimizations that key on it:
 *
 * - `map-lowering.ts` (Map fusion, 2026-07-27): walks a spine of such levels
 *   and serves each element with a direct application, bypassing
 *   `makeLambda`;
 * - `map-auto-compile.ts` (the exact-mode compile tier, 2026-07-31): proves
 *   an unmarked broadcast-shaped level integer-closed and overflow-free, then
 *   compiles it.
 *
 * This module is a LEAF (no imports from either consumer): `map-lowering.ts`
 * already imports `map-auto-compile.ts` for the per-level runner, so the
 * shape walk cannot live in either of them without a cycle.
 */

/** An operand of a lowered level: either a closed (parameter-free) operand of
 * the original canonical body — used as-is, so it carries its bindings — or
 * the 0-based index of the parameter it names within the level's element
 * row. */
export type Slot = Expression | number;

export interface LoweredLevel {
  /** The level's own `Map` instance — the key `mapAutoCompileRunner` and the
   * compile caches are keyed on. */
  expr: Expression;
  /** The body is a bare parameter symbol: the element passes through
   * unchanged. Never set when `napprox` is true (the `N` marker must still be
   * applied). */
  identity: boolean;
  /** The applied operator (absent for an identity level). */
  op?: string;
  /** The operand layout (absent for an identity level; for an identity level
   * `slots[0]` is the pass-through row index). */
  slots?: Slot[];
  /** The body carried the `Block(N(…))` numeric marker: this level evaluates
   * with `{ numericApproximation: true }`. */
  napprox: boolean;
  /** The number of source collections of this level (= parameter count). */
  arity: number;
  /** The level's source operands (everything but the mapping function). */
  sources: ReadonlyArray<Expression>;
  /** The mapping function's BODY scope, when a slot operand carries a FREE
   * SYMBOL — a variable the lambda closed over rather than a literal.
   *
   * The lowered path evaluates in the AMBIENT scope, so such an operand only
   * resolves while its defining frame is still current. A lazy `Map` returned
   * from a function outlives that frame: `f(k) = Map([1,2], x ↦ x + k)` drained
   * by the caller resolved `k` to nothing and produced `[k+1, k+2]`. The
   * closure chain itself is intact (`captureClosures` rebinds the literal), so
   * the fix is for the drain to evaluate INSIDE it.
   *
   * The drain pushes this scope's **parent**, not the scope itself, and reads
   * it at drain time rather than here — see `makeSpineRunner`. Both halves are
   * load-bearing; the reasons are recorded there.
   *
   * `undefined` when every slot operand is a literal — the shape the fusion
   * work was built for (`1 + Mod(Range(0,899) + 29, 900)`), which keeps the
   * original zero-scope-work path. */
  closureScope?: Scope;
  /** A parameter ANNOTATION was admitted on the evidence of a source's element
   * TYPE (see `annotationSatisfiedBySource`), so this outcome is not purely
   * structural: an INFERRED source type can retract under a reassignment, and
   * the admission — which stands in for the enforcement the lowered path
   * bypasses — must then be re-asked.
   *
   * The consumers' memos do not key on this flag (a DECLINED annotation is
   * just as impermanent, and produces no level to carry it): they record
   * {@link sourceElementTypeKey} for every consulted `Map` that
   * {@link hasAnnotatedParams}, and revalidate those keys on a new mutation
   * generation. The flag reports the provenance of an admitted level. */
  typeSensitive?: boolean;
}

/**
 * `true` when the head of the application `body` is declared IMPURE. Read from
 * the node's own definition; the body of a `.N()` rewrap is re-boxed from
 * MathJSON and can arrive UNBOUND, so fall back to a by-name lookup rather
 * than canonicalizing (canonicalization would reorder the operands the slot
 * layout is read from).
 */
function isImpureHead(ce: ComputeEngine, body: Expression): boolean {
  const bound = body.operatorDefinition;
  if (bound) return bound.pure === false;
  const def = ce.lookupDefinition(body.operator);
  if (def && 'operator' in def) return def.operator.pure === false;
  return false;
}

/**
 * Is the ANNOTATION on a mapping-function parameter provably a no-op for the
 * elements it will receive?
 *
 * The lowered/fused path evaluates the level's application directly, bypassing
 * the per-application `Typed`-parameter enforcement the interpreter performs
 * (`withEnforcedParams`). Under the annotation-as-contract ruling
 * (`docs/plans/2026-08-08-lambda-param-element-inference.md`, ruling 2) an
 * annotated literal must error LOUDLY on a violating element, so the gate may
 * only accept an annotated parameter when that enforcement cannot fire: the
 * source's element type is provable AND every element it claims already
 * satisfies the annotation.
 *
 * Positive evidence only — an unprovable source element type
 * (`undefined`/`unknown`/`any`) declines, and so does an annotation NARROWER
 * than the element type (element `number` vs annotation `integer`): those keep
 * today's behavior and fall back to the unfused path that raises the error.
 */
function annotationSatisfiedBySource(
  param: Expression,
  source: Expression | undefined
): boolean {
  const declared = functionLiteralParameterType(param);
  if (declared === undefined) return false;
  const elt = sourceElementType(source);
  if (elt === undefined) return false;
  // The subtype question is asked on the UNRESOLVED element and annotation
  // types: NOMINAL opacity is a property of `isSubtype` (a nominal reference is
  // deliberately not a subtype of its definition, `subtype.ts`), and resolving
  // either side here would erase that identity and admit a level whose
  // enforcement DOES fire — silently, since the lowered path bypasses it.
  // `isSubtype` unfolds STRUCTURAL aliases (`{alias: true}`) on either side
  // itself, so an alias annotation is still discharged.
  return isSubtype(elt, declared);
}

/**
 * The PROVABLE element type of a `Map` source operand, or `undefined` when
 * there is no positive evidence (`unknown`/`any`/no collection type).
 *
 * Only the source's COLLECTION layer is resolved — a collection type spelled as
 * a type reference has to be unfolded before its element type can be read — and
 * the element type itself is returned as-is, so a nominal element keeps its
 * identity for the subtype question above.
 */
function sourceElementType(source: Expression | undefined): Type | undefined {
  if (source === undefined) return undefined;
  // A raw (unbound) operand reports nothing: read the type from the canonical
  // form, as the element-type inference hook does. Only reached for an
  // annotated parameter (or its revalidation), so the common bare-parameter
  // gate pays nothing.
  const src = source.isCanonical ? source : source.canonical;
  const elt = collectionElementType(resolveTypeForCompilation(src.type.type));
  if (elt === undefined || elt === 'unknown' || elt === 'any') return undefined;
  return elt;
}

/**
 * A key over the ONE non-structural input {@link lowerLevel} reads: the element
 * TYPE of each source of a `Map` whose mapping function carries an annotated
 * parameter.
 *
 * The consumers' memos (`lowerMapSpine`, `exactTierShape`) record it alongside
 * the outcome, so a later ask on a new mutation generation REVALIDATES instead
 * of re-deriving: an unrelated `ce.assign` leaves every key untouched and the
 * memoized outcome stands, while a source type that actually moved changes its
 * key and forces the full walk (which then admits, or declines and errors
 * loudly, on the new evidence). Each `at()` access is its own micro-drain, so
 * that difference is the whole cost of the annotated spelling on the random-
 * access route.
 */
export function sourceElementTypeKey(expr: Expression): string {
  if (!isFunction(expr, 'Map') || expr.nops < 2) return '';
  let key = '';
  for (const source of expr.ops.slice(0, -1)) {
    const elt = sourceElementType(source);
    key += (elt === undefined ? '?' : typeToString(elt)) + '|';
  }
  return key;
}

/**
 * Does `expr`'s mapping function carry an ANNOTATED parameter? A cheap
 * syntactic test, asked by the consumers at EVERY level they consult to decide
 * whether that level's outcome needs a {@link sourceElementTypeKey} recorded:
 * an annotation makes the outcome of {@link lowerLevel} depend on the source's
 * TYPE, and neither verdict is permanent — assigning the source a value whose
 * element type satisfies the annotation admits a level that declined, and a
 * retraction revokes one that was admitted.
 */
export function hasAnnotatedParams(expr: Expression): boolean {
  if (!isFunction(expr, 'Map') || expr.nops < 2) return false;
  const fn = expr.ops[expr.nops - 1];
  if (!isFunction(fn, 'Function')) return false;
  return fn.ops.slice(1).some((p) => isFunction(p, 'Typed'));
}

/**
 * The structural gate (§4, R2). A level is lowerable iff it is a `Map` whose
 * mapping function is *broadcast-shaped*: a canonical `Function` literal with
 * parameters that are bare symbols — or annotated symbols whose annotation the
 * source's element type provably satisfies — one per source, whose body — after
 * unwrapping a single-statement `Block` and then an optional `N` marker — is
 * either a bare parameter symbol or a single function application each of
 * whose operands is a parameter symbol or a parameter-free subexpression, and
 * whose head is not declared impure (scope safety, see below).
 *
 * Side-effect free: nothing is evaluated or materialized.
 */
export function lowerLevel(expr: Expression): LoweredLevel | undefined {
  if (!isFunction(expr, 'Map')) return undefined;
  if (expr.nops < 2) return undefined;

  const fn = expr.ops[expr.nops - 1];
  if (!isFunction(fn, 'Function')) return undefined;

  // The parameters must be symbols, one per source. A `["Typed", …]`
  // annotation is accepted — and treated as the bare inner symbol for
  // everything downstream, so the lowered level is structurally identical to
  // the bare-parameter case — only when the corresponding source's element type
  // provably satisfies it (see `annotationSatisfiedBySource`); any other
  // annotation declines the level.
  const params = fn.ops.slice(1);
  const sources = expr.ops.slice(0, -1);
  const arity = sources.length;
  if (params.length !== arity) return undefined;
  const names: string[] = [];
  let typeSensitive = false;
  for (let i = 0; i < params.length; i++) {
    let p = params[i];
    if (isFunction(p, 'Typed')) {
      if (!annotationSatisfiedBySource(p, sources[i])) return undefined;
      typeSensitive = true;
      p = p.op1;
    }
    if (!isSymbol(p)) return undefined;
    const name = sym(p);
    if (name === undefined) return undefined;
    names.push(name);
  }

  let body = fn.ops[0];
  if (body === undefined) return undefined;

  // A canonical body is a scoped `Block`; only a SINGLE-statement block is
  // in shape. Keep its scope: it is the head of the literal's closure chain,
  // and a slot operand that closed over an enclosing frame can only be
  // resolved inside it.
  let bodyScope: Scope | undefined;
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    bodyScope = body.localScope ?? undefined;
    body = body.op1;
  }
  let needsClosureScope = false;

  // The numeric marker (`Block(N(inner))`, from the item-39 `.N()` rewrap and
  // the `addN`/`mulN` N-maps).
  let napprox = false;
  if (isFunction(body, 'N') && body.nops === 1) {
    napprox = true;
    body = body.op1;
  }

  if (isSymbol(body)) {
    const index = names.indexOf(sym(body) ?? '');
    if (index < 0) return undefined;
    // An identity body under the `N` marker is NOT a pass-through: the marker
    // must still be applied. Model it as an `N` application of the parameter.
    if (napprox)
      return {
        expr,
        identity: false,
        op: 'N',
        slots: [index],
        napprox,
        arity,
        sources,
        typeSensitive,
      };
    return {
      expr,
      identity: true,
      slots: [index],
      napprox,
      arity,
      sources,
      typeSensitive,
    };
  }

  if (!isFunction(body)) return undefined;

  // Scope safety. The general path runs the body inside a FRESH function
  // frame; the lowered path evaluates the application in the AMBIENT scope. A
  // body whose head WRITES scope (`Assign`, `Declare`, `Assume`) would
  // therefore leak its mutation engine-wide. The gate is derived from the
  // operator DEFINITION — no name list: lower only when purity is not
  // `false`. Heads that are impure but scope-safe (`Random`, …) fall back to
  // the general path too: an accepted perf-only concession, not a
  // correctness one. A head with NO definition may pass — an unknown operator
  // cannot write scope and evaluates identically on both paths.
  if (isImpureHead(expr.engine, body)) return undefined;

  const slots: Slot[] = [];
  for (const o of body.ops) {
    if (isSymbol(o)) {
      const index = names.indexOf(sym(o) ?? '');
      if (index >= 0) {
        slots.push(index);
        continue;
      }
    }
    // A closed operand: kept as the ORIGINAL node so it carries its bindings
    // (reactivity) and its impurity (draw order) exactly as the interpreter's
    // body evaluation does. The `.N()` rewrap
    // (`lazyMapNumericApproximation`) re-boxes the body from MathJSON, so its
    // operands can arrive UNBOUND; bind them here, once per instance —
    // `.canonical` binds structure without substituting assigned symbol
    // values, so reactivity and impurity are preserved.
    if (o.has(names)) return undefined;
    const operand = o.isCanonical ? o : o.canonical;
    // A free symbol here is a CLOSED-OVER variable, not a closed value: it
    // resolves by binding lookup, and the lowered path looks up in the ambient
    // scope. Record the body scope so the drain can evaluate inside the
    // closure chain (see `closureScope`).
    if (operand.symbols.length > 0) needsClosureScope = true;
    slots.push(operand);
  }

  return {
    expr,
    identity: false,
    op: body.operator,
    slots,
    napprox,
    arity,
    sources,
    closureScope: needsClosureScope ? bodyScope : undefined,
    typeSensitive,
  };
}
