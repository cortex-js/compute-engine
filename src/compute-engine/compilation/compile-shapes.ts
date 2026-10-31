// Local shape frames, aggregate component counts, scalar and vector shapes,
// and branch coercions.

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isNumber, isFunction } from '../boxed-expression/type-guards.js';
import type { CompileTarget, TargetSource } from './types.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';
import { compilationType } from './compiler-type-facts.js';
import {
  isCollectionValuedBigOpBodyByLookThrough,
  isContradictedScalarDeclaration,
  isProvablyNonNumericBigOpBody,
} from './compile-conditions.js';

/** `_localVector`: declared, but no binding seen yet. */
export const LOCAL_UNSET = -2;

/**
 * `_localVector`: the name holds a BOOLEAN, not a number.
 *
 * The frame's third channel (alongside "aggregate of width n" and
 * "scalar"): a shader `bool` is not an aggregate — so
 * `aggregateComponentCount` reads it back as "not an aggregate", like every
 * other negative sentinel — but it is not a float either, and a declared
 * `bool` name carries its boolean-ness NOWHERE else (a bare `b` is an
 * undeclared engine symbol, whose `type` is `unknown` = shader scalar).
 * Without this channel a `bool` argument flowed into a synthesized `float`
 * parameter behind a reported success.
 */
export const LOCAL_BOOLEAN = -3;

/**
 * `_localVector`: declared with a type whose SHAPE this analysis cannot
 * express — a matrix, an array, a struct, a target-specific alias.
 *
 * Reads back as "not an aggregate" like every other negative sentinel, which
 * is also what an UNFRAMED name answers; what the entry adds is the record
 * that the name IS declared. That is what lets a target consult its own
 * per-frame channel (the GPU targets carry the caller-declared shader TYPE,
 * which a width cannot express) and fail closed on it, instead of letting
 * the name pass for the untyped default.
 */
export const LOCAL_UNSHAPED = -4;

/**
 * The expression a local shape frame was pushed to describe, keyed by the
 * frame map itself (see `withLocalShapeFrame`'s `owner`).
 *
 * Keyed by the map rather than kept as a parallel stack because the complex
 * and vector stacks do not always grow together — `withBinderMask` pushes a
 * complex frame and only sometimes a vector one — so a positional pairing
 * would drift.
 */
export const _shapeFrameOwner = new WeakMap<object, Expression>();

/**
 * Is `name` answered by a local shape frame that describes some OTHER scope
 * than `owner`?
 *
 * A shape query answers from the innermost frame that MENTIONS the name, so
 * a `Function` literal that pushes no frame of its own has its parameters
 * answered by whatever enclosing frame happens to bind the same spelling.
 * That is how a nested lambda's real `z` inherited an enclosing complex `z`
 * and compiled in the `{ re, im }` lane over plain numbers. A literal asks
 * this question of each of its parameter names and pushes a shadowing frame
 * when the answer is `true`.
 *
 * The answer is `false` when no frame mentions the name at all, and also
 * when the innermost mentioning frame in BOTH stacks was pushed for `owner`
 * itself — the case of a combiner lambda, whose caller
 * (`compileCombinerLiteral`) frames its accumulator and element parameters in
 * the lanes the fold actually passes BEFORE compiling it. That frame must not
 * be shadowed, or the lanes it establishes are lost.
 *
 * Fails closed: an unowned frame, an unidentified `owner`, or a frame pushed
 * for a different expression all answer `true`, which makes the literal
 * describe its own parameters rather than inherit a foreign description.
 */
export function isFramedByForeignScope(
  name: string,
  owner: Expression | undefined
): boolean {
  const foreign = (stack: ReadonlyArray<Map<string, unknown>>): boolean => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].has(name)) continue;
      return owner === undefined || _shapeFrameOwner.get(stack[i]) !== owner;
    }
    return false;
  };
  return (
    foreign(CompilerState._localComplex) || foreign(CompilerState._localVector)
  );
}

/**
 * The complex lane `name` is already given by a local shape frame that was
 * pushed FOR `owner` itself, or `undefined` when no such frame describes it.
 *
 * Tri-state on purpose: this is NOT the negation of
 * `isFramedByForeignScope`, which also answers `false` when NO frame mentions
 * the name — the absence of a description rather than a description the owner
 * may rely on. A caller that must decide whether to leave an existing frame
 * in place asks this question instead, so that an unmentioned name does not
 * read as self-described.
 *
 * The lane comes back with the verdict because a caller that defers to its
 * own frame must emit the REST of its lowering in that frame's lanes too: a
 * combiner lambda's argument coercion is chosen from the same per-parameter
 * complexness as its body's arithmetic, and the two disagreeing is what turns
 * a `{ re, im }` argument into a string concatenation.
 *
 * Both stacks must answer, because a frame that enters the name in only one
 * of them leaves the other stack's answer to an enclosing scope, which is not
 * this owner's description. An unidentified `owner` owns nothing.
 */
