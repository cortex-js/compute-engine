import { installOperatorCalleeDerivation } from './callee-type-derivation.js';
import { callResultType } from './call-result-type.js';
import type {
  BoxedDefinition,
  BoxedOperatorDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
  TypeHandlerContext,
} from '../global-types.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  freeTypeVariables,
  paramAt,
  readTypeVariablesAsBounds,
  substituteTypeVariables,
} from '../../common/type/instantiate.js';
import {
  isSubtype,
  provablyDisjoint,
  widen,
} from '../../common/type/subtype.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  appliesToListCoordinateTuple,
  addsPointToNumberCollection,
  isPointArithmeticError,
  isTupleShapedType,
  scalarOrListUnionCellType,
  typeCouldBeUnkeyedCollection,
} from '../collection-utils.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import {
  functionResult,
  resolveTypeAlias,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { describeType, guardedTypeHandlerCall } from './operand-descriptor.js';
import {
  functionLiteralParameterName,
  isDestructuringParameter,
  isRestParameter,
} from './function-literal.js';
import { isFunction } from './type-guards.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { numericCanonicalHandlerName } from './numeric-canonical-registry.js';
import {
  instantiatedResultTypeOverActuals,
  isThreadableAt,
  solveArmOverActuals,
  type SolveActual,
  type Threadable,
} from './generic-instantiation.js';
import { arityBounds, isMoreSpecific, overloadArms } from './overload.js';
import {
  ABSENT_CELLS_STAY_MISSING,
  absentCellsPresentType,
  absorbOperandAbsence,
  broadcastLiftType,
  movesAbsentCells,
  passesAbsentCellsThrough,
  threadedPresentType,
  viewOfDescriptor,
  withPresentCellAbsence,
  withThreadedAbsence,
} from './broadcast-lift-type.js';

/**
 * The three readings of an operator definition the broadcast lift needs,
 * installed by `boxed-function.ts` at module load
 * (`installBroadcastLiftHooks`). They live there, next to the value-path
 * code that shares their private helpers, and `boxed-function.ts` already
 * imports this module for `typeHandlerContext`: importing them here would
 * close a cycle, which the module graph forbids. Until they are installed —
 * only while `boxed-function.ts` itself is still loading — the descriptor
 * route derives without the lift, as it did before the lift was shared.
 */
export interface BroadcastLiftHooks {
  /** The declared `broadcastable<T>` slot plan of a definition. */
  readonly mappableSlot: (
    def: BoxedOperatorDefinition
  ) => ((i: number) => boolean) | undefined | 'no-plan';
  /** `broadcastsOverTuples(operator, def)`. */
  readonly broadcastsOverTuples: (
    operator: string,
    def: BoxedOperatorDefinition
  ) => boolean;
  /** `typesTupleArmsAsCells(operator, def)`: the tuple arm of a
   * scalar-or-collection union operand is typed as a cell of its own. */
  readonly typesTupleArmsAsCells: (
    operator: string,
    def: BoxedOperatorDefinition
  ) => boolean;
  /** A lambda-literal definition, typed by its own broadcast arm. */
  readonly isLambda: (def: BoxedOperatorDefinition) => boolean;
  /** The type of a call of a user function literal, from the steps of the
   * expression route that type such a call before the derivation from the
   * body: a tuple at a declared scalar parameter, a partial application,
   * and the broadcast over a collection operand
   * (`lambdaCallTypeOverDescriptors`, `boxed-function.ts`). `undefined` when
   * no step applies. */
  readonly lambdaCallType: (
    engine: ComputeEngine,
    operator: string,
    binding: BoxedDefinition,
    operands: ReadonlyArray<OperandDescriptor>
  ) => Type | undefined;
}
let broadcastLiftHooks: BroadcastLiftHooks | undefined;
export function installBroadcastLiftHooks(hooks: BroadcastLiftHooks): void {
  broadcastLiftHooks = hooks;
}

/**
 * The components of a numeric tuple: a number, or an absence marker. An
 * absent component (`Missing`, or `Undefined`, which a tuple literal also
 * types `missing`) reads as `NaN` in a numeric slot, so it does not stop the
 * tuple from being a point: `-(1, Missing)` is `(-1, NaN)`. This is the rule
 * that the arithmetic handlers apply (`couldBeNumericElement`,
 * `collection-utils.ts`). A union of the two (`integer | missing`, the
 * component of an index read that can be out of range) is also accepted.
 */
const NUMERIC_TUPLE_COMPONENT: Type = {
  kind: 'union',
  types: ['number', 'missing'],
};

/** Whether `t` is a tuple whose every component is a number or an absence
 * marker (see `NUMERIC_TUPLE_COMPONENT`). */
export function isNumericTupleType(t0: Type): boolean {
  const t = resolveTypeAlias(t0);
  return (
    typeof t === 'object' &&
    t.kind === 'tuple' &&
    t.elements.every((e) => isSubtype(e.type, NUMERIC_TUPLE_COMPONENT))
  );
}

