// The compiler's former single file. It keeps the class name BaseCompiler as a
// facade whose static members forward to the modules that now hold the code,
// and re-exports the items it exported before, so importers keep working. New
// code imports an item from the module that defines it.

// Loading this module installs the compiler core: compiler-core.ts fills the hub
// record of compiler-core-hooks.ts when it loads, and nothing else imports it.
import './compiler-core.js';
import {
  isBroadcastablePointType,
  isNestedPointCollectionType,
  leafwardElementType,
  pointCollectionElementType,
} from '../collection-utils.js';
import {
  ABSENCE_DISCHARGING_HEADS,
  ARITHMETIC_HEADS,
  BINARY_INFIX_VALUE_OPERATORS,
  BUILTIN_FOLD_HEADS,
  COLLECTION_HOLDING_HEADS,
  COMPLEX_PROPAGATING_HEADS,
  COMPLEX_TRANSPARENT_HEADS,
  CONTROL_FLOW_HEADS,
  DECLARED_TOP_GUARD_HEADS,
  ELEMENTWISE_TUPLE_EXEMPT_HEADS,
  ELEMENTWISE_WIDTH_OPERATORS,
  EXACT_EXPONENT_HEADS,
  EXPENSIVE_PREFIX_HEADS,
  FOLD_CHARS_PER_NODE,
  FOLD_OPERAND_PREC,
  LOGICAL_BROADCAST_HEADS,
  MAX_FOLD_EXPANDED_NODES,
  NAMED_LOWERING_HEADS,
  NAN_PROPAGATING_BROADCAST_HEADS,
  NON_PROMOTING_ELEMENTWISE_HEADS,
  ORDERING_HEADS,
  OVERRIDABLE_CONTROL_FLOW_HEADS,
  PLAIN_BROADCASTS,
  PLAIN_BROADCAST_MEMO_LIMIT,
  REAL_BY_DEFINITION_HEADS,
  REAL_ONLY_BY_DEFINITION,
  REPEATABLE_SOURCE,
  SCALAR_ARITHMETIC_HEADS,
  STRUCTURAL_HEADS,
  TUPLE_ARITHMETIC_HEADS,
  WORD_KEYWORD_OPERATORS,
} from './compiler-tables.js';
import {
  _compileParents,
  _cseInlineCode,
  assertAssignmentIsStatement,
  assertExpressionValue,
  assertNoStatementOperand,
  builtinCallbackRefusal,
  canHoist,
  compileFunctionBody,
  compileListStatement,
  compileParents,
  compileRoot,
  compileStatementBody,
  compileValueOperand,
  hoistStatement,
  isBinaryInfixValueOperator,
  isUserDefinedFunction,
  joinShaderStatements,
  loopBodyTempTarget,
  recordFoldedPromotions,
  shaderExpressionStatement,
  snapshotCseInstances,
  statementLines,
  statementListDeclaredVarTypes,
  userFunctionValueRefRefusal,
  withStatementRecompile,
  withVarsMappedUserFunctionHeads,
} from './compile-statements.js';
import {
  ABSENCE_AS_NAN_OPERATORS,
  ATOMIC_FRAGMENT,
  _guardEmitting,
  _localNameKeys,
  _localValueFrames,
  _truthOnly,
  absenceAxisForType,
  absenceKind,
  absentComparisonGuard,
  absentDomainIsObject,
  absentOnlyThroughNumericSlots,
  blockInputs,
  blockLocalOf,
  blockLocalsNamed,
  catchNoValue,
  clearNoValue,
  collectionReadInputs,
  compileAbsentRelation,
  compileExactCondition,
  compileGuardTest,
  conditionDecidability,
  connectiveNode,
  exactSelect,
  findDependentLocals,
  guardTakesOperands,
  hasEffectNode,
  isAbsenceSymbol,
  isBooleanBindingType,
  isDecidedByConstruction,
  isInnerBinderRead,
  isNanLiteral,
  isNumericOrVerdictShaped,
  isNumericShaped,
  isObjectDomainMissingOperand,
  isOmittableRead,
  isTopTypedOperand,
  isUnsetLocalRead,
  isVarsObjectRead,
  kleeneRelationLeaf,
  kleeneValueLeaf,
  lazyChain,
  localDependsOnInputs,
  markTruthOnlyNode,
  mayBeUndecided,
  mayHoldFunctionType,
  mayReturnFunction,
  nanCanDecide,
  nanEscapeTerms,
  noBranchValue,
  operandDecidedConjuncts,
  operandInputNodes,
  operandMayBeAbsent,
  peelNegations,
  poisonSlot,
  presenceTest,
  readsAbsenceAsNaN,
  scalarOperandKind,
  testsFirst,
  truthOnlyEligible,
  unsuppliedComparisonGuard,
  unsuppliedReads,
  userFunctionSignature,
  withBoundOperands,
  withConditionOperands,
  withNanEscape,
  withNanTerms,
  withTruthOnly,
} from './compile-absence.js';
import {
  _blockStatements,
  _provingLocals,
  absentCollectionOperandGuard,
  appliedLiteralCheckedCall,
  argumentProvesParameterType,
  assertBuiltinCallbackUsable,
  assertCallbackLaneMatch,
  assertCapturedCallableBindings,
  assertUserFunctionFreeBindings,
  assignmentsProveType,
  beginRootPreprocessing,
  bodyWithArguments,
  checkUserCallArity,
  checkedCallMayBeAbsent,
  complexElementCallbackEta,
  declaredParameterCheck,
  declaredScalarTupleCall,
  intervalCheckingCallee,
  intervalParameterDomain,
  localCheckingCallee,
  localParameterChecks,
  mayBeAbsentCollection,
  mayBeAbsentCollectionNode,
  parameterCheckNeeded,
  registryHelperName,
  staticTypeIsEvidence,
  tryCompileLocalFunctionCall,
  tryCompileUserFunction,
  uncheckedParameterError,
} from './compile-user-functions.js';
import {
  ANTIDERIVATIVE_ATTEMPT_STEPS,
  ANTIDERIVATIVE_COMPILATION_HANG_MS,
  ANTIDERIVATIVE_COMPILATION_STEPS,
  CompilerState,
} from './compiler-state.js';
import {
  KIND_OPAQUE_HEADS,
  compileKindOperation,
  kindLoweringOf,
  kindLoweringReport,
} from './compile-kinds.js';
import { core, type CoreHooks } from './compiler-core-hooks.js';
import {
  PROMOTABLE_RADICAL_HEADS,
  _codeAliases,
  _codeOverrides,
  _prefixCallOverrides,
  _presentReads,
  _pushComplexMemoLayer,
  _runtimeMatrixPowerBases,
  _withFoldedRealOverride,
  hasPromotedDefinition,
  isPresentRead,
  isRealOnlyLowering,
  isRealOnlyLoweringHead,
  liftPromotionSuppression,
  mentionsAnyName,
  mode,
  notePromoted,
  oracleFoldTarget,
  rebindsAnyName,
  recordPromotion,
  restorePromotionSuppression,
  runtimeRealGuards,
  strictLanes,
  stringHelperIsRealOnly,
  unrolledIndexValueFold,
  wideIsComplex,
  wideNumericType,
  withPresentReads,
  withPromotionSuppressed,
  withPromotionUnsuppressed,
} from './compiler-mode.js';
import {
  LOCAL_SCALAR,
  _enterUnrolledIndexBinder,
  _exitUnrolledIndexBinder,
  _keyedMemoLayers,
  _popComplexMemoLayer,
  _popKeyedComplexMemoLayer,
  _pushKeyedComplexMemoLayer,
  assertCallbackAnnotations,
  assertLeafAssignable,
  assertLockstepSourcesPure,
  assertNoDestructuringParams,
  assertNoRestParams,
  callbackLiteral,
  collectionElementTypeOf,
  collectionFoldsReal,
  complexDiscipline,
  declareTypeOperand,
  declareValueOperand,
  declaredTypeSource,
  destructureViaTemp,
  desugarPatternAssign,
  desugarPatternDeclare,
  elementsRealByConstruction,
  enforcedLocalTargets,
  enforcedParamTargets,
  foldAccumulatorArgType,
  foldsCollectionElements,
  modePromotes,
  promotionActive,
  typedTemp,
  unwrappedFunctionBody,
  userCallMask,
  withBinderMask,
  withEnforcedParams,
  zipCallbackArgTypes,
} from './compile-declarations.js';
import {
  LANE_RECORD_LANGUAGES,
  _operandElementLane,
  ascriptionText,
  callerOverrides,
  complexLoweringOf,
  emitWithRecursiveLaneRetry,
  hasAnyComplexElement,
  isCollectionFold,
  isElementwiseBroadcastHead,
  isProvablyNonReal,
  isRealScalarAscription,
  laneMismatch,
  liftWideReference,
  linearAlgebraLane,
  linearAlgebraLaneOperands,
  realAscriptionError,
  realEntriesType,
  realGuardCandidate,
  realOnlyGuardOperands,
  realOperandChain,
  recordUserFunctionLane,
  resolveCompileMode,
  structuralOperandLane,
  takesComplexResultLowering,
  typeHasComplexLeaf,
  userCallDefinition,
  userCallElementLane,
  userCallLane,
  userParamBinding,
  wideEntriesType,
  withBoundVarsOf,
} from './compile-lanes.js';
import {
  _broadcastRadicalVerdict,
  assumedRealNonNegative,
  constantPoleOrdering,
  eulerPiSplit,
  fixedLogBase,
  hasNonIntegerRealCell,
  imaginaryPiMultiple,
  isArrayOperand,
  isConstantPole,
  isLibraryPi,
  isNameBoundByCompilation,
  knownExponentPower,
  libraryBoundConstantHidden,
  negativeBaseFloatPower,
  piMultiple,
  realPowerExponent,
  realRootDegreeTerms,
  unrolledIndexValuesProveNonNegative,
  withoutNaNMember,
} from './compile-real-analysis.js';
import {
  DISPATCHING_BROADCAST_HEADS,
  _boundLocals,
  _complexValueInProgress,
  _isComplexValuedFunction,
  _resetComplexMemoTop,
  _setLocalComplex,
  binderParts,
  broadcastLeafComplexness,
  checkNestedComplexRebinding,
  collectionConstructorBody,
  continuesToComplex,
  declaredTypeIsReal,
  dispatchingScalarBody,
  hasComplexContinuationLowering,
  hasShadowingCompileHandler,
  isBlockValueComplexValued,
  isComplexValuedElementAt,
  isComplexValuedUnderIndices,
  localComplexDefault,
  localIsBound,
  markLocalBound,
  mayHoldComplexElement,
  withCollectionElements,
  withLoopIndexLowerBound,
  withRealLoopIndices,
  withUnrolledIndexValues,
} from './compile-complexness.js';
import {
  _userFunctionLanes,
  addCompileHelpers,
  addDeclaredComplexParams,
  builtinCallbackValueRef,
  compileCollectionValueBlock,
  compileDefinitionBody,
  emitListRecursionLoop,
  ensureBuiltinCallbackEmitted,
  ensureHostOperatorCallbackEmitted,
  lambdaParamBinding,
  mayBeCollectionValued,
  prepareUserFunctionBody,
  recordCallerHandlerCode,
  recordScalarParams,
  removeDefinitionsAddedSince,
  setUserFunctionLane,
  shadowedLibraryLoweringError,
  tryEmitMultiClauseFunction,
  userFunctionLanes,
  userFunctionsPreamble,
} from './compile-definitions.js';
import {
  appliedArgumentTypeMismatch,
  appliedDerivativeDeclineReason,
  appliedDerivativeLiteral,
  appliedDerivativeTooLarge,
  broadcastingWrapper,
  cachedLiteralWithParameterTypes,
  callOnlyLocalFunctionLiterals,
  checkedParameterType,
  checkingShimName,
  checkingShimTests,
  combinerPlan,
  compileCombinerLiteral,
  complexCoercingWrapper,
  declaredParamType,
  ensureUserFunctionValueRef,
  failedCheckMarker,
  foldLaneIsComplex,
  hasUniformComplexScalarElements,
  jsClauseParamGuard,
  jsCollectionShapeGuard,
  jsParameterGuard,
  laneMismatchAt,
  laneRequestParamType,
  lastCallMemoEligible,
  listSpecializedValueRef,
  literalDeclaredParamTypes,
  literalWithParameterTypes,
  markScalarFedLiterals,
  multiClauseValueRef,
  parameterTypesKey,
  scalarFedLiterals,
  uniformElementComplexness,
  userFunctionSignatureIsInferred,
  withDerivativeArgument,
  withScalarFedLiteral,
} from './compile-callbacks.js';
import {
  assertNoAmbiguousComplexElementRead,
  containsNonFiniteLiteral,
  containsUnboundedBigOp,
  hasMixedElementComplexness,
  isCompileBoundName,
  isGatherIndex,
  isTabulateWithNonPositiveDimension,
  mentionsCompileBoundName,
  mentionsExcludedName,
  reachesExcludedName,
  symbolOccursFree,
} from './compiler-names.js';
import {
  SHIFT_JUMP_HEADS,
  _invalidateComplexMemo,
  assertSafeBigOpBounds,
  bigOpBoundValue,
  bigOpIterations,
  bigOpTripCount,
  callbackApplicationCost,
  calleeBodyCost,
  closedExactJump,
  emitFoldedValue,
  exactFoldCallbackRanges,
  exactFoldCollectionSize,
  exactFoldOperandFits,
  exactFoldValue,
  foldCapturedName,
  foldValueBlocked,
  foldValueCaptured,
  foldValueImpure,
  foldValueMentions,
  foldableCollectionElements,
  foldedRealNumber,
  hasObservableEffect,
  hasUnknowns,
  inlineFoldKeepsOwnerScope,
  inlineFoldTarget,
  jumpShiftRewrite,
  nameReachesAbsArg,
  numericRangeOf,
  parametersCanBeTyped,
  reachesAbsArg,
  realBoundOf,
  recordJumpFoldReads,
  resetCompilationMemos,
  staticCollectionSize,
  tryConstantFold,
  unsafeIntegerOperands,
} from './compile-folding.js';
import {
  ANTIDERIVATIVE_ATTEMPT_HANG_MS,
  MAX_ANTIDERIVATIVE_TIMEOUT_RECORDS,
  antiderivativeKey,
  antiderivativeStateStamp,
  antiderivativeTimeouts,
  closedFormIntegral,
  definitionIds,
  integrandLambda,
  nameHasAngularDefinition,
  readsAngularDefinition,
  recordedTypeLists,
  referencesVarsSymbol,
  resetSharedCompilationBudgets,
  setAntiderivativeAttemptBudgetForTesting,
  shadowedOperandSymbols,
  storedDefinitions,
} from './compile-integrals.js';
import {
  appliesToEachTupleCoordinate,
  compileExprOperator,
  compileLocallyBoundLibraryCall,
  findShadowedLibraryLowering,
  isBroadcastExemptTupleOperand,
  isHypotPointLeg,
  isScalarElementSource,
  isTupleOfTuples,
  realOnlyResultKind,
  rotationView,
  spliceSpreadOperands,
  withRepeatableSource,
} from './compile-operators.js';
import {
  OMITTING_NUMERIC_AGGREGATES,
  assertCollectionOmissionSupported,
  assertHeldValueType,
  assertNoProvedAbsentObjectOperand,
  assertOrderedOperandsAreNumbers,
  callbackExcludesNothing,
  compileInnerSymbol,
  complexShapedEmission,
  cseParentNode,
  isElementReadWithoutNothing,
  liftWideResult,
  readAbsentInput,
} from './compile-inner.js';
import {
  compileExprApplyField,
  compileExprAssign,
  compileExprBroadcastJavaScript,
  compileExprBroadcastPython,
  compileExprCapturedBody,
  compileExprCoalesce,
  compileExprDeclare,
  compileExprElementwiseBroadcast,
  compileExprGpuPoint,
  compileExprGpuRelational,
  compileExprTyped,
  declaredTopGuard,
  noLoweringMessage,
} from './compile-expr-handlers.js';
import {
  compileExprFunctionCall,
  compileExprTupleCall,
} from './compile-calls.js';
import { compileExprFunctionLiteral } from './compile-function-literals.js';
import {
  compileExprAssertPresent,
  compileExprIf,
  compileExprMissingEquality,
  compileExprWhen,
  compileExprWhich,
  falsyReadsOf,
  guardConnectiveAbsence,
  isDecidedBooleanValue,
  isFalsyWhenUndecided,
  kleeneValueConnective,
  testedReadsOf,
} from './compile-conditionals.js';
import {
  _runtimeMatrixProducts,
  arrayLiteralElements,
  arrayLiteralWidth,
  compileBroadcastInnerProduct,
  compileMatrixProduct,
  compileRuntimeMatrixPower,
  compileStaticInnerProduct,
  exponentExactness,
  hoistedListLiteralText,
  isAtomicSource,
  isTypedMatrixOperand,
  matrixProductDimensions,
  mayHoldPoint,
  staticBroadcastWidth,
  staticCollectionWidth,
} from './compile-linear-algebra.js';
import {
  compileBroadcastUnary,
  emitFusedBroadcast,
  rememberPlainBroadcast,
  tryCompileBroadcast,
  tryCompilePythonElementwise,
} from './compile-broadcast.js';
import { compileBlock, compileStatementList } from './compile-blocks.js';
import {
  _freshLocalNames,
  _writableLoopIndices,
  assertLocalsAssignedBeforeRead,
  assertNoUseBeforeDeclare,
  assignLValue,
  bindingStatesEffects,
  bindsLocalFunctions,
  blockLocalValueFrame,
  chainedAmbientWrite,
  chainedLocalDeclares,
  checkedLocalRead,
  checkedLocalReads,
  classifyLocalReads,
  compiledLocalDefinitions,
  freshBlockLocalName,
  hideCheckedLocals,
  localNameKey,
  localReadWithNoWrite,
  localVarsObjectStatement,
  loopRunsOnce,
  needsStartValue,
  nestedAssignmentsTo,
  nestedOnlyLocals,
  readsBlockLocal,
  refuseEffectContractViolations,
  scopeChainBinds,
  splitChainedAssignments,
  unassignedLocalRead,
  withDefineFunctionDeclares,
  withFreshBlockLocals,
  withImplicitLocalDeclares,
  withWritableLoopIndices,
} from './compile-locals.js';
import {
  _popLocalComplex,
  _pushLocalComplex,
  compileComprehension,
  compileCountedRange,
  compileElementLoops,
  compileForLoop,
  compileLoop,
  compileRangeIterable,
  compileRangeOperand,
  elementBinderLane,
  elementClauseBinders,
  emitElementLoops,
  isArrayValuedLoopSource,
  isLegacyCompatibleRange,
  isLiteralRange,
  lexicalFunctionScope,
  newLocalFunctionScope,
  noteLocalFunction,
  reboundFunctionScope,
  reboundLocalNames,
  scalarConditionTarget,
  spellTuplePattern,
} from './compile-loops.js';
import { isCompiledIndex, isNominalAtomicType } from './compiler-type-facts.js';
import {
  LOCAL_BOOLEAN,
  LOCAL_UNSET,
  LOCAL_UNSHAPED,
  _shapeFrameOwner,
  assertScalarBigOpBody,
  branchComplexCoercion,
  framedLaneByOwnScope,
  isFramedByForeignScope,
  isLocalBoolean,
  isNonScalarByShapeAlone,
  isNonScalarShape,
  isProvablyRealValued,
  localShapeFrameOf,
  vectorComponentCount,
  withoutAbsentArms,
} from './compile-shapes.js';
import {
  BRANCH_RELATIONS,
  assertNoContradictedScalarOperand,
  assertScalarCondition,
  booleanClaim,
  conditionDialectOf,
  conditionDialects,
  containsEarlyReturn,
  containsReturn,
  cseRegionOf,
  cseTop,
  guardCondition,
  isBooleanValued,
  isCollectionValuedBigOpBodyByLookThrough,
  isContradictedScalarDeclaration,
  isContradictedScalarFunctionBody,
  isIntegerValued,
  isNonNegative,
  isProvablyCollectionValuedApplication,
  isProvablyCollectionValuedBody,
  isProvablyCollectionValuedClauseSet,
  isProvablyNonNumericBigOpBody,
  isScalarDeclaredType,
  isStatementArm,
  kleeneCondition,
  kleeneConnective,
  liveSelectionArms,
  mayBeCollectionCondition,
  pushCseInstance,
  returnedFunctionLiterals,
  tailValue,
  tailValueFor,
  withCseOperand,
  withCseRegion,
  writesBlocksAsIife,
} from './compile-conditions.js';
import {
  MATCH_SWITCH_THRESHOLD,
  assertBreakLeavesWholeLoop,
  canonicalInCompiledScope,
  compileMatchBody,
  compileMatchConstant,
  compileMatchGuard,
  compileMatchJS,
  compileMatchStatement,
  compileMatchStatementBody,
  compileMatchTernary,
  emitMatchCaseJS,
  emitMatchConstructorCaseJS,
  emitMatchSwitch,
  escapingControl,
  inCompiledScope,
  isIrrefutableCase,
  matchCaptureTarget,
  matchCaseComparisons,
  matchCaseTest,
  matchConstructorTest,
  matchLeafCondition,
  matchSwitchable,
  sumBucketTest,
  walkConstructorElement,
  walkMatchElement,
} from './compile-match.js';
import {
  HOISTED_LIST_LITERAL_MIN_LENGTH,
  _inlineFoldInProgress,
  _radianValues,
  assertFoldableSize,
  binderBoundNames,
  bindsFoldedValue,
  constantListLiteral,
  ensureFoldedValueEmitted,
  expandedFoldSize,
  foldCaptureRefusal,
  foldedValueInRadians,
  foldedValueName,
  hoistConstantListLiteral,
  hoistSeededDraw,
  identifierPattern,
  selfReferenceRefusal,
  tryFoldKnownSymbol,
} from './compile-folded-values.js';
import {
  assertCapturedTypesCurrent,
  assertParameterWritesInUnit,
  assertParameterWritesMatchTypes,
  blockLocalFunction,
  declaredUserSignature,
  groundSignature,
  isElementCall,
  localCallWithResultType,
  provablyScalarArg,
  signatureParamType,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
  wholeTupleCall,
  withCellSlotsAsElements,
} from './compile-assignment-checks.js';
import {
  MAX_NESTED_INLINES,
  assignedNamesIn,
  availableCseBinding,
  compileCseRoot,
  compileOp,
  compileOpValue,
  computeInvariantPrefixes,
  cseAdmission,
  cseHarvestOf,
  cseTempVar,
  definitionBodyExpr,
  enclosingDefinitionOf,
  foldEmitted,
  hasSharedExpression,
  hoistLoopInvariants,
  inlineCollectionValuedCalls,
  inlineCollectionValuedCallsInDefinitionBody,
  inlineCollectionValuedCallsOnce,
  inlineExpression,
  invariantPrefixes,
  isEmissionSkippable,
  isSinglePointArg,
  jetDerivativeLowering,
  loopInvariantHoistCandidates,
  mentionsAnySymbol,
  mergeUsedNames,
  openCseSession,
  operandAt,
  operandCompiler,
  registryLocalName,
  substitutedUserFunctionBody,
  synthesizeInvariantPrefixes,
  userFunctionIsGeneric,
  userFunctionName,
  withCseBlind,
  withCseIsolatedInstance,
  withCseLocalInstance,
  withCseScope,
  withNestedCseHarvest,
  withOwnCseHarvest,
  withoutNodeCodeOverrides,
} from './compile-cse.js';
import {
  absentArgumentChecks,
  assertExtraParamsRead,
  bakedTupleValueType,
  certainlyScalarArg,
  checkDeclaredBroadcast,
  checkDeclaredBroadcastAgainst,
  complexCoordinateArgumentAt,
  complexWrapCode,
  declaredPointAdmitsListCoordinate,
  emitUserFunctionCall,
  ensureUserFunctionVariantEmitted,
  inlineCollectionValuedCallsAtRoot,
  inlinedUserFunctionCall,
  isElementWiseOperand,
  isNominalAtomicArg,
  isRealListArg,
  isShaderVectorListArg,
  isUnionOfPoints,
  isUntypedFreeInput,
  listArgumentAtOpenWholeParameter,
  multiClauseLaneMismatchAt,
  multiClauseParamIsComplex,
  operandTypeInContext,
  paramElementTypeIsOpen,
  pointArgumentAtUntypedParameter,
  pointOrPointListUnion,
  presentCheckedCode,
  provablyScalarOrFramedScalar,
  readsAsScalarThroughFreeInputs,
  signatureParamsLowerToScalars,
  throughTyped,
  tryInlineUserFunctionCall,
  typeWithFreeInputsAsNumbers,
  userFunctionBroadcastPlan,
  userFunctionHasBroadcastableParam,
  userFunctionParamType,
  writtenPointWithComplexCoordinateAt,
} from './compile-user-calls.js';
import {
  checkListCoordinateTupleArgs,
  checkPointListAtMatrixUnionArgs,
  checkPointParamCollectionUnionArgs,
  checkScalarListAtContractPointParam,
  compileUntypedScalarSlotCall,
  scalarSlotElementType,
  scalarSlotListArgs,
  tryCompilePointListCall,
  untypedPointListElement,
} from './compile-point-calls.js';
import {
  declaredParameterLiteral,
  literalAtGroundSignature,
  markerAtGroundSignature,
  radicalNeedsSignProof,
  rangeSpecializedParameterTypes,
  trySpecializedUserCall,
} from './compile-user-specialization.js';
import {
  compileMatchesTypeJS,
  fieldArgsWithDeclaredReceiver,
  jsTypeTest,
  matchesTypeLowerable,
  matchesTypeText,
  protocolCallParts,
  receiverWithDeclaredType,
  renderReceiverGuard,
  tryCompileProtocolDispatch,
} from './compile-protocol-dispatch.js';
import {
  analyzeReferences,
  buildInterpreterFallback,
  declaredTypeText,
  declineReport,
  defaultLoweredSymbolType,
  freeSymbolTypes,
  modeReport,
  withReferences,
} from './compile-references.js';
import {
  namingContext,
  newNamingContext,
  resetNaming,
  tempVar,
  withBoundNames,
  withBoundScope,
} from './compiler-naming.js';

