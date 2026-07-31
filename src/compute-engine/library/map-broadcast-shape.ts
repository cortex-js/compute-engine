import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards.js';

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
 * The structural gate (§4, R2). A level is lowerable iff it is a `Map` whose
 * mapping function is *broadcast-shaped*: a canonical `Function` literal with
 * bare (unannotated) parameters, one per source, whose body — after
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

  // The parameters must be BARE symbols (a `["Typed", …]` annotation is not
  // a symbol, so annotated parameters fall out here), one per source.
  const params = fn.ops.slice(1);
  const sources = expr.ops.slice(0, -1);
  const arity = sources.length;
  if (params.length !== arity) return undefined;
  const names: string[] = [];
  for (const p of params) {
    if (!isSymbol(p)) return undefined;
    const name = sym(p);
    if (name === undefined) return undefined;
    names.push(name);
  }

  let body = fn.ops[0];
  if (body === undefined) return undefined;

  // A canonical body is a scoped `Block`; only a SINGLE-statement block is
  // in shape.
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    body = body.op1;
  }

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
      };
    return { expr, identity: true, slots: [index], napprox, arity, sources };
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
    slots.push(o.isCanonical ? o : o.canonical);
  }

  return {
    expr,
    identity: false,
    op: body.operator,
    slots,
    napprox,
    arity,
    sources,
  };
}