/**
 * Whether `t` is a tuple type that is not provably a numeric tuple, but that
 * is one when its open components hold numbers: every component is a number
 * type, an absence marker (see `NUMERIC_TUPLE_COMPONENT`) or the open
 * `unknown`/`any`, and at least one is open. The tuple
 * `(a, a)` in the body of `g := a ↦ f((a, a))` has the type
 * `tuple<unknown, unknown>` when `g` is defined, and `g(1)` binds `(1, 1)`
 * to the parameter of `f`. A numeric-tuple argument at a scalar or open
 * parameter makes the signature result of a function literal wrong (see
 * `lambdaBroadcastType`, `boxed-function.ts`), so the callers that check for
 * a numeric tuple check for this type too. A tuple that is already numeric
 * answers false.
 *
 * The bare type `tuple` names no component, so every component is open: a
 * symbol declared `tuple` can hold `(1, 2)`, and `f := x ↦ (-x, x)` then
 * makes `f(w)` a pair of pairs.
 */
export function mayBeNumericTupleType(t0: Type): boolean {
  const t = resolveTypeAlias(t0);
  if (t === 'tuple') return true;
  if (typeof t !== 'object' || t.kind !== 'tuple') return false;
  const open = (e: Type) => e === 'unknown' || e === 'any';
  return (
    t.elements.some((e) => open(e.type)) &&
    t.elements.every(
      (e) => open(e.type) || isSubtype(e.type, NUMERIC_TUPLE_COMPONENT)
    )
  );
}

/**
 * Whether an argument of type `t` binds as a numeric tuple at a scalar or
 * open parameter of a function literal: `t` is a numeric tuple
 * (`isNumericTupleType`) or may be one (`mayBeNumericTupleType`), or `t` is
 * such a tuple with a whole-value `missing` arm.
 *
 * The `missing` arm comes from an argument that may be absent as a whole:
 * an index read that can be out of range (`L[k]` over a list of points is
 * `missing | tuple<integer, integer>`). An explicitly constructed tuple
 * remains present even when all its coordinates are absent. Each arm of the
 * argument types the call on its own, and the call is the union of the arms. With
 * `f := x ↦ (-x, x)`, the `missing` arm gives `tuple<number, missing>`, as
 * `f(Missing)` is `(NaN, Missing)`, and the tuple arm gives `any`, as
 * `f((1, 2))` does. The union of the two is `any`, so the callers answer
 * `any` for such an argument, the same as for a numeric tuple. Without the
 * `missing` arm read here, the call kept the signature result
 * `tuple<number, number>`, which the pair of pairs that a present argument
 * gives does not fit. An argument that is only `missing` is not a tuple and
 * answers false.
 *
 * The callers apply this rule only after the derivation from the body
 * (`callResultType`) declined. That derivation types each arm from the
 * body, and it is more precise for a body that passes the argument through:
 * `p ↦ p` over `L[k]` is `missing | tuple<number, number, number>`.
 */
export function isNumericTupleArgumentType(t: Type): boolean {
  const present = stripMissingFromType(resolveTypeAlias(t), 'keep');
  return isNumericTupleType(present) || mayBeNumericTupleType(present);
}

/**
 * Whether parameter `i` of the function literal `literal` can reach the
 * value of its body: true when the body mentions the parameter's name, and
 * true when that cannot be told (no literal, a rest or destructuring
 * parameter, a position past the fixed parameters). A numeric tuple bound
 * whole to a parameter that the body never reads does not change the value,
 * so the signature result still describes it: `outer := P ↦ (PointX(q),
 * PointY(q))`, where `q` is read from elsewhere, gives the same value for
 * any argument.
 */
export function parameterReachesBody(
  literal: Expression | undefined,
  i: number
): boolean {
  if (literal === undefined || !isFunction(literal, 'Function')) return true;
  const param = literal.ops[i + 1];
  if (
    param === undefined ||
    isRestParameter(param) ||
    isDestructuringParameter(param)
  )
    return true;
  const name = functionLiteralParameterName(param);
  return name === '' || literal.op1.has(name);
}

/** Whether parameter `i` of the signature `ft` is typed to take a tuple
 * (a tuple, a collection, or any type a tuple inhabits other than the open
 * `unknown`/`any`, which bind a tuple whole as a scalar parameter does). */
function parameterAdmitsTuple(ft: Type, i: number): boolean {
  if (typeof ft !== 'object' || ft.kind !== 'signature') return false;
  const param =
    ft.args?.[i]?.type ??
    ft.optArgs?.[i - (ft.args?.length ?? 0)]?.type ??
    ft.variadicArg?.type;
  if (param === undefined || param === 'unknown' || param === 'any')
    return false;
  if (isSubtype(param, 'number')) return false;
  return true;
}

/**
 * The exponent `k` of `Power(A, k)` when canonicalization writes that power
 * as a matrix power: `A` is typed a matrix and `k` is a number LITERAL with
 * an integer value. `undefined` otherwise. This is the test that
 * `canonicalPower()` (`arithmetic-power.ts`) makes on the expression: a
 * symbol or a function exponent (`A^n`, `A^(n+1)`) is not rewritten there.
 * The empty bottom type `never` is a subtype of every type, so it is
 * excluded before the matrix test.
 */
function matrixPowerLiteralExponent(
  base: OperandDescriptor,
  exponent: OperandDescriptor
): number | undefined {
  if (base.type === 'never' || !isSubtype(base.type, 'matrix'))
    return undefined;
  if (!isSubtype(exponent.type, 'integer')) return undefined;
  const structure = exponent.structureOf?.();
  if (structure?.kind !== 'number') return undefined;
  const rational = structure.rational;
  if (rational === undefined || rational[1] !== 1n) return undefined;
  return Number(rational[0]);
}

