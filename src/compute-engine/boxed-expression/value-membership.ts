import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';

import type { Expression } from '../global-types.js';

import { isFunction, isNumber, isString, isSymbol } from './type-guards.js';

/**
 * Value membership — does a *concrete value* inhabit a type containing
 * value-kind (literal) or bounded-numeric components?
 *
 * (`docs/plans/2026-08-01-function-polymorphism-design.md` §4.1, Phase 0.)
 *
 * Subtyping compares a value's *synthesized* type (`ce.box(0).type` is
 * `finite_integer`), which can never witness membership in a value type such
 * as `0` — the type would reject its own witness. This predicate tests the
 * value itself. It is consulted as an ADMISSION fallback wherever a concrete
 * value is at hand (argument validation, assign compatibility, overload arm
 * filtering) and never replaces the synthesized-type check.
 *
 * Contract:
 * - **Side-effect-free**: never evaluates; the only indirection followed is
 *   one symbol → literal-value hop through the symbol's existing binding.
 * - **Exactness (D1)**: number comparison is `isSame` — the engine's exact
 *   value identity (`0.0` boxes to the exact integer `0`; `3.5 ≡ 7/2`).
 *   `NaN` is a member of NO value type (isSame(NaN, NaN) is true; ruled out
 *   explicitly). Range endpoints are inclusive.
 * - Error values are members of nothing.
 * - `false` means "not provably a member" — a symbolic or partially-known
 *   expression yields `false` and the caller keeps its ordinary behavior
 *   (the tri-state refinement is Phase 1 of the design).
 */
export function typeAcceptsValue(
  expr: Expression,
  type: Type | undefined
): boolean {
  if (type === undefined) return false;
  // Fast bail: without a value-kind/bounded-numeric component, membership
  // coincides with subtyping and the caller has already checked that.
  if (!hasValueComponent(type)) return false;

  const v = concreteValueOf(expr);
  if (v === undefined) return false;

  return accepts(v, type);
}

/** Does `type` contain a component whose membership depends on the VALUE
 * (a literal value type or a bounded numeric), so that `typeAcceptsValue`
 * could answer differently from subtyping? */
export function hasValueComponent(t: Type): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'value':
    case 'numeric':
      return true;
    case 'union':
    case 'intersection':
      return t.types.some(hasValueComponent);
    case 'negation':
      return hasValueComponent(t.type);
    case 'reference':
      // Structural aliases unfold; a nominal reference stays opaque.
      return t.alias && t.def !== undefined ? hasValueComponent(t.def) : false;
    case 'list':
      return hasValueComponent(t.elements);
    case 'tuple':
      return t.elements.some((e) => hasValueComponent(e.type));
    default:
      return false;
  }
}

/** The concrete literal `expr` denotes, or `undefined` when `expr` is not a
 * concrete value. Never evaluates: literals answer directly; a symbol is
 * followed one hop into its existing binding iff that binding holds a
 * literal. */
function concreteValueOf(expr: Expression): Expression | undefined {
  if (!expr.isValid) return undefined;
  if (isNumber(expr) || isString(expr)) return expr;
  if (isSymbol(expr)) {
    const name = expr.symbol;
    if (name === 'True' || name === 'False') return expr;
    const bound = expr.valueDefinition?.value;
    if (
      bound !== undefined &&
      bound !== expr &&
      (isNumber(bound) || isString(bound) || isBooleanLiteral(bound))
    )
      return bound;
    return undefined;
  }
  // A `List`/`Tuple` application whose elements are ALL concrete is itself a
  // concrete value (fully-known shape, spec §4.1); anything less — a lazy or
  // symbolic collection, any other application, error values — is not.
  if (isFunction(expr, 'List') || isFunction(expr, 'Tuple')) {
    if (expr.ops.every((op) => concreteValueOf(op) !== undefined)) return expr;
    return undefined;
  }
  return undefined;
}

