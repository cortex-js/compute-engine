import type { Expression, FunctionInterface } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { isSubtype } from '../../common/type/subtype.js';
import { resolveTypeForCompilation } from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';

/**
 * What a compiled expression provably IS at run time: one number (`'scalar'`),
 * or a point — a numeric tuple of `point` scalar components, which the
 * JavaScript target emits as an array of that many numbers.
 *
 * `undefined` everywhere below means "not proven", never "neither of these".
 */
export type ProvableKind = 'scalar' | { readonly point: number };

function isPoint(k: ProvableKind | undefined): k is { readonly point: number } {
  return typeof k === 'object' && k !== null;
}

/**
 * The number of components when `t` describes a point — a tuple whose every
 * element is a number — and `undefined` otherwise.
 *
 * The type is read the way the compiler reads every representation question:
 * a `type alias` or a nominal `type` reference unfolds to its definition,
 * because compilation erases the distinction between a nominal type and the
 * structure it is defined by.
 */
function pointWidthOfType(t: Type): number | undefined {
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string' || r.kind !== 'tuple') return undefined;
  const elements = r.elements;
  if (elements.length === 0) return undefined;
  if (!elements.every((el) => isSubtype(el.type, 'number'))) return undefined;
  return elements.length;
}

/**
 * The `Function`-literal value of `e`'s operator when `e` is an application of
 * a USER-defined function (a symbol whose value is a `Function` literal), and
 * `undefined` otherwise — builtin operators have their own compile handlers and
 * no body to look through.
 */
export function userFunctionLiteral(
  e: Expression
): (Expression & FunctionInterface) | undefined {
  if (!isFunction(e)) return undefined;
  const op = e.operator;
  if (typeof op !== 'string') return undefined;
  const value = e.engine.box(op).value;
  return isFunction(value, 'Function') ? value : undefined;
}

/**
 * The kind of an expression judged from OUTSIDE any function body — an actual
 * argument at a call, or the whole expression a compile gate is asking about.
 *
 * The caller supplies `isScalar`, its own convention for "this is one number
 * at run time". At the compile gates that convention is: the type is not
 * collection-shaped and the gate does not call the expression
 * possibly-collection — so a bare `unknown` symbol passes, because at the top
 * level it is a free plot variable rather than a captured document symbol.
 *
 * The expression is then read with the same structural rules the body analysis
 * uses (`provableBodyKind`), with two entries taken first for every
 * subexpression: the caller's `isScalar`, and the TYPE, which names a point
 * when it is a tuple of numbers.
 */
export function provableTopLevelKind(
  a: Expression,
  isScalar: (a: Expression) => boolean
): ProvableKind | undefined {
  const kind = (x: Expression): ProvableKind | undefined => {
    if (isScalar(x)) return 'scalar';
    const n = pointWidthOfType(x.type.type);
    if (n !== undefined) return { point: n };
    return structuralKind(x, kind, new Set());
  };
  return kind(a);
}

/**
 * The heads that build a point from the components listed as their operands.
 *
 * `Tuple`, `Pair`, `Triple` and `Single` are the tuple spellings the engine
 * itself recognizes (`TUPLE_OPERATORS`, `collection-utils.ts`); every one of
 * them canonicalizes to `Tuple`, so only `Tuple` normally survives to a
 * compile, and the others are listed so a structurally-built expression is
 * read the same way. `PointList` joins them because an application whose
 * components are all scalars is one point.
 *
 * `javascript-value-facts.ts` reads this same set for the value-level twin of
 * this analysis. The two must agree, so it is exported rather than copied.
 */
export const POINT_CONSTRUCTOR_HEADS: ReadonlySet<string> = new Set([
  'Tuple',
  'Pair',
  'Triple',
  'Single',
  'PointList',
]);

/** See {@link POINT_CONSTRUCTOR_HEADS}. */
function isPointConstructorHead(h: string | Expression): boolean {
  return typeof h === 'string' && POINT_CONSTRUCTOR_HEADS.has(h);
}

/**
 * Is `x` a leaf that is one value at run time whatever the reading? A number
 * literal and a string literal are, and no other leaf is. The two walks of the
 * analysis — the body reading (`provableBodyKind`) and the reduction-body
 * reading inside a `Sum` or a `Product` — share this test, because a literal
 * does not depend on the environment a walk carries.
 */
function isScalarLiteral(x: Expression): boolean {
  return isNumber(x) || isString(x);
}