/**
 * `leafwardElementType`, `pointCollectionElementType`,
 * `isBroadcastablePointType` and `isNestedPointCollectionType`
 * (`collection-utils.ts`) for the interval target, which must not import
 * `collection-utils` directly (see `pointHasBroadcastComponent`).
 */
export {
  leafwardElementType,
  pointCollectionElementType,
  isBroadcastablePointType,
  isNestedPointCollectionType,
};
export class BaseCompiler {
  static readonly FOLD_OPERAND_PREC = FOLD_OPERAND_PREC;
  static readonly MAX_FOLD_EXPANDED_NODES = MAX_FOLD_EXPANDED_NODES;
  static readonly FOLD_CHARS_PER_NODE = FOLD_CHARS_PER_NODE;
  static readonly WORD_KEYWORD_OPERATORS = WORD_KEYWORD_OPERATORS;
  static readonly TUPLE_ARITHMETIC_HEADS = TUPLE_ARITHMETIC_HEADS;
  static readonly CONTROL_FLOW_HEADS = CONTROL_FLOW_HEADS;
  static readonly OVERRIDABLE_CONTROL_FLOW_HEADS =
    OVERRIDABLE_CONTROL_FLOW_HEADS;
  static readonly NAMED_LOWERING_HEADS = NAMED_LOWERING_HEADS;
  static readonly BINARY_INFIX_VALUE_OPERATORS = BINARY_INFIX_VALUE_OPERATORS;
  static readonly isBinaryInfixValueOperator = isBinaryInfixValueOperator;
  static readonly builtinCallbackRefusal = builtinCallbackRefusal;
  static readonly userFunctionValueRefRefusal = userFunctionValueRefRefusal;
  static readonly isUserDefinedFunction = isUserDefinedFunction;
  static readonly withVarsMappedUserFunctionHeads =
    withVarsMappedUserFunctionHeads;
  static readonly absenceAxisForType = absenceAxisForType;
  static readonly compileValueOperand = compileValueOperand;
  static readonly assertAssignmentIsStatement = assertAssignmentIsStatement;
  static readonly assertNoStatementOperand = assertNoStatementOperand;
  static readonly canHoist = canHoist;
  static readonly hoistStatement = hoistStatement;
  static readonly compileStatementBody = compileStatementBody;
  static readonly withStatementRecompile = withStatementRecompile;
  static readonly snapshotCseInstances = snapshotCseInstances;
  static readonly compileParents = compileParents;
  static readonly compileFunctionBody = compileFunctionBody;
  static readonly statementLines = statementLines;
  static readonly assertExpressionValue = assertExpressionValue;
  static readonly joinShaderStatements = joinShaderStatements;
  static readonly compileListStatement = compileListStatement;
  static readonly compileRoot = compileRoot;
  static readonly assertCapturedCallableBindings =
    assertCapturedCallableBindings;
  static readonly assertUserFunctionFreeBindings =
    assertUserFunctionFreeBindings;
  static get _kindLowering() {
    return CompilerState._kindLowering;
  }
  static set _kindLowering(v: (typeof CompilerState)['_kindLowering']) {
    CompilerState._kindLowering = v;
  }
  static get _lastKindLowering() {
    return CompilerState._lastKindLowering;
  }
  static set _lastKindLowering(v: (typeof CompilerState)['_lastKindLowering']) {
    CompilerState._lastKindLowering = v;
  }
  static readonly kindLoweringReport = kindLoweringReport;
  static readonly kindLoweringOf = kindLoweringOf;
  static readonly compileKindOperation = compileKindOperation;
  static readonly KIND_OPAQUE_HEADS = KIND_OPAQUE_HEADS;
  static get compile() {
    return core.compile;
  }
  static set compile(f: CoreHooks['compile']) {
    core.compile = f;
  }
  static get _oracleFoldTarget() {
    return CompilerState._oracleFoldTarget;
  }
  static set _oracleFoldTarget(v: (typeof CompilerState)['_oracleFoldTarget']) {
    CompilerState._oracleFoldTarget = v;
  }
  static get _callSiteTarget() {
    return CompilerState._callSiteTarget;
  }
  static set _callSiteTarget(v: (typeof CompilerState)['_callSiteTarget']) {
    CompilerState._callSiteTarget = v;
  }
  static get oracleFoldTarget() {
    return oracleFoldTarget();
  }
  static readonly _withFoldedRealOverride = _withFoldedRealOverride;
  static get _boundVarsCtx() {
    return CompilerState._boundVarsCtx;
  }
  static set _boundVarsCtx(v: (typeof CompilerState)['_boundVarsCtx']) {
    CompilerState._boundVarsCtx = v;
  }
  static get _mode() {
    return CompilerState._mode;
  }
  static set _mode(v: (typeof CompilerState)['_mode']) {
    CompilerState._mode = v;
  }
  static get mode() {
    return mode();
  }
  static get strictLanes() {
    return strictLanes();
  }
  static get promotionActive() {
    return promotionActive();
  }
  static get modePromotes() {
    return modePromotes();
  }
  static get _promotionSuppressed() {
    return CompilerState._promotionSuppressed;
  }
  static set _promotionSuppressed(
    v: (typeof CompilerState)['_promotionSuppressed']
  ) {
    CompilerState._promotionSuppressed = v;
  }
  static readonly withPromotionSuppressed = withPromotionSuppressed;
  static readonly withPromotionUnsuppressed = withPromotionUnsuppressed;
  static readonly liftPromotionSuppression = liftPromotionSuppression;
  static readonly restorePromotionSuppression = restorePromotionSuppression;
  static get runtimeRealGuards() {
    return runtimeRealGuards();
  }
  static get _promoted() {
    return CompilerState._promoted;
  }
  static set _promoted(v: (typeof CompilerState)['_promoted']) {
    CompilerState._promoted = v;
  }
  static get _realOnlyLowering() {
    return CompilerState._realOnlyLowering;
  }
  static set _realOnlyLowering(v: (typeof CompilerState)['_realOnlyLowering']) {
    CompilerState._realOnlyLowering = v;
  }
  static readonly isRealOnlyLoweringHead = isRealOnlyLoweringHead;
  static readonly isRealOnlyLowering = isRealOnlyLowering;
  static readonly stringHelperIsRealOnly = stringHelperIsRealOnly;
  static readonly notePromoted = notePromoted;
  static readonly recordPromotion = recordPromotion;
  static readonly recordFoldedPromotions = recordFoldedPromotions;
  static get _lastReport() {
    return CompilerState._lastReport;
  }
  static set _lastReport(v: (typeof CompilerState)['_lastReport']) {
    CompilerState._lastReport = v;
  }
  static get _lastReportBasis() {
    return CompilerState._lastReportBasis;
  }
  static set _lastReportBasis(v: (typeof CompilerState)['_lastReportBasis']) {
    CompilerState._lastReportBasis = v;
  }
  static readonly hasPromotedDefinition = hasPromotedDefinition;
  static get complexDiscipline() {
    return complexDiscipline();
  }
  static readonly wideIsComplex = wideIsComplex;
  static readonly wideNumericType = wideNumericType;
  static readonly _codeOverrides = _codeOverrides;
  static readonly _codeAliases = _codeAliases;
  static readonly _presentReads = _presentReads;
  static readonly withPresentReads = withPresentReads;
  static readonly isPresentRead = isPresentRead;
  static get hasCodeOverride() {
    return core.hasCodeOverride;
  }
  static set hasCodeOverride(f: CoreHooks['hasCodeOverride']) {
    core.hasCodeOverride = f;
  }
  static readonly _runtimeMatrixPowerBases = _runtimeMatrixPowerBases;
  static readonly _prefixCallOverrides = _prefixCallOverrides;
  static readonly isProvablyNonReal = isProvablyNonReal;
  static get realOperandGuard() {
    return core.realOperandGuard;
  }
  static set realOperandGuard(f: CoreHooks['realOperandGuard']) {
    core.realOperandGuard = f;
  }
  static readonly absentCollectionOperandGuard = absentCollectionOperandGuard;
  static readonly complexLoweringOf = complexLoweringOf;
  static readonly takesComplexResultLowering = takesComplexResultLowering;
  static readonly realGuardCandidate = realGuardCandidate;
  static readonly isArrayOperand = isArrayOperand;
  static readonly realOperandChain = realOperandChain;
  static readonly liftWideReference = liftWideReference;
  static readonly laneMismatch = laneMismatch;
  static readonly userParamBinding = userParamBinding;
  static readonly resolveCompileMode = resolveCompileMode;
  static readonly PROMOTABLE_RADICAL_HEADS = PROMOTABLE_RADICAL_HEADS;
  static readonly withoutNaNMember = withoutNaNMember;
  static readonly assumedRealNonNegative = assumedRealNonNegative;
  static readonly fixedLogBase = fixedLogBase;
  static readonly negativeBaseFloatPower = negativeBaseFloatPower;
  static readonly eulerPiSplit = eulerPiSplit;
  static readonly piMultiple = piMultiple;
  static readonly imaginaryPiMultiple = imaginaryPiMultiple;
  static readonly isLibraryPi = isLibraryPi;
  static readonly libraryBoundConstantHidden = libraryBoundConstantHidden;
  static readonly knownExponentPower = knownExponentPower;
  static readonly constantPoleOrdering = constantPoleOrdering;
  static readonly isConstantPole = isConstantPole;
  static get _constantPoleMemo() {
    return CompilerState._constantPoleMemo;
  }
  static set _constantPoleMemo(v: (typeof CompilerState)['_constantPoleMemo']) {
    CompilerState._constantPoleMemo = v;
  }
  static get _knownExponentMemo() {
    return CompilerState._knownExponentMemo;
  }
  static set _knownExponentMemo(
    v: (typeof CompilerState)['_knownExponentMemo']
  ) {
    CompilerState._knownExponentMemo = v;
  }
  static readonly isNameBoundByCompilation = isNameBoundByCompilation;
  static readonly realPowerExponent = realPowerExponent;
  static readonly realRootDegreeTerms = realRootDegreeTerms;
  static readonly hasNonIntegerRealCell = hasNonIntegerRealCell;
  static get promotesRadicalToComplex() {
    return core.promotesRadicalToComplex;
  }
  static set promotesRadicalToComplex(
    f: CoreHooks['promotesRadicalToComplex']
  ) {
    core.promotesRadicalToComplex = f;
  }
  static readonly continuesToComplex = continuesToComplex;
  static get hasComplexContinuationLowering() {
    return hasComplexContinuationLowering();
  }
  static readonly userCallLane = userCallLane;
  static readonly LANE_RECORD_LANGUAGES = LANE_RECORD_LANGUAGES;
  static readonly userCallDefinition = userCallDefinition;
  static readonly mayBeCollectionValued = mayBeCollectionValued;
  static readonly userFunctionLanes = userFunctionLanes;
  static readonly _userFunctionLanes = _userFunctionLanes;
  static readonly emitWithRecursiveLaneRetry = emitWithRecursiveLaneRetry;
  static readonly removeDefinitionsAddedSince = removeDefinitionsAddedSince;
  static readonly recordUserFunctionLane = recordUserFunctionLane;
  static readonly withBoundVarsOf = withBoundVarsOf;
  static readonly setUserFunctionLane = setUserFunctionLane;
  static get withCallerBindingsHidden() {
    return core.withCallerBindingsHidden;
  }
  static set withCallerBindingsHidden(
    f: CoreHooks['withCallerBindingsHidden']
  ) {
    core.withCallerBindingsHidden = f;
  }
  static readonly userCallMask = userCallMask;
  static get _userCallVisited() {
    return CompilerState._userCallVisited;
  }
  static set _userCallVisited(v: (typeof CompilerState)['_userCallVisited']) {
    CompilerState._userCallVisited = v;
  }
  static readonly unwrappedFunctionBody = unwrappedFunctionBody;
  static readonly collectionConstructorBody = collectionConstructorBody;
  static readonly withCollectionElements = withCollectionElements;
  static readonly isComplexValuedElementAt = isComplexValuedElementAt;
  static get elementComplexness() {
    return core.elementComplexness;
  }
  static set elementComplexness(f: CoreHooks['elementComplexness']) {
    core.elementComplexness = f;
  }
  static readonly broadcastLeafComplexness = broadcastLeafComplexness;
  static readonly uniformElementComplexness = uniformElementComplexness;
  static readonly isGatherIndex = isGatherIndex;
  static readonly mayHoldComplexElement = mayHoldComplexElement;
  static readonly hasAnyComplexElement = hasAnyComplexElement;
  static readonly hasMixedElementComplexness = hasMixedElementComplexness;
  static readonly DISPATCHING_BROADCAST_HEADS = DISPATCHING_BROADCAST_HEADS;
  static readonly dispatchingScalarBody = dispatchingScalarBody;
  static readonly isElementwiseBroadcastHead = isElementwiseBroadcastHead;
  static get _elementLaneMemoStack() {
    return CompilerState._elementLaneMemoStack;
  }
  static set _elementLaneMemoStack(
    v: (typeof CompilerState)['_elementLaneMemoStack']
  ) {
    CompilerState._elementLaneMemoStack = v;
  }
  static get operandElementLane() {
    return core.operandElementLane;
  }
  static set operandElementLane(f: CoreHooks['operandElementLane']) {
    core.operandElementLane = f;
  }
  static readonly _operandElementLane = _operandElementLane;
  static readonly isCollectionFold = isCollectionFold;
  static readonly typeHasComplexLeaf = typeHasComplexLeaf;
  static readonly wideEntriesType = wideEntriesType;
  static readonly ascriptionText = ascriptionText;
  static readonly realAscriptionError = realAscriptionError;
  static readonly isRealScalarAscription = isRealScalarAscription;
  static readonly realEntriesType = realEntriesType;
  static get linearAlgebraOperandLane() {
    return core.linearAlgebraOperandLane;
  }
  static set linearAlgebraOperandLane(
    f: CoreHooks['linearAlgebraOperandLane']
  ) {
    core.linearAlgebraOperandLane = f;
  }
  static readonly userCallElementLane = userCallElementLane;
  static readonly structuralOperandLane = structuralOperandLane;
  static readonly linearAlgebraLane = linearAlgebraLane;
  static readonly linearAlgebraLaneOperands = linearAlgebraLaneOperands;
  static readonly symbolOccursFree = symbolOccursFree;
  static readonly assertNoAmbiguousComplexElementRead =
    assertNoAmbiguousComplexElementRead;
  static readonly mentionsCompileBoundName = mentionsCompileBoundName;
  static readonly isCompileBoundName = isCompileBoundName;
  static readonly mentionsExcludedName = mentionsExcludedName;
  static readonly reachesExcludedName = reachesExcludedName;
  static readonly isTabulateWithNonPositiveDimension =
    isTabulateWithNonPositiveDimension;
  static readonly containsUnboundedBigOp = containsUnboundedBigOp;
  static readonly containsNonFiniteLiteral = containsNonFiniteLiteral;
  static readonly tryConstantFold = tryConstantFold;
  static readonly beginRootPreprocessing = beginRootPreprocessing;
  static readonly resetCompilationMemos = resetCompilationMemos;
  static get _foldValueMemo() {
    return CompilerState._foldValueMemo;
  }
  static set _foldValueMemo(v: (typeof CompilerState)['_foldValueMemo']) {
    CompilerState._foldValueMemo = v;
  }
  static get _foldValueBlockedMemo() {
    return CompilerState._foldValueBlockedMemo;
  }
  static set _foldValueBlockedMemo(
    v: (typeof CompilerState)['_foldValueBlockedMemo']
  ) {
    CompilerState._foldValueBlockedMemo = v;
  }
  static get _unknownsMemo() {
    return CompilerState._unknownsMemo;
  }
  static set _unknownsMemo(v: (typeof CompilerState)['_unknownsMemo']) {
    CompilerState._unknownsMemo = v;
  }
  static readonly hasUnknowns = hasUnknowns;
  static get _foldValueImpureMemo() {
    return CompilerState._foldValueImpureMemo;
  }
  static set _foldValueImpureMemo(
    v: (typeof CompilerState)['_foldValueImpureMemo']
  ) {
    CompilerState._foldValueImpureMemo = v;
  }
  static get _foldValueMentionsMemo() {
    return CompilerState._foldValueMentionsMemo;
  }
  static set _foldValueMentionsMemo(
    v: (typeof CompilerState)['_foldValueMentionsMemo']
  ) {
    CompilerState._foldValueMentionsMemo = v;
  }
  static get _angularDefinitionMemo() {
    return CompilerState._angularDefinitionMemo;
  }
  static set _angularDefinitionMemo(
    v: (typeof CompilerState)['_angularDefinitionMemo']
  ) {
    CompilerState._angularDefinitionMemo = v;
  }
  static readonly readsAngularDefinition = readsAngularDefinition;
  static readonly nameHasAngularDefinition = nameHasAngularDefinition;
  static get _absArgMemo() {
    return CompilerState._absArgMemo;
  }
  static set _absArgMemo(v: (typeof CompilerState)['_absArgMemo']) {
    CompilerState._absArgMemo = v;
  }
  static readonly reachesAbsArg = reachesAbsArg;
  static readonly nameReachesAbsArg = nameReachesAbsArg;
  static readonly storedDefinitions = storedDefinitions;
  static get _unsafeOperandsMemo() {
    return CompilerState._unsafeOperandsMemo;
  }
  static set _unsafeOperandsMemo(
    v: (typeof CompilerState)['_unsafeOperandsMemo']
  ) {
    CompilerState._unsafeOperandsMemo = v;
  }
  static readonly foldValueImpure = foldValueImpure;
  static readonly foldValueMentions = foldValueMentions;
  static readonly foldValueCaptured = foldValueCaptured;
  static readonly inlineFoldTarget = inlineFoldTarget;
  static readonly inlineFoldKeepsOwnerScope = inlineFoldKeepsOwnerScope;
  static readonly foldCapturedName = foldCapturedName;
  static readonly unsafeIntegerOperands = unsafeIntegerOperands;
  static readonly exactFoldValue = exactFoldValue;
  static readonly exactFoldOperandFits = exactFoldOperandFits;
  static readonly exactFoldCallbackRanges = exactFoldCallbackRanges;
  static readonly bigOpIterations = bigOpIterations;
  static readonly exactFoldCollectionSize = exactFoldCollectionSize;
  static readonly foldValueBlocked = foldValueBlocked;
  static readonly closedExactJump = closedExactJump;
  static readonly SHIFT_JUMP_HEADS = SHIFT_JUMP_HEADS;
  static readonly jumpShiftRewrite = jumpShiftRewrite;
  static readonly recordJumpFoldReads = recordJumpFoldReads;
  static get constantFoldValue() {
    return core.constantFoldValue;
  }
  static set constantFoldValue(f: CoreHooks['constantFoldValue']) {
    core.constantFoldValue = f;
  }
  static get foldCostEstimate() {
    return core.foldCostEstimate;
  }
  static set foldCostEstimate(f: CoreHooks['foldCostEstimate']) {
    core.foldCostEstimate = f;
  }
  static readonly callbackApplicationCost = callbackApplicationCost;
  static readonly calleeBodyCost = calleeBodyCost;
  static readonly staticCollectionSize = staticCollectionSize;
  static readonly realBoundOf = realBoundOf;
  static readonly bigOpTripCount = bigOpTripCount;
  static readonly foldableCollectionElements = foldableCollectionElements;
  static readonly emitFoldedValue = emitFoldedValue;
  static get _emittingFoldedValue() {
    return CompilerState._emittingFoldedValue;
  }
  static set _emittingFoldedValue(
    v: (typeof CompilerState)['_emittingFoldedValue']
  ) {
    CompilerState._emittingFoldedValue = v;
  }
  static readonly assertSafeBigOpBounds = assertSafeBigOpBounds;
  static readonly bigOpBoundValue = bigOpBoundValue;
  static get bigOpBoundConstant() {
    return core.bigOpBoundConstant;
  }
  static set bigOpBoundConstant(f: CoreHooks['bigOpBoundConstant']) {
    core.bigOpBoundConstant = f;
  }
  static readonly foldedRealNumber = foldedRealNumber;
  static readonly spliceSpreadOperands = spliceSpreadOperands;
  static readonly shadowedLibraryLoweringError = shadowedLibraryLoweringError;
  static readonly findShadowedLibraryLowering = findShadowedLibraryLowering;
  static readonly compileLocallyBoundLibraryCall =
    compileLocallyBoundLibraryCall;
  static get _compileInner() {
    return core._compileInner;
  }
  static set _compileInner(f: CoreHooks['_compileInner']) {
    core._compileInner = f;
  }
  static readonly compileInnerSymbol = compileInnerSymbol;
  static readonly assertHeldValueType = assertHeldValueType;
  static readonly readAbsentInput = readAbsentInput;
  static readonly liftWideResult = liftWideResult;
  static readonly complexShapedEmission = complexShapedEmission;
  static get _cseParent() {
    return CompilerState._cseParent;
  }
  static set _cseParent(v: (typeof CompilerState)['_cseParent']) {
    CompilerState._cseParent = v;
  }
  static readonly cseParentNode = cseParentNode;
  static get _collectionValueBlock() {
    return CompilerState._collectionValueBlock;
  }
  static set _collectionValueBlock(
    v: (typeof CompilerState)['_collectionValueBlock']
  ) {
    CompilerState._collectionValueBlock = v;
  }
  static readonly compileCollectionValueBlock = compileCollectionValueBlock;
  static readonly OMITTING_NUMERIC_AGGREGATES = OMITTING_NUMERIC_AGGREGATES;
  static readonly callbackExcludesNothing = callbackExcludesNothing;
  static readonly isElementReadWithoutNothing = isElementReadWithoutNothing;
  static readonly assertNoProvedAbsentObjectOperand =
    assertNoProvedAbsentObjectOperand;
  static readonly assertCollectionOmissionSupported =
    assertCollectionOmissionSupported;
  static readonly assertOrderedOperandsAreNumbers =
    assertOrderedOperandsAreNumbers;
  static get compileExpr() {
    return core.compileExpr;
  }
  static set compileExpr(f: CoreHooks['compileExpr']) {
    core.compileExpr = f;
  }
  static readonly compileExprCapturedBody = compileExprCapturedBody;
  static readonly DECLARED_TOP_GUARD_HEADS = DECLARED_TOP_GUARD_HEADS;
  static readonly declaredTopGuard = declaredTopGuard;
  static readonly compileExprElementwiseBroadcast =
    compileExprElementwiseBroadcast;
  static readonly compileExprGpuRelational = compileExprGpuRelational;
  static readonly compileExprGpuPoint = compileExprGpuPoint;
  static readonly compileExprDeclare = compileExprDeclare;
  static readonly compileExprCoalesce = compileExprCoalesce;
  static readonly compileExprApplyField = compileExprApplyField;
  static readonly compileExprFunctionCall = compileExprFunctionCall;
  static readonly compileExprTupleCall = compileExprTupleCall;
  static readonly compileExprBroadcastJavaScript =
    compileExprBroadcastJavaScript;
  static readonly compileExprBroadcastPython = compileExprBroadcastPython;
  static readonly compileExprOperator = compileExprOperator;
  static readonly compileExprFunctionLiteral = compileExprFunctionLiteral;
  static readonly compileExprAssign = compileExprAssign;
  static readonly compileExprIf = compileExprIf;
  static readonly compileExprWhich = compileExprWhich;
  static readonly compileExprWhen = compileExprWhen;
  static readonly testedReadsOf = testedReadsOf;
  static readonly falsyReadsOf = falsyReadsOf;
  static readonly isFalsyWhenUndecided = isFalsyWhenUndecided;
  static readonly compileExprAssertPresent = compileExprAssertPresent;
  static readonly compileExprMissingEquality = compileExprMissingEquality;
  static readonly compileExprTyped = compileExprTyped;
  static readonly noLoweringMessage = noLoweringMessage;
  static readonly COMPLEX_TRANSPARENT_HEADS = COMPLEX_TRANSPARENT_HEADS;
  static readonly REAL_BY_DEFINITION_HEADS = REAL_BY_DEFINITION_HEADS;
  static readonly SCALAR_ARITHMETIC_HEADS = SCALAR_ARITHMETIC_HEADS;
  static readonly isTupleOfTuples = isTupleOfTuples;
  static readonly REAL_ONLY_BY_DEFINITION = REAL_ONLY_BY_DEFINITION;
  static readonly realOnlyGuardOperands = realOnlyGuardOperands;
  static readonly realOnlyResultKind = realOnlyResultKind;
  static readonly COMPLEX_PROPAGATING_HEADS = COMPLEX_PROPAGATING_HEADS;
  static readonly ORDERING_HEADS = ORDERING_HEADS;
  static readonly LOGICAL_BROADCAST_HEADS = LOGICAL_BROADCAST_HEADS;
  static readonly isHypotPointLeg = isHypotPointLeg;
  static readonly ELEMENTWISE_TUPLE_EXEMPT_HEADS =
    ELEMENTWISE_TUPLE_EXEMPT_HEADS;
  static readonly appliesToEachTupleCoordinate = appliesToEachTupleCoordinate;
  static readonly isBroadcastExemptTupleOperand = isBroadcastExemptTupleOperand;
  static readonly isScalarElementSource = isScalarElementSource;
  static readonly rotationView = rotationView;
  static readonly REPEATABLE_SOURCE = REPEATABLE_SOURCE;
  static readonly withRepeatableSource = withRepeatableSource;
  static readonly callerOverrides = callerOverrides;
  static readonly exponentExactness = exponentExactness;
  static readonly EXACT_EXPONENT_HEADS = EXACT_EXPONENT_HEADS;
  static readonly compileRuntimeMatrixPower = compileRuntimeMatrixPower;
  static readonly _runtimeMatrixProducts = _runtimeMatrixProducts;
  static readonly isTypedMatrixOperand = isTypedMatrixOperand;
  static readonly matrixProductDimensions = matrixProductDimensions;
  static readonly mayHoldPoint = mayHoldPoint;
  static readonly compileMatrixProduct = compileMatrixProduct;
  static readonly arrayLiteralWidth = arrayLiteralWidth;
  static readonly hoistedListLiteralText = hoistedListLiteralText;
  static readonly arrayLiteralElements = arrayLiteralElements;
  static readonly isAtomicSource = isAtomicSource;
  static readonly compileBroadcastInnerProduct = compileBroadcastInnerProduct;
  static readonly compileStaticInnerProduct = compileStaticInnerProduct;
  static readonly staticCollectionWidth = staticCollectionWidth;
  static readonly staticBroadcastWidth = staticBroadcastWidth;
  static readonly tryCompileBroadcast = tryCompileBroadcast;
  static readonly PLAIN_BROADCASTS = PLAIN_BROADCASTS;
  static readonly PLAIN_BROADCAST_MEMO_LIMIT = PLAIN_BROADCAST_MEMO_LIMIT;
  static readonly NAN_PROPAGATING_BROADCAST_HEADS =
    NAN_PROPAGATING_BROADCAST_HEADS;
  static readonly emitFusedBroadcast = emitFusedBroadcast;
  static readonly rememberPlainBroadcast = rememberPlainBroadcast;
  static readonly compileBroadcastUnary = compileBroadcastUnary;
  static readonly tryCompilePythonElementwise = tryCompilePythonElementwise;
  static readonly kleeneValueConnective = kleeneValueConnective;
  static readonly isDecidedBooleanValue = isDecidedBooleanValue;
  static readonly guardConnectiveAbsence = guardConnectiveAbsence;
  static readonly declareValueOperand = declareValueOperand;
  static readonly declareTypeOperand = declareTypeOperand;
  static readonly declaredTypeSource = declaredTypeSource;
  static readonly destructureViaTemp = destructureViaTemp;
  static get _enforcedTargets() {
    return CompilerState._enforcedTargets;
  }
  static set _enforcedTargets(v: (typeof CompilerState)['_enforcedTargets']) {
    CompilerState._enforcedTargets = v;
  }
  static readonly assertLeafAssignable = assertLeafAssignable;
  static readonly enforcedLocalTargets = enforcedLocalTargets;
  static readonly enforcedParamTargets = enforcedParamTargets;
  static readonly assertNoDestructuringParams = assertNoDestructuringParams;
  static readonly assertNoRestParams = assertNoRestParams;
  static readonly withEnforcedParams = withEnforcedParams;
  static readonly collectionFoldsReal = collectionFoldsReal;
  static readonly elementsRealByConstruction = elementsRealByConstruction;
  static readonly NON_PROMOTING_ELEMENTWISE_HEADS =
    NON_PROMOTING_ELEMENTWISE_HEADS;
  static readonly assertLockstepSourcesPure = assertLockstepSourcesPure;
  static readonly zipCallbackArgTypes = zipCallbackArgTypes;
  static readonly foldsCollectionElements = foldsCollectionElements;
  static readonly collectionElementTypeOf = collectionElementTypeOf;
  static readonly callbackLiteral = callbackLiteral;
  static readonly foldAccumulatorArgType = foldAccumulatorArgType;
  static readonly assertCallbackAnnotations = assertCallbackAnnotations;
  static readonly typedTemp = typedTemp;
  static readonly desugarPatternDeclare = desugarPatternDeclare;
  static readonly desugarPatternAssign = desugarPatternAssign;
  static readonly compileStatementList = compileStatementList;
  static get shaderSelectionStatement() {
    return core.shaderSelectionStatement;
  }
  static set shaderSelectionStatement(
    f: CoreHooks['shaderSelectionStatement']
  ) {
    core.shaderSelectionStatement = f;
  }
  static readonly shaderExpressionStatement = shaderExpressionStatement;
  static readonly withDefineFunctionDeclares = withDefineFunctionDeclares;
  static readonly refuseEffectContractViolations =
    refuseEffectContractViolations;
  static readonly bindingStatesEffects = bindingStatesEffects;
  static readonly chainedLocalDeclares = chainedLocalDeclares;
  static readonly withImplicitLocalDeclares = withImplicitLocalDeclares;
  static readonly _localValueFrames = _localValueFrames;
  static readonly blockLocalValueFrame = blockLocalValueFrame;
  static readonly blockInputs = blockInputs;
  static readonly readsBlockLocal = readsBlockLocal;
  static readonly localDependsOnInputs = localDependsOnInputs;
  static readonly findDependentLocals = findDependentLocals;
  static readonly _localNameKeys = _localNameKeys;
  static readonly localNameKey = localNameKey;
  static readonly blockLocalOf = blockLocalOf;
  static readonly isInnerBinderRead = isInnerBinderRead;
  static readonly blockLocalsNamed = blockLocalsNamed;
  static readonly isUnsetLocalRead = isUnsetLocalRead;
  static get _checkedLocals() {
    return CompilerState._checkedLocals;
  }
  static set _checkedLocals(v: (typeof CompilerState)['_checkedLocals']) {
    CompilerState._checkedLocals = v;
  }
  static readonly classifyLocalReads = classifyLocalReads;
  static readonly compiledLocalDefinitions = compiledLocalDefinitions;
  static readonly loopRunsOnce = loopRunsOnce;
  static readonly localReadWithNoWrite = localReadWithNoWrite;
  static readonly checkedLocalReads = checkedLocalReads;
  static readonly checkedLocalRead = checkedLocalRead;
  static readonly hideCheckedLocals = hideCheckedLocals;
  static readonly nestedOnlyLocals = nestedOnlyLocals;
  static readonly nestedAssignmentsTo = nestedAssignmentsTo;
  static readonly chainedAmbientWrite = chainedAmbientWrite;
  static readonly scopeChainBinds = scopeChainBinds;
  static readonly splitChainedAssignments = splitChainedAssignments;
  static readonly assertLocalsAssignedBeforeRead =
    assertLocalsAssignedBeforeRead;
  static readonly assertNoUseBeforeDeclare = assertNoUseBeforeDeclare;
  static readonly unassignedLocalRead = unassignedLocalRead;
  static readonly needsStartValue = needsStartValue;
  static get _freshBlockLocals() {
    return CompilerState._freshBlockLocals;
  }
  static set _freshBlockLocals(v: (typeof CompilerState)['_freshBlockLocals']) {
    CompilerState._freshBlockLocals = v;
  }
  static readonly _freshLocalNames = _freshLocalNames;
  static readonly _writableLoopIndices = _writableLoopIndices;
  static readonly withWritableLoopIndices = withWritableLoopIndices;
  static readonly withFreshBlockLocals = withFreshBlockLocals;
  static readonly freshBlockLocalName = freshBlockLocalName;
  static readonly assignLValue = assignLValue;
  static readonly localVarsObjectStatement = localVarsObjectStatement;
  static readonly compileBlock = compileBlock;
  static readonly compileForLoop = compileForLoop;
  static readonly compileComprehension = compileComprehension;
  static readonly elementClauseBinders = elementClauseBinders;
  static readonly spellTuplePattern = spellTuplePattern;
  static readonly elementBinderLane = elementBinderLane;
  static readonly compileElementLoops = compileElementLoops;
  static readonly emitElementLoops = emitElementLoops;
  static readonly isArrayValuedLoopSource = isArrayValuedLoopSource;
  static readonly isLegacyCompatibleRange = isLegacyCompatibleRange;
  static readonly compileCountedRange = compileCountedRange;
  static readonly compileRangeOperand = compileRangeOperand;
  static readonly isLiteralRange = isLiteralRange;
  static readonly compileRangeIterable = compileRangeIterable;
  static get compileLoopBody() {
    return core.compileLoopBody;
  }
  static set compileLoopBody(f: CoreHooks['compileLoopBody']) {
    core.compileLoopBody = f;
  }
  static readonly loopBodyTempTarget = loopBodyTempTarget;
  static readonly lambdaParamBinding = lambdaParamBinding;
  static readonly bindsLocalFunctions = bindsLocalFunctions;
  static readonly newLocalFunctionScope = newLocalFunctionScope;
  static readonly lexicalFunctionScope = lexicalFunctionScope;
  static readonly reboundFunctionScope = reboundFunctionScope;
  static readonly reboundLocalNames = reboundLocalNames;
  static readonly noteLocalFunction = noteLocalFunction;
  static readonly statementListDeclaredVarTypes = statementListDeclaredVarTypes;
  static readonly scalarConditionTarget = scalarConditionTarget;
  static readonly compileLoop = compileLoop;
  static get _localComplex() {
    return CompilerState._localComplex;
  }
  static set _localComplex(v: (typeof CompilerState)['_localComplex']) {
    CompilerState._localComplex = v;
  }
  static get _binderShield() {
    return CompilerState._binderShield;
  }
  static set _binderShield(v: (typeof CompilerState)['_binderShield']) {
    CompilerState._binderShield = v;
  }
  static get _unrolledIndexValues() {
    return CompilerState._unrolledIndexValues;
  }
  static set _unrolledIndexValues(
    v: (typeof CompilerState)['_unrolledIndexValues']
  ) {
    CompilerState._unrolledIndexValues = v;
  }
  static readonly withUnrolledIndexValues = withUnrolledIndexValues;
  static readonly withLoopIndexLowerBound = withLoopIndexLowerBound;
  static readonly _enterUnrolledIndexBinder = _enterUnrolledIndexBinder;
  static readonly isCompiledIndex = isCompiledIndex;
  static readonly _exitUnrolledIndexBinder = _exitUnrolledIndexBinder;
  static readonly unrolledIndexValueFold = unrolledIndexValueFold;
  static readonly unrolledIndexValuesProveNonNegative =
    unrolledIndexValuesProveNonNegative;
  static readonly mentionsAnyName = mentionsAnyName;
  static readonly rebindsAnyName = rebindsAnyName;
  static readonly _broadcastRadicalVerdict = _broadcastRadicalVerdict;
  static get _complexMemoStack() {
    return CompilerState._complexMemoStack;
  }
  static set _complexMemoStack(v: (typeof CompilerState)['_complexMemoStack']) {
    CompilerState._complexMemoStack = v;
  }
  static readonly _invalidateComplexMemo = _invalidateComplexMemo;
  static readonly _pushComplexMemoLayer = _pushComplexMemoLayer;
  static readonly _keyedMemoLayers = _keyedMemoLayers;
  static readonly _pushKeyedComplexMemoLayer = _pushKeyedComplexMemoLayer;
  static readonly _popKeyedComplexMemoLayer = _popKeyedComplexMemoLayer;
  static readonly _popComplexMemoLayer = _popComplexMemoLayer;
  static readonly _resetComplexMemoTop = _resetComplexMemoTop;
  static get _compileDepth() {
    return CompilerState._compileDepth;
  }
  static set _compileDepth(v: (typeof CompilerState)['_compileDepth']) {
    CompilerState._compileDepth = v;
  }
  static readonly _compileParents = _compileParents;
  static readonly _pushLocalComplex = _pushLocalComplex;
  static readonly _popLocalComplex = _popLocalComplex;
  static readonly _setLocalComplex = _setLocalComplex;
  static get noteLocalComplex() {
    return core.noteLocalComplex;
  }
  static set noteLocalComplex(f: CoreHooks['noteLocalComplex']) {
    core.noteLocalComplex = f;
  }
  static readonly localComplexDefault = localComplexDefault;
  static readonly declaredTypeIsReal = declaredTypeIsReal;
  static readonly _boundLocals = _boundLocals;
  static readonly markLocalBound = markLocalBound;
  static readonly localIsBound = localIsBound;
  static readonly checkNestedComplexRebinding = checkNestedComplexRebinding;
  static readonly binderParts = binderParts;
  static readonly withBinderMask = withBinderMask;
  static readonly _complexValueInProgress = _complexValueInProgress;
  static readonly isComplexValuedUnderIndices = isComplexValuedUnderIndices;
  static readonly withRealLoopIndices = withRealLoopIndices;
  static get isComplexValued() {
    return core.isComplexValued;
  }
  static set isComplexValued(f: CoreHooks['isComplexValued']) {
    core.isComplexValued = f;
  }
  static readonly hasShadowingCompileHandler = hasShadowingCompileHandler;
  static readonly _isComplexValuedFunction = _isComplexValuedFunction;
  static readonly isBlockValueComplexValued = isBlockValueComplexValued;
  static get _localVector() {
    return CompilerState._localVector;
  }
  static set _localVector(v: (typeof CompilerState)['_localVector']) {
    CompilerState._localVector = v;
  }
  static readonly LOCAL_UNSET = LOCAL_UNSET;
  static readonly LOCAL_SCALAR = LOCAL_SCALAR;
  static readonly LOCAL_BOOLEAN = LOCAL_BOOLEAN;
  static readonly LOCAL_UNSHAPED = LOCAL_UNSHAPED;
  static readonly _shapeFrameOwner = _shapeFrameOwner;
  static readonly isFramedByForeignScope = isFramedByForeignScope;
  static readonly framedLaneByOwnScope = framedLaneByOwnScope;
  static readonly localShapeFrameOf = localShapeFrameOf;
  static readonly isLocalBoolean = isLocalBoolean;
  static get withLocalShapeFrame() {
    return core.withLocalShapeFrame;
  }
  static set withLocalShapeFrame(f: CoreHooks['withLocalShapeFrame']) {
    core.withLocalShapeFrame = f;
  }
  static get aggregateComponentCount() {
    return core.aggregateComponentCount;
  }
  static set aggregateComponentCount(f: CoreHooks['aggregateComponentCount']) {
    core.aggregateComponentCount = f;
  }
  static readonly ELEMENTWISE_WIDTH_OPERATORS = ELEMENTWISE_WIDTH_OPERATORS;
  static readonly isNonScalarShape = isNonScalarShape;
  static readonly isNonScalarByShapeAlone = isNonScalarByShapeAlone;
  static readonly withoutAbsentArms = withoutAbsentArms;
  static readonly vectorComponentCount = vectorComponentCount;
  static readonly branchComplexCoercion = branchComplexCoercion;
  static readonly isProvablyRealValued = isProvablyRealValued;
  static readonly assertScalarBigOpBody = assertScalarBigOpBody;
  static readonly ANTIDERIVATIVE_ATTEMPT_STEPS = ANTIDERIVATIVE_ATTEMPT_STEPS;
  static readonly ANTIDERIVATIVE_ATTEMPT_HANG_MS =
    ANTIDERIVATIVE_ATTEMPT_HANG_MS;
  static readonly ANTIDERIVATIVE_COMPILATION_HANG_MS =
    ANTIDERIVATIVE_COMPILATION_HANG_MS;
  static get antiderivativeHangMsLeft() {
    return CompilerState.antiderivativeHangMsLeft;
  }
  static set antiderivativeHangMsLeft(
    v: (typeof CompilerState)['antiderivativeHangMsLeft']
  ) {
    CompilerState.antiderivativeHangMsLeft = v;
  }
  static get antiderivativeAttemptSteps() {
    return CompilerState.antiderivativeAttemptSteps;
  }
  static set antiderivativeAttemptSteps(
    v: (typeof CompilerState)['antiderivativeAttemptSteps']
  ) {
    CompilerState.antiderivativeAttemptSteps = v;
  }
  static readonly setAntiderivativeAttemptBudgetForTesting =
    setAntiderivativeAttemptBudgetForTesting;
  static readonly ANTIDERIVATIVE_COMPILATION_STEPS =
    ANTIDERIVATIVE_COMPILATION_STEPS;
  static get antiderivativeStepsLeft() {
    return CompilerState.antiderivativeStepsLeft;
  }
  static set antiderivativeStepsLeft(
    v: (typeof CompilerState)['antiderivativeStepsLeft']
  ) {
    CompilerState.antiderivativeStepsLeft = v;
  }
  static readonly resetSharedCompilationBudgets = resetSharedCompilationBudgets;
  static readonly antiderivativeTimeouts = antiderivativeTimeouts;
  static readonly definitionIds = definitionIds;
  static get nextDefinitionId() {
    return CompilerState.nextDefinitionId;
  }
  static set nextDefinitionId(v: (typeof CompilerState)['nextDefinitionId']) {
    CompilerState.nextDefinitionId = v;
  }
  static readonly MAX_ANTIDERIVATIVE_TIMEOUT_RECORDS =
    MAX_ANTIDERIVATIVE_TIMEOUT_RECORDS;
  static readonly recordedTypeLists = recordedTypeLists;
  static get antiderivativeAttemptCount() {
    return CompilerState.antiderivativeAttemptCount;
  }
  static set antiderivativeAttemptCount(
    v: (typeof CompilerState)['antiderivativeAttemptCount']
  ) {
    CompilerState.antiderivativeAttemptCount = v;
  }
  static readonly antiderivativeStateStamp = antiderivativeStateStamp;
  static readonly antiderivativeKey = antiderivativeKey;
  static readonly shadowedOperandSymbols = shadowedOperandSymbols;
  static readonly referencesVarsSymbol = referencesVarsSymbol;
  static readonly integrandLambda = integrandLambda;
  static readonly closedFormIntegral = closedFormIntegral;
  static readonly isContradictedScalarDeclaration =
    isContradictedScalarDeclaration;
  static readonly isScalarDeclaredType = isScalarDeclaredType;
  static readonly isContradictedScalarFunctionBody =
    isContradictedScalarFunctionBody;
  static readonly assertNoContradictedScalarOperand =
    assertNoContradictedScalarOperand;
  static readonly isCollectionValuedBigOpBodyByLookThrough =
    isCollectionValuedBigOpBodyByLookThrough;
  static readonly isProvablyCollectionValuedApplication =
    isProvablyCollectionValuedApplication;
  static readonly isProvablyCollectionValuedClauseSet =
    isProvablyCollectionValuedClauseSet;
  static readonly isProvablyCollectionValuedBody =
    isProvablyCollectionValuedBody;
  static readonly returnedFunctionLiterals = returnedFunctionLiterals;
  static readonly containsReturn = containsReturn;
  static readonly containsEarlyReturn = containsEarlyReturn;
  static readonly writesBlocksAsIife = writesBlocksAsIife;
  static readonly tailValue = tailValue;
  static readonly tailValueFor = tailValueFor;
  static readonly isProvablyNonNumericBigOpBody = isProvablyNonNumericBigOpBody;
  static readonly isBooleanValued = isBooleanValued;
  static readonly booleanClaim = booleanClaim;
  static readonly liveSelectionArms = liveSelectionArms;
  static readonly isStatementArm = isStatementArm;
  static readonly assertScalarCondition = assertScalarCondition;
  static readonly mayBeCollectionCondition = mayBeCollectionCondition;
  static readonly guardCondition = guardCondition;
  static readonly BRANCH_RELATIONS = BRANCH_RELATIONS;
  static readonly conditionDialects = conditionDialects;
  static readonly conditionDialectOf = conditionDialectOf;
  static readonly compileAbsentRelation = compileAbsentRelation;
  static readonly isAbsenceSymbol = isAbsenceSymbol;
  static readonly isObjectDomainMissingOperand = isObjectDomainMissingOperand;
  static readonly operandMayBeAbsent = operandMayBeAbsent;
  static readonly ATOMIC_FRAGMENT = ATOMIC_FRAGMENT;
  static readonly mayBeUndecided = mayBeUndecided;
  static readonly compileGuardTest = compileGuardTest;
  static readonly conditionDecidability = conditionDecidability;
  static get conditionNode() {
    return core.conditionNode;
  }
  static set conditionNode(f: CoreHooks['conditionNode']) {
    core.conditionNode = f;
  }
  static readonly operandInputNodes = operandInputNodes;
  static readonly connectiveNode = connectiveNode;
  static readonly isDecidedByConstruction = isDecidedByConstruction;
  static readonly operandDecidedConjuncts = operandDecidedConjuncts;
  static readonly isOmittableRead = isOmittableRead;
  static readonly presenceTest = presenceTest;
  static readonly isVarsObjectRead = isVarsObjectRead;
  static readonly noBranchValue = noBranchValue;
  static readonly absenceKind = absenceKind;
  static readonly unsuppliedReads = unsuppliedReads;
  static readonly withNanEscape = withNanEscape;
  static readonly _guardEmitting = _guardEmitting;
  static readonly _truthOnly = _truthOnly;
  static readonly withTruthOnly = withTruthOnly;
  static readonly isBooleanBindingType = isBooleanBindingType;
  static readonly markTruthOnlyNode = markTruthOnlyNode;
  static readonly truthOnlyEligible = truthOnlyEligible;
  static readonly unsuppliedComparisonGuard = unsuppliedComparisonGuard;
  static get _poisonConditions() {
    return CompilerState._poisonConditions;
  }
  static set _poisonConditions(v: (typeof CompilerState)['_poisonConditions']) {
    CompilerState._poisonConditions = v;
  }
  static get _directInputsOnly() {
    return CompilerState._directInputsOnly;
  }
  static set _directInputsOnly(v: (typeof CompilerState)['_directInputsOnly']) {
    CompilerState._directInputsOnly = v;
  }
  static readonly poisonSlot = poisonSlot;
  static readonly mayReturnFunction = mayReturnFunction;
  static readonly mayHoldFunctionType = mayHoldFunctionType;
  static readonly hasEffectNode = hasEffectNode;
  static get _noValueUsed() {
    return CompilerState._noValueUsed;
  }
  static set _noValueUsed(v: (typeof CompilerState)['_noValueUsed']) {
    CompilerState._noValueUsed = v;
  }
  static readonly catchNoValue = catchNoValue;
  static readonly clearNoValue = clearNoValue;
  static readonly guardTakesOperands = guardTakesOperands;
  static readonly lazyChain = lazyChain;
  static readonly testsFirst = testsFirst;
  static readonly isTopTypedOperand = isTopTypedOperand;
  static readonly isNanLiteral = isNanLiteral;
  static readonly scalarOperandKind = scalarOperandKind;
  static readonly ABSENCE_AS_NAN_OPERATORS = ABSENCE_AS_NAN_OPERATORS;
  static readonly readsAbsenceAsNaN = readsAbsenceAsNaN;
  static readonly withBoundOperands = withBoundOperands;
  static readonly nanCanDecide = nanCanDecide;
  static readonly withNanTerms = withNanTerms;
  static readonly nanEscapeTerms = nanEscapeTerms;
  static readonly absentComparisonGuard = absentComparisonGuard;
  static readonly absentOnlyThroughNumericSlots = absentOnlyThroughNumericSlots;
  static readonly isNumericOrVerdictShaped = isNumericOrVerdictShaped;
  static readonly isNumericShaped = isNumericShaped;
  static readonly absentDomainIsObject = absentDomainIsObject;
  static readonly peelNegations = peelNegations;
  static readonly kleeneCondition = kleeneCondition;
  static get kleeneConditionParts() {
    return core.kleeneConditionParts;
  }
  static set kleeneConditionParts(f: CoreHooks['kleeneConditionParts']) {
    core.kleeneConditionParts = f;
  }
  static readonly kleeneValueLeaf = kleeneValueLeaf;
  static readonly kleeneRelationLeaf = kleeneRelationLeaf;
  static readonly kleeneConnective = kleeneConnective;
  static readonly withConditionOperands = withConditionOperands;
  static readonly exactSelect = exactSelect;
  static readonly compileExactCondition = compileExactCondition;
  static readonly isIntegerValued = isIntegerValued;
  static readonly isNonNegative = isNonNegative;
  static readonly MATCH_SWITCH_THRESHOLD = MATCH_SWITCH_THRESHOLD;
  static readonly isIrrefutableCase = isIrrefutableCase;
  static readonly matchCaseComparisons = matchCaseComparisons;
  static readonly compileMatchConstant = compileMatchConstant;
  static readonly matchLeafCondition = matchLeafCondition;
  static readonly inCompiledScope = inCompiledScope;
  static readonly canonicalInCompiledScope = canonicalInCompiledScope;
  static readonly compileMatchBody = compileMatchBody;
  static readonly compileMatchGuard = compileMatchGuard;
  static readonly matchCaptureTarget = matchCaptureTarget;
  static readonly compileMatchJS = compileMatchJS;
  static readonly assertBreakLeavesWholeLoop = assertBreakLeavesWholeLoop;
  static readonly escapingControl = escapingControl;
  static readonly emitMatchCaseJS = emitMatchCaseJS;
  static readonly matchCaseTest = matchCaseTest;
  static readonly compileMatchStatement = compileMatchStatement;
  static readonly compileMatchStatementBody = compileMatchStatementBody;
  static readonly emitMatchConstructorCaseJS = emitMatchConstructorCaseJS;
  static readonly matchConstructorTest = matchConstructorTest;
  static readonly sumBucketTest = sumBucketTest;
  static get walkConstructorPattern() {
    return core.walkConstructorPattern;
  }
  static set walkConstructorPattern(f: CoreHooks['walkConstructorPattern']) {
    core.walkConstructorPattern = f;
  }
  static readonly walkConstructorElement = walkConstructorElement;
  static get walkMatchShape() {
    return core.walkMatchShape;
  }
  static set walkMatchShape(f: CoreHooks['walkMatchShape']) {
    core.walkMatchShape = f;
  }
  static readonly walkMatchElement = walkMatchElement;
  static readonly matchSwitchable = matchSwitchable;
  static readonly emitMatchSwitch = emitMatchSwitch;
  static readonly compileMatchTernary = compileMatchTernary;
  static readonly tryFoldKnownSymbol = tryFoldKnownSymbol;
  static readonly foldedValueInRadians = foldedValueInRadians;
  static readonly _radianValues = _radianValues;
  static readonly _inlineFoldInProgress = _inlineFoldInProgress;
  static readonly foldCaptureRefusal = foldCaptureRefusal;
  static readonly selfReferenceRefusal = selfReferenceRefusal;
  static readonly bindsFoldedValue = bindsFoldedValue;
  static readonly foldedValueName = foldedValueName;
  static readonly ensureFoldedValueEmitted = ensureFoldedValueEmitted;
  static readonly HOISTED_LIST_LITERAL_MIN_LENGTH =
    HOISTED_LIST_LITERAL_MIN_LENGTH;
  static readonly hoistConstantListLiteral = hoistConstantListLiteral;
  static readonly hoistSeededDraw = hoistSeededDraw;
  static readonly constantListLiteral = constantListLiteral;
  static readonly expandedFoldSize = expandedFoldSize;
  static readonly binderBoundNames = binderBoundNames;
  static readonly assertFoldableSize = assertFoldableSize;
  static readonly declaredUserSignature = declaredUserSignature;
  static readonly wholeTupleCall = wholeTupleCall;
  static readonly localCallWithResultType = localCallWithResultType;
  static readonly assertParameterWritesInUnit = assertParameterWritesInUnit;
  static readonly assertParameterWritesMatchTypes =
    assertParameterWritesMatchTypes;
  static readonly bodyWithArguments = bodyWithArguments;
  static readonly isElementCall = isElementCall;
  static readonly declaredScalarTupleCall = declaredScalarTupleCall;
  static readonly userFunctionLiteral = userFunctionLiteral;
  static readonly assertCapturedTypesCurrent = assertCapturedTypesCurrent;
  static readonly blockLocalFunction = blockLocalFunction;
  static readonly registryLocalName = registryLocalName;
  static readonly registryHelperName = registryHelperName;
  static readonly userFunctionName = userFunctionName;
  static readonly hasUniformComplexScalarElements =
    hasUniformComplexScalarElements;
  static readonly assertCallbackLaneMatch = assertCallbackLaneMatch;
  static readonly complexElementCallbackEta = complexElementCallbackEta;
  static readonly assertBuiltinCallbackUsable = assertBuiltinCallbackUsable;
  static readonly provablyScalarOrFramedScalar = provablyScalarOrFramedScalar;
  static readonly laneRequestParamType = laneRequestParamType;
  static readonly addDeclaredComplexParams = addDeclaredComplexParams;
  static readonly checkUserCallArity = checkUserCallArity;
  static readonly tryCompileUserFunction = tryCompileUserFunction;
  static readonly checkedParameterType = checkedParameterType;
  static readonly userFunctionSignatureIsInferred =
    userFunctionSignatureIsInferred;
  static readonly parameterCheckNeeded = parameterCheckNeeded;
  static readonly declaredParameterCheck = declaredParameterCheck;
  static readonly uncheckedParameterError = uncheckedParameterError;
  static readonly intervalParameterDomain = intervalParameterDomain;
  static readonly localParameterChecks = localParameterChecks;
  static readonly appliedLiteralCheckedCall = appliedLiteralCheckedCall;
  static readonly intervalCheckingCallee = intervalCheckingCallee;
  static readonly localCheckingCallee = localCheckingCallee;
  static readonly argumentProvesParameterType = argumentProvesParameterType;
  static readonly staticTypeIsEvidence = staticTypeIsEvidence;
  static readonly _blockStatements = _blockStatements;
  static readonly _provingLocals = _provingLocals;
  static readonly assignmentsProveType = assignmentsProveType;
  static readonly checkingShimName = checkingShimName;
  static readonly failedCheckMarker = failedCheckMarker;
  static readonly ABSENCE_DISCHARGING_HEADS = ABSENCE_DISCHARGING_HEADS;
  static readonly COLLECTION_HOLDING_HEADS = COLLECTION_HOLDING_HEADS;
  static readonly collectionReadInputs = collectionReadInputs;
  static readonly mayBeAbsentCollection = mayBeAbsentCollection;
  static readonly mayBeAbsentCollectionNode = mayBeAbsentCollectionNode;
  static readonly checkedCallMayBeAbsent = checkedCallMayBeAbsent;
  static readonly checkingShimTests = checkingShimTests;
  static readonly tryCompilePointListCall = tryCompilePointListCall;
  static readonly scalarSlotListArgs = scalarSlotListArgs;
  static readonly compileUntypedScalarSlotCall = compileUntypedScalarSlotCall;
  static readonly scalarSlotElementType = scalarSlotElementType;
  static readonly untypedPointListElement = untypedPointListElement;
  static readonly checkPointListAtMatrixUnionArgs =
    checkPointListAtMatrixUnionArgs;
  static readonly checkScalarListAtContractPointParam =
    checkScalarListAtContractPointParam;
  static readonly checkPointParamCollectionUnionArgs =
    checkPointParamCollectionUnionArgs;
  static readonly checkListCoordinateTupleArgs = checkListCoordinateTupleArgs;
  static readonly tryCompileLocalFunctionCall = tryCompileLocalFunctionCall;
  static readonly complexWrapCode = complexWrapCode;
  static readonly absentArgumentChecks = absentArgumentChecks;
  static readonly presentCheckedCode = presentCheckedCode;
  static readonly emitUserFunctionCall = emitUserFunctionCall;
  static readonly isNominalAtomicArg = isNominalAtomicArg;
  static readonly isNominalAtomicType = isNominalAtomicType;
  static readonly signatureParamsLowerToScalars = signatureParamsLowerToScalars;
  static readonly withCellSlotsAsElements = withCellSlotsAsElements;
  static readonly userFunctionParamsAreScalar = userFunctionParamsAreScalar;
  static readonly userFunctionHasBroadcastableParam =
    userFunctionHasBroadcastableParam;
  static readonly userFunctionBroadcastPlan = userFunctionBroadcastPlan;
  static readonly complexCoordinateArgumentAt = complexCoordinateArgumentAt;
  static readonly writtenPointWithComplexCoordinateAt =
    writtenPointWithComplexCoordinateAt;
  static readonly throughTyped = throughTyped;
  static readonly isSinglePointArg = isSinglePointArg;
  static readonly isShaderVectorListArg = isShaderVectorListArg;
  static readonly isRealListArg = isRealListArg;
  static readonly pointArgumentAtUntypedParameter =
    pointArgumentAtUntypedParameter;
  static readonly listArgumentAtOpenWholeParameter =
    listArgumentAtOpenWholeParameter;
  static readonly isElementWiseOperand = isElementWiseOperand;
  static readonly provablyScalarArg = provablyScalarArg;
  static readonly certainlyScalarArg = certainlyScalarArg;
  static readonly checkDeclaredBroadcast = checkDeclaredBroadcast;
  static readonly bakedTupleValueType = bakedTupleValueType;
  static readonly checkDeclaredBroadcastAgainst = checkDeclaredBroadcastAgainst;
  static readonly userFunctionParamType = userFunctionParamType;
  static readonly signatureParamType = signatureParamType;
  static readonly userFunctionSignature = userFunctionSignature;
  static readonly groundSignature = groundSignature;
  static readonly multiClauseParamIsComplex = multiClauseParamIsComplex;
  static readonly laneMismatchAt = laneMismatchAt;
  static readonly multiClauseLaneMismatchAt = multiClauseLaneMismatchAt;
  static readonly userFunctionIsGeneric = userFunctionIsGeneric;
  static readonly tryInlineUserFunctionCall = tryInlineUserFunctionCall;
  static readonly inlinedUserFunctionCall = inlinedUserFunctionCall;
  static readonly substitutedUserFunctionBody = substitutedUserFunctionBody;
  static readonly MAX_NESTED_INLINES = MAX_NESTED_INLINES;
  static readonly inlineCollectionValuedCallsAtRoot =
    inlineCollectionValuedCallsAtRoot;
  static readonly inlineCollectionValuedCalls = inlineCollectionValuedCalls;
  static readonly inlineCollectionValuedCallsOnce =
    inlineCollectionValuedCallsOnce;
  static readonly inlineCollectionValuedCallsInDefinitionBody =
    inlineCollectionValuedCallsInDefinitionBody;
  static readonly enclosingDefinitionOf = enclosingDefinitionOf;
  static readonly isUntypedFreeInput = isUntypedFreeInput;
  static readonly typeWithFreeInputsAsNumbers = typeWithFreeInputsAsNumbers;
  static readonly readsAsScalarThroughFreeInputs =
    readsAsScalarThroughFreeInputs;
  static readonly operandTypeInContext = operandTypeInContext;
  static readonly isUnionOfPoints = isUnionOfPoints;
  static readonly pointOrPointListUnion = pointOrPointListUnion;
  static readonly declaredPointAdmitsListCoordinate =
    declaredPointAdmitsListCoordinate;
  static readonly paramElementTypeIsOpen = paramElementTypeIsOpen;
  static readonly trySpecializedUserCall = trySpecializedUserCall;
  static get ensureSpecializedUserCallEmitted() {
    return core.ensureSpecializedUserCallEmitted;
  }
  static set ensureSpecializedUserCallEmitted(
    f: CoreHooks['ensureSpecializedUserCallEmitted']
  ) {
    core.ensureSpecializedUserCallEmitted = f;
  }
  static readonly literalWithParameterTypes = literalWithParameterTypes;
  static readonly radicalNeedsSignProof = radicalNeedsSignProof;
  static get unprovenRadicalCount() {
    return core.unprovenRadicalCount;
  }
  static set unprovenRadicalCount(f: CoreHooks['unprovenRadicalCount']) {
    core.unprovenRadicalCount = f;
  }
  static readonly parameterTypesKey = parameterTypesKey;
  static readonly cachedLiteralWithParameterTypes =
    cachedLiteralWithParameterTypes;
  static readonly parametersCanBeTyped = parametersCanBeTyped;
  static readonly numericRangeOf = numericRangeOf;
  static readonly rangeSpecializedParameterTypes =
    rangeSpecializedParameterTypes;
  static readonly declaredParameterLiteral = declaredParameterLiteral;
  static get ensureUserFunctionEmitted() {
    return core.ensureUserFunctionEmitted;
  }
  static set ensureUserFunctionEmitted(
    f: CoreHooks['ensureUserFunctionEmitted']
  ) {
    core.ensureUserFunctionEmitted = f;
  }
  static readonly literalAtGroundSignature = literalAtGroundSignature;
  static readonly markerAtGroundSignature = markerAtGroundSignature;
  static readonly BUILTIN_FOLD_HEADS = BUILTIN_FOLD_HEADS;
  static readonly foldLaneIsComplex = foldLaneIsComplex;
  static readonly combinerPlan = combinerPlan;
  static readonly appliedDerivativeLiteral = appliedDerivativeLiteral;
  static readonly appliedDerivativeDeclineReason =
    appliedDerivativeDeclineReason;
  static readonly appliedDerivativeTooLarge = appliedDerivativeTooLarge;
  static readonly appliedArgumentTypeMismatch = appliedArgumentTypeMismatch;
  static readonly withDerivativeArgument = withDerivativeArgument;
  static readonly compileCombinerLiteral = compileCombinerLiteral;
  static readonly ensureUserFunctionValueRef = ensureUserFunctionValueRef;
  static readonly listSpecializedValueRef = listSpecializedValueRef;
  static readonly multiClauseValueRef = multiClauseValueRef;
  static readonly scalarFedLiterals = scalarFedLiterals;
  static readonly withScalarFedLiteral = withScalarFedLiteral;
  static readonly markScalarFedLiterals = markScalarFedLiterals;
  static readonly callOnlyLocalFunctionLiterals = callOnlyLocalFunctionLiterals;
  static readonly broadcastingWrapper = broadcastingWrapper;
  static readonly complexCoercingWrapper = complexCoercingWrapper;
  static readonly lastCallMemoEligible = lastCallMemoEligible;
  static get emitFunctionLiteralDefinition() {
    return core.emitFunctionLiteralDefinition;
  }
  static set emitFunctionLiteralDefinition(
    f: CoreHooks['emitFunctionLiteralDefinition']
  ) {
    core.emitFunctionLiteralDefinition = f;
  }
  static readonly ensureBuiltinCallbackEmitted = ensureBuiltinCallbackEmitted;
  static readonly ensureHostOperatorCallbackEmitted =
    ensureHostOperatorCallbackEmitted;
  static readonly builtinCallbackValueRef = builtinCallbackValueRef;
  static readonly definitionBodyExpr = definitionBodyExpr;
  static readonly emitListRecursionLoop = emitListRecursionLoop;
  static readonly prepareUserFunctionBody = prepareUserFunctionBody;
  static readonly recordScalarParams = recordScalarParams;
  static readonly literalDeclaredParamTypes = literalDeclaredParamTypes;
  static readonly declaredParamType = declaredParamType;
  static readonly tryEmitMultiClauseFunction = tryEmitMultiClauseFunction;
  static readonly jsParameterGuard = jsParameterGuard;
  static readonly jsCollectionShapeGuard = jsCollectionShapeGuard;
  static readonly jsClauseParamGuard = jsClauseParamGuard;
  static readonly compileDefinitionBody = compileDefinitionBody;
  static readonly recordCallerHandlerCode = recordCallerHandlerCode;
  static readonly addCompileHelpers = addCompileHelpers;
  static readonly userFunctionsPreamble = userFunctionsPreamble;
  static readonly identifierPattern = identifierPattern;
  static get pruneUnreferencedVariantBases() {
    return core.pruneUnreferencedVariantBases;
  }
  static set pruneUnreferencedVariantBases(
    f: CoreHooks['pruneUnreferencedVariantBases']
  ) {
    core.pruneUnreferencedVariantBases = f;
  }
  static readonly fieldArgsWithDeclaredReceiver = fieldArgsWithDeclaredReceiver;
  static readonly receiverWithDeclaredType = receiverWithDeclaredType;
  static readonly protocolCallParts = protocolCallParts;
  static readonly matchesTypeText = matchesTypeText;
  static readonly matchesTypeLowerable = matchesTypeLowerable;
  static readonly compileMatchesTypeJS = compileMatchesTypeJS;
  static readonly jsTypeTest = jsTypeTest;
  static readonly renderReceiverGuard = renderReceiverGuard;
  static readonly tryCompileProtocolDispatch = tryCompileProtocolDispatch;
  static readonly STRUCTURAL_HEADS = STRUCTURAL_HEADS;
  static readonly analyzeReferences = analyzeReferences;
  static readonly withReferences = withReferences;
  static readonly freeSymbolTypes = freeSymbolTypes;
  static readonly declaredTypeText = declaredTypeText;
  static readonly defaultLoweredSymbolType = defaultLoweredSymbolType;
  static readonly modeReport = modeReport;
  static readonly declineReport = declineReport;
  static readonly buildInterpreterFallback = buildInterpreterFallback;
  static readonly withBoundScope = withBoundScope;
  static readonly withBoundNames = withBoundNames;
  static readonly namingContext = namingContext;
  static readonly newNamingContext = newNamingContext;
  static readonly resetNaming = resetNaming;
  static readonly tempVar = tempVar;
  static readonly jetDerivativeLowering = jetDerivativeLowering;
  static readonly cseTempVar = cseTempVar;
  static readonly openCseSession = openCseSession;
  static readonly mergeUsedNames = mergeUsedNames;
  static readonly cseRegionOf = cseRegionOf;
  static readonly cseHarvestOf = cseHarvestOf;
  static readonly cseTop = cseTop;
  static readonly pushCseInstance = pushCseInstance;
  static readonly withCseRegion = withCseRegion;
  static readonly withCseLocalInstance = withCseLocalInstance;
  static readonly withCseOperand = withCseOperand;
  static readonly withCseScope = withCseScope;
  static readonly compileOp = compileOp;
  static readonly compileOpValue = compileOpValue;
  static readonly hasObservableEffect = hasObservableEffect;
  static readonly operandAt = operandAt;
  static readonly compileCseRoot = compileCseRoot;
  static readonly hoistLoopInvariants = hoistLoopInvariants;
  static readonly cseAdmission = cseAdmission;
  static readonly isEmissionSkippable = isEmissionSkippable;
  static readonly loopInvariantHoistCandidates = loopInvariantHoistCandidates;
  static readonly assignedNamesIn = assignedNamesIn;
  static readonly ARITHMETIC_HEADS = ARITHMETIC_HEADS;
  static readonly EXPENSIVE_PREFIX_HEADS = EXPENSIVE_PREFIX_HEADS;
  static readonly invariantPrefixes = invariantPrefixes;
  static readonly computeInvariantPrefixes = computeInvariantPrefixes;
  static readonly synthesizeInvariantPrefixes = synthesizeInvariantPrefixes;
  static readonly assertExtraParamsRead = assertExtraParamsRead;
  static readonly ensureUserFunctionVariantEmitted =
    ensureUserFunctionVariantEmitted;
  static readonly withNestedCseHarvest = withNestedCseHarvest;
  static readonly withOwnCseHarvest = withOwnCseHarvest;
  static readonly withoutNodeCodeOverrides = withoutNodeCodeOverrides;
  static readonly withCseIsolatedInstance = withCseIsolatedInstance;
  static readonly withCseBlind = withCseBlind;
  static readonly operandCompiler = operandCompiler;
  static readonly availableCseBinding = availableCseBinding;
  static readonly mentionsAnySymbol = mentionsAnySymbol;
  static readonly hasSharedExpression = hasSharedExpression;
  static get compileWithCse() {
    return core.compileWithCse;
  }
  static set compileWithCse(f: CoreHooks['compileWithCse']) {
    core.compileWithCse = f;
  }
  static readonly _cseInlineCode = _cseInlineCode;
  static readonly foldEmitted = foldEmitted;
  static readonly inlineExpression = inlineExpression;
}