/**
 * Whether the operand `d` is provably a scalar number, as canonicalization
 * reads it when it rejects `point + scalar` (`isProvablyScalarNumber`,
 * `collection-utils.ts`): its type is a number type, and it is known only
 * by that type (`describeType`: the type was computed by the derivation, so
 * nothing can retract it), or it is a number literal, or a symbol whose type
 * was declared rather than inferred. An application is not read here: the
 * expression route decides it when it canonicalizes the application, and
 * canonicalization does not count an application of a broadcastable
 * operator over an operand that may be a point.
 */
function isProvablyScalarDescriptor(d: OperandDescriptor): boolean {
  if (!isSubtype(d.type, 'number')) return false;
  if (d.structureOf === undefined) return true;
  const s = d.structureOf();
  return s?.kind === 'number' || (s?.kind === 'symbol' && s.inferred !== true);
}

/**
 * Whether boxing an application of `operator` runs the library `canonical`
 * handler of `operator` (`canonicalAdd`, `canonicalDivide`, …), with the
 * same test as the boxing code (`makeNumericFunction()` in `box.ts`):
 * the definition that the name resolves to is the library definition, or a
 * copy of it that keeps the library `canonical` handler. A user definition
 * that replaces the operator (`ce.declare('Divide', …)`, a `function` named
 * `Divide`) does not run it, and neither does a parameter with the name of
 * the operator.
 */
export function runsLibraryCanonicalForm(
  engine: ComputeEngine,
  operator: string,
  def: BoxedOperatorDefinition
): boolean {
  if (!shadowsLibraryName(engine, operator)) return true;
  if (engine._isShadowedParameter(operator)) return false;
  return numericCanonicalHandlerName(def.canonical) === operator;
}

/**
 * The type of applying `operator` to operands a handler holds only as
 * DESCRIPTORS — the recursive entry point a `type` handler needs to type an
 * application it does not have in hand: the body of a mapping literal
 * (`Map`, `Pipe`), a set comprehension's element, a broadcast per element.
 * Reachable from every `'types'`-shape handler as `context.derive`.
 *
 * The derivation is the handler-visible core of what the engine does for a
 * real application: the operator's own `type` handler answers first (run
 * under the same purity guard as a top-level call, so a state write inside
 * it is reported the same way); otherwise the declared signature's result
 * stands, with a polytype arm instantiated against the operands through
 * the same solver the expression route uses. An operand typed `never` (the
 * empty type) makes the application `never`, as at the call site. A call of
 * a user function literal is typed first by the steps of the call site that
 * type such a call (`BroadcastLiftHooks.lambdaCallType`): its map over a
 * collection operand, a tuple at a declared scalar parameter, and a partial
 * application.
 *
 * Absent operands are handled as at the call site: for a `propagate`
 * operator, an operand whose type carries a `missing` arm is handed to the
 * handler with that arm stripped (a bare `missing` keeps its type), and the
 * result absorbs the absence — every `missing` arm stripped, every numeric
 * cell widened to admit the `NaN` an absent numeric operand contributes.
 * Without that, `Map(k ↦ k + 1, xs)` over `integer | missing` elements
 * would advertise elements no evaluation produces. The one exception is a
 * whole-value absence that reaches a result that is not numeric (a
 * restricted point under `Sin`): the result keeps a `missing` arm, because
 * the value is then `Missing` (`absorbOperandAbsence`).
 *
 * It deliberately stops there. The other boxing-time steps that need the
 * expression — argument validation and its error types, the Contract B
 * widening of a signature result, the broadcast wrap of a threadable
 * operator's declared result — are not reproduced: the handlers that
 * matter for a mapping body (`Add`, `Multiply`, the comparison and
 * collection heads) derive their broadcast shape themselves, and a caller
 * that gets `undefined` keeps its own conservative answer. Reads nothing
 * but definitions and types, so it is pure by construction.
 *
 * Returns `undefined` when `operator` has no operator definition.
 */
