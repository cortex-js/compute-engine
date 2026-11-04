// The record through which every handler module calls back into the compiler
// core (compile, compileExpr, and the other hubs of the mutual recursion),
// filled by compiler-core.ts when it loads.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Type } from '../../common/type/types.js';
import type { ShapeNode } from '../boxed-expression/match-dispatch.js';
import type { CompileTarget, InvariantPrefix, TargetSource } from './types.js';
import type {
  DeclineNote,
  ElementLane,
  FoldCostContext,
  UnsettledShape,
  UserFunctionRegistry,
} from './compiler-types.js';

/** The signatures of the compiler core's hub functions; see `core`. */
export interface CoreHooks {
  compile(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec?: number
  ): TargetSource;
  /** The part of the admission check of the root of a compilation that
   * runs before the code is generated: it gives the value with no settled
   * shape, if any. */
  unsettledShapeIn(
    expr: Expression,
    target: CompileTarget<Expression>,
    staticTypeErrors?: boolean
  ): UnsettledShape | undefined;
  /** The code of a root that reads an input declared with a union of
   * shapes: one body per member, each compiled by `emit` (by default
   * `compile()`), joined by the run-time tests of the shapes of the
   * inputs. `undefined` when no such input is read, or when a member body
   * declines. */
  compileDeclaredUnionDispatch(
    expr: Expression,
    target: CompileTarget<Expression>,
    emit?: (body: Expression) => TargetSource
  ): TargetSource | undefined;
  /** The admission check of the root of a compilation that runs after the
   * code was generated: it throws a decline for the value with no settled
   * shape that `unsettledShapeIn()` gave, or for an input with no type. */
  assertAdmitted(
    expr: Expression,
    target: CompileTarget<Expression>,
    unsettled: UnsettledShape | undefined
  ): void;
  /** Decline the outermost compilation in progress now, for the value with
   * no settled shape that `assertAdmitted()` would decline for after the
   * code was generated, when there is one
   * (`throwPendingUnsettledShape()`, `compile-admission.ts`). */
  throwPendingUnsettledShape(): void;
  /** The inputs with no type of `expr`, from its reference analysis
   * (`untypedInputsOf()`, `compile-admission.ts`). */
  untypedInputsOf(
    expr: Expression,
    target: CompileTarget<Expression>,
    freeSymbols: ReadonlyArray<string>,
    occurrences: ReadonlyMap<string, Expression>
  ): string[];
  isComplexValued(expr: Expression): boolean;
  /** The lane on which the emitted JavaScript definition `name` reads each
   * of its parameters (`UserFunctionLanes.paramsByName`), or `undefined`
   * when the definition has no record. */
  userFunctionParamLanes(
    registry: UserFunctionRegistry,
    name: string
  ): ReadonlyArray<boolean | undefined> | undefined;
  foldCostEstimate(
    expr: Expression,
    depth?: number,
    ctx?: FoldCostContext
  ): number;
  linearAlgebraOperandLane(a: Expression): 'real' | 'complex' | 'wide';
  bigOpBoundConstant(
    expr: Expression | undefined,
    target?: CompileTarget<Expression>
  ): number | undefined;
  compileExpr(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    prec: number,
    target: CompileTarget<Expression>,
    node?: Expression
  ): TargetSource;
  unprovenRadicalCount(
    engine: ComputeEngine,
    body: Expression,
    registry: UserFunctionRegistry,
    visiting: Set<string>
  ): number;
  compileLoopBody(expr: Expression, target: CompileTarget<Expression>): string;
  shaderSelectionStatement(
    stmt: Expression,
    target: CompileTarget<Expression>
  ): string | undefined;
  elementComplexness(collection: Expression): boolean[] | undefined;
  operandElementLane(
    a: Expression,
    engine: ComputeEngine,
    target: CompileTarget<Expression>
  ): ElementLane;
  /** Whether the scalar closure of an element-wise broadcast of `h` over
   * `args` returns a `{re, im}` object (`elementwiseClosureIsComplex()`,
   * `compile-broadcast.ts`). */
  elementwiseClosureIsComplex(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    argIsComplex: ReadonlyArray<boolean>,
    target: CompileTarget<Expression>
  ): boolean;
  constantFoldValue(
    expr: Expression,
    target: CompileTarget<Expression>
  ): { value: Expression; elements: Expression[] | undefined } | undefined;
  noteLocalComplex(arg: Expression, frame: Map<string, boolean>): void;
  walkMatchShape(
    engine: ComputeEngine,
    node: ShapeNode,
    base: string,
    conds: string[],
    accessors: Map<string, string>,
    target: CompileTarget<Expression>,
    sequenceNames?: Set<string>
  ): void;
  walkConstructorPattern(
    engine: ComputeEngine,
    p: Expression,
    base: string,
    conds: string[],
    accessors: Map<string, string>,
    bound: Set<string>,
    target: CompileTarget<Expression>
  ): boolean;
  emitFunctionLiteralDefinition(
    h: string,
    literal: Expression & FunctionInterface,
    target: CompileTarget<Expression>,
    registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
    specialization?: {
      key: string;
      types: readonly Type[];
      pointWidths?: readonly (number | undefined)[];
    },
    prefixed?: {
      key: string;
      prefixes: ReadonlyArray<InvariantPrefix<Expression>>;
    }
  ): string | undefined;
  ensureUserFunctionEmitted(
    engine: ComputeEngine,
    h: string,
    target: CompileTarget<Expression>,
    decline?: DeclineNote
  ): string | undefined;
  /** The local name of the member variant of a function whose declared
   * signature has a union of shapes, for arguments whose static shapes
   * select one member at each such parameter. */
  declaredUnionMemberVariant(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): string | undefined;
  /** The static type of `a` for a consumer that reads its shape or its
   * rank: the type of `a`, or for a call of a user function whose type does
   * not settle a rank, the result type of its variant (`staticTypeOf()` in
   * `compiler-core.ts`). */
  staticTypeOf(a: Expression, target: CompileTarget<Expression>): Type;
  /** The result type of the variant of the function literal `literal`
   * for arguments of the types `argTypes`. */
  literalVariantResultType(
    literal: Expression & FunctionInterface,
    argTypes: ReadonlyArray<Type>,
    scalarParams: boolean
  ): Type | undefined;
  aggregateComponentCount(
    expr: Expression | null,
    memo?: Map<Expression, number | undefined>
  ): number | undefined;
  withLocalShapeFrame<T>(
    complex: Map<string, boolean>,
    vector: Map<string, number>,
    fn: () => T,
    isolate?: boolean,
    owner?: Expression
  ): T;
  realOperandGuard(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    emit: () => TargetSource,
    resultKind: 'boolean' | 'number' | 'color'
  ): TargetSource | undefined;
  promotesRadicalToComplex(
    head: MathJsonSymbol,
    args: ReadonlyArray<Expression>
  ): boolean;
  withCallerBindingsHidden<T>(fn: () => T): T;
  _compileInner(
    expr: Expression,
    target: CompileTarget<Expression>,
    prec?: number
  ): TargetSource;
  compileWithCse(
    expr: Expression,
    target: CompileTarget<Expression>,
    prec: number
  ): TargetSource;
  ensureSpecializedUserCallEmitted(
    engine: ComputeEngine,
    h: string,
    literal: Expression & FunctionInterface,
    args: readonly Expression[],
    target: CompileTarget<Expression>
  ):
    | {
        name: string;
        scalarDefinition: boolean;
        listArgument: boolean;
        bindsListsWhole: boolean;
        /** The specialization key, for a range specialization only. */
        rangeKey?: string;
        absentPointAt: number;
      }
    | undefined;
  pruneUnreferencedVariantBases(
    registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
    rootCode: string
  ): void;
  hasCodeOverride(expr: Expression): boolean;
}