export { installUnrolledBigOpLane } from './compile-lanes.js';
export type {
  EnclosingDefinition,
  ConditionDialect,
  ConditionNode,
  ElementBinder,
  MatchStatementClause,
  LoopInvariantBinding,
} from './compiler-types.js';
export { CONDITION_DIALECT_JS } from './compile-conditions.js';
export {
  hasEnclosureSymbol,
  compilationType,
  literalHasNoDoubleValue,
  isProvablyStringOperand,
  isProvablyCharacterOperand,
  unfaithfulComparisonAggregate,
  isProvablyNonTupleCollectionParticipant,
  isProvablyTupleParticipant,
  isNumericTupleParticipant,
  isProvablyStringComparisonParticipant,
  stringEvidenceSource,
  isFlatAllStringComparisonParticipant,
  couldBeCollectionParticipant,
  isMixedStringOrderingParticipants,
  unionAdmitsIndexedCollection,
  isGatedIndexedCollection,
  shapeOperandRefusal,
  countMayBeNaN,
  exactRationalDivisor,
  isDeclaredTopOperand,
  isDeclaredTopListOperand,
  isTopTypedLocalSymbol,
  isProvablyNumericListOperand,
  isGatedNumericListOperand,
  isGatedListComponent,
  everyPointCoordinateIsNumeric,
  mayHoldNumericArrayOfRank,
  pointHasBroadcastComponent,
  explicitBroadcastPointNorm,
} from './compiler-type-facts.js';
export {
  statementBodyHead,
  isTailAssignmentBlock,
} from './compile-statements.js';