export function deriveApplicationType(
  engine: ComputeEngine,
  operator: string,
  operands: ReadonlyArray<OperandDescriptor>,
  ownBinding?: BoxedDefinition
): Type | undefined {
  const binding = ownBinding ?? engine.lookupDefinition(operator);
  if (binding === undefined) return undefined;

  // Coalesce derives reachability itself: a failing fallback may be skipped.
  if (
    !(
      operator === 'Coalesce' &&
      'operator' in binding &&
      binding.operator.selectsOperands
    ) &&
    operands.some((d) => d.type === 'never')
  )
    return 'never';

  // A declared function SYMBOL (`f: (integer) -> real`, a symbol holding a
  // function literal) has no operator definition: its application types from
  // its function type alone, a polytype instantiated against the operands.
  if (!('operator' in binding)) {
    let ft = binding.value.type.type;
    if (typeof ft !== 'object' || ft.kind !== 'signature') {
      // A bare `function` declaration later assigned a literal (the
      // document-manager route of a consumer that declares every function
      // `function` and lets the assignment infer the signature): the
      // declared type says nothing, and the literal's own type is the
      // signature the engine inferred from the body. Without this fallback
      // a call to such a function inside another function's body could not
      // be derived, and the enclosing call fell back to its declared
      // result, in which a pass-through parameter reads `unknown`.
      const literal = binding.value.value;
      const lt = literal === undefined ? undefined : literal.type.type;
      if (typeof lt !== 'object' || lt.kind !== 'signature') return undefined;
      ft = lt;
    }
    // A call of a function literal over a collection operand maps the
    // literal over the collection, and is typed as the expression route
    // types it, before the derivation from the body: that derivation binds
    // the whole collection to the parameter, and its result describes one
    // element of the value (`f := x ↦ (-x, x)` over a `list<integer>` is a
    // `list<tuple<integer, integer>>`, not a `tuple<number, number>`).
    const lambdaCall = broadcastLiftHooks?.lambdaCallType(
      engine,
      operator,
      binding,
      operands
    );
    if (lambdaCall !== undefined) return lambdaCall;
    const inferred = callResultType(
      engine,
      operator,
      operands,
      functionResult(ft) ?? 'unknown',
      (h, a) => deriveApplicationType(engine, h, a),
      binding
    );
    if (inferred !== undefined) return inferred;
    // A numeric tuple binds WHOLE to a parameter the signature types as a
    // scalar or leaves open, and the body's arithmetic then decides the
    // shape of the value (`(a, a)` through `x ↦ (−x, x)` is a pair of
    // pairs), which the signature result, written for a scalar argument,
    // does not describe. The application-site typing of a lambda answers
    // `any` for this case (`lambdaBroadcastType`), and so does this route.
    // A tuple with an open component (`mayBeNumericTupleType`) is one such
    // tuple when the component holds a number, and so is such a tuple with a
    // whole-value `missing` arm (`isNumericTupleArgumentType`).
    if (
      operands.some(
        (d, i) =>
          isNumericTupleArgumentType(d.type) &&
          !parameterAdmitsTuple(ft, i) &&
          parameterReachesBody(binding.value.value, i)
      )
    )
      return 'any';
    return (
      instantiatedResultTypeOverActuals(ft, operands.map(actualOfDescriptor), {
        threadable: true,
        resolver: engine._typeResolver,
      }) ??
      functionResult(ft) ??
      'unknown'
    );
  }
  const def = binding.operator;

  // Canonicalization writes a power of a matrix to an integer literal as
  // the matrix power (`canonicalPower()`, `arithmetic-power.ts`): `A^1` is
  // `A`, `A^-1` is `Inverse(A)`, and any other `A^k` is `MatrixPower(A,
  // k)`. The expression route therefore types the rewritten node, never
  // `Power` over those operands. This route types the same node, so that
  // the two routes give the same type for a matrix base. Without this, the
  // broadcast lift of `Power` typed the power element by element.
  if (operator === 'Power' && operands.length === 2) {
    const k = matrixPowerLiteralExponent(operands[0], operands[1]);
    if (k === 1) return operands[0].type;
    if (k === -1)
      return deriveApplicationType(engine, 'Inverse', [operands[0]]);
    if (k !== undefined)
      return deriveApplicationType(engine, 'MatrixPower', operands);
  }

  // Arithmetic over a tuple with a list coordinate always evaluates to an
  // error, and is typed `error`, as at the call site (`type()` in
  // `boxed-function.ts`, `appliesToListCoordinateTuple`).
  if (
    broadcastLiftHooks !== undefined &&
    appliesToListCoordinateTuple(
      operator,
      broadcastLiftHooks.broadcastsOverTuples(operator, def),
      operands.map((d) => d.type)
    )
  )
    return 'error';
  // A sum of a point (or a list of points) and a collection of numbers is
  // typed `error`, as at the call site (`type()` in `boxed-function.ts`,
  // `addsPointToNumberCollection`). This is the behavior of the library
  // `Add` and `Subtract`: a user definition that replaces the operator
  // gives its own result type (`runsLibraryCanonicalForm`).
  if (
    runsLibraryCanonicalForm(engine, operator, def) &&
    addsPointToNumberCollection(
      operator,
      operands.map((d) => d.type)
    )
  )
    return 'error';
  // A sum of a point (or a list of points) and a scalar number, and a
  // quotient by a point, are rejected at canonicalization (`canonicalAdd`,
  // `canonicalDivide`), so the expression route types them `error`. This
  // route never canonicalizes, so it gives the same answer here: with
  // `f := P ↦ P + Norm(P)`, a call `f((1, 1))` derived from argument types
  // was typed `real | tuple<integer, integer>` for a value that is an
  // error. A scalar counts as canonicalization counts it: an operand known
  // only by its type (a computed type, not a guess), a number literal, or a
  // symbol whose type was not inferred (`isProvablyScalarDescriptor`).
  // The refusal is part of the library `canonical` handlers, so it does not
  // apply when a user definition replaces the operator: the expression route
  // then calls the user definition (`runsLibraryCanonicalForm`).
  if (
    runsLibraryCanonicalForm(engine, operator, def) &&
    isPointArithmeticError(
      operator,
      operands.map((d) => d.type),
      (i) => isProvablyScalarDescriptor(operands[i])
    )
  )
    return 'error';

  const propagate = def.resolvedMissingBehavior === 'propagate';
  // An operand that is the library `Undefined` symbol stands for an absent
  // value in a numeric slot, as `Missing` does (`isAbsentScalarSymbol`,
  // `validate.ts`), so it is typed `missing` here, as at the call site.
  // Its declared type, `unknown`, is dropped by a join, and the result then
  // claimed the type of the present operands.
  if (propagate)
    operands = operands.map((d) => {
      const s = d.structureOf?.();
      return s?.kind === 'symbol' && s.name === 'Undefined'
        ? { type: 'missing', facts: d.facts, structureOf: d.structureOf }
        : d;
    });
  // An operand absent only in its cells, at an operator that reorders or
  // selects cells without computing from them, takes no part in the
  // absorption, as at the call site (`passesAbsentCellsThrough`).
  const passedThrough = operands.map((d) =>
    passesAbsentCellsThrough(operator, d.type)
  );
  // An operand that can be absent as a whole, at such an operator, is typed
  // from its present type, absent cells kept, as at the call site
  // (`absentCellsPresentType`).
  // Only at a position that strips `missing` of an operator that propagates
  // absence, as at the call site.
  const cellsPresent =
    propagate && movesAbsentCells(operator)
      ? operands.map((d, i) =>
          def.stripsMissingAt(i) && typeContainsMissing(d.type)
            ? absentCellsPresentType(operator, d.type)
            : undefined
        )
      : undefined;
  const hasCellsPresent = cellsPresent?.some((t) => t !== undefined) === true;
  const absorbMissing =
    propagate &&
    operands.some(
      (d, i) =>
        // Only a position that strips `missing` (`missingStrip`) makes the
        // result absent, as at the call site.
        def.stripsMissingAt(i) &&
        typeContainsMissing(d.type) &&
        !passedThrough[i]
    );
  // An operator that threads conditional values without propagating absence
  // (`threadsConditionals`): a threaded operand that can be absent as a
  // whole is typed from its present value, and the result of a `handle`
  // operator gains a `missing` arm, as at the call site
  // (`threadedPresentType`).
  const threadedPresent =
    !propagate && def.threadsConditionals !== false
      ? operands.map((d, i) =>
          def.threadsConditionalsAt(i) && typeContainsMissing(d.type)
            ? threadedPresentType(d.type)
            : undefined
        )
      : undefined;
  const threadedPresence =
    threadedPresent?.some((t) => t !== undefined) === true;
  const threadedAbsence =
    threadedPresence && def.resolvedMissingBehavior === 'handle';
  const absorbed = (t: Type): Type => {
    const r = absorbOperandAbsence(
      t,
      // A position that does not strip `missing` (`missingStrip`) takes no
      // part in the absorption, and an operand typed from its present type
      // takes part with its whole absence only, as at the call site.
      operands.map((d, i): Type => {
        if (passedThrough[i] || !def.stripsMissingAt(i))
          return stripMissingFromType(d.type);
        const present = cellsPresent?.[i];
        if (present !== undefined)
          return {
            kind: 'union',
            types: ['missing', stripMissingFromType(present)],
          };
        return d.type;
      }),
      ABSENT_CELLS_STAY_MISSING.has(operator),
      def.broadcastable
    );
    return hasCellsPresent ? withPresentCellAbsence(t, r) : r;
  };
  const absorb = (t: Type): Type =>
    absorbMissing ? absorbed(t) : threadedAbsence ? withThreadedAbsence(t) : t;

  // The operands as the type handler sees them. Set by the main handler call
  // below, and read again by the per-cell calls of the broadcast lift
  // (`cellHandlerResult`), so that every call of the handler sees the same
  // operand types.
  let handlerOperandsSeen: ReadonlyArray<OperandDescriptor> = operands;
  if (typeof def.type === 'function') {
    const handlerOperands = propagate
      ? operands.map((d, i) => {
          if (
            !def.stripsMissingAt(i) ||
            !typeContainsMissing(d.type) ||
            passedThrough[i]
          )
            return d;
          // An operand typed from its present type is given to the handler
          // with that type, as at the call site.
          const present = cellsPresent?.[i];
          if (present !== undefined)
            return {
              type: present,
              facts: d.facts,
              structureOf: d.structureOf,
            };
          // An absent coordinate of a point (a `missing` tuple component) is
          // kept for an operator that reads coordinates, and is `nan` for one
          // that computes with them, as at the call site.
          const stripped = stripMissingFromType(
            d.type,
            ABSENT_CELLS_STAY_MISSING.has(operator) ? 'keep' : 'nan'
          );
          // A bare `missing` strips to `never`; the descriptor keeps its own
          // type there, as at the call site.
          if (stripped === 'never') return d;
          return { type: stripped, facts: d.facts, structureOf: d.structureOf };
        })
      : threadedPresence
        ? operands.map((d, i) => {
            const present = threadedPresent![i];
            return present === undefined
              ? d
              : { type: present, facts: d.facts, structureOf: d.structureOf };
          })
        : operands;
    handlerOperandsSeen = handlerOperands;
    const raw = guardedTypeHandlerCall(engine, operator, () =>
      def.type!(handlerOperands, typeHandlerContext(engine))
    );
    const answered = BoxedType.forResult(raw, engine._typeResolver)?.type;
    if (answered !== undefined)
      return absorb(
        lift(
          withCodomainForAbsentAnswer(
            answered,
            def,
            operands.map((d) => d.type)
          ),
          false
        )
      );
  }

  // A call of a function literal held by an operator definition, over a
  // collection operand: as on the value-definition branch above.
  const lambdaCall = broadcastLiftHooks?.lambdaCallType(
    engine,
    operator,
    binding,
    operands
  );
  if (lambdaCall !== undefined) return lambdaCall;
  const sig = def.signature.type;
  const inferred = callResultType(
    engine,
    operator,
    operands,
    functionResult(sig) ?? 'unknown',
    (h, a) => deriveApplicationType(engine, h, a),
    binding
  );
  if (inferred !== undefined) return absorb(inferred);
  // A function literal held by an operator definition (a literal assigned
  // to an undeclared name): a numeric tuple at a parameter its signature
  // types as a scalar or leaves open binds whole, as on the value-definition
  // branch above, and the signature result does not describe the value. The
  // application-site typing (`lambdaBroadcastType`, `boxed-function.ts`)
  // answers `any` when the result was inferred or is a number type, and
  // keeps any other declared result (a declared tuple result describes the
  // tuple argument). This branch applies the same rule.
  if (
    broadcastLiftHooks?.isLambda(def) === true &&
    (def.inferredSignature ||
      isSubtype(functionResult(sig) ?? 'unknown', 'number')) &&
    operands.some(
      (d, i) =>
        isNumericTupleArgumentType(d.type) &&
        !parameterAdmitsTuple(sig, i) &&
        parameterReachesBody(
          (def as { _lambdaLiteral?: Expression })._lambdaLiteral,
          i
        )
    )
  )
    return 'any';
  // An operand typed from its present type binds the type variables, and
  // takes part in the choice of an overload arm, with that type, as at the
  // call site.
  const solvedOperands = hasCellsPresent
    ? operands.map((d, i) => {
        const present = cellsPresent?.[i];
        return present === undefined
          ? d
          : { type: present, facts: d.facts, structureOf: d.structureOf };
      })
    : operands;
  const actuals: SolveActual[] = solvedOperands.map(actualOfDescriptor);
  const stripsAt = (i: number): boolean =>
    def.stripsMissingAt(i) &&
    !passedThrough[i] &&
    cellsPresent?.[i] === undefined;
  return absorb(
    lift(
      instantiatedResultTypeOverActuals(sig, actuals, {
        threadable: def.broadcastable,
        stripMissing: stripsAt,
        lazy: def.lazy,
        resolver: engine._typeResolver,
      }) ??
        overloadResultType(engine, sig, solvedOperands, actuals, {
          threadable: def.broadcastable,
          stripMissing: stripsAt,
          lazy: def.lazy,
        }) ??
        functionResult(sig) ??
        'unknown',
      true
    )
  );

  // The broadcast lift the expression route applies after its handler
  // (`BoxedFunction.type`, "Honest typing for list broadcast"): a
  // broadcastable operator over a collection operand evaluates element-wise,
  // so the handler's scalar per-element result is re-shaped to the
  // collection. Shared logic, `broadcast-lift-type.ts`.
  // `fromSignature` is `true` when `perElement` is the declared result of
  // the signature, which is solved against the cells of a collection
  // operand, and `false` when a type handler answered it from the whole
  // operands (`BroadcastLiftInput.sigResultIsPerElement`).
  function lift(perElement: Type, fromSignature: boolean): Type {
    const hooks = broadcastLiftHooks;
    if (hooks === undefined) return perElement;
    const mappable = hooks.mappableSlot(def);
    if (!(def.broadcastable || mappable !== 'no-plan')) return perElement;
    if (hooks.isLambda(def)) return perElement;
    const views = operands.map(viewOfDescriptor);
    // The type handler called again with the operands in `cells` typed as
    // one cell of a broadcast (`cells[i]`), for the per-cell results the
    // lift reads, as on the expression route (`BoxedFunction.type`). Every
    // other operand is the descriptor of the main handler call
    // (`handlerOperandsSeen`), and an answer that strips to `never` takes the
    // declared codomain (`withCodomainForAbsentAnswer`), as the main answer
    // does. The facts of a retyped operand are read from its cell type
    // (`describeType`): the operand's own facts describe the whole
    // collection or union, and would contradict the narrower type (a
    // possible collection beside a scalar type).
    // With `byTypeOnly`, a retyped operand is described by its cell type
    // alone, without the operand's structure: the cell is one ARM of a
    // declared union (`armwiseUnionBroadcastResultType`), so it states what
    // the value is, where the structure (an application of `Negate` over
    // the union-typed symbol) would say the value is unproven and keep a
    // handler from rejecting an arm it rejects at boxing.
    const cellHandlerResult = (
      cells: ReadonlyArray<Type | undefined>,
      byTypeOnly = false
    ): Type | undefined => {
      if (typeof def.type !== 'function') return undefined;
      if (cells.every((c) => c === undefined)) return undefined;
      const cellOperands = handlerOperandsSeen.map((d, i) =>
        cells[i] === undefined
          ? d
          : byTypeOnly
            ? describeType(cells[i]!, d.facts.closed)
            : {
                ...describeType(cells[i]!, d.facts.closed),
                structureOf: d.structureOf,
              }
      );
      const raw = guardedTypeHandlerCall(engine, operator, () =>
        def.type!(cellOperands, typeHandlerContext(engine))
      );
      const t = BoxedType.forResult(raw, engine._typeResolver)?.type;
      if (t === undefined) return undefined;
      return withCodomainForAbsentAnswer(
        t,
        def,
        operands.map((d) => d.type)
      );
    };
    return (
      broadcastLiftType({
        def,
        views,
        sigResult: perElement,
        sigResultIsPerElement: fromSignature,
        mappable: mappable === 'no-plan' ? undefined : mappable,
        broadcastsOverTuples: hooks.broadcastsOverTuples(operator, def),
        armwiseTupleArms: hooks.typesTupleArmsAsCells(operator, def),
        hasTensors: views.some((v) => v.tensorShape),
        // The handler typed again with each scalar-or-list union operand
        // typed as its cell, as on the expression route
        // (`BoxedFunction.type`).
        unionCellResult: () =>
          cellHandlerResult(
            operands.map((d) => scalarOrListUnionCellType(d.type))
          ),
        // The handler typed again with each trigger of the abstract
        // collection lift typed as its cell (`abstractCollectionCell`), as
        // on the expression route.
        abstractCellResult: (cells) => cellHandlerResult(cells),
        // The handler typed with each union trigger typed as one of its
        // arms, by type alone (`armwiseUnionBroadcastResultType`).
        armCellResult: (cells) => cellHandlerResult(cells, true),
      }) ?? perElement
    );
  }
}

