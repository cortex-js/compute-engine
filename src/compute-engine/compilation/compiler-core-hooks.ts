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
  ConditionDialect,
  ConditionNode,
  DeclineNote,
  ElementLane,
  FoldCostContext,
  UserFunctionRegistry,
} from './compiler-types.js';

/** The signatures of the compiler core's hub functions; see `core`. */
export interface CoreHooks {
  compile(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec?: number
  ): TargetSource;
  isComplexValued(expr: Expression): boolean;
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
  constantFoldValue(
    expr: Expression,
    target: CompileTarget<Expression>
  ): { value: Expression; elements: Expression[] | undefined } | undefined;
  conditionNode(
    cond: Expression,
    canBind: boolean,
    target?: CompileTarget<Expression>
  ): ConditionNode | null;
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
  kleeneConditionParts(
    node: ConditionNode,
    target: CompileTarget<Expression>,
    dialect: ConditionDialect
  ): { code: TargetSource; decided: boolean };
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
  isComplexValued: notInstalled('isComplexValued'),
  foldCostEstimate: notInstalled('foldCostEstimate'),
  linearAlgebraOperandLane: notInstalled('linearAlgebraOperandLane'),
  bigOpBoundConstant: notInstalled('bigOpBoundConstant'),
  compileExpr: notInstalled('compileExpr'),
  unprovenRadicalCount: notInstalled('unprovenRadicalCount'),
  compileLoopBody: notInstalled('compileLoopBody'),
  shaderSelectionStatement: notInstalled('shaderSelectionStatement'),
  elementComplexness: notInstalled('elementComplexness'),
  operandElementLane: notInstalled('operandElementLane'),
  constantFoldValue: notInstalled('constantFoldValue'),
  conditionNode: notInstalled('conditionNode'),
  noteLocalComplex: notInstalled('noteLocalComplex'),
  walkMatchShape: notInstalled('walkMatchShape'),
  walkConstructorPattern: notInstalled('walkConstructorPattern'),
  kleeneConditionParts: notInstalled('kleeneConditionParts'),
  emitFunctionLiteralDefinition: notInstalled('emitFunctionLiteralDefinition'),
  ensureUserFunctionEmitted: notInstalled('ensureUserFunctionEmitted'),
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