export function framedLaneByOwnScope(
  name: string,
  owner: Expression | undefined
): boolean | undefined {
  if (owner === undefined) return undefined;
  const ownsInnermost = (
    stack: ReadonlyArray<Map<string, unknown>>
  ): boolean => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].has(name)) continue;
      return _shapeFrameOwner.get(stack[i]) === owner;
    }
    return false;
  };
  if (!ownsInnermost(CompilerState._localVector)) return undefined;
  for (let i = CompilerState._localComplex.length - 1; i >= 0; i--) {
    const frame = CompilerState._localComplex[i];
    if (!frame.has(name)) continue;
    if (_shapeFrameOwner.get(frame) !== owner) return undefined;
    return frame.get(name)!;
  }
  return undefined;
}

/**
 * The innermost local shape frame that mentions `name`, or `undefined`.
 *
 * The frame IDENTITY, for a target that keeps a parallel per-frame channel
 * of its own. Returning the frame rather than its entry gives that channel
 * the same innermost-frame-wins shadowing for free: a `Block` local
 * shadowing a declared parameter answers with the BLOCK's frame, which
 * carries no declared type.
 */
export function localShapeFrameOf(
  name: string
): ReadonlyMap<string, number> | undefined {
  for (let i = CompilerState._localVector.length - 1; i >= 0; i--)
    if (CompilerState._localVector[i].has(name))
      return CompilerState._localVector[i];
  return undefined;
}

/**
 * Is `name` framed as a boolean by the innermost local shape frame that
 * mentions it?
 *
 * Innermost-frame-wins, like every other frame query: a `Block` local
 * shadowing a `bool` parameter enters its own (non-boolean) entry and so
 * answers `false`.
 */
export function isLocalBoolean(name: string): boolean {
  for (let i = CompilerState._localVector.length - 1; i >= 0; i--) {
    const known = CompilerState._localVector[i].get(name);
    if (known !== undefined) return known === LOCAL_BOOLEAN;
  }
  return false;
}

/**
 * Whether `expr` is provably NOT a shader scalar — it lowers to a `vecN`, an
 * array, or a `matN`/tensor.
 *
 * Broader than `aggregateComponentCount`, which reports a single component
 * COUNT and so has nothing to say about a value with no one-dimensional
 * shape: a `Matrix` (or any multi-axis / unsized `list` type) lowers to
 * `mat2(…)` / an array, but "how many components" is not a well-posed
 * question for it. Reporting `undefined` for those made every caller that
 * uses `undefined` to mean "scalar" treat a matrix as a scalar — which let
 * `Tuple(Matrix(…), 1)` emit `vec2(mat2(…), 1.0)`, source no shader compiler
 * accepts.
 *
 * Callers that must decide "is this a scalar?" (the fail-closed constructor
 * guard, the block-local declaration) need THIS predicate; callers that need
 * a width (`vectorComponentCount`, the `vecN` type hint) still need the
 * count, and are deliberately left unchanged.
 */
export function isNonScalarShape(expr: Expression | null): boolean {
  if (expr === null) return false;
  if (core.aggregateComponentCount(expr) !== undefined) return true;
  return isNonScalarByShapeAlone(expr);
}

/**
 * The part of `isNonScalarShape` that does not count components: a
 * `Matrix`, a value with a `list` type that has no single count, or a
 * collection value.
 */
export function isNonScalarByShapeAlone(expr: Expression): boolean {
  if (isFunction(expr, 'Matrix')) return true;
  const t = compilationType(expr);
  // A `list` type that `aggregateComponentCount` declined to size: either
  // multi-axis (a matrix/tensor) or of unknown length. Non-scalar either way.
  if (typeof t !== 'string' && t.kind === 'list') return true;
  // An `indexed_collection` or `collection` value can be a list at run time,
  // so it is never a shader scalar either (CE-224).
  if (
    typeof t !== 'string' &&
    (t.kind === 'indexed_collection' || t.kind === 'collection')
  )
    return true;
  return false;
}

/**
 * The type `t` with the `missing` and `nan` arms of a top-level union
 * removed: `missing | tuple<real, real>` is `tuple<real, real>`. The arms
 * nested inside a constructor (`list<real | missing>`) are kept. A type
 * that is only absent arms is returned unchanged.
 */