/**
 * The result type of applying an OVERLOAD SET `sig` (an intersection of
 * signatures) to operands known only by their types. `undefined` when `sig`
 * is not an overload set, or when no arm can take the operands.
 *
 * The expression route resolves an overload set with `resolveOverload`
 * (`overload.ts`), which reads boxed operands. A type handler that types a
 * call it does not hold (the completed call of a pipe stage, `xs |>
 * Take(2)`) has only descriptors, and without this resolution the call was
 * typed `unknown`. The rule is the same as on the expression route, read
 * from types only:
 *
 * - Each generic arm is first solved against the operand types
 *   (`instantiateArmOverActuals`), and the tests below read the solved
 *   parameters. An arm whose bound the operands violate is not taken.
 * - An arm takes the operands when it admits their count, and when no
 *   operand is provably disjoint from the parameter that it binds. An
 *   operand of a lazy operator, an `unknown` or `any` operand, and a
 *   collection operand at a threadable position refute no arm.
 * - When every operand is a subtype of its parameter in every arm that
 *   takes the operands, the types decide the arm, ranked as
 *   `resolveOverload` ranks it: the arm whose solved parameters are more
 *   specific (`isMoreSpecific`) wins, a ground arm wins over a generic arm
 *   with the same solved parameters, and the first one declared wins a tie
 *   that remains. So `((T) -> T where T) & ((number) -> number)` over an
 *   `integer` operand is `integer`: the generic arm solves to `(integer) ->
 *   integer`, which is more specific than `(number) -> number`.
 * - Otherwise the types do not decide the arm, and the result is the join
 *   of the results of every arm that takes the operands. A result `unknown`
 *   makes the join `unknown`, as on the expression route (`resolvedArm`,
 *   `boxed-function.ts`).
 *
 * The result of each arm is its declared result, with the type variables of
 * a generic arm solved against the operands. In the join, a variable that
 * the operands leave unsolved is read as its declared bound.
 */