/**
 * The kind of `x`, a subexpression of a user function's BODY, where `env`
 * gives the kind of every name the body binds — its parameters. A `Sum` or a
 * `Product` adds its own indices for the reading of its body.
 *
 * The analysis is a conservative WHITELIST: its only permitted failure mode is
 * *declining* (the caller then keeps its fail-closed path), never unsound
 * admission. Admission is the dangerous direction here, because the caller
 * uses the answer to drop a run-time shape dispatch.
 *
 * The rules, each of them a measured property of the interpreter:
 *
 * - a number or string literal is a scalar; a bound name has the kind `env`
 *   gives it; a captured (non-bound) symbol is a scalar when its declared type
 *   is a number, a boolean or a string, and a point when its type is a tuple
 *   of numbers. A captured symbol with a TOP type (`unknown`, `any`, `value`)
 *   is not trusted: unlike a free plot variable, a captured document symbol is
 *   routinely assigned a list later. (A symbol the engine has already inferred
 *   a number for — an undeclared name used in a sum — carries that inference
 *   in its type and is admitted by the same rule.)
 * - a `Block` of exactly one statement is that statement; a longer one
 *   declines.
 * - a point constructor over scalar components is a point of that width.
 * - `Dot` of two points of the same width is a scalar, and so is a component
 *   accessor (`PointX`/`PointY`/`PointZ`) of a point that has that component.
 *   `Norm` of a point is its length, and so is `Abs` of a point — the
 *   interpreter answers the norm for `|(3, 4)|`.
 * - the arithmetic operators follow the interpreter's point algebra: addition
 *   is component-wise and needs both sides to be points of one width (a point
 *   plus a number is an `incompatible-type` error), negation keeps the kind,
 *   a product or a quotient scales a point by scalars, and a point raised to a
 *   scalar power is raised component-wise (`(1, 2)^2` is `(1, 4)`).
 * - a `Sum` or a `Product` in the canonical `Limits` shape is a scalar when
 *   every bound is a scalar and the body is a scalar under the indices.
 * - every other `broadcastable` operator maps scalars to a scalar, by
 *   definition of the lift. This rule comes last so the operators above keep
 *   their point behavior, which the lift does not describe.
 * - an application of another user function takes the same look-through, with
 *   its arguments judged under THIS body's assumptions.
 * - everything else declines: `List`/`Range` and the other collection
 *   constructors, multi-statement blocks, arity mismatches, non-symbol
 *   parameters.
 *
 * Provenance: this generalizes the scalar-only whitelist of Tycho items 86 and
 * 171 to a point-or-scalar analysis.
 */
export function provableBodyKind(
  x: Expression,
  env: ReadonlyMap<string, ProvableKind>,
  visited: Set<string>
): ProvableKind | undefined {
  if (isScalarLiteral(x)) return 'scalar';
  if (isSymbol(x)) {
    const bound = env.get(x.symbol);
    if (bound !== undefined) return bound;
    const t = x.type;
    if (t.matches('number') || t.matches('boolean') || t.matches('string'))
      return 'scalar';
    const n = pointWidthOfType(t.type);
    return n === undefined ? undefined : { point: n };
  }
  return structuralKind(x, (o) => provableBodyKind(o, env, visited), visited);
}

/**
 * The operator rules of the analysis, shared by the two entry points: `kind`
 * gives the kind of an operand (the top-level reading, or the body reading
 * under an environment), and `visited` holds the user-function names already
 * being looked through.
 *
 * Every rule below is a measured property of the interpreter; the list is in
 * `provableBodyKind`.
 */
