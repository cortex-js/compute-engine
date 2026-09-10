import { callResultType } from './call-result-type.js';
import type {
  BoxedOperatorDefinition,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
  TypeHandlerContext,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import {
  absorbNumericAbsence,
  functionResult,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { typeCouldBeUnkeyedCollection } from '../collection-utils.js';
import { guardedTypeHandlerCall } from './operand-descriptor.js';
import {
  instantiatedResultTypeOverActuals,
  type SolveActual,
} from './generic-instantiation.js';
import { broadcastLiftType, viewOfDescriptor } from './broadcast-lift-type.js';

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
  /** A lambda-literal definition, typed by its own broadcast arm. */
  readonly isLambda: (def: BoxedOperatorDefinition) => boolean;
}
let broadcastLiftHooks: BroadcastLiftHooks | undefined;
export function installBroadcastLiftHooks(hooks: BroadcastLiftHooks): void {
  broadcastLiftHooks = hooks;
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
 * empty type) makes the application `never`, as at the call site.
 *
 * Absent operands are handled as at the call site: for a `propagate`
 * operator, an operand whose type carries a `missing` arm is handed to the
 * handler with that arm stripped (a bare `missing` keeps its type), and the
 * result absorbs the absence — every `missing` arm stripped, every numeric
 * cell widened to admit the `NaN` an absent numeric operand contributes.
 * Without that, `Map(k ↦ k + 1, xs)` over `integer | missing` elements
 * would advertise elements no evaluation produces.
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
  operands: ReadonlyArray<OperandDescriptor>
): Type | undefined {
  const binding = engine.lookupDefinition(operator);
  if (binding === undefined) return undefined;

  if (operands.some((d) => d.type === 'never')) return 'never';

  // A declared function SYMBOL (`f: (integer) -> real`, a symbol holding a
  // function literal) has no operator definition: its application types from
  // its function type alone, a polytype instantiated against the operands.
  if (!('operator' in binding)) {
    const ft = binding.value.type.type;
    if (typeof ft !== 'object' || ft.kind !== 'signature') return undefined;
    const inferred = callResultType(
      engine,
      operator,
      operands,
      functionResult(ft) ?? 'unknown',
      (h, a) => deriveApplicationType(engine, h, a)
    );
    if (inferred !== undefined) return inferred;
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

  const propagate = def.resolvedMissingBehavior === 'propagate';
  const absorbMissing =
    propagate && operands.some((d) => typeContainsMissing(d.type));
  const absorb = (t: Type): Type =>
    absorbMissing ? absorbNumericAbsence(t) : t;

  if (typeof def.type === 'function') {
    const handlerOperands = propagate
      ? operands.map((d, i) => {
          if (!def.stripsMissingAt(i) || !typeContainsMissing(d.type)) return d;
          const stripped = stripMissingFromType(d.type);
          // A bare `missing` strips to `never`; the descriptor keeps its own
          // type there, as at the call site.
          if (stripped === 'never') return d;
          return { type: stripped, facts: d.facts, structureOf: d.structureOf };
        })
      : operands;
    const raw = guardedTypeHandlerCall(engine, operator, () =>
      def.type!(handlerOperands, typeHandlerContext(engine))
    );
    const answered = BoxedType.forResult(raw, engine._typeResolver)?.type;
    if (answered !== undefined) return absorb(lift(answered));
  }

  const sig = def.signature.type;
  const inferred = callResultType(
    engine,
    operator,
    operands,
    functionResult(sig) ?? 'unknown',
    (h, a) => deriveApplicationType(engine, h, a)
  );
  if (inferred !== undefined) return absorb(inferred);
  const actuals: SolveActual[] = operands.map(actualOfDescriptor);
  return absorb(
    lift(
      instantiatedResultTypeOverActuals(sig, actuals, {
        threadable: def.broadcastable,
        stripMissing: (i) => def.stripsMissingAt(i),
        lazy: def.lazy,
        resolver: engine._typeResolver,
      }) ??
        functionResult(sig) ??
        'unknown'
    )
  );

  // The broadcast lift the expression route applies after its handler
  // (`BoxedFunction.type`, "Honest typing for list broadcast"): a
  // broadcastable operator over a collection operand evaluates element-wise,
  // so the handler's scalar per-element result is re-shaped to the
  // collection. Shared logic, `broadcast-lift-type.ts`.
  function lift(perElement: Type): Type {
    const hooks = broadcastLiftHooks;
    if (hooks === undefined) return perElement;
    const mappable = hooks.mappableSlot(def);
    if (!(def.broadcastable || mappable !== 'no-plan')) return perElement;
    if (hooks.isLambda(def)) return perElement;
    const views = operands.map(viewOfDescriptor);
    return (
      broadcastLiftType({
        def,
        views,
        sigResult: perElement,
        mappable: mappable === 'no-plan' ? undefined : mappable,
        broadcastsOverTuples: hooks.broadcastsOverTuples(operator, def),
        hasTensors: views.some((v) => v.tensorShape),
      }) ?? perElement
    );
  }
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