function overloadResultType(
  engine: ComputeEngine,
  sig: Type,
  operands: ReadonlyArray<OperandDescriptor>,
  actuals: ReadonlyArray<SolveActual>,
  options: {
    threadable: Threadable | undefined;
    stripMissing: (i: number) => boolean;
    lazy: boolean | undefined;
  }
): Type | undefined {
  const arms = overloadArms(sig);
  if (arms === undefined) return undefined;
  const n = operands.length;
  const ctx = { ...options, resolver: engine._typeResolver };
  const taken: {
    arm: FunctionSignature;
    instance: FunctionSignature;
    generic: boolean;
  }[] = [];
  let decided = true;
  for (const arm of arms) {
    const { min, max } = arityBounds(arm);
    if (n < min || n > max) continue;
    const instance = instantiateArmOverActuals(arm, actuals, ctx);
    if (instance === undefined) continue;
    let takes = true;
    let subtypes = true;
    for (let i = 0; i < n && takes; i++) {
      const param = paramAt(instance, i);
      if (param === undefined) {
        takes = false;
        break;
      }
      const t = operands[i].type;
      if (isSubtype(t, param)) continue;
      subtypes = false;
      if (options.lazy || t === 'unknown' || t === 'any') continue;
      if (isThreadableAt(options.threadable, i) && actuals[i].liftable === true)
        continue;
      if (provablyDisjoint(t, param)) takes = false;
    }
    if (!takes) continue;
    if (!subtypes) decided = false;
    taken.push({ arm, instance, generic: isGenericSignature(arm) });
  }
  if (taken.length === 0) return undefined;
  const resultOf = (arm: FunctionSignature): Type =>
    instantiatedResultTypeOverActuals(arm, actuals, {
      ...options,
      resolver: engine._typeResolver,
    }) ??
    functionResult(arm) ??
    'unknown';
  if (decided) {
    // The ranking of `resolveOverload` (`outranks`, `overload.ts`): an arm
    // wins when its instance is more specific, and, when the two instances
    // have the same parameters, a ground arm wins over a generic one. A tie
    // that remains goes to the arm declared first.
    const outranks = (a: (typeof taken)[number], b: (typeof taken)[number]) =>
      isMoreSpecific(a.instance, b.instance, n) ||
      (!a.generic &&
        b.generic &&
        sameParameters(a.instance, b.instance, n) &&
        !isMoreSpecific(b.instance, a.instance, n));
    let selected = taken[0];
    for (const candidate of taken.slice(1))
      if (outranks(candidate, selected)) selected = candidate;
    return resultOf(selected.arm);
  }
  // An operand that does not decide the arm gives no solution to a type
  // variable that it binds, and the solve answers `unknown`. The result of
  // the arm is then read with each variable as its declared bound, as the
  // expression route reads it: `Take(u, 2)` for an `unknown` operand `u` is
  // `list<unknown> | string`.
  const results = taken.map(({ arm }) => {
    const r = resultOf(arm);
    return r === 'unknown'
      ? (functionResult(readTypeVariablesAsBounds(arm)) ?? 'unknown')
      : r;
  });
  if (results.some((r) => r === 'unknown')) return 'unknown';
  return widen(...results);
}