function structuralKind(
  x: Expression,
  kind: (o: Expression) => ProvableKind | undefined,
  visited: Set<string>
): ProvableKind | undefined {
  if (!isFunction(x)) return undefined;

  const ops = x.ops;
  const h = x.operator;

  if (h === 'Block') return ops.length === 1 ? kind(ops[0]) : undefined;

  if (isPointConstructorHead(h)) {
    if (ops.length === 0) return undefined;
    return ops.every((o) => kind(o) === 'scalar')
      ? { point: ops.length }
      : undefined;
  }

  if (h === 'Dot') {
    if (ops.length !== 2) return undefined;
    const a = kind(ops[0]);
    const b = kind(ops[1]);
    return isPoint(a) && isPoint(b) && a.point === b.point
      ? 'scalar'
      : undefined;
  }

  if (h === 'PointX' || h === 'PointY' || h === 'PointZ') {
    if (ops.length !== 1) return undefined;
    const a = kind(ops[0]);
    const needed = h === 'PointX' ? 1 : h === 'PointY' ? 2 : 3;
    return isPoint(a) && a.point >= needed ? 'scalar' : undefined;
  }

  if (h === 'Norm' || h === 'Abs') {
    if (ops.length !== 1) return undefined;
    const a = kind(ops[0]);
    return a === 'scalar' || isPoint(a) ? 'scalar' : undefined;
  }

  if (h === 'Add') {
    const kinds = ops.map(kind);
    if (kinds.length === 0 || kinds.some((k) => k === undefined))
      return undefined;
    if (kinds.every((k) => k === 'scalar')) return 'scalar';
    const first = kinds[0];
    if (
      isPoint(first) &&
      kinds.every((k) => isPoint(k) && k.point === first.point)
    )
      return first;
    return undefined;
  }

  if (h === 'Negate') return ops.length === 1 ? kind(ops[0]) : undefined;

  if (h === 'Multiply') {
    const kinds = ops.map(kind);
    if (kinds.length === 0 || kinds.some((k) => k === undefined))
      return undefined;
    const points = kinds.filter(isPoint);
    if (points.length === 0) return 'scalar';
    return points.length === 1 ? points[0] : undefined;
  }

  if (h === 'Divide' || h === 'Power') {
    if (ops.length !== 2) return undefined;
    const a = kind(ops[0]);
    const b = kind(ops[1]);
    if (b !== 'scalar') return undefined;
    return a === 'scalar' || isPoint(a) ? a : undefined;
  }

  if (h === 'Sum' || h === 'Product') {
    if (ops.length < 2) return undefined;
    const indices: string[] = [];
    for (const limits of ops.slice(1)) {
      if (!isFunction(limits, 'Limits')) return undefined;
      const limitOps = limits.ops;
      const index = limitOps[0];
      if (index === undefined || !isSymbol(index)) return undefined;
      // The bounds are evaluated OUTSIDE the sum, so they are judged under the
      // enclosing reading, without the indices.
      for (const bound of limitOps.slice(1))
        if (kind(bound) !== 'scalar') return undefined;
      indices.push(index.symbol);
    }
    // The body is read in an environment where every index is a scalar. That
    // environment holds ONLY the indices: a name the enclosing reading knows
    // about reaches the body through `kind` below.
    const inner = new Map<string, ProvableKind>();
    for (const name of indices) inner.set(name, 'scalar');
    const bodyKind = (o: Expression): ProvableKind | undefined => {
      if (isScalarLiteral(o)) return 'scalar';
      if (isSymbol(o)) {
        const bound = inner.get(o.symbol);
        if (bound !== undefined) return bound;
        return kind(o);
      }
      return structuralKind(o, bodyKind, visited);
    };
    return bodyKind(ops[0]) === 'scalar' ? 'scalar' : undefined;
  }

  if (typeof h === 'string') {
    const def = x.engine.lookupDefinition(h);
    if (def && (def as any).operator?.broadcastable === true)
      return ops.every((o) => kind(o) === 'scalar') ? 'scalar' : undefined;
  }

  // A nested user-function application: same look-through, with its arguments
  // judged under THIS reading.
  return provableApplicationKind(x, visited, kind);
}

/**
 * The kind of `e`, an application of a user-defined function, when this
 * analysis proves one: every actual argument must have a kind of its own
 * (`argKind`), and the body must then have a kind under those parameters.
 *
 * `visited` holds the names already being looked through, so self-recursion
 * and mutual recursion decline instead of looping.
 */
export function provableApplicationKind(
  e: Expression,
  visited: Set<string>,
  argKind: (a: Expression) => ProvableKind | undefined
): ProvableKind | undefined {
  if (!isFunction(e)) return undefined;
  const op = e.operator;
  if (typeof op !== 'string' || visited.has(op)) return undefined;
  // Only a USER function — a symbol whose value is a `Function` literal — is
  // looked through; built-in operators have their own compile handlers.
  const fnVal = userFunctionLiteral(e);
  if (fnVal === undefined) return undefined;
  const fnOps = fnVal.ops;
  const params = fnOps
    .slice(1)
    .map((p: Expression) => functionLiteralParameterName(p));
  const args = e.ops;
  if (params.length !== args.length) return undefined;
  if (params.some((p: string) => !p)) return undefined;
  const env = new Map<string, ProvableKind>();
  for (let i = 0; i < params.length; i++) {
    const k = argKind(args[i]);
    if (k === undefined) return undefined;
    env.set(params[i], k);
  }
  const nextVisited = new Set(visited);
  nextVisited.add(op);
  // Canonical parse wraps a lambda body in `Block`; unwrap only the
  // single-statement form (a multi-statement body declines in the body
  // analysis).
  let body: Expression | undefined = fnOps[0];
  if (body === undefined) return undefined;
  while (isFunction(body, 'Block') && body.nops === 1) body = body.ops[0];
  return provableBodyKind(body, env, nextVisited);
}

/**
 * Is `e` an application of a user function whose result is provably ONE
 * NUMBER under scalar arguments? The yes-or-no reading of
 * `provableApplicationKind`, for a caller that needs no width — a point
 * answers `false` here, like every shape the analysis declines.
 */
export function isProvablyScalarApplication(
  e: Expression,
  visited: Set<string>,
  argIsScalar: (a: Expression) => boolean
): boolean {
  return (
    provableApplicationKind(e, visited, (a) =>
      provableTopLevelKind(a, argIsScalar)
    ) === 'scalar'
  );
}
