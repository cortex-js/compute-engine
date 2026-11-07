import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import {
  functionLiteralDeclaredSignature,
  isScalarType,
} from '../boxed-expression/function-literal.js';
import { provisionalLiteral } from '../boxed-expression/provisional-application.js';
import { ascribeDeclaredParameterTypes } from '../engine-declarations.js';
import { literalParamsMap } from '../library/core.js';
import { assignedNamesIn } from './compile-cse.js';
import { compilationType } from './compiler-type-facts.js';

/**
 * The callee of `Apply(f, a₁, …, aₙ)` or `ApplyWhole(f, a₁, …, aₙ)`, where
 * `f` is a function literal, with each bare parameter that receives a
 * collection typed from its argument. `ops` is `[f, a₁, …, aₙ]`. The value
 * is `undefined` when no parameter changes.
 *
 * A bare parameter of a function literal has the type that the uses in the
 * body infer: in `d ↦ Sum(d)`, `d` is a `collection`, which can hold
 * `Nothing` elements. The compiled code of the body reads that type and
 * declines, although the argument has a precise type, for example
 * `list<integer>`. With the parameter typed from the argument
 * (`(d: list<integer>) ↦ Sum(d)`), the body compiles as it does when the
 * argument is written in place of `d`. This is the shape that computes a
 * value once and names it, as a `let` does:
 * `Apply(d ↦ If(Length(d) = 0, 0, Max(d)), Filter(…))`.
 *
 * The typed literal is used for the compiled code only. The interpreter
 * applies the original literal. The two agree because the interpreter binds
 * each argument whole to its parameter, and the argument value has the
 * static type of the argument. These conditions make sure of that:
 *
 * - The literal does not map over a collection argument. `ApplyWhole`
 *   (`options.whole`) never maps. `Apply` maps when the parameters of the
 *   literal are all scalar (`literalParamsMap()`): it applies the body to
 *   each element of a list argument, and then the parameter holds an
 *   element, not the argument.
 * - The literal has no declared signature (a generic literal or a literal
 *   with a full-signature marker), no rest parameter, and exactly one
 *   argument for each parameter.
 * - The parameter is a bare name. A parameter with a type annotation keeps
 *   it.
 * - The body does not assign or declare the name of the parameter
 *   (`assignedNamesIn()`, which also counts a write inside a nested
 *   function). The argument type is the type of the first value only: in
 *   `a ↦ Block(Assign(a, C), Length(a))` with `C: list<real>` and an
 *   argument of type `list<integer>`, the type `list<integer>` would make
 *   the compiled code decline the assignment, which the interpreter
 *   accepts.
 * - The argument type is a collection type and a subtype of the parameter
 *   type that the body infers. Otherwise the interpreter gives an
 *   `incompatible-type` error, or the parameter can hold a value that is not
 *   a collection, and the literal is left as it is.
 *
 * An argument type that is a union (after its type aliases are resolved) is
 * not used, whatever its members: a parameter annotated with a union (for
 * example `tuple<real, real> | list<tuple<real, real>>`, two shapes) is the
 * host's request for a run-time dispatch at that parameter. A union inside
 * an element type (`list<integer | tuple<integer, integer>>`) is not a
 * union of the argument, and the parameter is typed. An annotation that the
 * compiler makes must not look like such a request, so the parameter keeps
 * the type that the body infers. Where the argument is an input declared
 * with a union, the shape is decided at the entry of that input
 * (`docs/plans/2026-10-31-static-shape-compilation.md`, rules R2 and R4).
 *
 * A scalar argument type is not used. The scalar parameter of a literal can
 * map over a collection at run time, and typing it does not remove a
 * decline of the compiled code.
 *
 * A `string` argument is used, although `isScalarType()` counts a string as
 * a scalar. A string is a collection of its characters, so the body can
 * infer a collection type for the parameter: in `s ↦ Length(s)`, `s` is a
 * `collection`. The compiled `Length` of a `collection` reads the value
 * with `_SYS.elts`, which accepts an array or a set and throws a
 * `RangeError` for a string, while the interpreter gives the number of
 * characters. With `s` typed `string`, `Length` counts the characters
 * (`_SYS.chars`). The other collection types that `isScalarType()` counts as
 * scalars (`range`) are not used, so their parameters keep the type that the
 * body infers.
 *
 * The body is canonicalized again with the typed parameters, in the scope
 * that encloses the literal, so that a name of an enclosing block keeps its
 * binding (`ascribeDeclaredParameterTypes()` builds the literal). A literal
 * with a provisional reading (a forward reference to a function that is not
 * yet defined, `provisional-application.ts`) is left as it is: that reading
 * is attached to the original body object.
 */
export function appliedLiteralTypedFromArguments(
  ops: ReadonlyArray<Expression>,
  options: { whole: boolean }
): Expression | undefined {
  const [literal, ...args] = ops;
  if (!isFunction(literal, 'Function')) return undefined;
  const params = literal.ops.slice(1);
  if (params.length === 0 || params.length !== args.length) return undefined;
  if (!params.every((p) => isSymbol(p) || isFunction(p, 'Typed')))
    return undefined;
  if (functionLiteralDeclaredSignature(literal) !== undefined) return undefined;
  if (
    provisionalLiteral(literal) !== undefined ||
    provisionalLiteral(literal.ops[0]) !== undefined
  )
    return undefined;

  const sig = literal.type.type;
  if (typeof sig !== 'object' || sig.kind !== 'signature') return undefined;
  if (sig.variadicArg !== undefined || (sig.optArgs?.length ?? 0) > 0)
    return undefined;
  if (sig.args?.length !== params.length) return undefined;
  if (!options.whole && literalParamsMap(sig)) return undefined;

  // `unknown` at a position leaves that parameter as it is
  // (`ascribeDeclaredParameterTypes()` skips it).
  const written = assignedNamesIn(literal.ops[0]);
  let changed = false;
  const types: Type[] = params.map((p, i) => {
    if (!isSymbol(p)) return 'unknown';
    if (written.has(p.symbol)) return 'unknown';
    const t = args[i].type.type;
    if (t === 'unknown' || t === 'any' || t === 'nothing' || t === 'never')
      return 'unknown';
    if (!isSubtype(t, 'collection')) return 'unknown';
    if (isScalarType(t) && !isSubtype(t, 'string')) return 'unknown';
    const resolved = compilationType(args[i]);
    if (typeof resolved === 'object' && resolved.kind === 'union')
      return 'unknown';
    const inferred = sig.args![i].type;
    if (!isSubtype(t, inferred)) return 'unknown';
    // The same type as the one the body infers adds nothing.
    if (isSubtype(inferred, t)) return 'unknown';
    changed = true;
    return t;
  });
  if (!changed) return undefined;

  const ce = literal.engine;
  const scope = literal.ops[0].localScope?.parent ?? undefined;
  // `includeScalar`: `ascribeDeclaredParameterTypes()` counts a `string` as
  // a scalar type, and without this option it does not write a scalar type
  // on a parameter, because that can change how a parameter that maps over
  // a collection broadcasts. The conditions above make sure that no
  // parameter here maps. The only scalar types left in `types` are strings:
  // the loop above gives `unknown` for the other scalar types.
  const typed = ce._inScope(scope, () =>
    ascribeDeclaredParameterTypes(
      ce,
      literal,
      {
        kind: 'signature',
        args: types.map((type) => ({ type })),
        result: 'unknown',
      },
      { includeScalar: true }
    )
  );
  if (typed === literal || !isFunction(typed, 'Function') || !typed.isValid)
    return undefined;
  return typed;
}