/**
 * The signature `arm` at a call whose operands are `actuals`: each type
 * variable of a generic arm solved against the operands, as the expression
 * route does (`instantiateArm`, `overload.ts`). A variable that the solve
 * leaves open is read as its declared bound. `undefined` when the operands
 * violate a bound of the arm, which the call then cannot take. A ground arm
 * is returned unchanged.
 */
function instantiateArmOverActuals(
  arm: FunctionSignature,
  actuals: ReadonlyArray<SolveActual>,
  ctx: Parameters<typeof solveArmOverActuals>[2]
): FunctionSignature | undefined {
  if (!isGenericSignature(arm)) return arm;
  const solved = solveArmOverActuals(arm, actuals, ctx);
  if (solved.failures.length > 0) return undefined;
  const substituted = substituteTypeVariables(arm, solved.bindings);
  return (
    freeTypeVariables(substituted).size === 0
      ? substituted
      : readTypeVariablesAsBounds(substituted)
  ) as FunctionSignature;
}

/** Whether `arm` has a `where` clause. */
function isGenericSignature(arm: FunctionSignature): boolean {
  return arm.typeParams !== undefined && arm.typeParams.length > 0;
}

/** Whether `a` and `b` have parameters that are subtypes of each other at
 * each of the `n` positions of a call. */
