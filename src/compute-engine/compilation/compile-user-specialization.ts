// Specialization of user functions by argument types and ranges, and the
// emission of their variants.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { makeNumericRangeType } from '../../common/type/numeric-range.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { ascribeDeclaredParameterTypes } from '../engine-declarations.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import { isNumber, isFunction } from '../boxed-expression/type-guards.js';
import {
  functionLiteralDeclaredSignature,
  functionLiteralReturnMarker,
  functionLiteralReturnType,
} from '../boxed-expression/function-literal.js';
import type { CompileTarget, TargetSource } from './types.js';
import { core } from './compiler-core-hooks.js';
import {
  PROMOTABLE_RADICAL_HEADS,
  _codeOverrides,
  declaredLiteralMemos,
  rangeVariantMemos,
  rangeVerdictMemos,
} from './compiler-mode.js';
import {
  absentArgumentChecks,
  emitUserFunctionCall,
  ensureUserFunctionVariantEmitted,
  presentCheckedCode,
  userFunctionParamType,
} from './compile-user-calls.js';
import { userFunctionParamsAreScalar } from './compile-assignment-checks.js';
import { compileValueOperand } from './compile-statements.js';
import {
  assumedRealNonNegative,
  realPowerExponent,
} from './compile-real-analysis.js';
import type { UserFunctionRegistry } from './compiler-types.js';
import { memoFor } from './compiler-tables.js';
import { numericRangeOf, parametersCanBeTyped } from './compile-folding.js';
import {
  cachedLiteralWithParameterTypes,
  parameterTypesKey,
} from './compile-callbacks.js';
import { userFunctionIsGeneric } from './compile-cse.js';
import { complexDiscipline } from './compile-declarations.js';

/** Compile one shared helper for each proven argument representation.
 * The private literal carries narrower parameters; the engine definition
 * remains available for list calls and function-value uses. */