export function withoutAbsentArms(t: Readonly<Type>): Readonly<Type> {
  if (typeof t === 'string' || t.kind !== 'union') return t;
  const present = t.types.filter((x) => x !== 'missing' && x !== 'nan');
  if (present.length === 0 || present.length === t.types.length) return t;
  return present.length === 1 ? present[0] : { ...t, types: present };
}

/**
 * Number of vector components a value expression occupies on a GPU target
 * (2–4), or `undefined` for a scalar (or a shape with no vector lowering).
 *
 * Structural for `Tuple`/`List` literals (the parametric-body shape
 * `(x(t), y(t))` → `vec2`), type-based for typed operands (`tuple<…>`, a
 * 1-axis `list`), and 2 for a complex value (lowered as `vec2(re, im)`).
 */
export function vectorComponentCount(
  expr: Expression | null
): 2 | 3 | 4 | undefined {
  const n = core.aggregateComponentCount(expr);
  return n !== undefined && n >= 2 && n <= 4 ? (n as 2 | 3 | 4) : undefined;
}

/**
 * On the plain JavaScript target a complex value is a `{ re, im }` object
 * and a real value a plain number — two incompatible runtime conventions. A
 * branch form (`If`/`Which`/`When`) whose value arms mix the two hands
 * consumers a value whose slots are sometimes missing (`(0).re` →
 * `undefined` → NaN at every point — Tycho item 60: a constant base-case
 * arm under a complex-ascribed recursive function). When any value arm is
 * complex-valued, coerce every real arm to the complex convention, so the
 * branch produces the ONE convention `isComplexValued` reports to consumers
 * (its operand fallback sees the complex arm).
 *
 * Returns `undefined` when no coercion applies — an all-real branch, or a
 * target with its own complex representation (Python's native `complex`
 * mixes freely with floats; GPU targets fail closed on complex earlier) —
 * and arms are then emitted unchanged.
 */
export function branchComplexCoercion(
  values: ReadonlyArray<Expression | undefined>,
  target: CompileTarget<Expression>
):
  | ((val: Expression | undefined, code: TargetSource) => TargetSource)
  | undefined {
  if (target.language !== 'javascript') return undefined;
  if (!values.some((v) => v !== undefined && core.isComplexValued(v)))
    return undefined;
  // Statically wrap ONLY provably-real arms. A wide-typed arm (`number`,
  // `unknown` — e.g. a pass-through parameter `z` in
  // `Which(n ≤ 0, z, True, K(n-1,z)²+c)` whose declared slot is `number`)
  // may hold a complex object at run time; wrapping it would nest the
  // object (`{ re: { re, im }, im: 0 }`).
  //
  // An arm that is neither provably real NOR complex-shaped
  // (`isComplexValued === false`) emits a plain number by the shape
  // invariant, but the static PROOF can be out of reach — a radical over a
  // radicand with free variables (`√(1 − 0.04r)`), or a closed constant the
  // fold's gates decline (`symbolDeps`, the cost ceiling, the evaluation
  // budget). Left bare, the branch's slot-reading consumers NaN-poison on
  // it (`_SYS.cabs(Math.sqrt(…))` read `.re` off a number and answered 0);
  // the idempotent runtime test `_SYS.cplx` settles it instead — a number
  // is lifted, an object passes through, so it is also the safe answer for
  // a wide arm actually holding an object. Only an arm the shape analysis
  // calls complex-valued stays bare: its emitted value is already in the
  // complex convention (or the discipline's consumers runtime-test it).
  return (val, code) => {
    if (val === undefined || isProvablyRealValued(val, target))
      return `({ re: ${code}, im: 0 })`;
    if (!core.isComplexValued(val)) return `_SYS.cplx(${code})`;
    return code;
  };
}