/**
 * The hub functions of the compiler core (`compiler-core.js`), which every
 * handler module calls back into. The core module fills this record when it
 * loads, so the handler modules import this small module, never the core,
 * and the import graph has no cycle. Until the core module loads, each hub is
 * a stub that throws an error naming the hub.
 */
export const core: CoreHooks = {
  compile: notInstalled('compile'),
  compileDeclaredUnionDispatch: notInstalled('compileDeclaredUnionDispatch'),
  isComplexValued: notInstalled('isComplexValued'),
  userFunctionParamLanes: notInstalled('userFunctionParamLanes'),
  foldCostEstimate: notInstalled('foldCostEstimate'),
  linearAlgebraOperandLane: notInstalled('linearAlgebraOperandLane'),
  bigOpBoundConstant: notInstalled('bigOpBoundConstant'),
  compileExpr: notInstalled('compileExpr'),
  unprovenRadicalCount: notInstalled('unprovenRadicalCount'),
  compileLoopBody: notInstalled('compileLoopBody'),
  shaderSelectionStatement: notInstalled('shaderSelectionStatement'),
  elementComplexness: notInstalled('elementComplexness'),
  operandElementLane: notInstalled('operandElementLane'),
  elementwiseClosureIsComplex: notInstalled('elementwiseClosureIsComplex'),
  constantFoldValue: notInstalled('constantFoldValue'),
  noteLocalComplex: notInstalled('noteLocalComplex'),
  walkMatchShape: notInstalled('walkMatchShape'),
  walkConstructorPattern: notInstalled('walkConstructorPattern'),
  emitFunctionLiteralDefinition: notInstalled('emitFunctionLiteralDefinition'),
  ensureUserFunctionEmitted: notInstalled('ensureUserFunctionEmitted'),
  declaredUnionMemberVariant: notInstalled('declaredUnionMemberVariant'),
  staticTypeOf: notInstalled('staticTypeOf'),
  literalVariantResultType: notInstalled('literalVariantResultType'),
  aggregateComponentCount: notInstalled('aggregateComponentCount'),
  withLocalShapeFrame: notInstalled('withLocalShapeFrame'),
  realOperandGuard: notInstalled('realOperandGuard'),
  promotesRadicalToComplex: notInstalled('promotesRadicalToComplex'),
  withCallerBindingsHidden: notInstalled('withCallerBindingsHidden'),
  _compileInner: notInstalled('_compileInner'),
  compileWithCse: notInstalled('compileWithCse'),
  ensureSpecializedUserCallEmitted: notInstalled(
    'ensureSpecializedUserCallEmitted'
  ),
  pruneUnreferencedVariantBases: notInstalled('pruneUnreferencedVariantBases'),
  hasCodeOverride: notInstalled('hasCodeOverride'),
} as unknown as CoreHooks;

function notInstalled(name: string): never {
  return (() => {
    throw new Error(
      'compiler core hook ' +
        name +
        ' is not installed: import compiler-core.js (or base-compiler.js) first'
    );
  }) as never;
}