export function trySpecializedUserCall(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  args: readonly Expression[],
  target: CompileTarget<Expression>,
  prefixed?: {
    prefixes: ReadonlyArray<number>;
    values: ReadonlyArray<Expression>;
  }
): TargetSource | undefined {
  const emitted = core.ensureSpecializedUserCallEmitted(
    engine,
    h,
    literal,
    args,
    target
  );
  if (emitted === undefined) return undefined;
  const { name, scalarDefinition, listArgument, bindsListsWhole } = emitted;
  // Scalar definitions already have a broadcast-aware call boundary and a
  // memoization policy. Reuse it after preparing the typed body.
  if (scalarDefinition) return undefined;
  // A call that a repetition site rewrote to the INVARIANT-PREFIX VARIANT
  // of `h` (see the ordinary route in the caller) and that takes a range
  // specialization calls a variant of that specialization: the same typed
  // body, with the prefix values passed as extra parameters. Without it,
  // the range specialization would evaluate the prefixes again on each
  // repetition. The variant is emitted only on the JavaScript target (a
  // range specialization exists only there). When it cannot be emitted,
  // the call takes the range specialization itself.
  if (
    emitted.rangeKey !== undefined &&
    prefixed !== undefined &&
    prefixed.values.every((v) => _codeOverrides.has(v))
  ) {
    let variant: string | undefined;
    try {
      variant = ensureUserFunctionVariantEmitted(
        engine,
        h,
        prefixed.prefixes,
        target,
        { key: emitted.rangeKey, name }
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      variant = undefined;
    }
    if (variant !== undefined)
      return emitUserFunctionCall(
        variant,
        args,
        target,
        args.map(() => false),
        userFunctionParamsAreScalar(engine, h),
        false,
        prefixed.values.map((v) => core.compile(v, target)),
        absentArgumentChecks(h, literal, args, target)
      );
  }
  // A list argument the interpreter broadcasts is mapped over at the call
  // boundary, the point arguments held whole: the "atomic argument beside
  // a collection" form of `emitUserFunctionCall`, whose closure calls the
  // specialized helper once per element. The helper's mapped parameters
  // are scalars, which is what `paramsAreScalar` states there. A list the
  // interpreter binds whole takes the direct call below.
  const absentChecks = absentArgumentChecks(h, literal, args, target);
  if (listArgument && !bindsListsWhole)
    return emitUserFunctionCall(
      name,
      args,
      target,
      args.map(() => false),
      true,
      false,
      [],
      absentChecks
    );
  const registry = target.userFunctions;
  if (registry?.lowering)
    return registry.lowering.call({ id: h, name, args, target });
  // On interval-js a list is an array of intervals, which only the
  // target's collection spelling (`compileCollectionValue`) writes: a
  // list literal `[x, y]` has no ordinary lowering there. The call
  // emitter spells each argument that way when no parameter is scalar,
  // which is the case here: an interval-js copy binds a list whole.
  if (target.language === 'interval-javascript')
    return emitUserFunctionCall(
      name,
      args,
      target,
      args.map(() => false),
      false,
      false,
      [],
      absentChecks
    );
  return `${name}(${args
    .map((a, i) => {
      return presentCheckedCode(
        compileValueOperand(a, target),
        absentChecks[i]
      );
    })
    .join(', ')})`;
}

/**
 * True when the JavaScript compile of `head(args)` must prove the sign of
 * an operand to keep the real lane, and cannot: a `Sqrt`, `Ln` or `Log`
 * whose operand is not provably non-negative, a `Root` with an even
 * degree, or a `Power` with a non-integer exponent, whose radicand or base
 * is not provably non-negative. Under the `auto` and `complex` modes, such
 * a node takes the complex lane, and so does every value computed from it.
 *
 * This is the test of `promotesRadicalToComplex`, without its side
 * effects (it does not record a promotion) and without the verdicts that
 * a broadcast closure records. It is used only to compare two versions of
 * one body (see `unprovenRadicalCount`).
 */
export function radicalNeedsSignProof(
  head: string,
  args: ReadonlyArray<Expression>
): boolean {
  if (head === 'Power') {
    if (realPowerExponent(args) !== undefined) return false;
    const [base, exp] = args;
    if (base === undefined || exp === undefined) return false;
    if (!isNumber(exp) || Number.isInteger(exp.re) || exp.isComplex)
      return false;
    return !assumedRealNonNegative(base);
  }
  if (head === 'Root') {
    const [radicand, degree] = args;
    if (radicand === undefined || degree === undefined) return false;
    if (!isNumber(degree) || degree.isComplex) return false;
    if (!Number.isInteger(degree.re) || degree.re === 0) return false;
    if (degree.re % 2 !== 0) return false;
    return !assumedRealNonNegative(radicand);
  }
  if (!PROMOTABLE_RADICAL_HEADS.has(head)) return false;
  return args.some((a) => a === undefined || !assumedRealNonNegative(a));
}

/**
 * The parameter types of a RANGE SPECIALIZATION of user function `h` for a
 * call whose arguments have the types `argTypes`, or `undefined` when the
 * call does not get one.
 *
 * An argument gives range evidence when its type is a real range
 * (`integer<1..16>`: the index of a `Sum` or of a comprehension over a
 * literal range) or the type of a number literal, and the parameter that
 * receives it is wider (its type, declared or written on the literal,
 * admits values out of that range). The body of `h`, compiled with that
 * parameter typed by the range, can prove the sign of an operand that it
 * cannot prove otherwise: `√((k − 0.5)/16)` is real for every `k` in
 * `1..16`, while for a `k` typed `unknown` it takes the complex lane under
 * the `auto` mode, and the whole kernel with it.
 *
 * A specialization is emitted only when it changes that verdict: it must
 * have fewer unproven radicals (`unprovenRadicalCount`) than the
 * definition that the call uses otherwise. So a function whose body proves
 * nothing more with the range gets no copy, whatever its call sites.
 *
 * Each range is first widened to its lower bound only (`integer<1..>`).
 * When that type proves as much as the range itself, it is used, so call
 * sites with different ranges (or with the literals of an unrolled sum)
 * share one specialization. Otherwise the exact range is used.
 *
 * An entry is `undefined` for a parameter that gets no evidence: that
 * parameter keeps its own type.
 *
 * The caller applies this to the JavaScript target only: the other
 * targets have no complex promotion.
 */
export function rangeSpecializedParameterTypes(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  argTypes: ReadonlyArray<Type>,
  registry: UserFunctionRegistry,
  visiting: Set<string> = new Set()
): (Type | undefined)[] | undefined {
  const params = literal.ops.slice(1);
  if (params.length !== argTypes.length || params.length === 0)
    return undefined;
  if (!parametersCanBeTyped(literal)) return undefined;
  // A parameter declared complex is passed a `{re, im}` object by the
  // ordinary call (`coerceToComplex` in `tryCompileUserFunction`), which
  // the direct call of a specialization does not do.
  if (
    params.some((_p, i) => {
      const declared = userFunctionParamType(engine, h, i);
      return declared !== undefined && isNonRealNumber(declared);
    })
  )
    return undefined;
  const exact: (Type | undefined)[] = [];
  const widened: (Type | undefined)[] = [];
  for (let i = 0; i < params.length; i++) {
    const range = numericRangeOf(argTypes[i]);
    const own = userFunctionParamType(engine, h, i) ?? params[i].type.type;
    const t =
      range === undefined
        ? undefined
        : makeNumericRangeType(
            range.tier,
            range.lower,
            range.upper,
            range.lowerOpen,
            range.upperOpen
          );
    // The argument must be a value of the parameter (otherwise the call
    // is not valid, and its own route reports it), and the parameter must
    // admit more than the range.
    if (
      range === undefined ||
      t === undefined ||
      !isSubtype(t, own) ||
      isSubtype(own, t)
    ) {
      exact.push(undefined);
      widened.push(undefined);
      continue;
    }
    exact.push(t);
    const lowerOnly =
      Number.isFinite(range.lower) && Number.isFinite(range.upper)
        ? makeNumericRangeType(
            range.tier,
            range.lower,
            Infinity,
            range.lowerOpen
          )
        : t;
    widened.push(isSubtype(lowerOnly, own) ? lowerOnly : t);
  }
  if (exact.every((t) => t === undefined)) return undefined;
  const memo = memoFor(rangeVerdictMemos, registry);
  const memoKey = parameterTypesKey(h, exact);
  if (memo.has(memoKey)) return memo.get(memoKey);
  // A specialization already chosen for another call of `h` is used when
  // each of its parameter types contains the range of this call: its body
  // is valid for these arguments, and it already keeps a radical on the
  // real lane. So call sites over `1..16` and over `2..10` share the
  // specialization typed `integer<1..>`.
  const chosen = memoFor(rangeVariantMemos, registry).get(h) ?? [];
  const shared = chosen.find((types) =>
    types.every((t, i) => {
      const e = exact[i];
      if (e === undefined || t === undefined) return e === t;
      return isSubtype(e, t);
    })
  );
  if (shared !== undefined) {
    memo.set(memoKey, shared);
    return shared;
  }
  // Recorded first as "no specialization", so a recursive function that
  // reaches this call again while it is counted stops here.
  memo.set(memoKey, undefined);
  const countOf = (
    definition: (Expression & FunctionInterface) | undefined
  ): number | undefined => {
    if (definition === undefined) return undefined;
    visiting.add(h);
    try {
      return core.unprovenRadicalCount(
        engine,
        definition.op1,
        registry,
        visiting
      );
    } finally {
      visiting.delete(h);
    }
  };
  const baseline = countOf(
    declaredParameterLiteral(engine, h, literal, registry, visiting)
  );
  const exactCount = countOf(
    cachedLiteralWithParameterTypes(engine, h, literal, exact, registry)
  );
  let result: (Type | undefined)[] | undefined;
  if (
    baseline !== undefined &&
    exactCount !== undefined &&
    exactCount < baseline
  ) {
    result = exact;
    if (widened.some((t, i) => t !== exact[i])) {
      const widenedCount = countOf(
        cachedLiteralWithParameterTypes(engine, h, literal, widened, registry)
      );
      if (widenedCount === exactCount) result = widened;
    }
  }
  memo.set(memoKey, result);
  if (result !== undefined)
    memoFor(rangeVariantMemos, registry).set(h, [...chosen, result]);
  return result;
}

/**
 * The literal of user function `h` to emit as its definition on the
 * JavaScript target: `literal` with each parameter typed by the DECLARED
 * signature of `h`, when that type is a real type narrower than the type
 * the literal gives the parameter, and when the typed body proves the
 * sign of more radicands (`unprovenRadicalCount`). `literal` otherwise.
 *
 * The declared signature is the contract of every call: with `p` declared
 * `(integer<1..16>) -> unknown` and assigned `k ↦ √((k − 0.5)/16)`, the
 * literal's own parameter `k` has no type, and its body would take the
 * complex lane under the `auto` mode, while every call of `p` passes an
 * integer from 1 to 16. The GPU targets read the declared parameter types
 * the same way when they synthesize a definition.
 *
 * The typed literal is used for the emission only; the definition of `h`
 * keeps its own literal.
 */
export function declaredParameterLiteral(
  engine: ComputeEngine,
  h: string,
  literal: Expression & FunctionInterface,
  registry: UserFunctionRegistry,
  visiting: Set<string> = new Set()
): Expression & FunctionInterface {
  const memo = memoFor(declaredLiteralMemos, registry);
  const hit = memo.get(h);
  if (hit !== undefined && hit.source === literal) return hit.emitted;
  // Recorded first, so a recursive function that reaches this function
  // again while it is counted reads its own literal.
  memo.set(h, { source: literal, emitted: literal });
  let emitted = literal;
  if (
    !userFunctionIsGeneric(engine, h, literal) &&
    parametersCanBeTyped(literal)
  ) {
    const types = literal.ops.slice(1).map((p, i) => {
      const declared = userFunctionParamType(engine, h, i);
      if (declared === undefined || !isSubtype(declared, 'real'))
        return undefined;
      return isSubtype(p.type.type, declared) ? undefined : declared;
    });
    const typed = types.some((t) => t !== undefined)
      ? cachedLiteralWithParameterTypes(engine, h, literal, types, registry)
      : undefined;
    if (typed !== undefined) {
      const count = (definition: Expression & FunctionInterface): number => {
        visiting.add(h);
        try {
          return core.unprovenRadicalCount(
            engine,
            definition.op1,
            registry,
            visiting
          );
        } finally {
          visiting.delete(h);
        }
      };
      // In the `complex` mode (`complexDiscipline`), a parameter that the
      // literal leaves untyped is read as complex by its wide type, so a
      // body over it declines under a real ascription (`(real) -> real`)
      // whatever its radicals are. The declared types are the contract of
      // every call, so that mode emits the typed literal when the declared
      // result is a number type: the rebuilt literal keeps such a result
      // ascription (`literalWithParameterTypes`), and drops a collection
      // one (`matrix<real>`), whose check of the entries must stay.
      // (ROADMAP CE-230.1.)
      const resultType = functionLiteralReturnType(literal);
      if (
        (complexDiscipline() &&
          resultType !== undefined &&
          isSubtype(resultType, 'number')) ||
        count(typed) < count(literal)
      )
        emitted = typed;
    }
  }
  memo.set(h, { source: literal, emitted });
  return emitted;
}

/**
 * The GENERIC literal `literal`, rewritten so its bare parameters carry the
 * parameter types of the ground signature `ground` it is being emitted at.
 *
 * Reading a quantified parameter at its declared bound settled the CALL
 * boundary — which coercion and broadcast wraps a call site gets — but the
 * BODY was still compiled against an erased parameter, because the type a
 * body operand reports is the one its parameter was BOUND at, not one the
 * emission passes alongside. So a `(xs: T) -> number where T: list<number>`
 * whose body is `Length(xs)` reached the `Length` lowering with `xs` typed
 * `collection` (usage inference), which is not array-shaped, and the whole
 * function declined even though the bound proves a list.
 *
 * The repair routes the bound through the channel a CONCRETE declaration
 * already uses: `ascribeDeclaredParameterTypes` stamps the declared type
 * onto each bare parameter as a `Typed` annotation and re-boxes the literal,
 * so the body is canonicalized afresh with its parameter references bound at
 * that type. Handing it the ground signature instead of the polytype gives a
 * generic body exactly the reading `(list<number>) -> number` gets, and the
 * gates that consume it — the indexed-collection shape tests behind
 * `Length`/`At`/`Reduce`/`Filter`, the possibly-collection analysis — need no
 * knowledge of genericity at all.
 *
 * Reusing that function also inherits its skips, which are the ones wanted
 * here: an author-annotated parameter keeps its own annotation, a
 * `broadcastable<T>` slot is never stamped (it is a declaration-level
 * contract with its own enforcement), and a SCALAR bound is not stamped
 * either, since only a parameter that binds a collection WHOLE can be handed
 * a value a scalar-compiled body cannot read. A `where T: number` or
 * `where T: complex` generic therefore emits byte-identically to before this
 * rewrite (measured over the scalar, complex, boolean, two-parameter and
 * recursive cases pinned in
 * `test/compute-engine/compile-generic-monomorphization.test.ts`). A bound
 * that does not prove what the body needs is not repaired by the stamp:
 * `where T: collection<number>` under an `At` body stamps
 * `collection<number>`, which is not array-shaped, and the body fails closed
 * exactly as an equally weak concrete declaration does.
 *
 * The stamped literal is used for the EMISSION only — it is never stored
 * back on the definition, so the engine's own value keeps its polytype and
 * the interpreter still instantiates per call.
 */
export function literalAtGroundSignature(
  engine: ComputeEngine,
  literal: Expression & FunctionInterface,
  ground: FunctionSignature
): Expression & FunctionInterface {
  const grounded = markerAtGroundSignature(engine, literal, ground);
  const ascribed = ascribeDeclaredParameterTypes(engine, grounded, ground);
  return isFunction(ascribed, 'Function') ? ascribed : grounded;
}

/**
 * `literal` with its own FULL-SIGNATURE MARKER — the `Typed` node wrapping
 * the body that makes a literal self-describing — restated at the ground
 * signature `ground`. Unchanged when the literal carries no such marker, or
 * carries a ground one already.
 *
 * A generic literal installed against a declaration carries the declared
 * polytype as that marker, and the marker is what the literal's own type is
 * read from. While it says `where T`, a parameter annotation added next to
 * it does not survive canonicalization — the parameter annotations of a
 * generic literal are erased, since an annotation naming a ground type would
 * contradict the quantified parameter the marker declares. Stamping the
 * ground parameter types therefore has to restate the marker in the same
 * breath: with both halves ground the literal reads as the ordinary
 * `(xs: list<number>) -> number` declaration it is being emitted at.
 *
 * Rebuilt through the same authoring form the ascription helpers use — the
 * type as an ungrouped signature TEXT in the body slot, re-boxed so
 * canonicalization normalizes the marker back onto the body Block's last
 * statement.
 */
export function markerAtGroundSignature(
  engine: ComputeEngine,
  literal: Expression & FunctionInterface,
  ground: FunctionSignature
): Expression & FunctionInterface {
  const declared = functionLiteralDeclaredSignature(literal);
  if (declared === undefined || !isPolymorphicType(declared)) return literal;
  const marker = functionLiteralReturnMarker(literal);
  const inner = marker?.op1;
  if (marker === undefined || inner === undefined) return literal;

  // The canonical marker wraps the LAST statement of the body Block; in the
  // not-yet-normalized authoring form the marker IS the body slot.
  const body = literal.ops[0];
  const stripped: MathJsonExpression = isFunction(body, 'Block')
    ? ([
        'Block',
        ...body.ops.slice(0, -1).map((s) => s.json),
        inner.json,
      ] as MathJsonExpression)
    : inner.json;

  const rebuilt = engine.box([
    'Function',
    ['Typed', stripped, `'${typeToString(ground)}'`],
    ...literal.ops.slice(1).map((p) => p.json),
  ]);
  return isFunction(rebuilt, 'Function') ? rebuilt : literal;
}