function isBooleanLiteral(expr: Expression): boolean {
  return isSymbol(expr, 'True') || isSymbol(expr, 'False');
}

/** Recursive membership of the concrete literal `v` in `t`. Components with
 * no value dependence fall back to subtyping on the synthesized type. */
function accepts(v: Expression, t: Type): boolean {
  if (typeof t === 'string') return isSubtype(v.type.type, t);

  switch (t.kind) {
    case 'value':
      return acceptsValueLiteral(v, t.value);

    case 'numeric': {
      // Bounds are only meaningful over an ordered (real) domain — a
      // non-real value (e.g. `5+1000i` against `complex<0..10>`) is never a
      // member. Mirrors `rangeContains` (match-dispatch.ts).
      if (!isNumber(v) || v.isNaN === true || v.isReal !== true) return false;
      // The base kind is judged on the synthesized type (an integer literal
      // inhabits `integer<…>`; a non-integer float does not).
      if (!isSubtype(v.type.type, t.type)) return false;
      // Inclusive bounds (spec §4.1), compared through the boxed
      // exactness-aware comparators — `.re` would project an exact bignum
      // or rational onto a double and could round it onto an endpoint
      // (e.g. 2^53 + 1 admitted by an upper bound of 2^53).
      const ce = v.engine;
      if (t.lower !== undefined && v.isGreaterEqual(ce.number(t.lower)) !== true)
        return false;
      if (t.upper !== undefined && v.isLessEqual(ce.number(t.upper)) !== true)
        return false;
      return true;
    }

    case 'union':
      return t.types.some((u) => accepts(v, u));
    case 'intersection':
      return t.types.every((u) => accepts(v, u));
    case 'negation':
      return !accepts(v, t.type);
    case 'reference':
      if (t.alias && t.def !== undefined) return accepts(v, t.def);
      // Nominal references are opaque — synthesized subtyping decides.
      return isSubtype(v.type.type, t);

    // Fully-known constructor shapes recurse element-wise (spec §4.1):
    // `List(0)` inhabits `list<0>`. `concreteValueOf` only admits List/Tuple
    // applications whose elements are all concrete, so `v.ops` is safe to
    // walk here. Other constructor kinds (set, record, dictionary) stay
    // conservative — they fall through to synthesized subtyping.
    case 'list': {
      if (!isFunction(v, 'List')) return isSubtype(v.type.type, t);
      // A declared first dimension must match the element count; deeper
      // dimensions are the nested lists' own membership problem.
      if (t.dimensions !== undefined && t.dimensions.length > 0) {
        const d0 = t.dimensions[0];
        if (Number.isFinite(d0) && d0 >= 0 && v.ops.length !== d0)
          return false;
        if (t.dimensions.length > 1) return isSubtype(v.type.type, t);
      }
      return v.ops.every((op) => {
        const el = concreteValueOf(op);
        return el !== undefined && accepts(el, t.elements);
      });
    }
    case 'tuple': {
      if (!isFunction(v, 'Tuple')) return isSubtype(v.type.type, t);
      if (v.ops.length !== t.elements.length) return false;
      return v.ops.every((op, i) => {
        const el = concreteValueOf(op);
        return el !== undefined && accepts(el, t.elements[i].type);
      });
    }

    default:
      return isSubtype(v.type.type, t);
  }
}

/** Membership in a literal value type (`0`, `"red"`, `true`): the engine's
 * exact value identity (`isSame`), with `NaN` ruled out explicitly. */
function acceptsValueLiteral(v: Expression, value: unknown): boolean {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return false;
    if (!isNumber(v) || v.isNaN === true) return false;
    return v.isSame(v.engine.number(value));
  }
  if (typeof value === 'string') return isString(v) && v.string === value;
  if (typeof value === 'boolean')
    return isSymbol(v) && v.symbol === (value ? 'True' : 'False');
  return false;
}