function sameParameters(
  a: FunctionSignature,
  b: FunctionSignature,
  n: number
): boolean {
  for (let i = 0; i < n; i++) {
    const pa = paramAt(a, i);
    const pb = paramAt(b, i);
    if (pa === undefined || pb === undefined) return false;
    if (!isSubtype(pa, pb) || !isSubtype(pb, pa)) return false;
  }
  return true;
}

/** The context every `'types'`-shape handler call receives. */
export function typeHandlerContext(engine: ComputeEngine): TypeHandlerContext {
  return {
    engine,
    derive: (operator, operands) =>
      deriveApplicationType(engine, operator, operands),
  };
}

/** The solver's view of a descriptor: the same five reads
 * `actualOfOperand` makes on an expression, each answered from the
 * descriptor's type, facts and structure. */
export function actualOfDescriptor(d: OperandDescriptor): SolveActual {
  const structure = d.structureOf?.();
  const isTop = d.type === 'unknown' || d.type === 'any';
  return {
    type: d.type,
    literal: structure?.kind === 'number',
    valid: d.type !== 'error',
    inferable:
      structure?.kind === 'symbol' && structure.inferred === true && isTop,
    // A string never lifts (`typeCouldBeUnkeyedCollection` excludes it); a
    // value known to be a finite indexed collection lifts even when its
    // type is a top type. Read on demand, as the field's contract says.
    get liftable(): boolean {
      return (
        typeCouldBeUnkeyedCollection(d.type) ||
        (d.facts.indexed === true && d.facts.finiteCollection === true)
      );
    },
  };
}

/**
 * A type handler that read an ABSENT operand (`Filter(Missing, p)`; the
 * descriptor of a bare `Missing` keeps its own type) often answers `missing`
 * alone, which strips to `never`, a subtype of everything: the absorption
 * then read it as numeric and typed `Filter(Missing, p)` as `number`, so its
 * marker was `NaN` instead of `Missing`. When the signature's declared result
 * is a COLLECTION or a point, that is the codomain of such an answer
 * (`missing | collection` for `Filter`), and the absorption reads it
 * correctly. A numeric codomain keeps the absorption's reading (`Negate` of an
 * absent operand is a `number`, its marker `NaN`), and a boolean one keeps the
 * handler's own answer (a comparison with `Missing` is `missing`, Kleene).
 */
export function withCodomainForAbsentAnswer(
  answered: Type,
  def: { signature: { type: Type } },
  operandTypes: ReadonlyArray<Type>
): Type {
  if (stripMissingFromType(answered) !== 'never') return answered;
  // Only when an operand IS absent (typed `missing`, or `never` as a symbol
  // assigned `Missing` is): a handler may answer `never` for a reason of its
  // own — a contradiction it wants surfaced — and that answer is left alone.
  if (
    !operandTypes.some(
      (t) => t === 'never' || stripMissingFromType(t) === 'never'
    )
  )
    return answered;
  // A polymorphic signature (`-> collection where T`) reads its result
  // through the bounds of its type variables.
  const declared = functionResult(
    readTypeVariablesAsBounds(def.signature.type)
  );
  if (declared === undefined) return answered;
  if (
    !isSubtype(declared, COLLECTION_SHAPE_TYPE) &&
    !isTupleShapedType(declared)
  )
    return answered;
  return reduceType({ kind: 'union', types: ['missing', declared] });
}

installOperatorCalleeDerivation((engine, head, args, definition) =>
  deriveApplicationType(engine, head, args, { operator: definition })
);