/**
 * True when the expression PROVABLY produces a plain real number at run
 * time on the JavaScript target — never the `{ re, im }` complex-object
 * convention. Callers wrap a provably-real value in that convention
 * statically; anything else must be left untouched (or routed through the
 * idempotent `_SYS.cplx` runtime test), because wrapping an object nests it
 * (`{ re: { re, im }, im: 0 }`) and every slot read off the nest is NaN.
 *
 * Three sources answer, in order:
 *
 * 1. The SHAPE analysis (`isComplexValued`), which overrides the static
 *    type: under the complex discipline a promoted radical — `√(1−0.2²)`,
 *    promoted for its unknown-sign radicand — is emitted as `_SYS.csqrt`,
 *    a `{ re, im }` object, whatever its static type says. Answering from
 *    the type alone wrapped that object a second time.
 * 2. The static type: a subtype of `real` is a plain number. Wide types
 *    (`number`, `unknown`) are NOT provably real — they may carry a
 *    `{ re, im }` object at run time (a pass-through parameter, a call to
 *    a function declared `-> complex` returning a real value).
 * 3. The constant FOLD (`constantFoldValue`, when the caller can supply
 *    its target): a closed pure constant subtree that evaluates to a real
 *    number is real-emitted — as the folded literal itself, or, where the
 *    emission declines (`constantFold: false`), through the real lowering
 *    that the step-1 `isComplexValued === false` verdict guarantees. This
 *    is what keeps `√(1 − 0.2²)` — statically the `complex` hedge,
 *    machine floats being unfolded at canonicalization — recognized as the
 *    plain number it evaluates to.
 */
export function isProvablyRealValued(
  expr: Expression,
  target?: CompileTarget<Expression>
): boolean {
  if (isNumber(expr)) return !expr.isComplex;
  if (core.isComplexValued(expr)) return false;
  if (expr.type.matches('real')) return true;
  if (target !== undefined) {
    const v = core.constantFoldValue(expr, target)?.value;
    if (v !== undefined && isNumber(v) && !v.isComplex) return true;
  }
  return false;
}

/**
 * Fail-closed guard (D6) for the INDEXED big-op form (`Sum`/`Product` with a
 * body plus an indexing set). A collection-valued body (`Σ h(i)·a(…)` where
 * `a` returns a vector — the interpreter's zip-broadcast elementwise Sum) has
 * no scalar accumulation: the emitters would produce `acc + <array>` (NaN,
 * string concatenation, or a dangling array), a silently WRONG value. Throw
 * until an element-wise accumulation arm exists; consumers can distribute the
 * element access through the big op (`At(Σ…, k)` → `Σ At(…, k)`), which
 * compiles as a scalar loop.
 *
 * Call this ONLY on the indexed form's body, never on the no-index
 * collection-reduce form (`Sum(collection)`), whose body is legitimately a
 * collection.
 *
 * The same argument applies to a body that is provably NOT a number at all —
 * a `string`, a `record`/`dictionary`, a function value (Tycho item 121).
 * `Add`/`Multiply` reject such an operand at BOX time (canonicalization
 * replaces it with an `Error(incompatible-type)` node, and
 * `BaseCompiler.compile`'s `isValid` guard then declines), but a big-op body
 * stays raw, so nothing re-ran that check before the emitters wrote a bare
 * `+`/`*` over it: `Σ_{i=0}^{2} "ab"` compiled to `("ab") + ("ab") + ("ab")`
 * and RAN to `"ababab"` behind `success: true` — including under
 * a caller reading the result as a number. Declining
 * is what the callers want (they fall back to expansion / the interpreter).
 */
export function assertScalarBigOpBody(kind: string, body: Expression): void {
  if (
    body.type.matches('list<any>') ||
    body.type.matches('indexed_collection<any>')
  )
    throw new Error(
      `Could not compile \`${kind}\`: a collection-valued body has no compiled form — distribute the ` +
        `element access through the ${kind} (At(${kind}(…), k) → ` +
        `${kind}(At(…, k))) or evaluate instead.`
    );
  if (isProvablyNonNumericBigOpBody(body))
    throw new Error(
      `Could not compile \`${kind}\`: a body of type '${body.type.toString()}' has no compiled form — the accumulation is numeric (a bare '+'/'*'), which for a ` +
        `non-numeric body silently produces a string or an object rather ` +
        `than a number. Evaluate it instead.`
    );
  if (isCollectionValuedBigOpBodyByLookThrough(body))
    throw new Error(
      `Could not compile \`${kind}\`: a collection-valued body has no compiled form — '${
        isFunction(body) ? body.operator : body.toString()
      }' is declared with an open result type ` +
        `('${body.type.toString()}') but its body constructs a collection. ` +
        `Distribute the element access through the ${kind} ` +
        `(At(${kind}(…), k) → ${kind}(At(…, k))) or evaluate instead.`
    );
  if (isContradictedScalarDeclaration(body))
    throw new Error(
      `Could not compile \`${kind}\`: the declaration of '${
        isFunction(body) ? body.operator : body.toString()
      }' says it returns a scalar ` +
        `('${body.type.toString()}'), but its body constructs a collection. ` +
        `The declaration is contradicted by the body, so the numeric ` +
        `accumulation would produce a wrong value. Fix the declaration ` +
        `(e.g. '-> list<number>') or evaluate instead.`
    );
}
