// The compiler core: compile, compileExpr and the other hub functions of the
// mutual recursion. It imports every handler module and installs the hubs in
// the record of compiler-core-hooks.ts.

import { isIndexReadTuple } from '../boxed-expression/index-read-tuple.js';
import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import {
  boundNamesAddedBy,
  isConstructedScalar,
  recordConstructedPointParams,
  provenScalarPointWidth,
} from './javascript-value-facts.js';
import { javascriptStatements } from './javascript-statements.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  isNonSquareMatrixPower,
  isSquareMatrixPower,
} from '../boxed-expression/boxed-function.js';
import { lookupApplicable } from '../function-utils.js';
import {
  isBroadcastablePointType,
  isNestedPointCollectionType,
  isPointListValue,
  isTextAtom,
  isTuple,
  isTupleWithListCoordinate,
} from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
  kindArmNames,
  withoutKindArms,
} from '../../common/type/utils.js';
import {
  holdsKindValue,
  holdsKindValueForCertain,
  kindTypesHeldBy,
  typeIsKindForCertain,
} from '../boxed-expression/residue-class.js';
import { kindTypeNames } from '../boxed-expression/value-kinds.js';
import { multiClauseState } from '../multi-clause.js';
import { hasEnclosureArm } from '../library/enclosure-compile.js';
import { isSubtype, provablyAdmits } from '../../common/type/subtype.js';
import { typeToIdentityKey } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import { hasOneSidedLimits, withDefaultBigOpBounds } from '../library/utils.js';
import {
  isSymbol,
  isNumber,
  isString,
  isCharacter,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { ABS_ARG_REFUSAL, containsDerivativeHead } from './angular-unit.js';
import { sumVariantInfo, taggedSumInType } from '../sum-representation.js';
import type { ShapeNode } from '../boxed-expression/match-dispatch.js';
import type { CompileTarget, InvariantPrefix, TargetSource } from './types.js';
import { CompileDeclineError } from './diagnostics.js';
import { isColorValued } from './color-space-fact.js';
import { candidateAt, isCallerMapped } from './cse.js';
import {
  arraysArePoints,
  compilationType,
  hasEnclosureSymbol,
  isBoundPossiblyCollectionTyped,
  isGatedPoint,
  isGatedPointList,
  isPointSumOperand,
  isRuntimePointShaped,
  literalDoubleRoundings,
  literalHasNoDoubleValue,
  typeHasPointArm,
  unionAdmitsFlatNumericList,
} from './compiler-type-facts.js';
import { CompilerState } from './compiler-state.js';
import {
  absentCollectionOperandGuard,
  assertCapturedCallableBindings,
  assertUserFunctionFreeBindings,
  tryCompileLocalFunctionCall,
  tryCompileUserFunction,
} from './compile-user-functions.js';
import {
  assertParameterWritesInUnit,
  blockLocalFunction,
  localCallWithResultType,
  signatureParamType,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import {
  PROMOTABLE_RADICAL_HEADS,
  _codeAliases,
  _codeOverrides,
  _pushComplexMemoLayer,
  _withFoldedRealOverride,
  hasPromotedDefinition,
  isRealOnlyLowering,
  liftPromotionSuppression,
  notePromoted,
  promotedDefinitions,
  radicalCountMemos,
  restorePromotionSuppression,
  runtimeRealGuards,
  strictLanes,
  wideIsComplex,
  withPromotionUnsuppressed,
} from './compiler-mode.js';
import { compileKindOperation, kindLoweringOf } from './compile-kinds.js';
import {
  compileMatchesTypeJS,
  fieldArgsWithDeclaredReceiver,
  matchesTypeLowerable,
  protocolCallParts,
  tryCompileProtocolDispatch,
} from './compile-protocol-dispatch.js';
import { newNamingContext, tempVar } from './compiler-naming.js';
import {
  absenceAxisForType,
  absentComparisonGuard,
  absentOnlyThroughNumericSlots,
  compileAbsentRelation,
  conditionDecidability,
  connectiveNode,
  guardTakesOperands,
  isAbsenceSymbol,
  isNanLiteral,
  isNumericOrVerdictShaped,
  isObjectDomainMissingOperand,
  kleeneRelationLeaf,
  kleeneValueLeaf,
  mayBeUndecided,
  operandInputNodes,
  operandMayBeAbsent,
  peelNegations,
  unsuppliedComparisonGuard,
  userFunctionSignature,
  withConditionOperands,
} from './compile-absence.js';
import {
  appliesToEachTupleCoordinate,
  compileExprOperator,
  compileLocallyBoundLibraryCall,
  findShadowedLibraryLowering,
  spliceSpreadOperands,
} from './compile-operators.js';
import {
  CONSTANT_FOLD_MAX_COLLECTION_SIZE,
  CONSTANT_FOLD_MAX_COST,
  CONSTANT_FOLD_MAX_DEPTH,
  CONSTANT_FOLD_MAX_INLINE_ELEMENTS,
  CONSTANT_FOLD_MAX_VISITS,
  CONSTANT_FOLD_MAX_WALK,
  FOLD_QUADRATURE_EVALS,
  MONTE_CARLO_FOLD_EXCLUSIONS,
  _invalidateComplexMemo,
  bigOpTripCount,
  callbackApplicationCost,
  calleeBodyCost,
  closedExactJump,
  exactFoldValue,
  foldValueBlocked,
  foldValueImpure,
  foldableCollectionElements,
  reachesCallerCode,
  foldedRealNumber,
  hasUnknowns,
  jumpShiftRewrite,
  parametersCanBeTyped,
  reachesAbsArg,
  recordJumpFoldReads,
  resetCompilationMemos,
  staticCollectionSize,
  tryConstantFold,
  unsafeIntegerOperands,
} from './compile-folding.js';
import {
  readsAngularDefinition,
  resetSharedCompilationBudgets,
} from './compile-integrals.js';
import {
  _operandElementLane,
  emitWithRecursiveLaneRetry,
  isProvablyNonReal,
  laneMismatch,
  realEntriesType,
  realGuardCandidate,
  realOperandChain,
  recordUserFunctionLane,
  resolveCompileMode,
  structuralOperandLane,
  userCallElementLane,
} from './compile-lanes.js';
import {
  _enterUnrolledIndexBinder,
  _exitUnrolledIndexBinder,
  _popComplexMemoLayer,
  complexDiscipline,
  declareValueOperand,
  desugarPatternAssign,
  desugarPatternDeclare,
  modePromotes,
  promotionActive,
  withEnforcedParams,
} from './compile-declarations.js';
import {
  _compileParents,
  _cseInlineCode,
  assertAssignmentIsStatement,
  compileListStatement,
  compileValueOperand,
  loopBodyTempTarget,
} from './compile-statements.js';
import {
  _broadcastRadicalVerdict,
  assumedRealNonNegative,
  constantPoleOrdering,
  hasNonIntegerRealCell,
  isArrayOperand,
  knownExponentPower,
  negativeBaseFloatPower,
  realPowerExponent,
} from './compile-real-analysis.js';
import {
  availableCseBinding,
  compileOp,
  cseTempVar,
  foldEmitted,
  isEmissionSkippable,
  isSinglePointArg,
  userFunctionIsGeneric,
  userFunctionName,
  withCseBlind,
  withCseScope,
  withNestedCseHarvest,
} from './compile-cse.js';
import { core } from './compiler-core-hooks.js';
import type { CoreHooks } from './compiler-core-hooks.js';
import {
  _complexValueInProgress,
  _isComplexValuedFunction,
  _setLocalComplex,
  broadcastLeafComplexness,
  checkNestedComplexRebinding,
  declaredTypeIsReal,
  localComplexDefault,
  localIsBound,
  markLocalBound,
  mayHoldComplexElement,
  withCollectionElements,
  withRealLoopIndices,
} from './compile-complexness.js';
import {
  ARITHMETIC_HEADS,
  COMPLEX_PROPAGATING_HEADS,
  CONTROL_FLOW_HEADS,
  ELEMENTWISE_WIDTH_OPERATORS,
  ORDERING_HEADS,
  OVERRIDABLE_CONTROL_FLOW_HEADS,
  TUPLE_ARITHMETIC_HEADS,
  memoFor,
} from './compiler-tables.js';
import type {
  ConditionDialect,
  ConditionNode,
  DeclineNote,
  ElementLane,
  FoldCostContext,
  UserFunctionRegistry,
} from './compiler-types.js';
import {
  assertNoAmbiguousComplexElementRead,
  containsUnboundedBigOp,
  isTabulateWithNonPositiveDimension,
  mentionsCompileBoundName,
  mentionsExcludedName,
  reachesExcludedName,
} from './compiler-names.js';
import {
  _userFunctionLanes,
  addDeclaredComplexParams,
  compileDefinitionBody,
  emitListRecursionLoop,
  prepareUserFunctionBody,
  recordCallerHandlerCode,
  recordScalarParams,
  removeDefinitionsAddedSince,
  shadowedLibraryLoweringError,
  tryEmitMultiClauseFunction,
  userFunctionLanes,
} from './compile-definitions.js';
import {
  assertCollectionOmissionSupported,
  assertNoProvedAbsentObjectOperand,
  assertOrderedOperandsAreNumbers,
  compileInnerSymbol,
  complexShapedEmission,
  liftWideResult,
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
  noLoweringMessage,
} from './compile-expr-handlers.js';
import {
  BRANCH_RELATIONS,
  CONDITION_DIALECT_JS,
  assertNoContradictedScalarOperand,
  assertScalarCondition,
  booleanClaim,
  cseRegionOf,
  isContradictedScalarDeclaration,
  isContradictedScalarFunctionBody,
  isStatementArm,
  kleeneCondition,
  kleeneConnective,
  liveSelectionArms,
  withCseOperand,
  withCseRegion,
} from './compile-conditions.js';
import {
  compileExprFunctionCall,
  compileExprTupleCall,
} from './compile-calls.js';
import {
  _popLocalComplex,
  _pushLocalComplex,
  compileComprehension,
  compileForLoop,
  compileLoop,
  lexicalFunctionScope,
  newLocalFunctionScope,
  noteLocalFunction,
  reboundFunctionScope,
  reboundLocalNames,
  scalarConditionTarget,
} from './compile-loops.js';
import {
  assertExtraParamsRead,
  declaredPointAdmitsListCoordinate,
  isRealListArg,
  isShaderVectorListArg,
  isUnionOfPoints,
  operandTypeInContext,
  paramElementTypeIsOpen,
  userFunctionParamType,
} from './compile-user-calls.js';
import {
  compileExprAssertPresent,
  compileExprIf,
  compileExprMissingEquality,
  compileExprWhen,
  compileExprWhich,
  kleeneValueConnective,
} from './compile-conditionals.js';
import {
  compileMatrixProduct,
  compileRuntimeMatrixPower,
} from './compile-linear-algebra.js';
import { compileExprFunctionLiteral } from './compile-function-literals.js';
import {
  compileMatchJS,
  compileMatchStatement,
  sumBucketTest,
  walkConstructorElement,
  walkMatchElement,
} from './compile-match.js';
import { compileBlock, compileStatementList } from './compile-blocks.js';
import {
  assertLocalsAssignedBeforeRead,
  assertNoUseBeforeDeclare,
  chainedLocalDeclares,
  checkedLocalReads,
  classifyLocalReads,
  hideCheckedLocals,
  readsBlockLocal,
  refuseEffectContractViolations,
  splitChainedAssignments,
  withDefineFunctionDeclares,
  withImplicitLocalDeclares,
} from './compile-locals.js';
import {
  _shapeFrameOwner,
  isNonScalarByShapeAlone,
  withoutAbsentArms,
} from './compile-shapes.js';
import {
  declaredParameterLiteral,
  literalAtGroundSignature,
  radicalNeedsSignProof,
  rangeSpecializedParameterTypes,
} from './compile-user-specialization.js';
import {
  cachedLiteralWithParameterTypes,
  lastCallMemoEligible,
  literalWithParameterTypes,
  parameterTypesKey,
} from './compile-callbacks.js';
import { identifierPattern } from './compile-folded-values.js';

export function compile(
  expr: Expression | undefined,
  target: CompileTarget<Expression>,
  prec = 0
): TargetSource {
  if (expr === undefined) return '';
  // Check before folding/inlining can replace a captured call by its body.
  if (CompilerState._compileDepth === 0) {
    assertCapturedCallableBindings(expr, target);
    assertUserFunctionFreeBindings(expr, target);
    assertParameterWritesInUnit(expr);
  }

  // A node whose emission the D2/D6 runtime rule has BOUND to a temporary
  // (`realOperandGuard`): the real lowering re-emits its head with the
  // operand's code replaced by the temporary's real projection.
  const override = _codeOverrides.get(expr);
  if (override !== undefined) return override;
  const alias = _codeAliases.get(expr);
  if (alias !== undefined) return alias;
  if (!expr.isValid) {
    throw new Error(
      `Could not compile invalid expression: "${expr.toString()}"`
    );
  }
  // First-class type values do not compile — a reified type expression has
  // no runtime representation on any target, and the type-algebra
  // operators consult the engine's type registry, which compiled code does
  // not carry. This is the SHARED boundary the design prescribes
  // (`docs/TYPE-SYSTEM.md`): one gate covers
  // every target — including `interval-js`, whose unknown-operator path
  // emits empty code instead of rejecting (ROADMAP.md, "The `interval-js`
  // compile target emits EMPTY code"), and custom registered targets. Two
  // checks, both deliberately narrow:
  //
  // 1. A node whose result type is EXACTLY the `type` primitive (a settled
  //    `TypeFrom` node, a `type`-typed symbol or parameter). Exact
  //    equality, never `matches('type')`: declared types are routinely
  //    wider than runtime values, and a wide-typed operand must not trip a
  //    static gate (the compile-type-gate rule, `docs` plan §3.3).
  // 2. A type-comparison head whose operands are NOT all ground type
  //    values or literal type text. A GROUND call is exempt on purpose:
  //    constant folding evaluates it through the interpreter to its
  //    correct boolean — right code, not wrong code — and the fold must
  //    keep winning.
  //
  // One exemption from check 2: a `MatchesType` whose TYPE operand is
  // literal text compiles on the JavaScript target when the type has a
  // faithful test on the JS value model (`matchesTypeLowerable` decides
  // here; `compileMatchesTypeJS` emits, inside the compile frame below) —
  // the registry is consulted at COMPILE time and the test is baked into
  // the code, the same way a compiled `match` constructor pattern or a
  // multi-clause parameter guard bakes its type test. A type with no
  // faithful test still fails closed here.
  if (expr.type.toString() === 'type')
    throw new Error(
      `Could not compile a type value (type 'type') to target ` +
        `'${target.language ?? 'unknown'}': a reified type expression has ` +
        `no compiled representation.`
    );
  // A value of a VALUE KIND (a residue class, an element of ℤ/nℤ, type
  // `residue`; a value of a kind registered by the host) has no compiled
  // representation either: the targets compute over numbers, and the
  // arithmetic of a kind value is its own. The test is the engine's own
  // STRICT recognition (`holdsKindValueForCertain`): a call of a kind head,
  // a call of a head declared to return a kind type, a symbol declared
  // with a kind type or holding a kind value, at any depth; or a result
  // that is a kind value for certain. Read at the compile boundary once, so
  // that a class in an operand position (`Equal(r, r)` with `r: residue`)
  // is refused as a class in the result is. A result that MAY be a kind
  // value (`number | residue`, the sum of a parameter typed from a
  // signature that admits a class) is not refused: the compiled code
  // computes the number it is given. The message names the kind types
  // found.
  //
  // A kind type whose `compile.type` contract answers `lowered()` for the
  // target HAS a representation there (`kind-lowering.ts`): the expression
  // is then compiled, and `compileKindOperation()` lowers each operation
  // with an operand of the kind through the contract. Two limits of phase 1
  // of the design (`docs/plans/2026-10-26-value-kinds.md`, section 4.8)
  // decline anyway: a COLLECTION of kind values (`entry` and `lowered()`
  // describe one value), and an interval target with a kind other than
  // the enclosure (its runner checks the host value of an enclosure only).
  //
  // On `interval-js` the lowering of the enclosure is set up also when a
  // free symbol MAY hold an enclosure (`y: real | enclosure`), so that the
  // runner checks its host value and its operations reach the contract.
  if (CompilerState._compileDepth === 0) {
    CompilerState._kindLowering = undefined;
    CompilerState._lastKindLowering = undefined;
  }
  const possibleEnclosure =
    CompilerState._compileDepth === 0 &&
    target.language === 'interval-javascript' &&
    hasEnclosureSymbol(expr);
  if (
    CompilerState._compileDepth === 0 &&
    (possibleEnclosure ||
      typeIsKindForCertain(expr.type.type, expr.engine) ||
      holdsKindValueForCertain(expr))
  ) {
    const lowering = kindLoweringOf(expr, target, possibleEnclosure);
    if (lowering !== undefined) {
      CompilerState._kindLowering = lowering;
      CompilerState._lastKindLowering = lowering;
    }
  }
  if (
    CompilerState._compileDepth === 0 &&
    CompilerState._kindLowering === undefined &&
    (typeIsKindForCertain(expr.type.type, expr.engine) ||
      holdsKindValueForCertain(expr))
  ) {
    // The kinds whose values the expression holds, else the kinds of its
    // result type. The held kinds are read first because they name the
    // kinds more precisely: the result type of an arithmetic operator
    // over kind values (`residueResultType()`) can be a union of the kind
    // types of its operands, or a type that a `resultType` hook gives.
    const held = kindTypesHeldBy(expr);
    const kindTypes = new Set(
      held.length > 0
        ? held
        : kindArmNames(expr.type.type, kindTypeNames(expr.engine))
    );
    const target_ = target.language ?? 'unknown';
    if (
      kindTypes.size === 0 ||
      (kindTypes.size === 1 && kindTypes.has('residue'))
    )
      throw new Error(
        `Could not compile an expression that holds a residue class (type ` +
          `'residue') to target '${target_}': the ` +
          `compiled targets compute over numbers, and a class of ℤ/nℤ has ` +
          `no compiled representation.`
      );
    const names = [...kindTypes].map((t) => `'${t}'`).join(', ');
    throw new Error(
      `Could not compile an expression that holds a value of the kind ` +
        `type ${names} to target '${target_}': the compiled targets ` +
        `compute over numbers, and the value kind has no compiled ` +
        `representation.`
    );
  }
  if (
    isFunction(expr, 'Subtype') ||
    isFunction(expr, 'MatchesType') ||
    isFunction(expr, 'Conforms')
  ) {
    const ground = expr.ops.every(
      (op) =>
        isString(op) ||
        (isFunction(op, 'TypeFrom') && op.nops === 1 && isString(op.op1))
    );
    if (
      !ground &&
      !(isFunction(expr, 'MatchesType') && matchesTypeLowerable(expr, target))
    )
      throw new Error(
        `Could not compile \`${expr.operator}\`: a non-constant type ` +
          `comparison needs the engine's type registry, which compiled ` +
          `code does not carry (target '${target.language ?? 'unknown'}').`
      );
  }
  // Install the naming context EAGERLY, on the outermost call, for a target
  // that arrived without one (a hand-rolled target driven through
  // `BaseCompiler.compile`). It must be installed before the first
  // `{ ...target }` spread: a context installed lazily deeper in the
  // recursion lands on a spread COPY, and the sibling branches then number
  // their temporaries from a forked counter (§4.1 — the context is a SHARED
  // object reference by design).
  if (target.naming === undefined) target.naming = newNamingContext(expr);
  // Object-domain absence gate (§3.F). A subexpression whose type carries a
  // `missing` arm in an OBJECT (non-numeric) domain has no representation on a
  // target lacking the `object` absence axis (interval, GPU) — fail closed
  // (D6) with a diagnostic rather than emit source that cannot represent the
  // hole. Numeric-domain absence (`number | missing`) is `NaN` (I6) and needs
  // no object axis, so it is exempt. Only object-axis-less targets pay the
  // check (JS/Python declare `object`, so the guard short-circuits).
  if (target.absence !== undefined && target.absence.object === undefined) {
    const t = compilationType(expr);
    if (typeContainsMissing(t)) {
      // On `interval-js` an enclosure is an interval of the value model,
      // whose absence is the `NaN` interval of a number: its arm is read
      // as a number (`x + y` with `x: enclosure` and `y: real | missing`
      // is typed `enclosure | missing`).
      const withoutMissing = resolveTypeForCompilation(stripMissingFromType(t));
      const stripped =
        target.language === 'interval-javascript' &&
        hasEnclosureArm(withoutMissing)
          ? withoutKindArms(withoutMissing, kindTypeNames(expr.engine))
          : withoutMissing;
      // A NUMERIC-SHAPED type — a tuple of 2 to 4 numeric components — is
      // exempt like a scalar number is: absence fills every lane with NaN
      // (`vec2(_gpu_nan())`), which is exactly what the `When`/`Which`
      // no-match lowering emits for a shaped branch value (Tycho item 49).
      // This is the arm a default-less `Which` over a numeric tuple carries
      // since the no-selection ruling of 2026-08-27 (its value is `Missing`
      // and its type says so). The width bound is the GPU `vecN` family:
      // the no-match lowering has no NaN fill for a wider tuple — it falls
      // back to a SCALAR `_gpu_nan()` against an array-typed value arm,
      // which is an invalid shader — so a width outside 2–4 fails closed
      // below, as does a tuple with a non-numeric component (there is no
      // NaN for a string lane).
      //
      // A LIST of 2 to 4 real numbers (`vector<real^2>`, the type of
      // `[x, y]`) lowers to a `vecN` as such a tuple does, and is exempt
      // for the same reason: `If(c, [x, y])`, `When([x, y], c)` and
      // `If(c, [x, y], Missing)` fill every lane with NaN. A list of
      // another length, or with complex cells, has no `vecN` lowering and
      // stays fail-closed.
      const numericShaped =
        typeof stripped !== 'string' &&
        ((stripped.kind === 'tuple' &&
          stripped.elements.length >= 2 &&
          stripped.elements.length <= 4 &&
          stripped.elements.every((el) => isSubtype(el.type, 'number'))) ||
          (stripped.kind === 'list' &&
            stripped.dimensions?.length === 1 &&
            stripped.dimensions[0] >= 2 &&
            stripped.dimensions[0] <= 4 &&
            isSubtype(stripped.elements, 'real')));
      // A LIST whose cells are numbers that may be absent
      // (`list<integer | missing>`, the type of `[sin x, x{x > 0}]`) is
      // exempt for the same reason a scalar number is: an absent cell is a
      // NaN lane, which is exactly what the `When`/`Which` no-match
      // lowering emits for that cell. The exemption reads the UNSTRIPPED
      // type: only a type that IS a list, with the marker on its element
      // type, qualifies. `missing | list<number>` — the whole list may be
      // absent — does not: the no-match lowering pairs an array arm with a
      // scalar NaN there, which is not a shader, so it stays fail-closed.
      // (A whole list of 2 to 4 real numbers that may be absent,
      // `missing | vector<real^2>`, is a `vecN` and is exempt as
      // `numericShaped` above.)
      const numericCells = (() => {
        const whole = resolveTypeForCompilation(t);
        if (typeof whole === 'string' || whole.kind !== 'list') return false;
        const cell = resolveTypeForCompilation(
          stripMissingFromType(whole.elements)
        );
        return cell !== 'never' && isSubtype(cell, 'number');
      })();
      // A target whose absence spellings cover its whole value model
      // (`absence.numeric.coversValueModel`, the interval target) is exempt
      // for every type IN that model: numbers, verdicts, and indexed
      // collections of them at any depth — `list<number> | missing |
      // number` (a restricted value over a broadcastable helper),
      // `boolean | missing` (a restricted relation),
      // `vector<3> | missing`. A type outside the model (a string, a list
      // of strings, an expression) keeps failing closed here: the
      // target's lowerings do not all check element domains, and one
      // would hand a string back behind `success: true`.
      const inValueModel =
        target.absence.numeric.coversValueModel === true &&
        isNumericOrVerdictShaped(stripped);
      if (
        stripped !== 'never' &&
        stripped !== 'unknown' &&
        stripped !== 'any' &&
        !isSubtype(stripped, 'number') &&
        !numericShaped &&
        !numericCells &&
        !inValueModel &&
        !absentOnlyThroughNumericSlots(expr)
      )
        throw new Error(
          `Could not compile an object-domain absent ('missing') position ` +
            `(type '${expr.type.toString()}') to target ` +
            `'${target.language ?? 'unknown'}': it has no object null ` +
            `representation. Discharge with 'Coalesce' first.`
        );
    }
  }
  // The engine⇄compiled boundary for TAGGED sums
  // (`docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §B2). A
  // `{_tag, _ops}` object is an implementation detail of one compiled unit;
  // v1 does not marshal it back into boxed land. So a unit whose RESULT type
  // admits one declines here, at the compilation boundary (`_compileDepth
  // === 0` — the outermost `compile()`, whichever target funnels through it),
  // rather than leaking the representation. A tagged sum in a PARAMETER
  // position is fine and stays supported: an in-unit recursive function
  // (`ev(n: node)`) needs it, and its only callers are in the same unit.
  // Representation-DISJOINT sums are ordinary erased values and flow as
  // today.
  // A head that a user definition shadows and that the compiler would
  // lower as the library operator fails closed. `_compileInner` checks each
  // node it compiles, but some lowerings handle a node without compiling it
  // as a node (an `If` statement in a loop body), so the whole unit is
  // checked here once, with the bodies of the user functions it calls.
  if (CompilerState._compileDepth === 0) {
    const error = findShadowedLibraryLowering(expr, target);
    if (error !== undefined) throw new Error(error);
  }
  if (CompilerState._compileDepth === 0) {
    const tagged = taggedSumInType(expr.engine, expr.type.type);
    if (tagged !== undefined)
      throw new Error(
        `Could not compile an expression whose result type '${expr.type.toString()}' ` +
          `is the tagged sum variant '${tagged}': its compiled representation ` +
          `is internal to the compiled unit and does not cross the boundary.`
      );
  }
  // Keep the compile-bound-variables context in sync for the contextless
  // analysis helpers (`isComplexValued`): every recursive compilation flows
  // through here with the innermost target, so the static always reflects
  // the names currently shadowing the engine (loop indices, lambda
  // parameters, broadcast elements).
  const prevBoundCtx = CompilerState._boundVarsCtx;
  const nextBoundCtx = target.boundVars ?? prevBoundCtx;
  // Compilation boundary for the complexness memo (Tycho item 148). This —
  // not `compileRoot` — is the entry EVERY target funnels through (the GPU,
  // JS, Python and interval targets each call `BaseCompiler.compile`
  // directly from their own `compileOrThrow`), so the reset has to key off
  // the nesting depth rather than a per-target hook. Engine symbol values
  // are stable within one compilation but not across compilations, and a
  // boxed expression can outlive the compile that cached its answer.
  if (CompilerState._compileDepth === 0) {
    resetCompilationMemos();
    // The report of a compilation that declines is the neutral one (see
    // the reset of `_lastReport` below). It is written here too, because
    // the `AbsArg` refusal below throws before that reset.
    CompilerState._lastReport = { mode: 'strict', promoted: false };
    // `AbsArg` is refused in any angular unit other than radians, also
    // when a stored value or a function body that the expression reads
    // holds it. The test is made here, before any handler reads the
    // operand, so that every target gives the same message.
    if (expr.engine.angularUnit !== 'rad' && reachesAbsArg(expr))
      throw new Error(ABS_ARG_REFUSAL);
    // (The fold-aware oracle latch `_oracleFoldTarget` is synced below,
    // OUTSIDE this depth-0 block — a re-entrant nested compile must be
    // able to switch it off.)
    // A fresh outermost compilation gets a fresh shared antiderivative
    // pool. This is the only reset: putting it anywhere shallower missed a
    // route — registered targets compile through `compileCseRoot`, never
    // `compileRoot` or the public `compile()` entry, so a compilation that
    // drained the pool left every later direct-target compilation skipping
    // symbolic closed forms permanently. Nested compilations (depth > 0)
    // deliberately consume the OUTER pool, so the aggregate stays bounded
    // by one pool per outermost entry; an auto-mode escalation retry
    // re-enters at depth 0 and gets its own pool.
    resetSharedCompilationBudgets();
  }
  // The compile MODE (`CompileMode`) is latched from the OUTERMOST
  // compilation only. The analysis here and every target emitter must agree
  // on each node's value SHAPE — a parent that read `{re, im}` around a
  // child that emitted a bare number is NaN everywhere — so the lane must be
  // one answer for a whole compilation. Nested targets (a user function's
  // body, a broadcast element) are constructed internally and do not carry
  // the caller's option, so reading it at depth > 0 would flip the lane back
  // mid-compile. `resolveCompileMode` validates the requested mode against
  // the target's `supportedModes` — a mode the target does not offer is a
  // `capability` decline, thrown here so it surfaces through the target's
  // ordinary decline channel — and supplies the target's default when none
  // was requested. It is resolved BEFORE the latch is written: the throw
  // happens outside the `try`/`finally` below, so a latch mutated ahead of
  // it would never be restored.
  const prevMode = CompilerState._mode;
  const prevRealOnlyLowering = CompilerState._realOnlyLowering;
  // Fold-before-shape for the complexness oracle (Tycho item 229): with
  // this latch set, `isComplexValued` answers `false` for a closed pure
  // scalar whose constant fold is a real number — an exact constant such
  // as `√(5−√5)` types (and would promote as) the complex hedge while its
  // value is the plain real 1.6625…. The latch makes the ORACLE the
  // single source of truth: every analysis (broadcast element verdicts,
  // the indexed-read arm, the fail-closed guards) and the emission
  // (`tryConstantFold`'s complex-shape gate reads the same oracle, so the
  // fold is admitted and the literal is inlined) flip together.
  // JavaScript target only, and never under the `constantFold: false`
  // emission opt-out or a `symbolDeps` capture — there the emission stays
  // structural/unfolded, so the oracle must keep the shape-first verdict
  // or analysis and emission would disagree.
  //
  // Synced at EVERY compile entry, not only at depth 0: constant folding
  // evaluates, evaluation can re-enter compilation with a DIFFERENT
  // target (a large `Map` body auto-compiles through `implicitCompile`,
  // whose target carries `symbolDeps`), and that nested compilation's own
  // emission cannot fold — inheriting the outer fold-aware oracle there
  // would let its analyses claim shapes its emission does not produce.
  // Same-compilation nested targets are spreads of the outer one, so
  // their eligibility matches and the latch object is left alone; the
  // complexness memo is invalidated on an actual flip (rare — only the
  // re-entrant routes), since verdicts cached under one latch state are
  // wrong under the other.
  const prevOracleFold = CompilerState._oracleFoldTarget;
  // The unrolled-term index values belong to the outermost compilation that
  // pushed them: they name an index THAT compilation binds at the emitted-
  // code level. A fresh outermost compilation binds nothing of the kind, so
  // it must start with no frames — a frame a previous compilation left
  // behind would substitute its value for a symbol that is free here.
  // Saved here, cleared at the depth-0 entry below and restored on the way
  // out, the same boundary `_invalidateComplexMemo` uses.
  const prevUnrolledIndexValues = CompilerState._unrolledIndexValues;
  const prevCallSiteTarget = CompilerState._callSiteTarget;
  const oracleFoldEligible =
    target.language === 'javascript' &&
    target.constantFold !== false &&
    target.symbolDeps === undefined;
  const nextOracleFold =
    CompilerState._compileDepth === 0
      ? oracleFoldEligible
        ? target
        : undefined
      : oracleFoldEligible
        ? prevOracleFold
        : undefined;
  // A declined compilation must not report the previous compilation's mode.
  // Reset first so a fallback built for the decline
  // reports `strict`/not promoted. This is the only report a decline gets —
  // whether it throws before the latches below are written (an unsupported
  // requested mode throws in `resolveCompileMode`) or long after, since the
  // `finally` re-freezes only on the success path.
  if (CompilerState._compileDepth === 0)
    CompilerState._lastReport = { mode: 'strict', promoted: false };
  const nextMode =
    CompilerState._compileDepth === 0 ? resolveCompileMode(target) : prevMode;
  // Written only after `resolveCompileMode` above — its throw escapes the
  // `try`/`finally` below, and a latch mutated ahead of it would never be
  // restored (the same ordering rule the mode latches follow).
  if (nextOracleFold !== prevOracleFold) {
    CompilerState._oracleFoldTarget = nextOracleFold;
    _invalidateComplexMemo();
  }
  if (CompilerState._compileDepth === 0) {
    // Written only after `resolveCompileMode`, like the latches above: its
    // throw escapes the `try`/`finally` below, which is what restores this.
    CompilerState._unrolledIndexValues = [];
    CompilerState._mode = nextMode;
    // The per-compilation report (`modeReport`) starts fresh: no head
    // promoted yet; the discipline is the one just latched.
    CompilerState._promoted = false;
    // The outermost target's real-only lowerings, so the contextless
    // analysis can tell which heads this compilation lowers with a
    // real-only lowering (see `_realOnlyLowering`). Latched once per
    // compilation like the mode: nested targets (a user-function body, a
    // broadcast element) are spread from this one and lower every head the
    // same way.
    CompilerState._realOnlyLowering =
      target.language !== undefined && !target.language.startsWith('interval')
        ? (h) => isRealOnlyLowering(target, h)
        : undefined;
  }
  CompilerState._compileDepth += 1;
  CompilerState._callSiteTarget = target;
  // Only a genuine CHANGE of the bound-variable context invalidates: the
  // inner targets of a recursion carry the SAME `boundVars` set object
  // except at a binder crossing, so the memo survives the common path.
  if (nextBoundCtx !== prevBoundCtx) {
    CompilerState._boundVarsCtx = nextBoundCtx;
    _invalidateComplexMemo();
  }
  // A scope that binds a name an unrolled term holds a value for REBINDS
  // it: inside that scope the name stands for the inner binder's own
  // variable, so the term's value must not be read there (see
  // `_enterUnrolledIndexBinder`). The names come from the binder that built
  // the set, not from a set difference against the enclosing one: a binder
  // over the SAME name as the one enclosing it builds a set with the same
  // content, and the difference would be empty.
  const rebound =
    nextBoundCtx !== prevBoundCtx
      ? _enterUnrolledIndexBinder(boundNamesAddedBy(nextBoundCtx))
      : undefined;
  // Set on the way out of a compilation that produced code. A decline
  // leaves the `try` by THROWING, so this stays `false` there and the
  // `finally` below knows not to freeze a report for code that was never
  // emitted.
  let emitted = false;
  // The read of an input that may be absent depends on the head that
  // consumes it (`readAbsentInput`), so a function node stays on the stack
  // while its operands compile.
  const isParent = isFunction(expr);
  if (isParent) _compileParents.push(expr);
  try {
    // Compile-time constant folding, attempted top-down at every function
    // node so the largest constant subtree folds: a pure subtree with no
    // free variables evaluates at compile time and emits as a literal
    // (`Sum(Take(Map(_ ↦ _^2, 1..20), 10))` → `385`) instead of lowering
    // structurally. Runs before the CSE walk so eliminated regions are
    // never inventoried. All the safety gates live in `tryConstantFold`.
    // A node that may hold a kind value is not folded under a kind
    // lowering: the fold would evaluate it to a kind value, which has no
    // literal of the target; its operations are lowered by the kind's
    // contract instead (`compileKindOperation`).
    if (
      isFunction(expr) &&
      !(CompilerState._kindLowering !== undefined && holdsKindValue(expr))
    ) {
      const folded = tryConstantFold(expr, target, prec);
      if (folded !== undefined) {
        emitted = true;
        return folded;
      }
      // A rounding function whose operand adds an integer to an exact
      // constant that no double holds is compiled from an equivalent form
      // that rounds the constant alone, so the constant fold computes the
      // rounded constant exactly (`jumpShiftRewrite`). The other shapes
      // that mix only integer variables with such a constant decline
      // there.
      const shifted = jumpShiftRewrite(expr, target);
      if (shifted !== undefined) {
        const code = core.compile(shifted, target, prec);
        emitted = true;
        return code;
      }
      // A `Power` whose exponent reads only constants and assigned symbols
      // is compiled with the value of the exponent, so the lane rules of
      // `Power` read a number literal (`knownExponentPower`).
      const powered = knownExponentPower(expr);
      if (powered !== undefined) {
        const code = core.compile(powered, target, prec);
        emitted = true;
        return code;
      }
      // A `MatchesType` the gate above admitted (a ground one that did not
      // fold reaches here too). Emitted INSIDE the frame so its subject
      // compiles as an operand: at depth 0 a tagged-sum subject would trip
      // the result-type boundary gate, although only the boolean crosses.
      if (isFunction(expr, 'MatchesType')) {
        const lowered = compileMatchesTypeJS(expr, target, prec);
        if (lowered !== undefined) {
          emitted = true;
          return lowered;
        }
      }
    }
    const compiled = foldEmitted(
      expr,
      target,
      core.compileWithCse(expr, target, prec)
    );
    emitted = true;
    return compiled;
  } finally {
    if (isParent) _compileParents.pop();
    CompilerState._compileDepth -= 1;
    CompilerState._callSiteTarget = prevCallSiteTarget;
    if (CompilerState._compileDepth === 0)
      CompilerState._kindLowering = undefined;
    // The memos are also emptied when the outermost compilation ends. A
    // target runs passes BEFORE it calls `compile` (the GPU inlining of
    // point calls reads `foldValueImpure`), and those passes would
    // otherwise read the answers of an earlier compilation, made with
    // other engine values: `r` recorded as pure, then `r := Random()`.
    if (CompilerState._compileDepth === 0) resetCompilationMemos();
    // Leaving the OUTERMOST compilation: freeze its report for the target
    // to attach (`withReferences` → `modeReport`), before the latches are
    // restored.
    //
    // `mode` is the latched DISCIPLINE — `'strict'` or `'complex'`, with
    // `'auto'` collapsed to `'strict'` because `auto` is a policy OVER the
    // two disciplines (try strict, escalate on a `LaneMismatch`), not a
    // discipline code can be compiled under — WIDENED to `'complex'` when a
    // promotable head was promoted (`_promoted`). The widening is needed
    // because under `auto` a promotable head is lowered through the complex
    // kernel on the FIRST attempt, with no escalation: `_mode` still reads
    // `'strict'` while the emitted code computes in the complex kernel and
    // returns `{re, im}`, so `_mode` alone contradicted `promoted: true` on
    // the same result.
    //
    // The widening is NOT a lane oracle: an operand that is already
    // complex-TYPED (`Sqrt(z)` with `z: complex`) or a complex literal
    // (`2i·x`) routes through the complex kernel in EVERY discipline, and
    // `promotesRadicalToComplex` deliberately does not count that as a
    // promotion (`promoted` reports a lane DIFFERENCE with the shader
    // targets, which is what a merely-unknown-sign operand creates). Such a
    // compile emits `{re, im}` and still reports `mode: 'strict'`. Read the
    // returned value's shape (`typeof v === 'number'`), never `mode`, to
    // decide whether a result is complex-shaped.
    //
    // Only a compilation that EMITTED code gets this report: the report
    // describes emitted code, and a decline emitted none. A decline throws
    // out of the `try` above with the latches already written, so freezing
    // unconditionally here would hand `buildInterpreterFallback` — which
    // spreads `modeReport()` onto a `success: false` result whose `run` is
    // interpreter-backed — a `{mode: 'complex', promoted: true}` describing
    // code that does not exist: before the decline, the emitters of the
    // operands compiled so far can have recorded promotions in
    // `_promoted`. The ANALYSIS predicate `isComplexValued` calls the same
    // `promotesRadicalToComplex` as the emitters, but it restores
    // `_promoted` after the call, because the subtree it reads can be
    // folded or never emitted. So on the success path `_promoted` records
    // the promotions of emitted code only. On the throw path the
    // neutral `{mode: 'strict', promoted: false}` installed at depth-0 entry
    // stands. (User ruling 2026-08-17, on Tycho consumer item 201.)
    if (CompilerState._compileDepth === 0 && emitted) {
      // A promotion in the body of an emitted user-function definition is
      // recorded on that definition (`promotedDefinitions`), not in
      // `_promoted`. It counts while the definition is in `defs`; a
      // definition removed later as unreferenced is taken out of the
      // report again (`pruneUnreferencedVariantBases`).
      const registry = target.userFunctions;
      const promoted =
        CompilerState._promoted || hasPromotedDefinition(registry);
      CompilerState._lastReport = {
        mode:
          CompilerState._mode === 'complex' || promoted ? 'complex' : 'strict',
        promoted,
      };
      CompilerState._lastReportBasis = {
        registry,
        complexDiscipline: CompilerState._mode === 'complex',
        promotedOutsideDefinitions: CompilerState._promoted,
      };
    }
    CompilerState._mode = prevMode;
    CompilerState._realOnlyLowering = prevRealOnlyLowering;
    // Restore the caller's oracle-fold latch (undefined at depth 0:
    // outside a compilation the conservative shape-first verdict is the
    // safe one — engine symbol values may change between compilations,
    // and an out-of-compile analysis caller has no emission to agree
    // with). A flip invalidates the memo for the same reason the entry
    // flip does: cached verdicts embed the latch state.
    if (nextOracleFold !== prevOracleFold) {
      CompilerState._oracleFoldTarget =
        CompilerState._compileDepth === 0 ? undefined : prevOracleFold;
      _invalidateComplexMemo();
    }
    if (nextBoundCtx !== prevBoundCtx) {
      CompilerState._boundVarsCtx = prevBoundCtx;
      _invalidateComplexMemo();
    }
    _exitUnrolledIndexBinder(rebound);
    // The depth is already decremented, so this reads as "we were the
    // outermost compilation" and undoes the clear made at its entry.
    if (CompilerState._compileDepth === 0)
      CompilerState._unrolledIndexValues = prevUnrolledIndexValues;
  }
}

/**
 * Does `compile()` currently emit fixed code for `expr` (an entry in
 * `_codeOverrides` or `_codeAliases`) instead of lowering it? A target
 * handler that takes a node apart and compiles its operands directly (the
 * interval `Add` chain compiles the operand of a `Negate` as a
 * subtrahend) must compile such a node whole: its parts are not
 * overridden, so lowering them emits the expression again where the
 * override emits a name. The invariant-prefix variant of a user function
 * installs such overrides for the prefixes its extra parameters carry.
 */
export function hasCodeOverride(expr: Expression): boolean {
  return _codeOverrides.has(expr) || _codeAliases.has(expr);
}

/**
 * The effect labels (`docs/EFFECTS-MODEL.md`) that cannot change the value
 * of a symbol: a draw, a clock read, input and output. The other labels
 * (`scope`, `state`, `environment`) and unknown effects may.
 */
const BINDING_NEUTRAL_EFFECTS: ReadonlySet<string> = new Set([
  'console',
  'entropy',
  'fs_read',
  'fs_write',
  'network',
  'random',
  'time',
]);

/**
 * The D2/D6 RUNTIME RULE (design §8, `docs/COMPILATION-MODEL.md`)
 * around a head `h` whose lowering is real-only — an ordering comparison,
 * an integer-only head (`Floor`, `Mod`, …), a real-only library helper
 * (`Erf`, …): when some SCALAR operand may be complex at run time (a
 * `complex`-typed symbol, a wide binding under the complex discipline, a
 * promoted radical), every such operand is bound ONCE to a temporary, in
 * argument order (draw order is preserved: `√(Random()) < 2` draws once),
 * and the head's real lowering is emitted with each bound operand's code
 * replaced by the temporary's real projection (`complexReal`), under the
 * guard that every temporary's imaginary part is exactly zero
 * (`complexIsReal`); otherwise the value is `elseCode` (`'false'` for a
 * comparison, `'NaN'` for a numeric head). When some operand has an effect
 * (`Random()`, an assignment), every operand that is not a number literal,
 * a constant symbol or already a temporary is bound with them, in the same
 * argument order: each operand is then evaluated once, in source order,
 * whatever the guard decides, and a variable is read where the
 * interpreter reads it. Because the
 * guard is emitted WHERE the head is lowered, a head inside a conditional
 * arm or a short-circuited operand keeps its laziness.
 *
 * A STATICALLY non-real operand (`isProvablyNonReal`: `i`, `2i`, an
 * `imaginary`-typed symbol) is the compile-time DECLINE, raised here as a
 * `capability` diagnostic (`code: 'non-real-operand'`). The real lowering
 * has no value to give there. The interpreter may still have one: it
 * leaves `Less(i, 2)` unevaluated, but it computes `Erf(1 + i)` under
 * `.N()`, which the real-only JavaScript helper cannot do. The diagnostic therefore
 * names the lowering, not the interpreter, as the reason.
 *
 * THE ELEMENT-WISE FORM. When some maybe-complex operand is an ARRAY at
 * run time — a list whose elements may be complex (`√L` over `L:
 * list<real>`, a `list<complex>` symbol, a selection with such an arm) —
 * the rule is applied per ELEMENT instead of per value: every maybe-complex
 * operand of the head, the scalar ones included, is bound once and replaced
 * by the target's element-wise real projection (`complexRealElements`: each
 * exactly-real element as its real part, every other element as the
 * target's NaN, nested arrays recursed), and the real lowering is emitted
 * UNCONDITIONALLY over the projections. The real lowering then broadcasts
 * or reduces over the projected array: `⌊√L⌋` floors each real root and
 * answers NaN where the root is complex, `min(√L)` reduces to NaN as soon
 * as one root is complex, `√L < 1` compares each real root and answers
 * false at a complex one. A scalar operand takes the same projection there
 * (rather than the whole-value guard) so that the failing value keeps the
 * head's SHAPE — `L < w` at a complex `w` is `[false, false]`, one per
 * element, not a scalar `false` — which relies on every real lowering
 * propagating NaN (`Math.floor`, `%`, `Math.max`, the helpers, and `<`,
 * which answers `false` on NaN; measured for each head of
 * `REAL_ONLY_BY_DEFINITION` before this form was written). An operand the
 * analysis has already projected (present in `_codeOverrides`) answers
 * "real" to `isComplexValued` and `operandElementLane`, so the re-emission
 * lowers the head on the real lane (`tryCompileBroadcast` emits its plain
 * closure over the projected arrays). Before this form existed, a
 * collection-typed maybe-complex operand fell back to the caller's
 * fail-closed decline — Tycho item 251: a histogram row's `Min` over a
 * 10 000-element piecewise with a `Sqrt` arm declined in the default mode
 * and the interpreted fallback ran past the consumer's time budget.
 *
 * Returns `undefined` — the caller then applies its pre-existing
 * fail-closed decline — when no operand may be complex, when a maybe-
 * complex operand is a collection WITHOUT a positional array lowering (a
 * set, a dictionary: `complexRealElements` maps arrays), when an array
 * operand's element lane is undecided (`operandElementLane` answers
 * `undefined`: it would reach the real lowering unprojected), or when the target
 * lacks the hooks the rule is emitted through (`bindExpr`, `complexIsReal`,
 * `complexReal`, `realGuard`, and `complexRealElements` for the
 * element-wise form: the shader targets, a custom target without them).
 *
 * Throws a `capability` diagnostic (`code: 'shared-impure-operand'`) when
 * one operand node occurs at two or more positions and either has effects
 * or reads a symbol that an operand may write: the override is keyed on
 * the node, so it cannot give each position its own evaluation.
 *
 * `emit` re-emits the head with the overrides active; the gate that called
 * this must skip an operand present in `_codeOverrides` on re-entry.
 */
export function realOperandGuard(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  emit: () => TargetSource,
  // The shape of the failing branch, forwarded to the target's
  // `realGuard`. It must match the shape the head returns when the guard
  // passes — see the `realGuard` contract in `types.ts`. The color heads
  // pass `'color'` so a genuinely-complex operand yields the non-finite
  // COLOR, never a bare scalar that flips the caller's reading at runtime.
  resultKind: 'boolean' | 'number' | 'color'
): TargetSource | undefined {
  // The rule belongs to the `auto` and `complex` disciplines; in strict
  // mode nothing changes — a typed-complex or provably non-real operand of
  // a real-only head fails closed as before (design D2/D6: "in strict mode
  // nothing changes").
  if (!runtimeRealGuards()) return undefined;
  // Deduplicated by node identity: the same PURE operand instance in two
  // positions (`Max(e, e)`) is bound once, which is correct because its two
  // evaluations give the same value. An impure instance in two positions is
  // declined below.
  const maybe = [
    ...new Set(args.filter((a) => realGuardCandidate(a, engine, target))),
  ];
  if (maybe.length === 0) return undefined;
  const nonReal = maybe.find((a) => isProvablyNonReal(a));
  if (nonReal !== undefined)
    throw new CompileDeclineError({
      code: 'non-real-operand',
      kind: 'capability',
      message:
        `Could not compile \`${h}\`: the operand \`${nonReal.toString()}\` is ` +
        `certainly not a real number, and this target's ` +
        `lowering of the head is real-only.`,
    });
  if (
    !target.bindExpr ||
    !target.complexIsReal ||
    !target.complexReal ||
    !target.realGuard
  )
    return undefined;
  // An operand with a POSITIONAL array lowering: an array operand that is
  // not a set or a dictionary (those are collections without a positional
  // lowering, so there is nothing `complexRealElements` could map over).
  const positional = (a: Expression): boolean =>
    isArrayOperand(a) && (!a.isCollection || a.isIndexedCollection);
  // A maybe-complex collection with no positional lowering keeps the
  // caller's decline.
  if (maybe.some((a) => !positional(a) && a.type.matches('collection<any>')))
    return undefined;
  // An array operand whose element lane is UNDECIDED (`undefined`: a
  // `broadcastable<complex>` parameter) is not a candidate — it keeps its
  // compile-time decline (see `_operandElementLane`) — yet it would be
  // handed, unprojected, to the re-emitted real lowering alongside the
  // projected candidates. Keep the decline for the whole form.
  if (
    args.some(
      (a) =>
        isArrayOperand(a) &&
        core.operandElementLane(a, engine, target) === undefined
    )
  )
    return undefined;
  // The element-wise form (see above) applies as soon as one operand of
  // the head — maybe-complex or not — is an array at run time: the value
  // the head returns is then array-shaped (or a reduction of one), and the
  // per-element projection of every maybe-complex operand, scalars
  // included, is what keeps that shape. The exception is a head whose
  // failing value is a COLOR (`resultKind` `'color'`): its scalar operands
  // keep the whole-value guard, so a complex scalar channel still yields
  // the documented non-finite color rather than a raw NaN fed to the color
  // kernel.
  const elementwise = args.some(positional);
  const projectScalars = elementwise && resultKind !== 'color';
  const projectElements = target.complexRealElements;
  if (elementwise && projectElements === undefined) return undefined;
  // An operand that is a name or a constant reads no state and has no
  // effect, so it can stay inline in the guarded real lowering: one that
  // already has a code override (a temporary of an enclosing lowering), a
  // number literal, a constant symbol.
  const inert = (a: Expression): boolean =>
    _codeOverrides.has(a) || isNumber(a) || (isSymbol(a) && a.isConstant);
  // Whether an operand has an effect once the values of the symbols it
  // reads and the bodies of the user functions it calls are looked through:
  // `isPure` stops at a symbol with a value, so `r` with `r := Random()` is
  // pure to it, but the value is evaluated again at each read, by the
  // interpreter and in the compiled code (`foldValueImpure`).
  //
  // Code that the caller supplied (a `vars` string that is not a plain read
  // of the input, a head mapped through `functions` or `operators`, an
  // operator's own `compile` handler) counts as code with an effect: it can
  // draw or count its calls (`_.draw()`), and the compiler cannot see
  // inside it. A route with no common-subexpression session has no `vars`
  // or `functions`, and `isCallerMapped` still finds a `compile` handler
  // there from the definition.
  const caller = target.cse?.harvestOptions ?? {};
  // A symbol that `vars` maps to a plain read of an input, or that a binder
  // of the compiled code binds, is read from that input and never from its
  // stored value, so its value does not count.
  const inputName = (name: string): boolean =>
    caller.isStringVar?.(name) !== true &&
    (target.varsKeys?.has(name) === true ||
      target.boundVars?.has(name) === true);
  // The walk looks through symbol values and user-function bodies, as the
  // compiled code inlines them (`reachesCallerCode`).
  // One answer per operand node: the walk can be long (values and bodies),
  // and the tests below ask about the same operand several times.
  const callerCodeMemo = new Map<Expression, boolean>();
  const callerCode = (a: Expression): boolean => {
    let known = callerCodeMemo.get(a);
    if (known === undefined) {
      known = reachesCallerCode(a, {
        isStringVar: caller.isStringVar,
        isCallerMapped: (node) => isCallerMapped(node, caller),
        readsInput: inputName,
        localFunction: (name) => blockLocalFunction(name, target),
      });
      callerCodeMemo.set(a, known);
    }
    return known;
  };
  const readsInput = (a: Expression): boolean =>
    isSymbol(a) && inputName(a.symbol);
  const impure = (a: Expression): boolean =>
    a.isPure !== true ||
    callerCode(a) ||
    (!readsInput(a) && foldValueImpure(a));
  // Whether some operand has an effect (`Random()`, an assignment). Then
  // the ORDER in which the operands are evaluated and read is observable,
  // and every operand that is not inert is bound, in source order (below).
  const effects = args.some((a) => impure(a) && !inert(a));
  // An operand node that occurs at two or more positions is bound once:
  // the code override that replaces an operand by its temporary is keyed
  // on the node, so the re-emitted head reads one temporary at every
  // position. That is correct when every evaluation of the node gives the
  // same value. It is not when the node has an effect (`Max(e, e)` with
  // one boxed node `e = √(Random() − 0.5)`: the interpreter evaluates
  // each position and draws twice), or when the node reads a symbol that
  // an operand may write (`Max(y, Assign(y, 1), y)`: the second `y`
  // reads 1). Left inline instead, the node would run inside the guarded
  // branch, after the bindings, and not at all when the guard fails. So
  // these two cases decline, with their own diagnostic (CE-687). An
  // operand may write a symbol unless each of its effect labels is one
  // that changes no binding (a draw, a clock read, input or output): an
  // `Assign` carries `scope`, and unknown effects are `'any'`.
  // The labels of an operand are those of its own nodes: a symbol's
  // `effects` is always `undefined`, and a call does not add the labels of
  // a user-function body. So an operand that reaches an impure symbol value
  // or an impure body (`r` or `Random() + r` with `r := Assign(y, 1)`) may
  // write a symbol that its labels do not show, and it counts as one that
  // may write.
  const hiddenEffect = (a: Expression): boolean => {
    const seen = new Set<Expression>();
    const visit = (node: Expression): boolean => {
      if (seen.has(node)) return false;
      seen.add(node);
      if (isSymbol(node)) {
        // A block-local function passed by name is the block's own binding.
        // It is looked up before `readsInput`: the block binds each of its
        // locals, so the name is also a bound variable.
        const local = blockLocalFunction(node.symbol, target);
        if (local === null) return true;
        if (local !== undefined) return foldValueImpure(local);
        if (readsInput(node)) return false;
        const value = engine._getSymbolValue(node.symbol);
        return value !== undefined && foldValueImpure(value);
      }
      if (!isFunction(node)) return false;
      if (node.ops.some(visit)) return true;
      // A function that the compiled block defines is called instead of an
      // engine function with the same name; `null` means its literal cannot
      // be read here, so its effects are not known.
      const local = blockLocalFunction(node.operator, target);
      if (local === null) return true;
      if (local !== undefined) return foldValueImpure(local);
      const literal = userFunctionLiteral(engine, node.operator);
      if (literal !== undefined) return foldValueImpure(literal);
      return (
        multiClauseState(engine.lookupDefinition(node.operator))?.clauses.some(
          (c) => foldValueImpure(c.literal)
        ) ?? false
      );
    };
    return visit(a);
  };
  const mayWriteSymbol = (a: Expression): boolean => {
    if (!impure(a) || inert(a)) return false;
    if (a.isPure === true || callerCode(a) || hiddenEffect(a)) return true;
    const labels = a.effects;
    return (
      labels === 'any' ||
      (labels ?? []).some((l) => !BINDING_NEUTRAL_EFFECTS.has(l))
    );
  };
  const writes = args.some(mayWriteSymbol);
  const shared = args.find(
    (a, i) => !inert(a) && args.indexOf(a) !== i && (impure(a) || writes)
  );
  if (shared !== undefined)
    throw new CompileDeclineError({
      code: 'shared-impure-operand',
      kind: 'capability',
      message:
        `Could not compile \`${h}\`: the operand \`${shared.toString()}\` ` +
        (impure(shared)
          ? `has effects and `
          : `reads a value that another operand may change, and it `) +
        `occurs at more than one position. Each position must be ` +
        `evaluated on its own, and this lowering binds it once.`,
    });
  const bindings: Array<[string, string]> = [];
  const guards: string[] = [];
  const bound: Expression[] = [];
  // A fresh memo layer for the re-emission: an answer computed while an
  // operand is overridden (it reads "real") must not survive the override.
  _pushComplexMemoLayer();
  try {
    // The bindings are evaluated before the guard, in argument order, and
    // the head's real lowering reads the temporaries. Each maybe-complex
    // operand is bound. When some operand has an effect, every operand
    // that is not inert is bound too, so that each operand is evaluated
    // exactly once, in source order, whatever the guard decides, as the
    // interpreter evaluates it:
    // - an operand with effects, left inline in the guarded lowering,
    //   would run only when the guard passes (`Max(√x, Random())` at
    //   `x = −4` consumed no draw where the interpreter consumes one), and
    //   after the draws of a maybe-complex operand written to its right
    //   (CE-686);
    // - a pure operand that reads a variable, left inline, would read it
    //   after the bound operands ran: `Max(√x, y, Assign(y, 1))` with
    //   `y = 5` read 1 where the interpreter reads 5.
    // When no operand has an effect, a pure operand stays inline: no
    // operand can change what it reads, and its value is the same whether
    // it is evaluated before the guard, inside it, or not at all.
    //
    // Every binding is compiled BEFORE any override of this call is set.
    // The bindings are the parameters of one `bindExpr`, so a binding
    // compiled after an earlier operand's override would read that
    // operand's temporary, which is not in scope there
    // (`Max(r, √(r − 0.5))` with one shared `r` node gave a
    // `ReferenceError`). Compiled first, a node shared by two operands is
    // evaluated in each of them, as the interpreter evaluates it (CE-687).
    const maybeSet = new Set(maybe);
    const temps: string[] = [];
    for (const a of args) {
      if (bound.includes(a)) continue;
      if (!maybeSet.has(a) && (!effects || inert(a))) continue;
      const t = tempVar(target);
      bindings.push([t, compileValueOperand(a, target)]);
      bound.push(a);
      temps.push(t);
    }
    for (let k = 0; k < bound.length; k++) {
      const a = bound[k];
      const t = temps[k];
      if (!maybeSet.has(a)) _codeOverrides.set(a, t);
      else if (
        projectElements !== undefined &&
        (positional(a) || projectScalars)
      )
        _codeOverrides.set(a, projectElements(t));
      else {
        guards.push(target.complexIsReal(t));
        _codeOverrides.set(a, target.complexReal(t));
      }
    }
    const body = emit();
    // The conditional and its "else" literal are the TARGET's spelling
    // (`realGuard`): JavaScript `((g) ? (body) : NaN)`, Python
    // `((body) if (g) else float('nan'))`. The element-wise form has no
    // guards, so the body is emitted unconditionally.
    return target.bindExpr(
      bindings,
      target.realGuard(guards, body, resultKind)
    );
  } finally {
    for (const a of bound) _codeOverrides.delete(a);
    _popComplexMemoLayer();
  }
}

export function promotesRadicalToComplex(
  head: MathJsonSymbol,
  args: ReadonlyArray<Expression>
): boolean {
  // The `auto` and `complex` disciplines promote (design §2: "unknown-sign
  // radicals/logarithms promote" — the interpreter's `√(−1)`, `ln(−2)` fall
  // out); strict never.
  if (!promotionActive()) return false;
  // Broadcast closures re-invoke the head's scalar codegen on synthetic
  // element temps, which carry no sign or type information of their own —
  // deriving the verdict from a temp PROMOTES shapes whose real operands
  // are provably non-negative. Measured: `√(x²+L²)` with a list-valued `L`
  // emitted `_SYS.csqrt` while the downstream analysis, reading the real
  // radicand, said real — the producer/consumer divergence behind
  // `"[object Object]-1"` string concatenation on the composed `−1`. The
  // verdict for such a closure is therefore decided ONCE, on the
  // node-level operands (in `tryCompileBroadcast`), and recorded; a call
  // whose arguments are exactly that closure's element temps returns the
  // recorded verdict. This is also what keeps a broadcast `Power` honest:
  // its literal exponent is elementized into a temp, so `isNumber(exp)`
  // below could never see it. `notePromoted` is not re-fired here — the
  // node-level decision already ran it.
  for (let i = _broadcastRadicalVerdict.length - 1; i >= 0; i--) {
    const frame = _broadcastRadicalVerdict[i];
    if (
      frame.head === head &&
      args.length > 0 &&
      args.every(
        (a) => a !== undefined && isSymbol(a) && frame.params.has(a.symbol)
      )
    )
      return frame.promotes;
  }
  if (head === 'Power') {
    // Exact powers with an odd denominator have a real value at negative
    // real bases. Explicitly complex operands still use complex arithmetic.
    if (
      realPowerExponent(args) !== undefined &&
      !args.some((a) => core.isComplexValued(a))
    )
      return false;
    const [base, exp] = args;
    if (base === undefined || exp === undefined) return false;
    // A `List` literal exponent is paired with the base cell by cell, and
    // one closure computes every cell: when one of its number cells is
    // not an integer, every cell takes the complex lane, as a scalar
    // exponent that is not an integer does. `p^[2, 0.5]` gave `NaN` for
    // `(-4)^0.5`, where the interpreter gives `2i` (ROADMAP CE-215.1). The
    // complex power gives the real root of a negative base where the
    // interpreter does (`_SYS.cpow`), and an integer cell gives the same
    // value on both lanes.
    if (
      isNumber(exp)
        ? Number.isInteger(exp.re) || exp.isComplex
        : !hasNonIntegerRealCell(exp)
    )
      return false;
    if (assumedRealNonNegative(base)) return false;
    if (base.isNegative !== true && !isNonRealNumber(base.type.type))
      notePromoted();
    return true;
  }
  if (head === 'Root') {
    // `Root(u, k)` of an unknown-sign operand with an EVEN integer degree
    // is the same case as `Sqrt`, which is `Root(u, 2)`: the real
    // `Math.pow(u, 1/k)` is `NaN` for a negative `u`, while the
    // interpreter answers the principal complex root (`Root(−8, 4)` is
    // `1.1892… + 1.1892…i`).
    //
    // An ODD degree keeps the real lowering: there the interpreter answers
    // the REAL root (`Root(−8, 3)` is `−2`, not the principal complex
    // value), which the emitters spell with `Math.cbrt` or a
    // sign-corrected power. A degree that is not an even integer literal
    // keeps it too — a variable degree may be odd at run time, and
    // promoting it would move every `\sqrt[n]{x}` off the real kernel.
    const [radicand, degree] = args;
    if (radicand === undefined || degree === undefined) return false;
    if (!isNumber(degree) || degree.isComplex) return false;
    if (!Number.isInteger(degree.re) || degree.re === 0) return false;
    if (degree.re % 2 !== 0) return false;
    if (assumedRealNonNegative(radicand)) return false;
    if (radicand.isNegative !== true && !isNonRealNumber(radicand.type.type))
      notePromoted();
    return true;
  }
  if (!PROMOTABLE_RADICAL_HEADS.has(head)) return false;
  // `Log(x, b)`: a negative BASE makes the quotient complex too, so every
  // operand has to clear the bar. An omitted operand cannot be cleared.
  if (!args.some((a) => a === undefined || !assumedRealNonNegative(a)))
    return false;
  // `promoted` reports a lane DIFFERENCE with the shader targets: a
  // PROVABLY negative operand, or one TYPED complex, is complex-shaped on
  // every target and in every mode (not a promotion); only a real-shaped
  // operand of UNKNOWN sign is.
  if (
    args.some(
      (a) =>
        a !== undefined &&
        a.isNonNegative !== true &&
        a.isNegative !== true &&
        !isNonRealNumber(a.type.type)
    )
  )
    notePromoted();
  return true;
}

/**
 * Run `fn` — the emission of a user function's definition, or an analysis
 * of its BODY — with every binding of the call site hidden.
 *
 * The emitted `_fn_…` definition is a module-level function, so inside its
 * body a name refers to the function's own parameters or to the engine,
 * never to a name the caller binds. An emission that starts inside an
 * analysis of the caller (`userCallDefinition`), and an analysis of the
 * elements of a body (`withCollectionElements`,
 * `elementsRealByConstruction`), must read the body the same way, or they
 * describe a different value than the one the definition returns. With a
 * global `k := i` and `v(s) := [s, k]` called inside `Σ_{k=1}^{3}`, the
 * element `k` of the body is the global, not the index. The caller's
 * bindings live in four places, and all four are hidden for the
 * duration:
 * - the `Block` local frames (`_localComplex`, `_localVector`), replaced by
 *   an empty frame;
 * - the compile context's bound variables (`_boundVarsCtx`): a loop index,
 *   a lambda parameter, a broadcast element;
 * - the names shielded by an enclosing binder under analysis
 *   (`_binderShield`): a `Sum`/`Product` index, a `Function` parameter;
 * - the index values of the unrolled `Sum`/`Product` terms in progress
 *   (`_unrolledIndexValues`).
 *
 * The promotion of the compile mode is also restored when the caller is
 * the value of a real ascription, which compiles with promotion off
 * (`withPromotionUnsuppressed`): the definition is compiled for every call
 * site, not for this one.
 *
 * The analysis runs in a fresh complexness memo layer (pushed by
 * `withLocalShapeFrame`), so no answer computed here reaches the caller's
 * context, and no answer of the caller's context is reused here.
 */
export function withCallerBindingsHidden<T>(fn: () => T): T {
  return core.withLocalShapeFrame(
    new Map(),
    new Map(),
    () => {
      const savedBoundCtx = CompilerState._boundVarsCtx;
      const savedShield = CompilerState._binderShield;
      const savedIndexValues = CompilerState._unrolledIndexValues;
      CompilerState._boundVarsCtx = undefined;
      CompilerState._binderShield = [];
      CompilerState._unrolledIndexValues = [];
      try {
        return withPromotionUnsuppressed(fn);
      } finally {
        CompilerState._boundVarsCtx = savedBoundCtx;
        CompilerState._binderShield = savedShield;
        CompilerState._unrolledIndexValues = savedIndexValues;
      }
    },
    true
  );
}

/**
 * The complex-ness of each element the emitter will lower for the indexed
 * collection `collection`, one verdict per element — or `undefined` when the
 * elements cannot be identified and the caller must keep its previous,
 * whole-collection answer.
 *
 * Two sources, and the second is what makes the analysis compose. A literal
 * collection constructor, or a call to a user function whose body is one, has
 * its elements read directly ({@link withCollectionElements}). An ELEMENT-WISE
 * ARITHMETIC node over such a collection — `Multiply(2, w(t))` — has no
 * elements of its own: the JavaScript target lowers it through a `_SYS.bcast`
 * closure that applies the head to element k of every collection operand and
 * to the scalar operands whole, so element k of the result is complex exactly
 * when one of those is. Only the heads that PROPAGATE complex-ness from their
 * operands qualify (`COMPLEX_PROPAGATING_HEADS`); a head whose emitter picks
 * its lowering from the node TYPE instead (`Power`, `Root`, the inverse trigs)
 * would not follow this rule and is left to decline.
 *
 * Reading arithmetic this way is what lets an enclosing form see the elements
 * the closure actually produces. In a promoting mode with
 * `w(t) := [√(t−1), √(t−2)]`, `_fn_w` returns `[{re, im}, {re, im}]`, so
 * `2·w(t)` is an array of complex objects; without this route an enclosing
 * `(2·w(t))[1] + 1` would classify the whole `Multiply` from
 * `isComplexValued` — a scalar verdict describing no element, which answers
 * `false` here — and add `1` to an object.
 */
export function elementComplexness(
  collection: Expression
): boolean[] | undefined {
  const direct = withCollectionElements(collection, (elements) => {
    const out: boolean[] = [];
    for (const e of elements) {
      const v = broadcastLeafComplexness(e);
      // One element with no single answer leaves the whole collection with
      // none: a broadcast maps ONE closure over every position.
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  });
  if (direct !== undefined) return direct;

  if (
    !isFunction(collection) ||
    !COMPLEX_PROPAGATING_HEADS.has(collection.operator)
  )
    return undefined;

  let n: number | undefined = undefined;
  const perOperand: (boolean | boolean[])[] = [];
  for (const op of collection.ops) {
    // The same operand predicate `tryCompileBroadcast` uses to decide which
    // operands the closure sees element-wise; everything else is a scalar it
    // sees whole.
    if (
      op.isCollection ||
      op.type.matches('list<any>') ||
      op.type.matches('indexed_collection<any>') ||
      isBoundPossiblyCollectionTyped(op)
    ) {
      const elts = core.elementComplexness(op);
      if (elts === undefined) return undefined;
      // `_SYS.bcast` projects a LENGTH MISMATCH to NaN rather than zipping to
      // the shortest operand, so mismatched lengths produce no elements at
      // all and there is nothing here to describe.
      if (n !== undefined && elts.length !== n) return undefined;
      n = elts.length;
      perOperand.push(elts);
    } else perOperand.push(core.isComplexValued(op));
  }
  // No operand contributes elements: this is scalar arithmetic, not a
  // collection, and the element question does not apply to it.
  if (n === undefined) return undefined;

  const out: boolean[] = [];
  for (let i = 0; i < n; i++)
    out.push(perOperand.some((p) => (Array.isArray(p) ? p[i] : p)));
  return out;
}

/**
 * What the broadcast closure's parameter for operand `a` holds at run
 * time: `true` for a `{re, im}` object at every position, `false` for a
 * plain number at every position, `'mixed'` when the positions do not all
 * share one shape or the shape cannot be decided statically.
 *
 * A SCALAR operand is passed whole, so its own `isComplexValued` verdict is
 * the answer. An ARRAY operand contributes one element per position, and
 * the whole-collection verdict describes no single element (`[1+i, 2]`
 * types `vector<complex^2>` and reads complex while its second element is
 * the plain number `2`), so the answer comes from the elements:
 *
 * - visible elements (`elementComplexness`) answer directly — one shape
 *   shared by all, or `'mixed'`;
 * - an application of an ELEMENT-WISE head (`isElementwiseBroadcastHead`)
 *   lowers to one closure mapped over its arrays, so its elements share
 *   that closure's shape: when every operand lane of the application is
 *   decided, that is the application's own `isComplexValued` verdict —
 *   the closure is built by the head's scalar codegen from the very
 *   predicates `isComplexValued` reads (`√L` lowers to `_SYS.csqrt` at
 *   every element and the node reads complex; `sin L` to `Math.sin` and
 *   reads real). Before this rule, `L + √L` declined while `√L` alone
 *   compiled: the sum saw the radical's whole-node verdict, could not
 *   attribute it to an element, and failed closed (Tycho item 246).
 *   When some operand lane of the application is `'mixed'`, so is its
 *   result: the application itself lowers through the dispatching helpers
 *   (or declines, which fails the whole compile);
 * - any other array operand with complexness evidence — a `list<complex>`
 *   element type, or a complex whole-collection verdict — is `'mixed'`:
 *   the evidence cannot be attributed to individual elements. A rank-2
 *   list (a matrix) is treated the same way: its lowering is not the
 *   element-wise closure this analysis describes;
 * - in the `complex` mode (`complexDiscipline`), an array operand whose
 *   cell type ADMITS a complex value (`list<number>`, `tensor<number>`,
 *   `list<unknown>`) is `'mixed'` too: a scalar binding of such a type is
 *   complex in that mode, and a cell of the list can hold a `{re, im}`
 *   object as well. In the other modes such a cell is read on the real
 *   lane, as documented, and the emitted closure stays the plain one.
 */
export function operandElementLane(
  a: Expression,
  engine: ComputeEngine,
  target: CompileTarget<Expression>
): ElementLane {
  // An operand the D2/D6 runtime rule has projected onto the real lane
  // (`realOperandGuard`, element-wise form) holds plain numbers or NaN at
  // every position while its override is active: the code emitted for it
  // IS the projection. Answered before the memo so the verdict never
  // outlives the override.
  if (_codeOverrides.has(a)) return false;
  // The same operand predicate `tryCompileBroadcast` uses to decide which
  // operands the closure sees element-wise (`isArrayOperand`); everything
  // else is a scalar it sees whole.
  if (!isArrayOperand(a)) return core.isComplexValued(a);
  const memo = CompilerState._compileDepth > 0;
  const stack = CompilerState._elementLaneMemoStack;
  if (memo) {
    const layer = stack[stack.length - 1];
    if (layer.has(a)) return layer.get(a);
  }
  const result = _operandElementLane(a, engine, target);
  if (memo) {
    const after = CompilerState._elementLaneMemoStack;
    after[after.length - 1].set(a, result);
  }
  return result;
}

/**
 * The LANE of the entries of the collection operand `a` of a
 * linear-algebra head (`Determinant`, `Dot`, `MatrixMultiply`, …):
 *
 * - `'complex'`: an entry is complex-valued. The type has a complex leaf
 *   (`matrix<complex>`), an entry the compiler can identify is complex
 *   (`[x, i]`), or the operand as a whole reads complex. Under
 *   `mode: 'complex'` a wide operand is complex too, because that mode
 *   reads every wide value as complex.
 * - `'real'`: every entry is real. Either the compiler can identify every
 *   entry (a literal collection, or a user function whose body is one) and
 *   none of them is complex-valued, or the type proves every entry real
 *   (`matrix<real>`).
 * - `'wide'`: the type admits real and complex entries (`matrix<number>`,
 *   `list<unknown>`, an undeclared collection) and the mode is `strict` or
 *   `auto`. The heads READ A WIDE OPERAND AS REAL: the target emits the
 *   real-only helper, and a parent reads the value of the head as real.
 *   This is the reading of a `number`-typed scalar in the same modes. A
 *   `{re, im}` entry a caller binds to such an operand computes as a
 *   non-number: the entries of a binding are the caller's responsibility
 *   (`EntryPlan`, `javascript-runtime.ts`). The value is kept separate from `'real'` because a head whose value
 *   is correct for either representation (`Distance`) still chooses the
 *   helper that reads both.
 *
 * The same answer decides two things that must agree: which helper a
 * target emits for the head (a real-only one, or one that computes with
 * complex entries and returns complex values), and whether a PARENT
 * expression reads the head's value as complex (`isComplexValued`).
 *
 * Decision of 2026-09-24 (option B): before it, a `'wide'` operand failed
 * closed on the JavaScript target and asked the host for a precise type.
 */
export function linearAlgebraOperandLane(
  a: Expression
): 'real' | 'complex' | 'wide' {
  // A recorded WIDE lane gives way to the rules below: a body with a wide
  // entry (a `number`-typed global `w` in `[[t, w]]`) under a declared
  // `matrix<real>` is real by the declaration, which is the contract, as a
  // scalar `number` body is under a declared `-> real`.
  const recorded = userCallElementLane(a);
  if (recorded !== undefined && recorded !== 'wide') return recorded;
  if (mayHoldComplexElement(a)) return 'complex';
  if (core.elementComplexness(a) !== undefined) return 'real';
  if (realEntriesType(compilationType(a))) return 'real';
  const structural = structuralOperandLane(a);
  if (structural !== undefined) return structural;
  return complexDiscipline() ? 'complex' : 'wide';
}

export function constantFoldValue(
  expr: Expression,
  target: CompileTarget<Expression>
): { value: Expression; elements: Expression[] | undefined } | undefined {
  // Re-entry from the emission of a value this fold already computed (see
  // `emitFoldedValue`) — there is nothing left to fold inside it.
  if (CompilerState._emittingFoldedValue) return undefined;

  // A caller recording the capture set (`CompileTarget.symbolDeps` — the
  // implicit-compilation cache key) gets NO subtree folding: the fold
  // consults engine state TRANSITIVELY (a folded user-function call reads
  // its callees' definitions, a folded symbol's value may read further
  // symbols), and unlike the leaf-level `tryFoldKnownSymbol` — whose
  // recursive compile of the value records each nested read — an evaluation
  // has no per-read hook, so the capture set would under-report and the
  // cache would serve the baked constant after a dependency changed.
  // Declining keeps the capture contract exact; the implicit-compile
  // kernels are dominated by non-constant subtrees anyway.
  //
  // A closed exact operand of a function whose result jumps at a point is
  // the exception (`closedExactJump`): its structural code can give the
  // wrong value, so it folds when every read can be recorded
  // (`recordJumpFoldReads`, after the other gates below).
  if (target.symbolDeps !== undefined && !closedExactJump(expr, target))
    return undefined;

  if (hasUnknowns(expr)) return undefined;
  if (!expr.isPure) return undefined;
  // A free symbol or an impure operation reached only THROUGH an assigned
  // value also disqualifies the evaluation, which `unknowns` and `isPure`
  // do not see.
  if (foldValueBlocked(expr)) return undefined;

  const t = compilationType(expr);
  if (
    t !== 'unknown' &&
    t !== 'any' &&
    t !== 'value' &&
    !isSubtype(t, 'number') &&
    !isSubtype(t, 'boolean') &&
    !isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)
  )
    return undefined;

  // `indexed_collection` above is UNPARAMETRIZED, so it also admits
  // `list<string>`, `list<boolean>` and nested lists — none of which can
  // fold, since only number literals are inlined. Without this check the
  // decision would be deferred to `foldableCollectionElements`, i.e. until
  // AFTER a full `.N()` has materialized the collection (up to the
  // evaluation budget and the collection-size clamp), and it would be paid
  // again at every node the top-down walk reaches it from. When the element
  // type is statically known and is not numeric, decline here instead —
  // keeping this gate sequence's cheap-before-expensive ordering.
  const elementType = collectionElementType(t);
  if (
    elementType !== undefined &&
    elementType !== 'unknown' &&
    elementType !== 'any' &&
    elementType !== 'value' &&
    !isSubtype(elementType, 'number')
  )
    return undefined;

  if (mentionsCompileBoundName(expr)) return undefined;
  // A `Sum`/`Product` whose indexing set has a NON-FINITE bound never
  // folds: for a divergent series the interpreter's `.N()` silently
  // returns an iteration-limit-truncated PARTIAL sum (`Σ i, i=1..∞` →
  // 50015001, the 10001-term prefix), and baking that as a compile-time
  // constant would put a mathematically wrong number behind
  // `success: true` where the structural lowering deliberately fails
  // closed. Convergent infinite series decline too — telling the two
  // apart is exactly what the fold cannot do — and keep their pre-fold
  // behavior (fail closed, interpreter fallback at run time). A BOUNDED
  // infinite pipeline (`Sum(Take(Map(_ ↦ _^2, 1..∞), 10))`) has its `∞`
  // inside the collection operand, not an indexing set, and still folds.
  if (containsUnboundedBigOp(expr)) return undefined;
  // A `Tabulate` with a dimension that is a constant ≤ 0 is left to its
  // compile handler, which declines it (see
  // `isTabulateWithNonPositiveDimension`).
  if (isTabulateWithNonPositiveDimension(expr)) return undefined;
  // A COLOR value has a representation of its own on the JavaScript target —
  // the object `{ space, c0, c1, c2, alpha }` — and the interpreter's value
  // does not carry it: a color evaluates to a typed head, whose literal
  // emission is a bare numeric array, and a bare numeric array is a LIST on
  // this target, never a color. So a color-valued expression is left to its
  // own lowering, which builds the target's color value. The test is the
  // expression's TYPE (`isColorValued`), so every color-valued expression is
  // covered whatever its head, while an expression that answers components
  // rather than a color — `ColorToColorspace`, whose interpreted value is a
  // `Tuple` and whose compiled value is the same array — folds like any
  // other tuple.
  //
  // The shader targets are unaffected: a color there IS a bare `vec3` and
  // the folded literal is the right shape, with `gpuColorOperand` converting
  // it from the space `colorSpaceOf` reports for the unfolded expression.
  if (target.language === 'javascript' && isColorValued(expr)) return undefined;
  // Transitive on purpose: a mapped input reached through a symbol's
  // assigned value or a called function's body must not be baked either
  // (see `reachesExcludedName`).
  if (reachesExcludedName(expr, target)) return undefined;
  // `quadrature: 'monte-carlo'` is an explicit request for the stochastic
  // runtime estimator — a DIFFERENT result on each call, by contract.
  // Folding a constant integral to one fixed value would override that
  // request, so integrals stay structural under it.
  if (
    target.quadrature === 'monte-carlo' &&
    mentionsExcludedName(expr, undefined, MONTE_CARLO_FOLD_EXCLUSIONS)
  )
    return undefined;

  const engine = expr.engine;
  let value: Expression | undefined;
  // The materialized elements when the value is a foldable constant
  // COLLECTION (assigned inside the budget below, since walking a lazy
  // collection is real work).
  let elements: Expression[] | undefined;
  // Evaluation may re-enter compilation (large `Map` callbacks are
  // auto-compiled during evaluate); that inner compilation must not inherit
  // THIS compilation's bound-name context, or its analysis would treat the
  // evaluated expression's own names as shadowed.
  const savedBoundCtx = CompilerState._boundVarsCtx;
  const savedShield = CompilerState._binderShield;
  const savedMaxCollectionSize = engine.maxCollectionSize;
  // ANGULAR UNIT — a CORRECTNESS requirement, not a tuning knob.
  //
  // `rewriteAngularUnit` runs at the compile entry and puts the tree into
  // the RADIAN convention, so under `angularUnit: 'deg'` the subtree
  // reaching this point is `sin(90 * 0.01745…)`, not `sin(90)` (visible in
  // the emitted code of an unfolded compile). Evaluating that through
  // `.N()` on an engine still set to degrees applied the conversion a
  // SECOND time: `sin(90)` folded to 0.0274 — the sine of 90° re-read as
  // degrees — instead of 1, and `arctan(1)` to 2578.31 (45 × 180/π) on the
  // way out. Silently wrong compiled output, disagreeing with
  // interpretation, for every angular function with a CONSTANT argument on
  // a user-facing engine setting. (A free-variable argument was unaffected,
  // since only constant subtrees fold — which is why the bug's shape was
  // "constants only".) So the fold evaluates with the unit neutralized.
  //
  // EXCEPT under a derivative head. `rewriteAngularUnit` deliberately does
  // NOT rewrite the operands of `D`/`Derivative`/`ND` — differentiation is
  // unit-aware and must run in the engine's own convention, its closed form
  // being rewritten later where it is produced. A subtree containing one
  // therefore carries BOTH conventions at once and is correct under neither
  // single setting, so it is declined rather than folded: structural
  // compilation of that shape is already correct, and declining costs only
  // the fold.
  //
  // The neutralization uses `_withTransientAngularUnit`, not the
  // `angularUnit` setter. The setter resets the engine and purges its
  // caches, so a degree-mode compile paid two purges for each subtree that
  // folded (2.2 times the radian-mode compile time over 60 angular
  // constants). The transient window changes only the unit: the memos that
  // hold evaluated values are neither read nor written while it is open
  // (`_atTransientConfiguration`), so a value computed in radians is not
  // served later in degrees. (CE-345.1)
  const neutralizeAngle = engine.angularUnit !== 'rad';
  if (neutralizeAngle && containsDerivativeHead(expr)) return undefined;
  // The angle of `AbsArg(z)` is in the engine's unit, and evaluating it in
  // radians would give it in radians. `rewriteAngularUnit` refuses the
  // compilation of `AbsArg` in that case; this decline also covers a
  // subtree that did not go through the rewrite.
  if (neutralizeAngle && expr.has('AbsArg')) return undefined;

  // The eligibility decision, and the LAST gate before the expensive part:
  // everything above is a cheap structural check, so the estimate is only
  // paid for a subtree that would otherwise be evaluated. It is a property
  // of the expression alone, which is what makes the compiled output
  // reproducible — see `CONSTANT_FOLD_MAX_COST`.
  // Spelled as a NEGATED "within budget" rather than "over budget": a
  // comparison against `NaN` is false either way, so `> ceiling` would have
  // ADMITTED an estimate that arithmetic had turned into `NaN` instead of
  // declining it. Only a finite estimate at or under the ceiling folds.
  if (!(core.foldCostEstimate(expr) <= CONSTANT_FOLD_MAX_COST))
    return undefined;
  // A subtree that reads a stored definition with a unit-dependent head is
  // declined too. The compile entry rewrote the compiled tree into
  // radians, but not the value of an assigned symbol or the body of a user
  // function: `.N()` reads those as they are stored, in the engine's unit.
  // Under the radian window below, `2k` with `k := Sin(30)` in degree mode
  // evaluated `sin(30 rad)` and folded to -1.976 instead of 1. The
  // structural compilation rewrites each such value and body for the unit
  // (`foldedValueInRadians()`, and the rewrite of an inlined callee body),
  // and still folds the parts that read no stored definition. The test
  // runs after the cost estimate, which bounds the size of the subtree it
  // walks.
  if (neutralizeAngle && readsAngularDefinition(expr)) return undefined;
  if (
    target.symbolDeps !== undefined &&
    !recordJumpFoldReads(expr, target.symbolDeps)
  )
    return undefined;
  // Every gate above re-ran for THIS call site's context; only the
  // evaluation below is shared (see `_foldValueMemo`).
  let byExpr = CompilerState._foldValueMemo.get(target);
  const hit = byExpr?.get(expr);
  if (hit !== undefined) return hit === 'declined' ? undefined : hit;
  // An operand beyond the safe integer range at a position that reads
  // every digit: the value comes from `evaluate()`, not `.N()` (see
  // `unsafeIntegerOperands`). Read after the memo, since the scan
  // folds the operands it checks, which is the work the memo saves.
  const unsafe = unsafeIntegerOperands(expr, target);
  CompilerState._boundVarsCtx = undefined;
  CompilerState._binderShield = [];
  try {
    engine.maxCollectionSize = Math.min(
      savedMaxCollectionSize,
      CONSTANT_FOLD_MAX_COLLECTION_SIZE
    );
    // The evaluation runs with NO wall-clock budget of its own: a per-fold
    // deadline made the fold decision depend on machine load — five
    // in-process compiles of the same source produced two different
    // programs at load ~30 — which is the very nondeterminism
    // `foldCostEstimate` exists to prevent, so it was removed by user
    // ruling (the ROADMAP.md entry "compile-time constant-fold
    // eligibility is deterministic — the wall-clock backstop is
    // removed"). The
    // estimate is now the ONLY anti-hang gate, so every evaluation class
    // whose work is invisible to a syntax walk must be priced there (see
    // the quadrature arm), and the remaining evaluation bounds are
    // themselves deterministic: `engine.iterationLimit`, the
    // `maxCollectionSize` clamp above, and the quadrature interval
    // budget. An AMBIENT deadline armed by the caller still cancels the
    // whole compilation through the ordinary check sites.
    const evaluateFold = (): Expression | undefined => {
      const v = unsafe.length > 0 ? exactFoldValue(expr, unsafe) : expr.N();
      if (v === undefined) return undefined;
      elements = foldableCollectionElements(
        v,
        target.maxInlineElements ?? CONSTANT_FOLD_MAX_INLINE_ELEMENTS
      );
      return v;
    };
    value = neutralizeAngle
      ? engine._withTransientAngularUnit('rad', evaluateFold)
      : evaluateFold();
  } catch (e) {
    // An evaluation error is a quiet decline — but a cancellation
    // raised because the AMBIENT (outer) deadline expired must keep
    // cancelling the whole compilation, not be swallowed as a fold miss.
    if (!engine._shouldContinueExecution()) throw e;
    value = undefined;
  } finally {
    CompilerState._boundVarsCtx = savedBoundCtx;
    CompilerState._binderShield = savedShield;
    engine.maxCollectionSize = savedMaxCollectionSize;
  }
  if (byExpr === undefined) {
    byExpr = new Map();
    CompilerState._foldValueMemo.set(target, byExpr);
  }
  if (value === undefined) {
    // A failed evaluation is memoized too: a retry at the second call
    // site might land a DIFFERENT degraded estimate, which is exactly
    // the emit/analyze divergence this memo exists to prevent.
    byExpr.set(expr, 'declined');
    return undefined;
  }
  const result = { value, elements };
  byExpr.set(expr, result);
  return result;
}

/**
 * A DETERMINISTIC estimate of what evaluating `expr` at compile time will
 * cost, in abstract work units — the constant fold's eligibility test.
 *
 * Deterministic is the whole point: the decision depends only on the
 * expression, so one input always produces one compiled output (see
 * `CONSTANT_FOLD_MAX_COST` for the load-dependent behaviour this replaced).
 *
 * The estimate is deliberately an OVER-approximation, and it is MONOTONE —
 * a node never costs less than the sum of its parts. Monotonicity is
 * load-bearing rather than tidy: the fold is attempted top-down at every
 * node, so if a parent could estimate cheaper than a child, it could fold a
 * subtree the child had already refused, and the cost ceiling would depend
 * on where the walk happened to start.
 *
 * The multiplying constructs are the ones that actually decide cost:
 *
 * - a `Sum`/`Product` over a resolvable finite range costs its body once per
 *   iteration, so the body is multiplied by the trip count;
 * - a `Map`/`Filter` over a collection of resolvable size costs its callback
 *   once per element, likewise;
 * - an applied user function costs its own body, memoized by name in
 *   `FoldCostContext.cache` so a function reached from many call sites is
 *   analyzed once, with a separate in-progress set guarding recursion (a
 *   recursive definition has no static bound, so it declines).
 *
 * The estimator's own work is bounded by `CONSTANT_FOLD_MAX_VISITS` as well
 * as by depth, because it runs BEFORE the anti-hang deadline is armed and
 * so has no other backstop.
 *
 * Anything whose count cannot be resolved statically returns `Infinity` —
 * fail closed, the same answer the depth bound gives, and the same
 * shape every other gate in this folder uses. `Infinity` propagates through
 * the arithmetic below without special-casing.
 */
export function foldCostEstimate(
  expr: Expression,
  depth = 0,
  ctx?: FoldCostContext
): number {
  const c = ctx ?? {
    inProgress: new Set<string>(),
    cache: new Map(),
    visits: 0,
  };
  // The estimator's OWN work is bounded, not just the tree's depth. Depth
  // alone does not bound a wide call graph: composed helpers that each call
  // the one below a few times branch as fan-out^depth, and a 12-level,
  // 4-way composition took 26.6 s to analyze before this cap existed — far
  // more than the evaluation it was guarding. Exhausting the budget
  // declines, like every other unresolvable answer here.
  if (++c.visits > CONSTANT_FOLD_MAX_VISITS) return Infinity;
  if (depth > CONSTANT_FOLD_MAX_DEPTH) return Infinity;
  if (isNumber(expr) || isString(expr) || isCharacter(expr)) return 1;
  if (isSymbol(expr)) {
    // A symbol with an assigned value costs that value: the evaluator reads
    // it in the symbol's place. Cached by name, under a prefix that cannot
    // collide with an operator name, so a value referenced from many
    // places is priced once; a value that reaches itself has no static
    // bound. Pricing it as a leaf let a chain of values that each mention
    // the previous one twice pass the gate with an estimate of a few units
    // while its evaluation grew exponentially with the chain's depth.
    const value = expr.engine._getSymbolValue(expr.symbol);
    if (value === undefined || !isFunction(value)) return 1;
    const key = `value:${expr.symbol}`;
    const cached = c.cache.get(key);
    if (cached !== undefined) return cached;
    if (c.inProgress.has(key)) return Infinity;
    c.inProgress.add(key);
    const cost = 1 + core.foldCostEstimate(value, depth + 1, c);
    c.inProgress.delete(key);
    // As for the operator arm below: a non-finite answer is relative to the
    // depth it was reached at, so it is not cached under a depth-free key.
    if (Number.isFinite(cost)) c.cache.set(key, cost);
    return cost;
  }
  if (isDictionary(expr)) {
    let total = 1;
    for (const v of expr.values) {
      total += core.foldCostEstimate(v, depth + 1, c);
      if (total >= Infinity) return Infinity;
    }
    return total;
  }
  if (!isFunction(expr)) return 1;

  const op = expr.operator;
  const ops = expr.ops;

  // A definite integral costs its integrand once per quadrature node,
  // and its evaluation may run the full adaptive interval budget — work
  // entirely invisible to a syntax walk (the node is a handful of
  // operands). Priced at the quadrature WORST case
  // (`FOLD_QUADRATURE_EVALS`), multiplicatively: a NESTED inner
  // integral's own arm multiplies again, which is what makes an iterated
  // integral decline. A FLAT multi-limit spelling
  // (`Integrate(body, Limits(x, …), Limits(y, …))`) is the same iterated
  // work in one node — `nIntegrateMultiple` runs a complete inner
  // quadrature per outer sample — and two worst-case levels always
  // exceed the ceiling, so it declines directly. `NIntegrate(f, a, b)` is
  // always one-dimensional and runs the same methods in the same order as
  // a single-limit `Integrate(…).N()` (`integrateRealPart()`,
  // `library/calculus.ts`: quadrature first, Monte Carlo only as the
  // fallback), so it takes the same price. Its integrand can be the NAME
  // of a user function (`NIntegrate(g, 0, 1)`): the name alone is one
  // syntax node, so the body of `g` is added, once per evaluation.
  // An INDEFINITE integral takes the quadrature price although its
  // `.N()` stays symbolic: over-pricing it merely declines a fold that
  // could not have produced a number anyway.
  // A numeric limit's fallback is Richardson extrapolation with a
  // 1e6-evaluation budget (`numerics/richardson.ts`), reached whenever the
  // probe samples never settle — an oscillatory constant limit such as
  // `lim_{x→0} sin(1/x)` — and its per-iteration Neville update makes the
  // worst case far beyond any fold ceiling. The work is invisible to a
  // syntax walk, and unlike quadrature there is no cheap-and-typical tier
  // to admit: whether the samples settle is not readable statically.
  // Decline the fold; the structural lowering (`_SYS.limit`) evaluates at
  // run time, where the caller's deadline governs. `Residue` reaches the
  // same numeric limit machinery through its evaluation.
  if (op === 'Limit' || op === 'NLimit' || op === 'Residue') return Infinity;

  if (op === 'Integrate' || op === 'NIntegrate') {
    if (op === 'Integrate' && ops.length > 2) return Infinity;
    let body = core.foldCostEstimate(ops[0], depth + 1, c);
    if (op === 'NIntegrate' && isSymbol(ops[0]))
      body += calleeBodyCost(expr.engine, ops[0].symbol, depth, c);
    if (!Number.isFinite(body)) return Infinity;
    let boundsCost = 0;
    for (const operand of ops.slice(1)) {
      boundsCost += core.foldCostEstimate(operand, depth + 1, c);
      if (!Number.isFinite(boundsCost)) return Infinity;
    }
    return 1 + boundsCost + FOLD_QUADRATURE_EVALS * body;
  }

  // A big op costs its body once per iteration. `bigOpBoundConstant`
  // already answers `undefined` for a bound that is symbolic or mentions a
  // compile-bound name, which is exactly when there is no static count.
  if (op === 'Sum' || op === 'Product') {
    const body = core.foldCostEstimate(ops[0], depth + 1, c);
    // A non-finite body poisons the product REGARDLESS of the count: in
    // JavaScript `0 * Infinity` is `NaN`, and `NaN > ceiling` is false, so
    // a zero-trip node wrapping an unpriceable body would have sailed
    // through the gate as "cheap". Non-finite in, non-finite out.
    if (!Number.isFinite(body)) return Infinity;

    // The INDEXED form (`Sum(body, Limits(i, a, b))`) repeats its body once
    // per iteration.
    if (ops.length >= 2) {
      const trips = bigOpTripCount(expr);
      if (trips === undefined || trips > CONSTANT_FOLD_MAX_WALK)
        return Infinity;
      return 1 + trips * body;
    }

    // The one-operand COLLECTION-REDUCER form (`Sum(xs)`) reduces every
    // element of its operand, so it costs the collection's size — not the
    // three syntax nodes the generic arm would have counted.
    // `Sum(Range(1, 1000000))` took 1.07 s to fold under the generic
    // pricing, close enough to the anti-hang deadline that load could
    // decide the outcome again.
    // An UNRESOLVABLE size takes the same optimistic fallback the
    // `Map`/`Filter` arm uses, and for the same reason: this estimate also
    // runs over a callee's BODY, where the bounds are the function's own
    // parameters and are symbolic by construction. `g(k) := Sum(Take(…, k))`
    // has no static size in the body, yet `g(3)` is a perfectly ordinary
    // constant fold — declining here refused it. A size that IS resolvable
    // is still priced, which is what keeps `Sum(Range(1, 1000000))` out.
    const size = staticCollectionSize(ops[0], depth + 1);
    if (size !== undefined && size > CONSTANT_FOLD_MAX_WALK) return Infinity;
    return 1 + (size ?? 1) * body;
  }

  // A `Take` with a positive constant count `n` of a `Map` applies the
  // callback only to the first `n` elements: the `Map` of the interpreter
  // is lazy, so `Take(Map(f, Range(1, 100000)), 10)` walks ten elements.
  // The walk is the size of the `Take` (`staticCollectionSize`, which is
  // the smaller of `n` and the size of the source), so the walk cap and the
  // cost apply to that size and not to the size of the source. The sources
  // are priced by their own estimate, which declines a source that walks
  // more than the cap itself (a nested `Map` or a `Filter`). A negative
  // count takes the last elements, which walks the whole source, so it is
  // priced by the arms below.
  if (op === 'Take' && ops.length === 2) {
    const map = ops[0];
    const n = core.bigOpBoundConstant(ops[1]);
    if (
      n !== undefined &&
      n > 0 &&
      isFunction(map) &&
      map.operator === 'Map' &&
      map.ops.length >= 2
    ) {
      const size = staticCollectionSize(expr, depth);
      if (size === undefined || size > CONSTANT_FOLD_MAX_WALK) return Infinity;
      const perElement = core.foldCostEstimate(map.ops[0], depth + 2, c);
      let sourceCost = 0;
      for (const source of map.ops.slice(1))
        sourceCost += core.foldCostEstimate(source, depth + 2, c);
      if (!Number.isFinite(perElement) || !Number.isFinite(sourceCost))
        return Infinity;
      return 3 + sourceCost + size * perElement;
    }
  }

  // A collection PIPELINE costs its callback once per element. The size
  // comes from the source (`staticCollectionSize`), so a pipeline over a
  // literal range is priced by that range even though the pipeline itself
  // is only a few nodes. Without this a `Sum(Map(f, 1..100000))` estimated
  // at a dozen units — the multiplying construct is the collection, not the
  // syntax — and evaluating it forced all 100 000 elements.
  if ((op === 'Map' || op === 'Filter') && ops.length >= 2) {
    // `Map(f, xs)` is callback-first; `Filter(xs, f)` is collection-first.
    // The zipWith form `Map(f, xs, ys, …)` walks every source in lockstep
    // and stops at the shortest, so its size is the minimum over the
    // sources and each source is materialized once.
    const [callback, sources] =
      op === 'Map' ? [ops[0], ops.slice(1)] : [ops[1], [ops[0]]];
    // `staticCollectionSize` knows the zip rule for `Map`; a `Filter` is
    // priced by its source, the bound on what it can keep.
    const size =
      op === 'Map'
        ? staticCollectionSize(expr, depth)
        : staticCollectionSize(ops[0], depth + 1);
    const perElement = core.foldCostEstimate(callback, depth + 1, c);
    let sourceCost = 0;
    for (const source of sources)
      sourceCost += core.foldCostEstimate(source, depth + 1, c);
    if (!Number.isFinite(perElement) || !Number.isFinite(sourceCost))
      return Infinity;
    if (size !== undefined && size > CONSTANT_FOLD_MAX_WALK) return Infinity;
    // An UNRESOLVABLE source size is priced as a single element rather than
    // as infinite, because the bound may live in a CONSUMER above this node
    // rather than in the source below it: `Take(Map(f, 1..∞), 10)` walks ten
    // elements, and `staticCollectionSize` prices that correctly from the
    // `Take`. Declining here instead would refuse every bounded infinite
    // pipeline — the shape the lazy-stream lowering exists for. A pipeline
    // with neither a resolvable source nor a bounding consumer is not
    // under-guarded: it cannot produce a finite collection, so the
    // evaluation returns a non-number and the fold declines on the value.
    //
    // The size is read from SYNTAX, so a collection returned by a USER
    // FUNCTION (`myrange(n) := Range(1, n)`, then `Map(f, myrange(10^6))`)
    // is invisible here and takes this same one-element fallback however
    // large it really is. That gap is bounded not by this estimate but by
    // `CONSTANT_FOLD_MAX_COLLECTION_SIZE`, which clamps
    // `engine.maxCollectionSize` for the evaluation: materialization stops
    // early and the fold declines on the value instead. Anything that
    // raises or relocates that clamp has to revisit this line.
    return 1 + sourceCost + (size ?? 1) * perElement;
  }

  // A user-defined function costs its own body. Memoized by NAME: a
  // function applied ten times is analyzed once, so the estimator stays
  // linear in the program rather than in the call graph. A name already on
  // the path is recursive and has no static bound.
  const calleeCost = calleeBodyCost(expr.engine, op, depth, c);
  if (!Number.isFinite(calleeCost)) return Infinity;

  let total = 1 + calleeCost;
  for (const operand of ops) {
    total += core.foldCostEstimate(operand, depth + 1, c);
    if (total >= Infinity) return Infinity;
  }
  // A higher-order operator (`CountIf(xs, p)`, `Any(xs, p)`,
  // `Reduce(xs, f)`, `Fold(f, x0, xs)`, …) applies its callback once per
  // element of a collection operand. The syntax walk above counted the
  // callback once, so the walk is priced here: the size of each collection
  // operand times the cost of one application. An operator with no
  // callback operand (`Length(xs)`, `Mean(xs)`) is not priced per element:
  // several of them have a closed form over a `Range`. The callback is
  // priced only when a collection operand has a static size: a callback
  // operand with no collection to walk (`Apply(Derivative(f), 0.5)`) was
  // counted once above, and pricing its body again here could only decline
  // a fold that the walk above admitted.
  let elements = 0;
  for (const operand of ops) {
    const size = staticCollectionSize(operand, depth + 1);
    if (size !== undefined) elements += size;
  }
  if (elements > 0) {
    let application: number | undefined;
    for (const operand of ops) {
      const cost = callbackApplicationCost(operand, depth, c);
      if (cost !== undefined) application = Math.max(application ?? 0, cost);
    }
    if (application !== undefined) {
      if (!Number.isFinite(application)) return Infinity;
      if (elements > CONSTANT_FOLD_MAX_WALK) return Infinity;
      total += elements * application;
    }
  }
  return total;
}

/**
 * The compile-time integer value of a `Sum`/`Product` bound, or `undefined`
 * when the bound is not a compile-time constant and must instead be emitted
 * as code and evaluated at run time.
 * With a JavaScript emission target, also reuse eligible constant folds.
 * Newly folded bounds must floor to safe integers so a counter can advance.
 * Analysis callers without a target only inspect the expression's value.
 *
 * A bound that mentions a compile-bound name has NO compile-time value, and
 * reading one anyway is not a harmless miss: with the library's single-letter
 * constants it yields a plausible number instead of `NaN`, and the caller
 * then folds the whole big op against it behind `success: true`. With
 * `F(i) = Σ_{m=1..i} m`, the parameter `i` resolved to the imaginary unit
 * (`re` 0), so `lower 1 > upper 0` read as an empty range and the body
 * compiled to the identity `0` — `_fn_F = (i) => 0` — while the interpreter
 * answered 6. A parameter named `e` picked up Euler's number and summed two
 * terms (`3`). Reported by the Tycho team as item 176; the same shape on the
 * GPU targets emitted `float _fn_F(float i) { return 0.0; }`.
 *
 * Callers must treat `undefined` as "symbolic bound" and emit the loop form,
 * which compiles the bound expression in a target that maps the bound name to
 * its emitted local.
 */
export function bigOpBoundConstant(
  expr: Expression | undefined,
  target?: CompileTarget<Expression>
): number | undefined {
  if (expr === undefined) return undefined;
  if (mentionsCompileBoundName(expr)) return undefined;
  if (
    target?.boundVars !== undefined &&
    mentionsExcludedName(expr, target.boundVars, undefined)
  )
    return undefined;
  // A nonzero imaginary part leaves no iteration count; folding on the real
  // part alone would silently discard it (`Σ_{n=1}^{i}` → the empty range).
  const im = expr.im;
  if (!isNaN(im) && im !== 0) return undefined;
  let re = expr.re;
  // Bound emission must use the same folded value as ordinary expression
  // emission. Otherwise Length(P) can become 53 only after the loop has
  // already been classified as symbolic, leaving a floor and finite checks.
  if (
    isNaN(re) &&
    target?.language === 'javascript' &&
    target.constantFold !== false
  ) {
    const value = foldedRealNumber(expr, target);
    if (value !== undefined && Number.isSafeInteger(Math.floor(value)))
      re = value;
  }
  if (isNaN(re) || !Number.isFinite(re)) return undefined;
  return Math.floor(re);
}

export function _compileInner(
  expr: Expression,
  target: CompileTarget<Expression>,
  prec = 0
): TargetSource {
  // `f(...p)` — a `Spread` operand splices a tuple into the call's
  // arguments. Rewrite statically and re-enter compilation; the rewrite is
  // target-agnostic (it lowers to positional `At` accesses, which each
  // target compiles with its own indexing rules).
  if (isFunction(expr) && expr.ops.some((x) => x.operator === 'Spread'))
    return core.compile(spliceSpreadOperands(expr), target, prec);

  // A user definition that shadows a library operator (`function
  // Square(x) { x + 100 }`) is what the interpreter calls, but the target's
  // built-in lowering of the head (`Square(y)` → `y * y`, `Sin` →
  // `Math.sin`, the compiler's own lowering of `If`) is the library's. Fail
  // closed rather than emit the library operator: the interpreter evaluates
  // the call instead. See `shadowedLibraryLoweringError()`.
  if (isFunction(expr)) {
    const error = shadowedLibraryLoweringError(
      expr.engine,
      expr.operator,
      target
    );
    if (error !== undefined) throw new Error(error);
    const local = compileLocallyBoundLibraryCall(expr, target);
    if (local !== undefined) return local;
    // An arithmetic operand whose type is a function type (`g + 1` with
    // `const g = (x) => x + 2`): the interpreter keeps such an expression
    // symbolic, and the emitted JavaScript applied `+` or `*` to a
    // function value, which gives a string or `NaN`. Fail closed.
    if (ARITHMETIC_HEADS.has(expr.operator)) {
      const fn = expr.ops.find((op) => {
        // A block-local function is typed from its uses (`number` in
        // `g + 1`), so its binding is read too.
        if (isSymbol(op) && blockLocalFunction(op.symbol, target) !== undefined)
          return true;
        const t = resolveTypeAlias(op.type.type);
        return (
          t === 'function' || (typeof t === 'object' && t.kind === 'signature')
        );
      });
      if (fn !== undefined)
        throw new Error(
          `Could not compile \`${expr.operator}\`: the operand ` +
            `\`${fn.toString()}\` is a function, and the compiled code ` +
            `has no arithmetic on functions. The interpreter keeps the ` +
            `expression symbolic.`
        );
    }
    // An index into the value of a call of a block-local function
    // (`At(f(x), 1)` with `const f = (u) => (u + 1, 2)`). The engine types
    // such a call `unknown`, so the `At` lowerings, which read the static
    // type of their first operand, declined with "first operand is not an
    // indexed collection". The call is given the result type of the
    // literal. CE-236.
    if (expr.operator === 'At' && expr.nops === 2) {
      const typed = localCallWithResultType(expr.op1, target);
      if (typed !== undefined)
        return core.compile(
          expr.engine.function('At', [typed, expr.op2]),
          target,
          prec
        );
    }
  }

  // Is it a symbol?
  if (isSymbol(expr)) return compileInnerSymbol(expr, target);

  // Is it a number?
  if (isNumber(expr)) {
    // `~oo` first: it carries an infinite imaginary part, but it types
    // `number` (the non-finite typing convention admits undirected infinity
    // at the top type only), and a real target cannot spell an undirected
    // infinity. Its float projection is `Infinity` (pole-encoding ruling,
    // 2026-08-28): the runtime division `1/x` at `x = 0` already answers
    // the IEEE `Infinity` through the bare `/` instruction, so the folded
    // spelling of the same pole must agree — a literal `1/0` folds to the
    // interpreter's `~oo` and now embeds as `Infinity`, not `NaN`. The
    // projection keeps the MAGNITUDE and drops the missing direction; it is
    // documented as the float-target carve-out in
    // `docs/COMPILATION-MODEL.md`. (Emitting the `{re: ∞, im: ∞}` object
    // instead handed a real-arithmetic parent an object to add, producing
    // the string `"1[object Object]"` from `1 + ~oo`.)
    if (expr.isInfinity && expr.isComplex) return target.number(Infinity);
    if (expr.isComplex) {
      if (!target.complex)
        throw new Error('Complex numbers are not supported by this target');
      return target.complex(expr.re, expr.im);
    }
    // A literal the engine holds EXACTLY but that no double represents —
    // `1/49`, `√2` — reaches the target through `inexactNumber` when the
    // target defines one, because `expr.re` is then a rounded value, not
    // the literal. The interval target spells such a literal as an
    // enclosure of the true value instead of a point at the rounded one.
    const inexact =
      target.inexactNumber !== undefined && literalHasNoDoubleValue(expr);
    const code = inexact
      ? target.inexactNumber!(expr.re, literalDoubleRoundings(expr))
      : target.number(expr.re);
    // A negative numeric literal (e.g. `-2`) has a leading unary minus, so it
    // must be parenthesized wherever a unary `Negate(...)` would be: when
    // spliced as an operand that binds tighter than unary negation. Otherwise
    // Python `Power(-2, x)` emits `-2 ** x`, which parses as `-(2 ** x)`
    // (sign-flipped). Mirror the Negate operator's own `op[1] < prec` wrap.
    // An `inexactNumber` spelling is exempt: it is a target-chosen
    // aggregate (the interval target emits an object literal), not a
    // number with a leading sign.
    if (expr.re < 0 && !inexact) {
      const negPrec = target.operators?.('Negate')?.[1] ?? 14;
      if (negPrec < prec) return `(${code})`;
    }
    return code;
  }

  // Is it a string?
  if (isString(expr)) {
    return target.string(expr.string);
  }

  // Is it a CHARACTER? A character is exactly one grapheme cluster, and on a
  // target that can represent one the faithful lowering is the one-character
  // string it denotes — the distinction between the two kinds is compile-time
  // only. Gated on the target's own `character` capability rather than on
  // `string`, because holding the cluster is only half of it: ordering two
  // characters, segmenting a string into them and counting them all need
  // grapheme-cluster awareness. Python has string literals but no stdlib
  // grapheme segmentation, and GLSL/WGSL have no text at all, so both decline
  // here instead of emitting a target string that would then be compared with
  // the wrong order or indexed by the wrong unit.
  // (`docs/STRING_ROADMAP.md`, decision D13.)
  if (isCharacter(expr)) {
    if (target.character === undefined)
      throw new Error(
        `Could not compile a character to target '${target.language ?? '?'}': ` +
          `it has no character representation (a character is one UAX #29 ` +
          `grapheme cluster, which this target cannot segment or order). The interpreter evaluates it instead.`
      );
    return target.character(expr.string);
  }

  // It must be a function expression...
  if (!isFunction(expr))
    throw new Error(`Could not compile expression: "${expr.toString()}"`);
  // The node itself is passed along: the CSE region inventory is keyed by
  // the `(node, operandIndex)` EDGE (a tree may be a DAG, so a bare operand
  // object is ambiguous), and `compileExpr` receives only the operand list.
  const prevCseParent = CompilerState._cseParent;
  CompilerState._cseParent = expr;
  try {
    return liftWideResult(
      expr,
      core.compileExpr(
        expr.engine,
        expr.operator,
        expr.ops,
        prec,
        target,
        expr
      ),
      target
    );
  } finally {
    CompilerState._cseParent = prevCseParent;
  }
}

/**
 * Compile a function expression
 */
export function compileExpr(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  prec: number,
  target: CompileTarget<Expression>,
  /** The node being lowered, when the caller has it: the CSE region
   * inventory is keyed by the `(node, operandIndex)` edge (§5.1). Omitting
   * it costs only the optimization — no region is pushed. */
  node?: Expression
): TargetSource {
  // Most cases of this function are in functions of their own
  // (`compileExprOperator`, `compileExprFunctionCall`, …), each called as
  // `sub = …; if (sub !== undefined) return sub;`. The compiler is
  // recursive, and each level of a nested expression keeps one frame of
  // this function on the stack: with all its cases inline, the frame was
  // 1,632 bytes, and an expression nested about 280 levels deep overflowed
  // the stack. The helpers keep the frame small (ROADMAP CE-320.2).
  let sub: TargetSource | undefined;
  if (h === 'Error') throw new Error('Error');

  // A known captured function body cannot be replaced by a different
  // ambient function. Forward placeholders and target operator overrides
  // still resolve actively; local compilation bindings supply their own code.
  sub = compileExprCapturedBody(engine, h, target, node);
  if (sub !== undefined) return sub;

  assertCollectionOmissionSupported(h, args, node, target);
  assertNoProvedAbsentObjectOperand(engine, h, args);

  // An operation with a value of a value kind, lowered by the kind's
  // compile contract (`compileKindOperation`).
  sub = compileKindOperation(h, args, target, node);
  if (sub !== undefined) return sub;

  // A node whose TYPE is the value `true` or `false` — a comparison proven
  // by its operands' types (`Equal(a, a)` over a NaN-free `a`), a
  // connective of such, a literal predicate — lowers to the target's own
  // `True`/`False` literal instead of the runtime test, when it is
  // compile-pure (`booleanClaim`). Control-flow heads are exempt: they
  // may lower to statements, which a literal cannot replace.
  if (node !== undefined && !CONTROL_FLOW_HEADS.has(h)) {
    const claim = booleanClaim(node);
    if (claim !== undefined)
      return core.compile(claim ? engine.True : engine.False, target);
  }

  // A TUPLE argument at a parameter declared as a scalar maps over its
  // components (user decision 2026-10-03), so the call is compiled as the
  // tuple of the calls at each component (`declaredScalarTupleCall`).
  sub = compileExprTupleCall(engine, h, args, prec, target);
  if (sub !== undefined) return sub;

  if (h === 'Sequence') {
    if (args.length === 0) return '';
    return `(${args.map((arg) => core.compile(arg, target, prec)).join(', ')})`;
  }

  // A collection operand that can be absent as a whole (`missing | list<…>`)
  // at an operator that answers the absence marker for an absent operand:
  // the operand is bound once, and the operator is lowered on the present
  // collection under a test for the absent value. See
  // `absentCollectionOperandGuard`.
  {
    const guarded = absentCollectionOperandGuard(engine, h, args, target, node);
    if (guarded !== undefined) return guarded;
  }

  if (h === 'Sum' || h === 'Product') {
    // A clause with only one bound (`\sum_{k=1} k`, `Limits(k, 1,
    // Nothing)`) has no value: the interpreter keeps the operator
    // unevaluated and chooses no default for the missing bound
    // (`hasOneSidedLimits()`). Every target declines it here with that
    // reason. Before, the targets read the `Nothing` marker of the missing
    // bound as a variable and declined with a message about `Nothing`
    // (CE-142.5). A caller that maps a run-time input named `Nothing`
    // through the `vars` option keeps that input as the bound.
    if (
      args.length > 1 &&
      !target.varsKeys?.has('Nothing') &&
      hasOneSidedLimits(args.slice(1))
    )
      throw new Error(
        `Could not compile \`${h}\`: a ${h === 'Sum' ? 'sum' : 'product'} ` +
          `with only one bound has no value, and the interpreter keeps it ` +
          `unevaluated.`
      );
    // A clause with no bounds (`\sum_k f`) runs over 1..+∞, as in the
    // interpreter, so the targets read the bounds 1 and +∞ (and decline the
    // infinite bound by name) instead of the `Nothing` marker.
    const bigOpArgs =
      args.length > 1
        ? [args[0], ...withDefaultBigOpBounds(engine, args.slice(1))]
        : args;
    // Delegate to target-specific function handler if available,
    // otherwise fall back to the generic loop compilation.
    const sumProdFn = target.functions?.(h);
    if (typeof sumProdFn === 'function') {
      return sumProdFn(
        bigOpArgs,
        (expr) => compileValueOperand(expr, target),
        target
      );
    }
    if (typeof sumProdFn === 'string') {
      return `${sumProdFn}(${bigOpArgs
        .map((x) => core.compile(x, target))
        .join(', ')})`;
    }
    return compileLoop(h, bigOpArgs, target, node);
  }

  // A user operator definition may supply its own target-aware compile
  // handler (the public per-operator compilation extension point). It is
  // consulted HERE — before the target's built-in operator mappings, the
  // broadcast lowering, and the broadcast fail-closed guard — so an explicit
  // handler is an explicit opt-in that takes precedence over the built-in
  // lowering, even for an operator-mapped head (e.g. a custom-tolerance `GCD`
  // or a re-mapped `Add`). Structural/control-flow heads
  // (`CONTROL_FLOW_HEADS`: Sum/Product/If/When/Match/Block/Function/
  // Loop/Comprehension/Sequence, …) are handled by their own bespoke lowering
  // and are NOT overridable — except the carve-outs in
  // `OVERRIDABLE_CONTROL_FLOW_HEADS` (`Which`, Tycho item 180), which have
  // no binding structure and keep the decline-falls-back contract. A handler
  // that returns `undefined`/`null` OR an
  // empty string falls through to the default compilation (finding A5).
  // Set when a per-operator `compile` handler ran and DECLINED — the head is
  // known and lowerable in general, it just has no lowering for THIS operand
  // shape or target. Read by the fall-through diagnostic below so the decline
  // is not reported as `Unknown operator` (Tycho item 109a).
  let declinedByCustomHandler = false;
  if (!CONTROL_FLOW_HEADS.has(h) || OVERRIDABLE_CONTROL_FLOW_HEADS.has(h)) {
    // `lookupApplicable`, not `lookupDefinition`: `h` is by construction in
    // OPERATOR position, and a user value that shadows a builtin of the same
    // name — `D` as a diffusion coefficient, `N` as a count — must not hide
    // the builtin's lowering. That is the same rule binding already follows
    // (`BoxedFunction` resolves its def with `lookupApplicable`), so without
    // it a `D(x^2, x)` that EVALUATES fine would fail to compile with
    // ``Unknown operator `D` ``.
    const customDef = lookupApplicable(h, engine.context.lexicalScope);
    if (
      isOperatorDef(customDef) &&
      typeof customDef.operator.compile === 'function'
    ) {
      const custom = customDef.operator.compile(
        fieldArgsWithDeclaredReceiver(
          engine,
          h,
          args,
          target.declaredVarTypes
        ) ?? args,
        (expr) => compileValueOperand(expr, target),
        {
          language: target.language ?? 'javascript',
          typeOf: (x) => operandTypeInContext(x, target),
        }
      );
      if (custom !== undefined && custom !== null && custom !== '') {
        recordCallerHandlerCode(h, customDef.operator, target);
        return custom;
      }
      declinedByCustomHandler = true;
    }
  }

  // After the per-operator handler: a user operator that supports these
  // operand types lowers them itself.
  assertOrderedOperandsAreNumbers(h, args, target);

  // `And`/`Or`/`Not` used as a VALUE over an operand that may be ABSENT
  // (typed `boolean | missing`, `undefined` or `None` at run time) follow
  // the Kleene tables, as in the interpreter. See `kleeneValueConnective`.
  {
    const kleene = kleeneValueConnective(h, args, target, node);
    if (kleene !== undefined) return kleene;
  }

  // Arithmetic, or a function applied to each coordinate (`Sin`, `Ln`,
  // `Floor`, …), over a `Tuple` with a LIST coordinate (`Tuple(A, B)` with
  // `A`, `B` declared lists, built as MathJSON) fails closed. Such a tuple
  // is data, not a point, and the interpreter answers an
  // `incompatible-type` error for it (`listCoordinateTupleOperandError`).
  // Without this decline the broadcast lowering combined the lists
  // coordinate by coordinate and returned a pair of arrays that is neither
  // a point nor a list of points. A list of points is `PointList(A, B)`,
  // which is what the LaTeX `(A, B)` canonicalizes to.
  if (
    args.some((x) => isTupleWithListCoordinate(x)) &&
    (TUPLE_ARITHMETIC_HEADS.has(h) || appliesToEachTupleCoordinate(engine, h))
  )
    throw new Error(
      `Could not compile \`${h}\`: an operand is a tuple with a list coordinate, ` +
        `which is not a point. Write \`PointList(…)\` for a list of points.`
    );

  // The sum or the difference of a point and a number is an
  // `incompatible-type` error in the interpreter, for one point and for
  // each point of a list of points. Compiled code holds a point as an
  // array, and the broadcast lowering added the number to each
  // coordinate: `At(P, 1) + 1` with `P: broadcastable<tuple<number,
  // number>>` holding `[(3, 4), (6, 8)]` gave `[4, 5]`. So the
  // compilation declines when an operand may hold a point by its type
  // (a tuple arm, or a collection or broadcastable of tuples), every
  // array its type admits is a point or a collection of points
  // (`arraysArePoints`), and another operand is a number. A type that
  // also admits a list of numbers (`list<number> | tuple<…>`) keeps its
  // code: compiled code cannot tell that list from a point, and the
  // list is a value the sum reads element by element. A top type
  // (`any`, `unknown`) is not read as a point here: nothing is known
  // about it (ROADMAP CE-221).
  if (
    (h === 'Add' || h === 'Subtract') &&
    args.some(
      (x) => typeHasPointArm(x.type.type) && arraysArePoints(x.type.type)
    ) &&
    args.some((x) => isSubtype(x.type.type, 'number'))
  )
    throw new Error(
      `Could not compile \`${h}\`: an operand may be a point (a tuple) and another ` +
        `operand is a number. The sum of a point and a number is an ` +
        `\`incompatible-type\` error, which compiled code cannot return.`
    );

  // |(x,y)| over a fixed-arity point is the Euclidean norm (`Abs(Tuple)`
  // routes to `Norm` at evaluation). A point binds ATOMICALLY — it must
  // never be broadcast into component-wise `abs`, so this rewrite sits
  // BEFORE the broadcast lowering (which would map over the tuple) but
  // AFTER the custom per-operator compile hook above, so a user-registered
  // `Abs` handler keeps its documented precedence (Tycho item 74: the js
  // target compiled `|(x,y)|` to a bare array that concatenated into a
  // string downstream). `isTuple` (type-based), matching the evaluate and
  // type-handler detection: a tuple-TYPED symbol is a point too — without
  // it, `|p|` for `p: tuple<real,real>` broadcast `Math.abs` over the
  // point's components behind `success: true`.
  //
  // A union whose every arm is a tuple — `tuple<number, number> |
  // tuple<list<number>, list<number>>` — is a point too: whichever arm the
  // value takes, `Abs` of it is a norm (with the coordinate broadcast the
  // `Norm` lowering performs for a list coordinate), never the
  // component-wise `abs` the broadcast lowering emitted for it.
  //
  // A GATED point (`isGatedPoint`: a restricted point such as
  // `When((t, 1), c)`) is a point too when it is present. Without this,
  // the Python target emitted `np.abs(…)` over it, the component-wise
  // `abs`.
  if (
    h === 'Abs' &&
    args.length === 1 &&
    (isTuple(args[0]) || isUnionOfPoints(args[0]) || isGatedPoint(args[0]))
  ) {
    return core.compileExpr(engine, 'Norm', args, prec, target);
  }

  // Same rule one level up: `|S|` over a LIST of points is the list of point
  // norms (the interpreter broadcasts `Abs`, and `Abs` of a point is its
  // norm), NOT the component-wise `abs` the broadcast lowering below would
  // emit behind `success: true` (Tycho item 138). Every target's `Norm`
  // either lowers the point list (javascript) or fails closed on it, so the
  // rewrite is uniform rather than javascript-only.
  //
  // A RESTRICTED list of points (`PointList(L {c}, y)`, typed
  // `list<tuple<…>> | missing`) is a list of points too when it is
  // present. Without this test, its `missing` arm hid the point element
  // type, and the broadcast lowering took the absolute value of each
  // coordinate: `[[1, 3], [2, 3]]` where the interpreter answers
  // `[√10, √13]`.
  //
  // A `broadcastable<P>` of points is one point or a tensor of points of
  // any rank, and the static type does not say which. On the JavaScript
  // target the shape is read at run time (`_SYS.absShape`): one point is
  // its norm, a list of points one norm per point, and a tensor of points
  // of rank 2 or more a tensor of norms, as the interpreter answers. The
  // `Norm` rewrite below cannot give the last answer: the interpreter's
  // `Norm` refuses a tensor of points of rank 2 or more. A collection of
  // points at more than one level (`isNestedPointCollectionType`, a
  // `tensor<tuple<…>>`) takes the same dispatch, for the same reason; the
  // element-wise lowering took the absolute value of each coordinate.
  if (
    h === 'Abs' &&
    args.length === 1 &&
    target.language === 'javascript' &&
    (isBroadcastablePointType(args[0].type.type) ||
      isNestedPointCollectionType(args[0].type.type))
  )
    return `_SYS.absShape(${core.compile(args[0], target)})`;
  if (
    h === 'Abs' &&
    args.length === 1 &&
    (isPointListValue(args[0]) || isGatedPointList(args[0]))
  ) {
    return core.compileExpr(engine, 'Norm', args, prec, target);
  }

  // `|P|` over an operand whose static type admits both a point and a
  // point list — the `list<tuple<…>> | tuple<…>` union a point-consuming
  // document function declares for its parameter: neither rewrite above
  // applies (the operand is not provably a point nor provably a point
  // list), and the broadcast lowering below would map `Math.abs` over the
  // components of whatever array arrives, so `|P − (4, 0)|` at a point
  // answered `[|dx|, |dy|]` where `evaluate()` answers the norm (Tycho
  // item 253). The shape is decided at run time instead
  // (`_SYS.absShape`), the way the interpreter dispatches on the operand's
  // kind. JavaScript only: the shader targets have no run-time shape.
  //
  // A compiled array carries no tuple-versus-list tag, so this dispatch is
  // only sound when a flat array of numbers can ONLY be a point. That
  // holds when the type admits no flat numeric list at all
  // (`unionAdmitsFlatNumericList`), and it holds again when the operand is
  // a point SUM: a provable point is added to it, and the interpreter
  // answers an `incompatible-type` error at every element for
  // `number − point`, so a flat list of numbers is not a value this
  // operand can legitimately take. A top-typed operand is excluded by
  // `isRuntimePointShaped`, so a NESTED array reaching `_SYS.absShape` can
  // only be a point list: a MATRIX has no legitimate value here either —
  // the point-list union refuses one at the call gate
  // (`incompatible-type`, measured), and where the declaration does accept
  // it the point subtraction errors at every element.
  if (
    h === 'Abs' &&
    args.length === 1 &&
    target.language === 'javascript' &&
    isRuntimePointShaped(args[0]) &&
    (!unionAdmitsFlatNumericList(args[0]) || isPointSumOperand(args[0]))
  ) {
    return `_SYS.absShape(${core.compile(args[0], target)})`;
  }

  // An integer power of a square matrix is the matrix power, not the
  // element-wise power. Canonicalization writes `A^n` as `MatrixPower(A,
  // n)` only when the type of `A` is a matrix when the `Power` is built.
  // A `Power` built before its base has a matrix type (`B^2` parsed before
  // `B` holds a matrix, or a structural `Power`) is still a `Power` here,
  // and `evaluate()` computes the matrix power for it. The same decision
  // (`isSquareMatrixPower()`) selects the lowering here: a matrix power
  // compiles as `MatrixPower` (a target without a `MatrixPower` lowering
  // declines it). When only the value at run time can decide, the
  // compilation declines, because the two powers give different values.
  if (h === 'Power' && args.length === 2) {
    const matrixPower = isSquareMatrixPower(args[0].type, args[1]);
    if (matrixPower === true)
      return core.compileExpr(engine, 'MatrixPower', args, prec, target);
    if (matrixPower === undefined)
      throw new Error(
        'Could not compile `Power`: the base is a matrix, and only its shape or the exponent at run time ' +
          'tells if the power is a matrix power (a square matrix with an integer exponent) or an element-wise power.'
      );
    // `evaluate()` gives the `expected-square-matrix` error for an integer
    // power of a matrix that is not square, and compiled code cannot
    // return that error, so the compilation declines.
    if (isNonSquareMatrixPower(args[0].type, args[1]))
      throw new Error(
        'Could not compile `Power`: the base is a matrix that is not square, and an integer power of it ' +
          'is the `expected-square-matrix` error.'
      );
    // A base whose type does not give its rank (`tensor<number>`) may hold
    // a square matrix at run time, and `evaluate()` reads the value: the
    // code then decides on the shape of the value.
    if (matrixPower === false && target.language === 'javascript') {
      const dispatched = compileRuntimeMatrixPower(
        engine,
        args,
        prec,
        target,
        node
      );
      if (dispatched !== undefined) return dispatched;
    }
  }

  // The product of two matrices is the matrix product, however the
  // factors are written (user decision 2026-10-22): `evaluate()` reads the
  // shapes of the values (`mulTensors()`), and the code does the same
  // (`compileMatrixProduct`). A product of vectors, or of numbers and one
  // matrix, keeps the element-wise code below.
  if (
    h === 'Multiply' &&
    (target.language === 'javascript' || target.language === 'python')
  ) {
    const product = compileMatrixProduct(engine, args, prec, target, node);
    if (product !== undefined) return product;
  }

  // Element-wise broadcast of a `broadcastable` head (arithmetic + unary
  // math) over one or more list-valued operands, for the JavaScript target.
  // Emits a `_SYS.bcast` call wrapping the head's own scalar codegen — see
  // `tryCompileBroadcast`. Other targets have native vector types (GLSL/WGSL
  // `vec3 + vec3`) or their own broadcasting, so this is JavaScript-only.
  sub = compileExprElementwiseBroadcast(engine, h, args, prec, target, node);
  if (sub !== undefined) return sub;

  // A declaration CONTRADICTED by its body, sitting in a scalar-consuming
  // position (2026-08-12 ruling — the adjacency half of the
  // `assertScalarBigOpBody` clause of the same name). Target-agnostic, and
  // deliberately AFTER the JavaScript broadcast attempt above: a shape that
  // already had a value-safe element-wise route (a sibling operand made the
  // whole form broadcast) keeps it; what reaches here is the scalar emission
  // the contradiction makes wrong. See
  // `assertNoContradictedScalarOperand`.
  assertNoContradictedScalarOperand(engine, h, args);

  // An indexed read into a collection that mixes complex- and real-valued
  // elements, with an index known only at run time: the element is a complex
  // object for some indices and a plain number for others, so no single
  // lowering is correct. Refuse rather than guess (D6), for the same reason
  // and in the same place as the contradicted declaration above. See
  // `assertNoAmbiguousComplexElementRead`.
  assertNoAmbiguousComplexElementRead(h, args);

  // A broadcastable head with a list/collection-typed operand that
  // `tryCompileBroadcast` did NOT handle would otherwise fall through to the
  // legacy scalar path and silently return garbage behind a `success: true`.
  // What reaches here is the residue the broadcast closure DECLINES:
  //   - Arithmetic (`SCALAR_ARITHMETIC_HEADS`): the built-in symbolic lowering
  //     emits element-wise-impossible JS (`[1,2,3] + x` → the *string*
  //     "1,2,31"; `list * scalar` → NaN), and a complex-valued list is
  //     declined by the broadcast closure (can't carry complex scalar
  //     codegen).
  //   - Any *other* broadcastable numeric head whose operands the closure
  //     declined — the `Multiply` ≥2-arrayish matrix-divergence carve-out, or
  //     a complex element type. (A *string*-mapped scalar helper — `Arctan2` →
  //     `Math.atan2`, `Hypot` → `Math.hypot`, `Sinc` → `_SYS.sinc` — used to
  //     land here too, because it has no array codegen of its own; it now
  //     broadcasts through the same `_SYS.bcast` closure, wrapping the scalar
  //     CALL. The widened net stays: those heads are not in
  //     `SCALAR_ARITHMETIC_HEADS`, and a complex-element operand still has to
  //     fail closed rather than call `Math.atan2` on a `{re, im}` object.)
  // Fail closed with the offending head so the engine-level `compile()`
  // reports `success: false` and falls back to the interpreter (which
  // broadcasts correctly).
  //
  // Deliberately narrow, to avoid false positives on genuinely supported list
  // forms:
  //   - GLSL/WGSL/GPU targets have native vector types (`vec3 + vec3`) and
  //     express their own element-wise lowering through the target's
  //     `broadcastUnary` hook, so this guard is scoped to `javascript` only.
  //   - Relational (`Equal`/`Less`/…) and logical (`And`/`Or`/…) heads are
  //     excluded — they return booleans and are handled by their own codegen
  //     (`compileJSEquality` fails closed on collection operands).
  //   - A user `operators` override that lowers the head to a *function call*
  //     (an identifier like `add`, not a symbolic infix `+`) takes
  //     responsibility for list operands (Issue #240) — only the built-in
  //     symbolic lowering (`+`, `*`, `_SYS.pow`) produces garbage.
  // The operand check is type-based (not just `isCollection`) so a symbolic
  // list *parameter* fails closed too, rather than silently emitting garbage.
  // It also matches a possibly-collection-typed operand
  // (`isPossiblyCollectionTyped`: a `broadcastable<T>` node or a top-typed
  // application). After the F1 widening, most such operands compile through
  // `_SYS.bcast` and never reach here.
  sub = compileExprBroadcastJavaScript(engine, h, args, target);
  if (sub !== undefined) return sub;

  // Python target: arithmetic over a collection-typed or possibly-collection
  // operand (a concrete/declared `list`/`indexed_collection`, a
  // `broadcastable<T>`, or a top-typed application such as `h(x)` — the same
  // operand predicate as the JS D6 guard above) cannot be lowered to the
  // target's INFIX arithmetic. Python's arithmetic operators do NOT broadcast
  // a plain `list`: `2 * [1, 2]` REPEATS (`[1, 2, 1, 2]`), `[1, 2] - 1`
  // raises — both diverge from the interpreter's element-wise result
  // (`[2, 4]` / `[0, 1]`). A NumPy array WOULD broadcast, but the compiled
  // artifact cannot constrain what the caller binds, so the outcome is
  // binding-dependent.
  //
  // What IS soundly expressible is a fan-out over the ONE collection operand
  // (`tryCompilePythonElementwise`): the target spells the element-wise map
  // as a list comprehension, which is element-wise for a plain Python list,
  // a tuple and an ndarray alike. When that route declines, fail closed
  // and let the engine fall back to the interpreter, which broadcasts
  // correctly. Only infix-lowering arithmetic heads are affected;
  // element-wise math functions (`Sin` → `np.sin`) broadcast natively over a
  // NumPy array and are left untouched. Bare unknown symbols are NOT
  // possibly-collection-typed, so plain scalar plot bodies are unaffected.
  sub = compileExprBroadcastPython(engine, h, args, target);
  if (sub !== undefined) return sub;

  // A comparison over a variable the caller can leave out (`x > 0`, read
  // as `_.x`) has no value when it is left out, as in the interpreter and
  // as in a branch condition (`unsuppliedComparisonGuard`).
  {
    const guarded = unsuppliedComparisonGuard(
      h,
      args,
      target,
      () => core.compileExpr(engine, h, args, prec, target, node),
      node
    );
    if (guarded !== undefined) return guarded;
  }

  // A comparison with an operand that may be absent (`w > 0` with
  // `w: number | missing`) is absent when that operand is absent, on a
  // target with object absence (ROADMAP CE-93, `absentComparisonGuard`).
  {
    const guarded = absentComparisonGuard(h, args, target, () =>
      core.compileExpr(engine, h, args, prec, target, node)
    );
    if (guarded !== undefined) return guarded;
  }

  // GPU shader targets: a comparison or logical connective over a non-scalar
  // operand must not lower through the scalar infix operators — GLSL rejects
  // `vecN < float` outright, and where an infix form IS legal it means the
  // wrong thing (WGSL `vecN == vecN` is a `vecN<bool>`, not the scalar bool
  // the surrounding expression expects; GLSL `vecN == vecN` is ATOMIC
  // aggregate equality where the interpreter broadcasts a `List`
  // element-wise). The element-wise `Which`/`If` selection path builds its
  // boolean-vector masks directly (`compileGPUSelection`) and never routes a
  // condition through here; everything else fails closed. One shape is
  // deliberately admitted: GLSL `Equal`/`NotEqual` over TUPLE-shaped
  // operands — a tuple (point) is atomic in the interpreter too, and GLSL
  // `==` on two vecNs is scalar aggregate equality, so that lowering is
  // faithful. (On WGSL the same `==` is component-wise — excluded.)
  // Complex operands are excluded: they already skip the infix path below
  // and fail closed in function dispatch.
  sub = compileExprGpuRelational(h, args, target);
  if (sub !== undefined) return sub;

  // GPU shader targets: the point rules of the interpreter. A point lowers
  // to a `vecN`, and the shader operators are component-wise over vectors
  // and broadcast a scalar over a vector, so every shape below compiled to
  // a plausible vector where the interpreter answers an error:
  //  - `Multiply` of two points: `no-product-between-points`;
  //  - `Divide` by a point: `no-division-by-point`;
  //  - `Add` of a point and a term that is not a point: `incompatible-type`.
  // Canonicalization already turns most of these into an `Error` for a
  // plain point, but not for a GATED point (`isGatedPoint`: a restricted
  // point such as `When((t, 1), c)`, whose `missing` arm hides the tuple
  // type), and not for `t + P` with an undeclared `t`. Fail closed instead.
  sub = compileExprGpuPoint(h, args, target);
  if (sub !== undefined) return sub;

  // A comparison with a WRITTEN absence operand (`Missing`, `Undefined`) is
  // undecided: the interpreter answers `Missing` for `Less(Missing, t)` and
  // for `Equal(Undefined, 1)`, whatever the other operand holds (Kleene).
  // The compiled value is the target's object null, which is also the
  // undecided value of its three-valued conditions, so an `If`/`Which` over
  // it takes no arm (`conditionNode` reads such a relation by its value).
  // Before, the absence symbol lowered to `undefined` and the plain
  // comparison answered a confident `false` (`true` for `NotEqual`), so an
  // `If` over it took an arm. A target without an object axis keeps its
  // plain lowering.
  if (
    BRANCH_RELATIONS.has(h) &&
    target.absence?.object !== undefined &&
    args.some(isAbsenceSymbol)
  )
    return compileAbsentRelation(
      engine,
      h,
      args,
      target,
      target.absence.object.nullLiteral
    );

  // An ORDERING comparison with an operand that is a constant pole (a
  // closed operand whose value is the complex infinity `~oo`: `1/0`,
  // `(-1)!`, a symbol assigned `1/0`) is `False` in the interpreter
  // whatever the other operands are, because `~oo` has no order (user
  // decision 2026-10-21). The pole compiles to the IEEE `Infinity`, which
  // has an order, so `x < 1/0` compiled to `x < Infinity`, `true` at
  // `x = 1`. Such a comparison compiles to the target's `False`
  // (`constantPoleOrdering`). (ROADMAP CE-211.)
  if (ORDERING_HEADS.has(h)) {
    const pole = constantPoleOrdering(engine, args, target);
    if (pole !== undefined) return pole;
  }

  // An ORDERING comparison over a complex-valued operand has no lowering:
  // the complex numbers are not ordered, so the interpreter leaves
  // `Less(i·x, 0)` symbolic (no truth value) while `x` has no value, and
  // answers `False` once the value of an operand is not a real number,
  // whatever the other operands are (`x < i` is `False` with `x` free;
  // user decision of 2026-10-21, `nonRealKind()` in
  // `library/relational-operator.ts`), while both the infix path
  // below and the function codegen it falls through to emit a raw `<` over
  // the `{re, im}` object — a silent `false` behind `success: true`. Fail
  // closed instead. `Equal`/`NotEqual` are NOT affected: they have
  // their own complex-aware codegen (`_SYS.eq`/`_SYS.neq`). An operand of
  // merely UNKNOWN sign over a real kernel (`Sqrt(x)`) is not complex-valued
  // by `isComplexValued`'s carve-out, so `Less(Sqrt(x), 2)` still compiles.
  if (ORDERING_HEADS.has(h)) {
    // D2 (design §8, `docs/COMPILATION-MODEL.md`): an
    // operand that MAY be complex — a `complex`-typed symbol, a wide binding
    // under the complex discipline, a promoted radical — takes the RUNTIME
    // rule (bind once, compare the real parts when every imaginary part is
    // exactly zero, `false` otherwise); only a STATICALLY non-real operand
    // is the compile-time decline, raised inside `realOperandGuard`.
    // A CHAIN (`a < b < c`) binds each operand at its own edge so a later
    // operand is never evaluated when an earlier edge already failed — the
    // interpreter's short-circuit order (`realOperandChain`). A chain with
    // an ARRAY operand is element-wise: every operand is an argument of
    // one broadcast closure (evaluated exactly once, the edges conjoined
    // per element), so it takes the element-wise form of
    // `realOperandGuard`, which projects the operands and re-emits the
    // closure over the projections.
    const guarded =
      args.length > 2 && !args.some((a) => isArrayOperand(a))
        ? realOperandChain(h, args, target)
        : core.realOperandGuard(
            engine,
            h,
            args,
            target,
            () => core.compileExpr(engine, h, args, prec, target, node),
            'boolean'
          );
    if (guarded !== undefined) return guarded;
    const complexOperand = args.find((a) =>
      realGuardCandidate(a, engine, target)
    );
    if (complexOperand !== undefined)
      throw new Error(
        `Could not compile \`${h}\`: an ordering comparison over the ` +
          `complex-valued operand \`${complexOperand.toString()}\` — the ` +
          `complex numbers are not ordered. The interpreter answers ` +
          `\`False\` when an operand has a value that is not a real ` +
          `number, whatever the other operands are (\`x < i\` is ` +
          `\`False\`), and leaves the comparison symbolic while the ` +
          `operand depends on a free symbol (\`i·x < 0\`).`
      );
  }

  // Handle operators
  const op = target.operators?.(h);

  // A Python power that may need the real root of a negative base (an
  // exact rational or a float exponent, see `negativeBaseFloatPower`)
  // goes to the `Power` function lowering instead of the `**` operator.
  // So does a power that the analysis reads as promoted to the complex
  // lane (an unknown-sign real base with a float exponent, `t^0.3`, in the
  // `auto` mode, see `promotesRadicalToComplex`): the function lowering
  // emits `np.emath.power` for it, which gives the complex value for a
  // negative base, as the analysis reports to the parent. Before, the
  // `**` operator was emitted for this form in every mode, so the emission
  // did not match the analysis (CE-230.6).
  const realPythonPower =
    target.language === 'python' &&
    h === 'Power' &&
    op?.[0] === '**' &&
    (realPowerExponent(args) !== undefined ||
      negativeBaseFloatPower(args) !== undefined ||
      (!args.some((a) => core.isComplexValued(a)) &&
        core.promotesRadicalToComplex('Power', args)));
  sub = compileExprOperator(h, args, prec, target, node, op, realPythonPower);
  if (sub !== undefined) return sub;

  // Handle special constructs
  sub = compileExprFunctionLiteral(engine, h, args, target, node);
  if (sub !== undefined) return sub;

  sub = compileExprDeclare(h, args, target, node);
  if (sub !== undefined) return sub;
  sub = compileExprAssign(engine, h, args, prec, target, node);
  if (sub !== undefined) return sub;
  if (h === 'Return') {
    // A target with a statically typed signature checks the returned value's
    // shape against it HERE, while the emitter's local frames are still
    // pushed (see `CompileTarget.onReturn`).
    target.onReturn?.(args[0]);
    return `return ${compileOp(node, 0, target, 0, args[0])}`;
  }
  if (h === 'Break') return 'break';
  if (h === 'Continue') return 'continue';

  if (h === 'Loop') {
    const loopFn = target.functions?.(h);
    if (typeof loopFn === 'function')
      return loopFn(args, (expr) => compileValueOperand(expr, target), target);
    return compileForLoop(args, target, node);
  }

  if (h === 'Comprehension') {
    const compFn = target.functions?.(h);
    if (typeof compFn === 'function')
      return compFn(args, (expr) => compileValueOperand(expr, target), target);
    return compileComprehension(args, target, node);
  }

  if (h === 'If' && args.length !== 2 && args.length !== 3)
    throw new Error('Could not compile `If`: wrong number of arguments');
  // The else-less `If(c, t)` is the one-clause `Which(c, t)`: when the
  // condition is false no branch is selected, and the value is the
  // codomain's absence marker (`NaN` for a number), exactly what a `Which`
  // that matched no clause answers (no-selection ruling of 2026-08-27,
  // `docs/ERROR-MODEL.md`). The operand indices of the two shapes agree
  // (0 → condition, 1 → arm), so the `Which` branch below compiles the
  // `If` node as it stands, CSE regions included, and every target's own
  // `Which` handler lowers it. Before this the two-operand shape was
  // refused on every target with "wrong number of arguments" while the
  // interpreter answered `Missing` for it.
  //
  // Only the VALUE form is routed this way: a two-operand `If` whose arm is
  // a statement (an assignment, a block, a loop, a jump) is a guard
  // statement that reached the expression compiler from a block, and each
  // target decides that shape on its own terms — plain JavaScript
  // statement-forms it in the block dispatcher before this point, and the
  // other targets decline it here, each for a verified reason
  // (`test/compute-engine/compile-elseless-if-statement.test.ts`). Wrapping
  // such an arm in a conditional expression would emit an assignment inside
  // an expression, which Python refuses and the GPU statement model does
  // not admit.
  const selectionHead =
    h === 'If' && args.length === 2 && !isStatementArm(args[1]) ? 'Which' : h;
  if (h === 'If' && args.length === 2 && selectionHead === 'If')
    throw new Error('Could not compile `If`: wrong number of arguments');

  sub = compileExprIf(engine, h, args, target, node, selectionHead);
  if (sub !== undefined) return sub;

  sub = compileExprWhich(args, target, node, selectionHead);
  if (sub !== undefined) return sub;

  sub = compileExprWhen(h, args, target, node);
  if (sub !== undefined) return sub;

  if (h === 'Match') {
    // A target may override the whole construct (GPU emits target-specific
    // ternaries; interval/Python fail closed). Otherwise the default is the
    // JavaScript emission (chained `if`/`switch` in an arrow-IIFE).
    //
    // `Match` is fully CSE-inert in Phase 1 (§2): its guards and bodies are
    // compiled from plan-constructed closure trees, not from these operands,
    // so emission runs under a blind instance — no candidate resolves inside,
    // and no enclosing region's candidate can leak in through a shared node.
    return withCseBlind(target, () => {
      const fn = target.functions?.(h);
      if (typeof fn === 'function')
        return fn(args, (expr) => compileValueOperand(expr, target), target);
      return compileMatchJS(engine, args, target);
    });
  }

  if (h === 'Block') {
    const collectionValue =
      node !== undefined && node === CompilerState._collectionValueBlock;
    if (collectionValue) CompilerState._collectionValueBlock = undefined;
    return compileBlock(args, target, node, true, prec, collectionValue);
  }

  // Absence-discharge primitives (§3.F). `IsMissing`/`Coalesce` lower through
  // the target-supplied absence capability, choosing the numeric or object
  // axis by the operand's (result's) domain (I6). A target lacking the needed
  // axis — GPU has no `isAbsent`, interval/GPU have no `object` axis — fails
  // closed with a diagnostic (propagation stays native; discharge does not).
  if (h === 'IsMissing') {
    if (args.length !== 1)
      throw new Error(
        'Could not compile `IsMissing`: expected exactly one argument'
      );
    if (provablyAdmits('nothing', compilationType(args[0])))
      throw new Error(
        `Could not compile \`IsMissing\`: target '${target.language ?? 'unknown'}' ` +
          `cannot distinguish a possible 'Nothing' input from an absent datum.`
      );
    const axis = absenceAxisForType(args[0].type.type, target, 'IsMissing');
    if (axis.isAbsent === undefined)
      throw new Error(
        `Could not compile \`IsMissing\`: target '${target.language ?? 'unknown'}' cannot test ` +
          `absence (no 'isAbsent' capability — e.g. GPU fast-math cannot ` +
          `guarantee 'isnan' survives).`
      );
    return axis.isAbsent(compileValueOperand(args[0], target));
  }

  // The presence assertion `AssertPresent(x)` (Epsil `x?!`): `x` unless it
  // is absent, else a raised run-time error `expected-present` naming the
  // operand as written (the interpreter's `Error("expected-present", …)`).
  //
  // - A static proof removes the check: an operand whose compilation type
  //   has no `missing` member and does not admit `nan` can only be present,
  //   so the operand compiles as is. This is the only way the check is
  //   omitted (user decision P4).
  // - A target with no `raise` (a shader) compiles the assertion as the
  //   identity; the author accepts the absent value flowing on (user
  //   decision P5, 2026-10-21). The operand is compiled with its OWN type,
  //   not the asserted one, so nothing downstream reads the assertion as a
  //   proof: the node's `Present(T)` type is not consulted here, and a
  //   later `IsMissing`/`Coalesce` on the value keeps its test.
  // - An operand that may be `Nothing` is declined, as for `IsMissing`: the
  //   targets cannot tell an omission from an absent datum.
  sub = compileExprAssertPresent(h, args, target);
  if (sub !== undefined) return sub;

  sub = compileExprCoalesce(h, args, target, node);
  if (sub !== undefined) return sub;

  // Kleene/IEEE `Equal`/`NotEqual` guarded lowering (§3.D, amended
  // 2026-07-24; extended to `NotEqual` 2026-08-08).
  // Comparisons are IEEE over `NaN` and Kleene over the `Missing` symbol. For
  // a NUMERIC-domain operand a raw `==`/tolerant-compare already IS the IEEE
  // semantics (`NaN == NaN` is `false`), so no guard is emitted — the plain
  // codegen below runs and interpreter/compiled agree by construction. The
  // guard is kept ONLY when an operand can hold an OBJECT-domain hole (e.g.
  // `string | missing`), where a `Missing` must lower to the target null:
  // emit `isAbsent(a) || isAbsent(b) ? <object null> : <a == b>`. The absent
  // boolean is an OBJECT-domain value, so a target without the object axis
  // (GPU) fails closed.
  //
  // `NotEqual` is guarded on exactly the same terms, and for the same reason
  // `Equal` is: the interpreter answers `Missing` for BOTH
  // (`NotEqual(Missing, 1)` → `Missing`, pinned in `missing-value.test.ts`
  // §P3). It was `Equal`-only while every string-bearing `NotEqual` failed
  // closed on the string gate; once the tier-2 admissions started compiling
  // `NotEqual(s, "x")` for `s: string | missing` (the literal supplies the
  // string evidence, and the union is neither provably numeric nor a
  // collection), the unguarded lowering emitted `undefined !== "x"` — a bare
  // `true` where the interpreter answers `Missing`.
  sub = compileExprMissingEquality(h, args, target);
  if (sub !== undefined) return sub;

  // `Typed(value, type)` is a transparent runtime ascription — it constrains
  // the static type but has no runtime effect, so it compiles to its value
  // operand on every target (the interpreter ignores it likewise, and
  // returns the value even when it contradicts the ascribed type). Without
  // this, a helper declared with a precise return type (e.g. `(number) ->
  // vector<11>`) wraps its body in `Typed`, and every compiled call throws
  // `Unknown operator \`Typed\`` at the dispatch below.
  //
  // A target that keeps complex values apart from real ones (a `{re, im}`
  // object in JavaScript, a `vec2` in a shader) needs more. A consumer of
  // the ascription (the enclosing lowering, or the call sites of a user
  // function whose body is the ascription) reads the lane of the `Typed`
  // node, which follows the ascribed type. The value operand is emitted in
  // its own lane. The two must agree, or the consumer reads the value in
  // the wrong representation:
  //
  //  - A complex ascription over a real scalar value is lifted: a real
  //    number is a complex number. With `s: (complex) -> complex` and
  //    `s := z ↦ Re(z)`, the body is `Typed(Re(z), complex)`, and the
  //    definition returns a complex value. The declared-signature
  //    canonicalization also wraps an all-real function body in
  //    `Typed(body, "complex")`, so that a function declared to return a
  //    complex value returns a `{re, im}` object from every body, a real
  //    base case included (Tycho item 60).
  //  - A complex ascription over a value that is not a scalar (a point,
  //    a color, a boolean) contradicts the value. Fail closed.
  //  - A real ascription over a value that is complex only because of
  //    promotion selects the real lane for the value. Under a mode that
  //    promotes (`auto`, `complex`), an unknown-sign `Sqrt`, `Ln`, `Log`,
  //    even `Root` or non-integer `Power` lowers through a complex kernel,
  //    and makes the value complex. The ascription says that the value is
  //    real, so the value compiles with promotion off
  //    (`withPromotionSuppressed`), as `mode: 'strict'` compiles it: such a
  //    head gives NaN outside its real domain. NaN is the value that a
  //    real-typed result has when it has no real value. With
  //    `p: (real) -> real` and `p := k ↦ sin(2.4k)·√((k − 0.5)/16)`, the
  //    definition is `Math.sin(2.4 * k) * Math.sqrt(0.0625 * (k + -0.5))`
  //    in every mode, and `promoted` stays `false`. "Complex only because
  //    of promotion" means: complex with promotion on, real with promotion
  //    off. A value that is real with promotion on (`|√k|`) keeps its
  //    promoted heads.
  //  - A real ascription over a value that is complex also with promotion
  //    off contradicts the value: the value has a complex-typed operand
  //    (or, under `mode: 'complex'`, a node whose type admits a complex
  //    value, which that mode reads as complex). With `q: (unknown) -> real` and `q := z ↦ z²`, the call `q(1+i)` is
  //    `2i`. JavaScript read the `{re, im}` object that `_fn_q` returns as
  //    a real number, and `q(w) + 1` returned the string
  //    `"[object Object]1"`; a shader has no conversion from a `vec2` to a
  //    `float` that keeps the value. Fail closed, and ask for a corrected
  //    signature. A call in the value of a user function whose definition
  //    is complex is such an operand: the definition is shared by every
  //    call site, so it is compiled with the promotion of the mode
  //    (`withPromotionUnsuppressed`), and its recorded lane is complex.
  //
  // With these rules, the lane of the `Typed` node is the lane of the value
  // it emits, so the lane recorded for a user function whose body is the
  // ascription (`recordUserFunctionLane`) is the lane of what its
  // definition returns.
  sub = compileExprTyped(engine, h, args, target, node);
  if (sub !== undefined) return sub;

  // A qualified protocol call — `Comparable.compare(x, y)` — canonicalizes
  // to `Apply(Field(Comparable, "compare"), x, y)` and STAYS that (the
  // `ProtocolMember` node only appears when the `Field` EVALUATE handler's
  // wrapper literal beta-reduces). Intercept it BEFORE the target's `Apply`
  // mapping, which would otherwise compile the protocol-naming `Field`
  // operand and die inside it. When the dispatch tier declines, fail closed
  // for the whole unit rather than falling through to the generic `Apply`
  // lowering (ruled 2026-08-12, `docs/COMPILATION-MODEL.md`).
  sub = compileExprApplyField(engine, h, args, target);
  if (sub !== undefined) return sub;

  // `Clamp(x, lo, hi)` takes exactly three operands. Only non-canonical
  // input has another count, and the interpreter answers an error for it
  // (`Clamp(x)` evaluates to `Error("missing")`). The lowerings index the
  // three operands, so they emitted invalid code such as `clamp(x + 1.0)`
  // on the shader targets or `Math.max(_.x + 1, )` on JavaScript.
  if (h === 'Clamp' && args.length !== 3)
    throw new Error(
      `Could not compile \`Clamp\`: expected three operands, got ${args.length}`
    );

  // Handle function calls
  const fn = target.functions?.(h);
  if (!fn) {
    // A four-operand `ProtocolProperty` is a property STORE, not a call — the
    // shape a hand-built expression spells, and what `p.(P.name) = v` folds
    // to at evaluation. Refused with the same message as the `Assign`
    // spellings of the same write: a store writes a mutable object, and
    // objects have no compiled representation yet.
    if (h === 'ProtocolProperty' && args.length === 4)
      throw new Error(
        `Could not compile \`${isString(args[1]) ? args[1].string : 'property'}\`: this protocol ` +
          `property assignment has no lowering on target ` +
          `'${target.language ?? 'javascript'}' (a property store writes a ` +
          `mutable object, and objects have no compiled representation).`
      );

    // A protocol call — a bare dispatcher head (`compare(x, y)`), the
    // `ProtocolMember`/`ProtocolProperty` operators, or a `Field` read that
    // only a protocol property can answer. Compiled as a direct call
    // (static resolution) or a reified guard chain (dynamic dispatch); a
    // decline falls through to the standard fail-closed throw below.
    const protoCall = protocolCallParts(engine, h, args);
    if (protoCall !== undefined) {
      const code = tryCompileProtocolDispatch(engine, protoCall, target);
      if (code !== undefined) return code;
    }

    // `h` may name a function-valued BLOCK LOCAL of an enclosing statement
    // list (`const g = (k) => …`, then `g(3)`). That binding is emitted by
    // the block itself, so the call is an ordinary call of it — and it must
    // be resolved BEFORE the engine lookup below, which a same-named engine
    // symbol would otherwise win.
    const localFn = tryCompileLocalFunctionCall(h, args, target);
    if (localFn !== undefined) return localFn;

    // `h` may be a symbol whose engine definition is a user-defined function
    // literal (`f(x) := …`, `x ↦ …`). Emit it as a named local function and
    // compile the call site as `_fn_f(arg)`. Returns undefined for a truly
    // unknown operator (no such definition) or a target that opts out.
    //
    // Skipped when `h` names a BOUND variable of the enclosing compilation —
    // a function literal's parameter, a loop index, a block local. That
    // binding is what the call applies, and it shadows any same-named engine
    // definition; resolving the engine definition instead emitted a call to
    // the WRONG function. With `f` assigned at engine level, the literal
    // `(f, x) ↦ f(x)` emitted `_fn_f(x)` and so ignored its own `f`
    // argument, disagreeing with the interpreter. A bound head that is a
    // block-local FUNCTION was already resolved by
    // `tryCompileLocalFunctionCall` above and never reaches this line;
    // anything else falls through to the fail-closed throw below, so the
    // interpreter — which resolves the parameter correctly — runs the call.
    // Ruled by the user 2026-08-14: fail closed now; compiling such a call as
    // a direct call of the bound parameter (true higher-order compilation)
    // remains a possible future feature, not a bug fix.
    const userFn = target.boundVars?.has(h)
      ? undefined
      : tryCompileUserFunction(engine, h, args, target, node);
    if (userFn !== undefined) return userFn;
    throw new Error(
      noLoweringMessage(engine, h, args, target, declinedByCustomHandler)
    );
  }

  sub = compileExprFunctionCall(engine, h, args, prec, target, node, fn);
  if (sub !== undefined) return sub;

  // `fn` is a plain string: the target maps this head to a helper. When
  // the target declares the helper real-only (`isRealOnlyLowering`: by
  // default every helper name, e.g. JS `_SYS.erf`), it takes a real
  // scalar, and handing it a complex value silently returns garbage
  // (compiled `Erf(z)` for complex z → −1, not NaN). Fail closed with
  // the offending head. A helper the target declares complex-capable
  // (Python `scipy.special.erf`) receives the complex value as it is.
  if (
    isRealOnlyLowering(target, h) &&
    args.some((a) => realGuardCandidate(a, engine, target))
  ) {
    // D6 runtime rule (design §8): `Erf(x)` for a maybe-complex `x` runs
    // the real helper on the real part when the imaginary part is exactly
    // zero and answers `NaN` otherwise; a statically non-real operand is
    // the compile-time decline (inside `realOperandGuard`). Over an array
    // operand (`Erf(√L)`) the rule is element-wise and the helper
    // broadcasts over the projected array.
    const guarded = core.realOperandGuard(
      engine,
      h,
      args,
      target,
      () => core.compileExpr(engine, h, args, prec, target, node),
      'number'
    );
    if (guarded !== undefined) return guarded;
    throw new Error(
      `Could not compile \`${h}\`: real-only target helper "${fn}" cannot represent a complex-valued argument.`
    );
  }

  const call = `${fn}(${args
    .map((x) => compileValueOperand(x, target))
    .join(', ')})`;
  // Same shape gate as the function-codegen path above: a string-mapped
  // helper is a scalar/genType signature too (`atan`, `clamp`, `mod`), and
  // handing it a `vecN`/`matN` operand it has no overload for is invalid
  // source, not a runtime concern.
  target.checkOperandShapes?.(h, args, call, target);
  return call;
}

/**
 * A selection (`If`, `When`, `Which`) in STATEMENT position on a shader
 * target, written as an `if (…) { … } else { … }` statement, or
 * `undefined` when the selection keeps its expression form.
 *
 * The expression form of a selection is a WGSL `select(…)` call, whose
 * operands are expressions, and an assignment is a statement in WGSL: a
 * branch that assigns a variable has no expression form there. GLSL keeps
 * its ternary, where an assignment is an expression and only the selected
 * branch runs, except for an else-less `If`, which has no ternary form on
 * either language. In statement position the value of the selection is
 * discarded, so the statement form is exact: each branch is compiled as a
 * statement list (`compileStatementList`) and runs only when its clause is
 * selected. A condition after the first is compiled inside the `else` of
 * the clause before it, with a statement sink of its own, so a statement
 * it hoists runs only when that clause is reached.
 *
 * The form is taken only when a branch or a condition assigns a variable
 * (outside a function literal, whose body is not run here) and no operand
 * contains a `Return`, `Break` or `Continue`: those keep the gates of the
 * expression form. A condition must be a scalar boolean, because an `if`
 * statement takes a `bool`. A condition that is not `true` (a comparison
 * with a NaN operand gives `false`) runs the next clause, as the
 * expression form selects its `else` operand.
 */
export function shaderSelectionStatement(
  stmt: Expression,
  target: CompileTarget<Expression>
): string | undefined {
  if (target.language !== 'wgsl' && target.language !== 'glsl')
    return undefined;
  if (!isFunction(stmt)) return undefined;
  const h = stmt.operator;
  const ops = stmt.ops;
  // The clauses as (condition index, branch index) pairs of the operands of
  // `stmt`; a condition index of `-1` is the default clause.
  const clauses: Array<[number, number]> = [];
  if (h === 'If' && (ops.length === 2 || ops.length === 3)) {
    clauses.push([0, 1]);
    if (ops.length === 3) clauses.push([-1, 2]);
  } else if (h === 'When' && ops.length === 2) clauses.push([1, 0]);
  else if (h === 'Which' && ops.length >= 2 && ops.length % 2 === 0) {
    for (let i = 0; i < ops.length; i += 2)
      clauses.push([isSymbol(ops[i], 'True') ? -1 : i, i + 1]);
  } else return undefined;
  const elseless = h === 'If' && ops.length === 2;
  if (target.language !== 'wgsl' && !elseless) return undefined;
  const contains =
    (heads: ReadonlyArray<string>) =>
    (e: Expression): boolean =>
      isFunction(e) &&
      e.operator !== 'Function' &&
      (heads.includes(e.operator) || e.ops.some(contains(heads)));
  if (!ops.some(contains(['Assign']))) return undefined;
  if (ops.some(contains(['Return', 'Break', 'Continue']))) return undefined;
  for (const [c] of clauses) {
    if (c < 0) continue;
    assertScalarCondition(ops[c]);
    if (!ops[c].type.matches('boolean')) return undefined;
  }
  const indent = (code: string): string[] =>
    code === '' ? [] : code.split('\n').map((line) => `  ${line}`);
  const branch = (i: number): string =>
    withCseScope(stmt, i, target, () => compileStatementList(ops[i], target));
  const build = (k: number): string[] => {
    if (k >= clauses.length) return [];
    const [c, b] = clauses[k];
    if (c < 0) {
      const body = branch(b);
      return body === '' ? [] : [body];
    }
    // A condition is a value: an assignment there (`if (flag = c)`) has no
    // WGSL form, and the compilation declines as for any other operand
    // (`assertAssignmentIsStatement`). An assignment nested deeper in the
    // condition reaches the same test through `compileValueOperand`.
    const condition = ops[c];
    if (isFunction(condition, 'Assign') && isSymbol(condition.ops[0]))
      assertAssignmentIsStatement(condition.ops[0].symbol, target);
    // The first condition runs whenever the statement runs: a statement it
    // hoists goes to the sink of the statement, ahead of the `if`. A later
    // condition is compiled with a sink of its own, in the `else` branch.
    const condLines =
      k === 0
        ? [compileOp(stmt, c, target, 0, ops[c])]
        : compileListStatement(target, ops[c], (t) => [
            compileOp(stmt, c, t, 0, ops[c]),
          ]);
    const cond = condLines.pop()!;
    const rest = build(k + 1).join('\n');
    return [
      ...condLines.map((line) => (/[;}]\s*$/.test(line) ? line : `${line};`)),
      `if (${cond}) {`,
      ...indent(branch(b)),
      ...(rest === '' ? ['}'] : ['} else {', ...indent(rest), '}']),
    ];
  };
  return build(0).join('\n');
}

/**
 * Compile a loop body expression as statements (not wrapped in IIFE).
 * Handles Break, Continue, Return as statements, and If as if-else when
 * branches contain control flow.
 */
export function compileLoopBody(
  expr: Expression,
  target: CompileTarget<Expression>
): string {
  // Nothing is a no-op in statement context
  if (isSymbol(expr, 'Nothing')) return '';
  if (!isFunction(expr)) return core.compile(expr, target);

  const h = expr.operator;

  if (h === 'Break') return 'break';
  if (h === 'Continue') return 'continue';
  if (h === 'Return')
    return `return ${compileOp(expr, 0, target, 0, expr.ops[0])}`;

  if (h === 'If') {
    // For the imperative `if` statement, the condition must produce a
    // boolean.  Interval targets compile comparisons to interval results
    // (e.g. `_IA.greater(...)` returns an object, not a boolean), which
    // would always be truthy.  Use scalar operators for the condition.
    // The condition is a value expression (its own bindable region); each
    // branch is a statement list again (§5.1(c)).
    const condTarget = scalarConditionTarget(target);
    const branch = (i: number): string =>
      withCseScope(expr, i, target, () =>
        core.compileLoopBody(expr.ops[i], target)
      );
    // A condition that is not exactly `true` or `false` when the compiled
    // function runs runs neither branch, and execution continues with the
    // next statement. This is the statement form of the rule the conditional
    // expression follows: the interpreter leaves such an `If` unevaluated,
    // so no assignment inside it happens and no `Break` under it fires. A
    // statement has no value, so running neither branch is the whole answer.
    //
    // The analysis is shared with the conditional expression
    // (`conditionDecidability`), and so is the reason for it: a comparison
    // with a NaN or missing operand gives an ordinary `false` in JavaScript,
    // so a condition that cannot be decided looks the same as one decided to
    // be false, and the difference has to be read off its operands — and,
    // for a condition built from `&&`/`||`/`!`, off the Kleene combination
    // of its leaves' verdicts.
    const decidability = conditionDecidability(expr.ops[0], true, condTarget);
    // A `Not` over a value-shaped condition is lowered by exchanging the two
    // constants the decided tests compare against, never by an emitted `!`:
    // `!undefined` is a confident `true` (see `peelNegations`).
    //
    // A condition that reaches a connective is compiled to its three-valued
    // value and then inspected the same way, so it takes the value-shaped
    // branch below with no negation of its own (`kleeneCondition`).
    const kind = decidability?.test.kind;
    const valueShaped = kind === 'value' || kind === 'connective';
    const { expr: condExpr, negate } =
      kind === 'value'
        ? peelNegations(expr.ops[0])
        : { expr: expr.ops[0], negate: false };
    const compileCond = (): string =>
      kind === 'connective'
        ? withCseOperand(expr, 0, condTarget, () =>
            kleeneCondition(decidability!, condTarget)
          )
        : compileOp(expr, 0, condTarget, 0, condExpr);
    let cond: string;
    let conjuncts: ReadonlyArray<TargetSource> = [];
    let bindings: Array<[string, TargetSource]> = [];
    if (decidability === null || valueShaped) {
      cond = compileCond();
    } else {
      // A non-trivial operand is bound to a block-scoped constant, so its
      // computation runs once instead of once in the condition and twice
      // more in the decidedness test (`withConditionOperands`).
      const bound = withConditionOperands(
        decidability.test.kind === 'operands' ? decidability.test.operands : [],
        condTarget,
        true,
        (c) => {
          conjuncts = c;
          return compileCond();
        },
        CONDITION_DIALECT_JS
      );
      cond = bound.value;
      bindings = bound.bindings;
    }
    const thenBranch = branch(1);
    const elseBranch = expr.ops.length > 2 ? branch(2) : undefined;
    // A block is a statement, so it splices in where the `if` did, and
    // `break`/`continue` inside a branch still reach the enclosing loop.
    const withBindings = (body: string): string =>
      bindings.length === 0
        ? body
        : `{ ${bindings
            .map(([name, code]) => `const ${name} = ${code};`)
            .join(' ')} ${body} }`;
    // A condition whose VALUE has to be inspected (it may not be a boolean
    // at all) is bound to a block-scoped constant first, so an application
    // is evaluated once.
    if (valueShaped) {
      const [then, otherwise] = negate ? ['false', 'true'] : ['true', 'false'];
      const tail =
        elseBranch === undefined || elseBranch === ''
          ? ''
          : ` else if (_CND === ${otherwise}) { ${elseBranch} }`;
      return `{ const _CND = (${cond}); if (_CND === ${then}) { ${thenBranch} }${tail} }`;
    }
    if (elseBranch !== undefined && elseBranch !== '') {
      const body = `if (${cond}) { ${thenBranch} } else { ${elseBranch} }`;
      return withBindings(
        conjuncts.length === 0
          ? body
          : `if (${conjuncts.join(' && ')}) { ${body} }`
      );
    }
    // With no else branch, the test that the condition is decidable joins
    // the one `if` rather than nesting a second one inside it: the two guard
    // the same statement, and one `if` is easier to read. The condition is
    // parenthesized when it joins the test, because `&&` binds tighter than
    // the `||` a condition may contain — and a connective's decidedness test
    // is a disjunction too, which is why `withConditionTest` hands that one
    // over already parenthesized.
    const test =
      conjuncts.length === 0 ? cond : [...conjuncts, `(${cond})`].join(' && ');
    return withBindings(`if (${test}) { ${thenBranch} }`);
  }

  if (h === 'Block') {
    // A loop body is a statement list of its own — it does NOT go through
    // `compileBlock` — so the destructuring-assign desugar has to run here
    // too, or the pair-carrying loop step this feature exists for
    // (`(a, b) := (b, a + b)`) would fail closed. A body's value is
    // discarded, so no trailing value tuple (`isLast: false`).
    // For the same reason the implicit-block-local desugar runs here too: a
    // loop body that binds a scratch variable by bare assignment
    // (`q ⩴ 2i; s ⩴ s + q`) has no `Declare` for it either, so the write
    // emitted a bare `q` while every read emitted `_.q` — `NaN`.
    //
    // …and so does the COMPLEX-ness inference `compileBlock` runs over its
    // locals: without the frame, a loop-body local bound to a complex value
    // (`z ⩴ t + i; s ⩴ s + |z|`) was written as a `{re, im}` object but read
    // back as a real — `Abs(z)` lowered to `Math.abs` on an object, i.e.
    // `NaN` behind `success: true` — and an explicitly declared local
    // behaved identically.
    //
    // The VECTOR-width frame is deliberately NOT pushed here. Its only
    // consumer is the shader declaration type hint, and no shader target
    // reaches this routine: the GPU targets define their own `Loop`
    // (`GPU_FUNCTIONS.Loop`), which compiles the body with
    // `compileStatementList` — a `Block` body goes straight to
    // `compileBlock`, inference included. This is the JavaScript-family
    // path, whose locals are untyped `let`s, and a vector-valued loop-body
    // local already agrees with the interpreter there.
    //
    // Destructuring DECLARES (`let (a, x) = (2, 3)`) are desugared into
    // per-leaf declares first, in the same order as `compileBlock` does it.
    // Every statement of a loop body is in statement position, the last one
    // included, so each of them lowers. Without this step such a declare
    // reached the value-position `Declare` handler, which fails closed.
    // An assignment whose value is another assignment
    // (`t ≔ (u ≔ t + i)`) is split into two statements, as in
    // `compileBlock`, so the inner target is declared in the loop body
    // when no enclosing scope binds it. Without the split the write went to
    // the caller's `vars` object (`t = _.u = …`).
    const split = splitChainedAssignments(
      expr.ops
        .flatMap((s) => desugarPatternDeclare(s, target) ?? [s])
        .flatMap((s) => desugarPatternAssign(s, target) ?? [s])
    );
    const stmts = split.args;
    // …and so does the `function`-definition rewrite, so a definition made
    // INSIDE a loop body lowers and is callable there, exactly as one made
    // in an ordinary block is. A loop body carries no value, hence
    // `valueUsed: false`: every statement of it, the last included, is in
    // statement position. A definition that the interpreter refuses for
    // its effects is refused first, as in `compileBlock`.
    refuseEffectContractViolations(stmts, expr.localScope);
    const withDecls = withImplicitLocalDeclares(
      withDefineFunctionDeclares(stmts, target, false),
      target,
      expr,
      split.chained
    );
    // The checks of `compileBlock` on the order of the statements: no use
    // of a local before its `Declare`, and no read of a local before a
    // statement gives it a value. Each pass of the loop runs the body
    // with new locals, so a value of the previous pass does not count.
    assertNoUseBeforeDeclare(withDecls);
    const bodyLocals = withDecls.flatMap((s) =>
      isFunction(s, 'Declare') && isSymbol(s.ops[0]) ? [s.ops[0].symbol] : []
    );
    assertLocalsAssignedBeforeRead(withDecls, bodyLocals);
    // The reads of a local of the body that may have no value
    // (`classifyLocalReads`): a read with no assignment on any path before
    // it is refused, and the others are checked when the code runs, as in
    // `compileBlock`.
    const readClasses = classifyLocalReads(withDecls, bodyLocals, expr, target);
    // A body-scoped `localFunctions`, filled in statement order below. Held
    // as its own binding because the field on `CompileTarget` is a
    // `ReadonlyMap`: the target exposes it for READS during compilation, and
    // only this routine writes it.
    const bodyLocalFunctions = newLocalFunctionScope(target);
    const bodyRebound = reboundLocalNames(withDecls);
    const bodyTarget: CompileTarget<Expression> = {
      ...loopBodyTempTarget(withDecls, target),
      localFunctions: bodyLocalFunctions,
      lexicalFunctions: lexicalFunctionScope(withDecls, target, bodyRebound),
      reboundFunctions: reboundFunctionScope(withDecls, target, bodyRebound),
    };
    const checkedFrame = checkedLocalReads(
      readClasses,
      target,
      (name) => bodyTarget.var(name) ?? name
    );
    const complexFrame = new Map<string, boolean>();
    for (const s of withDecls)
      if (isFunction(s, 'Declare') && isSymbol(s.ops[0]))
        complexFrame.set(s.ops[0].symbol, localComplexDefault());
    _pushLocalComplex(complexFrame);
    if (checkedFrame !== undefined)
      CompilerState._checkedLocals.push(checkedFrame);
    try {
      for (const s of withDecls) core.noteLocalComplex(s, complexFrame);
      return withCseScope(expr, -1, bodyTarget, () =>
        withDecls
          .map((s) => {
            // Statement-ordered, as in `compileBlock` — see the
            // `localFunctions` comment there.
            noteLocalFunction(s, bodyLocalFunctions, bodyRebound);
            // A checked local starts with its own marker of "no value",
            // as in `compileBlock`.
            if (
              checkedFrame !== undefined &&
              isFunction(s, 'Declare') &&
              isSymbol(s.ops[0]) &&
              declareValueOperand(s.ops) === undefined
            ) {
              const name = s.ops[0].symbol;
              const marker = checkedFrame.markers.get(name);
              if (marker !== undefined)
                return `const ${marker} = {}; let ${checkedFrame.spelled.get(name)} = ${marker}`;
            }
            const code = core.compileLoopBody(s, bodyTarget);
            // A nested block is a JavaScript block statement (`{ … }`), so
            // that a `let` of it, written or implicit (a bare assignment of
            // a name that nothing outside binds), does not hide a variable
            // of the same name in the rest of the loop body. Without the
            // braces, `let V` of the nested block made every later `V` of
            // the loop body the local.
            return isFunction(s, 'Block') && code !== '' ? `{ ${code} }` : code;
          })
          .join('; ')
      );
    } finally {
      _popLocalComplex();
      if (checkedFrame !== undefined) CompilerState._checkedLocals.pop();
    }
  }

  // A target that overrides `Match` wholesale (a function-valued handler)
  // keeps it in value position, where its handler is consulted.
  if (h === 'Match' && typeof target.functions?.(h) !== 'function') {
    const stmt = compileMatchStatement(expr, target);
    if (stmt !== undefined) return stmt;
  }

  // …and the same statements as a bare (unwrapped) loop body: a
  // destructuring declare or a destructuring assign.
  if ((h === 'Declare' || h === 'Assign') && isFunction(expr.ops[0], 'Tuple')) {
    const stmts =
      h === 'Declare'
        ? desugarPatternDeclare(expr, target)
        : desugarPatternAssign(expr, target);
    if (stmts !== null) {
      const bodyTarget = loopBodyTempTarget(stmts, target);
      return stmts.map((s) => core.compileLoopBody(s, bodyTarget)).join('; ');
    }
  }

  // A loop body that is one chained assignment (`t ≔ (u ≔ t + i)`) is
  // two statements, and the inner target is declared in the loop body
  // when nothing outside binds it (`chainedLocalDeclares`).
  if (h === 'Assign') {
    const split = splitChainedAssignments([expr]);
    if (split.args.length > 1) {
      const stmts = [
        ...chainedLocalDeclares(split.args, split.chained, target),
        ...split.args,
      ];
      const bodyTarget = loopBodyTempTarget(stmts, target);
      return stmts.map((s) => core.compileLoopBody(s, bodyTarget)).join('; ');
    }
  }

  return compileOp(expr, -1, target, 0, expr);
}

/**
 * Record what the statement `arg` says about the complex-ness of the local
 * it binds, into the (already PUSHED) frame `frame`.
 *
 * The per-statement step of the incremental inference `compileBlock`
 * performs over its locals — factored out because two other statement-list
 * routes run the same inference: `compileLoopBody`'s `Block` branch (a JS
 * loop body is a statement list of its own, which does NOT go through
 * `compileBlock`) and the `Block` arm of `isComplexValued` (which types a
 * block from its VALUE, and so must know its locals' shapes).
 *
 * Sources, per local: an explicit `complex` type on the `Declare`, a
 * `Declare` initial value, or the FIRST `Assign` RHS (a local already known
 * complex is never demoted). The frame must be pushed while this runs, so a
 * later local whose RHS reads an earlier one resolves it through the frame.
 * A name with no entry in `frame` is not a local of this list and is left
 * alone.
 */
export function noteLocalComplex(
  arg: Expression,
  frame: Map<string, boolean>
): void {
  if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0])) {
    const name = arg.ops[0].symbol;
    if (isSymbol(arg.ops[1], 'complex')) _setLocalComplex(frame, name, true);
    else if (complexDiscipline() && declaredTypeIsReal(arg.ops[1]))
      // Complex discipline: a local DECLARED a real-only type keeps the
      // real kernel (the type-based realness proof survives as an
      // optimization, design §2).
      _setLocalComplex(frame, name, false);
    const value = declareValueOperand(arg.ops);
    if (value !== undefined) {
      if (core.isComplexValued(value)) _setLocalComplex(frame, name, true);
      markLocalBound(frame, name);
    }
  } else if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0])) {
    const name = arg.ops[0].symbol;
    if (frame.get(name) === false && core.isComplexValued(arg.ops[1])) {
      // STRICT discipline (design §3, "Block local" row): a local's shape
      // is its FIRST binding's shape, and a later complex-shaped assignment
      // to a local bound real is a LaneMismatch DECLINE — the statements
      // between the two bindings were compiled reading a number. Under the
      // other modes (step 2) the local is promoted as before, which is
      // itself the silent-wrong shape (`k := 1; k := k + 2i` reads `.re`
      // off the number `1`) that step 3's complex discipline removes.
      if (strictLanes() && localIsBound(frame, name))
        laneMismatch('Block local', `the local \`${name}\``, arg.ops[1]);
      _setLocalComplex(frame, name, true);
    }
    if (frame.has(name)) markLocalBound(frame, name);
  } else if (strictLanes()) {
    // A complex-shaped assignment to a real-bound local NESTED in a
    // conditional or loop statement (`if (t < 0) { k := i·k }`) is the same
    // mismatch: the local stays real-shaped for the rest of the block (only
    // top-level statements shape it), so the value it holds after the
    // branch is consumed as a number. Walked here for the strict decline
    // only; a nested `Function`/`Block` scope of its own is not entered.
    checkNestedComplexRebinding(arg, frame);
  }
}

export function isComplexValued(expr: Expression): boolean {
  // An operand the D2/D6 runtime rule has projected onto the real lane
  // (`realOperandGuard`): while its override is active, the code emitted
  // for it is the real projection — a plain number or NaN — so it is not
  // complex-valued. Answered before the memo so the verdict never outlives
  // the override.
  if (_codeOverrides.has(expr)) return false;
  if (isNumber(expr)) {
    // `~oo` is not complex-valued, even though the value carries an
    // infinite imaginary part: the non-finite typing convention
    // (ARCHITECTURE.md, "Non-finite typing convention for type handlers")
    // admits undirected infinity at the top type `number` only, and the
    // constant types that way. Reporting it complex would put the whole
    // enclosing expression on the complex lane on the strength of a pole,
    // so `1 + (-1)!` emitted a `{re, im}` object where the real lane wants
    // the pole's float projection, `Infinity`.
    if (expr.isInfinity && expr.isComplex) return false;
    return expr.isComplex;
  }

  if (isSymbol(expr)) {
    if (expr.symbol === 'ImaginaryUnit') return true;
    // A `Block` local's complex-ness is inferred from its assigned RHS
    // (`w_1 ⩴ (x+iy)² + z_0; w_2 ⩴ w_1² + z_0`: the type system defaults
    // the local to real, but the emitter binds it to a complex object —
    // the analysis must agree or later statements consume the object as a
    // number; Tycho item 58). Innermost frame containing the name decides
    // (a shadowing inner local is not poisoned by an outer complex one).
    for (let i = CompilerState._localComplex.length - 1; i >= 0; i--) {
      const frame = CompilerState._localComplex[i];
      const known = frame.get(expr.symbol);
      if (known !== undefined) return known;
    }
    const t = expr.type;
    if (!t) return false;
    if (isNonRealNumber(t.type)) return true;
    if (t.matches('real')) return false;
    // The declared type is wide (`number`, `unknown`) — but the symbol may
    // carry an assigned complex VALUE, which `tryFoldKnownSymbol` folds as
    // a complex object literal. The operand analysis must agree with the
    // fold, or the target emits structurally wrong arithmetic
    // (`number + {re, im}` → NaN at every point; Tycho item 57). Does NOT
    // apply to compile-bound variables, which shadow the engine.
    if (CompilerState._boundVarsCtx?.has(expr.symbol))
      return wideIsComplex(t.type);
    // Same rule for a name bound by a binder form we are analyzing rather
    // than compiling (Tycho item 65).
    for (let i = CompilerState._binderShield.length - 1; i >= 0; i--)
      if (CompilerState._binderShield[i].has(expr.symbol))
        return wideIsComplex(t.type);
    const v = expr.engine._getSymbolValue(expr.symbol);
    // A value that mentions its own symbol (`b := b + 1`, storable in raw
    // form) would recurse here without end; the interpreter leaves such a
    // symbol unevaluated. Answer from the declared type while the symbol's
    // own value is being analyzed, so the compile reaches the emitter's
    // fail-closed refusal instead of overflowing the stack.
    if (v !== undefined) {
      const inProgress = _complexValueInProgress;
      if (inProgress.has(expr.symbol)) return wideIsComplex(t.type);
      inProgress.add(expr.symbol);
      try {
        // The value compiles with the promotion in force where the symbol
        // is read: inside the value of a real ascription, promotion is off
        // for it too (`tryFoldKnownSymbol`, `ensureFoldedValueEmitted`), so
        // it is analyzed the same way.
        return core.isComplexValued(v);
      } finally {
        inProgress.delete(expr.symbol);
      }
    }
    return wideIsComplex(t.type);
  }

  if (isFunction(expr)) {
    // Memoize FUNCTION answers only (Tycho item 148): symbols and numbers
    // are already O(1), and a function answer transitively embeds the
    // symbol/frame answers below it — which the TOTAL invalidation on every
    // context mutation covers. Without this the analysis is O(subtree) per
    // node and the whole compile O(n²) (a depth-6 nested chain spent 82% of
    // its GLSL compile inside 1.5M `isComplexValued` calls).
    //
    // Only inside a compilation: engine symbol VALUES (read by the symbol
    // arm's fallback) are stable while one compilation runs — compiles do
    // not assign — but not between compilations, and a boxed expression can
    // outlive the compile that first cached it.
    if (CompilerState._compileDepth === 0)
      return _withFoldedRealOverride(expr, _isComplexValuedFunction(expr));
    const stack = CompilerState._complexMemoStack;
    const hit = stack[stack.length - 1].get(expr);
    if (hit !== undefined) return hit;
    const result = _withFoldedRealOverride(
      expr,
      _isComplexValuedFunction(expr)
    );
    // Store into the layer that is live NOW, not the one captured on entry:
    // a binder operand pushes a mask layer and pops it before returning, so
    // by here the context — and the top layer — are the ones this call
    // started with, and a binder node's own verdict lands in its ENCLOSING
    // layer where sibling and repeat queries can hit it.
    const after = CompilerState._complexMemoStack;
    after[after.length - 1].set(expr, result);
    return result;
  }

  return false;
}

/**
 * Run `fn` with an extra lexical frame of inferred local SHAPES — the
 * mechanism `compileBlock` uses for its own locals (`_localComplex` /
 * `_localVector`), exposed for the other binding forms that must declare a
 * static type for a name they bind.
 *
 * Its user is the GPU user-function emission: a parameter's lowering comes
 * from the DECLARED signature (`f: (complex) -> complex` ⇒ `vec2`), which is
 * not carried by the parameter symbol's own type, so without a frame the
 * body analysis would disagree with the declaration the emitter just wrote.
 * Entering EVERY parameter (scalars as `LOCAL_SCALAR`) also shields them
 * from `isComplexValued`'s engine-value fallback, the same way a `Block`
 * local is shielded.
 *
 * Compilation is synchronous, so a static stack is safe (see
 * `_localComplex`).
 *
 * `isolate` replaces the enclosing frames instead of stacking on them, for a
 * body that is NOT lexically nested in them — a user-function definition is
 * emitted at module level, so when one definition's body triggers the
 * emission of another, the callee's body must not see the caller's parameter
 * shapes (a same-named global would take the caller's width).
 *
 * `owner` names the expression the frame was pushed to DESCRIBE — normally a
 * `Function` literal whose parameters the frame enters. A frame with an owner
 * is authoritative for that expression: when the literal is then compiled, it
 * reuses the frame instead of pushing one of its own
 * (`isFramedByForeignScope`). Without an owner the frame describes some
 * enclosing scope, and a nested literal binding the same name must shadow it.
 */
export function withLocalShapeFrame<T>(
  complex: Map<string, boolean>,
  vector: Map<string, number>,
  fn: () => T,
  isolate = false,
  owner?: Expression
): T {
  if (owner !== undefined) {
    _shapeFrameOwner.set(complex, owner);
    _shapeFrameOwner.set(vector, owner);
  }
  const savedComplex = CompilerState._localComplex;
  const savedVector = CompilerState._localVector;
  // An isolated body is not lexically nested in the enclosing bodies, so
  // the checks of their locals are not written in it either
  // (`hideCheckedLocals`).
  const savedChecked = isolate ? hideCheckedLocals() : undefined;
  if (isolate) {
    CompilerState._localComplex = [];
    CompilerState._localVector = [];
  }
  CompilerState._localComplex.push(complex);
  CompilerState._localVector.push(vector);
  // One layer per entry, isolated or not: during the frame only the fresh
  // top layer is consulted (so an isolated body cannot reuse caller-context
  // answers), and the exit below restores the enclosing frames exactly, so
  // popping back to the enclosing layer is sound.
  _pushComplexMemoLayer();
  try {
    return fn();
  } finally {
    CompilerState._localVector = savedVector;
    CompilerState._localComplex = savedComplex;
    if (savedChecked !== undefined) CompilerState._checkedLocals = savedChecked;
    if (!isolate) {
      CompilerState._localVector.pop();
      CompilerState._localComplex.pop();
    }
    _popComplexMemoLayer();
  }
}

/**
 * Number of components a value expression occupies when lowered on a GPU
 * target, for ANY aggregate width (`0`, `1`, `5`, …), or `undefined` for a
 * scalar.
 *
 * Structural for `Tuple`/`List` literals, type-based for typed operands
 * (`tuple<…>`, a 1-axis `list`), 2 for a complex value (lowered as
 * `vec2(re, im)`), and frame-based for a `Block` local.
 *
 * Distinct from `vectorComponentCount`, which answers the narrower question
 * "does this have a `vec2`/`vec3`/`vec4` lowering?". Callers that must
 * decide *whether a value is an aggregate at all* — the fail-closed
 * constructor guard, the block-local type hint — need THIS one: a 1- or
 * 5-element tuple is still an aggregate even though no `vecN` fits it.
 */
export function aggregateComponentCount(
  expr: Expression | null,
  memo?: Map<Expression, number | undefined>
): number | undefined {
  if (expr === null) return undefined;
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'List')) return expr.nops;
  // A value typed as a list or a tuple is a collection, even when it is
  // complex-valued. `isComplexValued` answers `true` for a collection with
  // a complex element (`x + [1, 2, i]`), but such a collection has one slot
  // per element, not the two of a complex `vec2(re, im)`: its count comes
  // from its type, below. CE-280.6.
  //
  // A value that may be absent (`missing | tuple<real, real>`, the type of
  // `If(c, (x, y), Missing)`, or `nan | tuple<real, real>`) has the width
  // of its present value: the absent value is a NaN in every lane.
  const t = withoutAbsentArms(compilationType(expr));
  const collectionTyped =
    typeof t !== 'string' && (t.kind === 'list' || t.kind === 'tuple');
  if (!collectionTyped && core.isComplexValued(expr)) return 2;
  if (isSymbol(expr)) {
    for (let i = CompilerState._localVector.length - 1; i >= 0; i--) {
      const known = CompilerState._localVector[i].get(expr.symbol);
      // Negative entries are the "no aggregate binding" sentinels (see
      // `_localVector`); a width of `0` is a real — invalid — zero-width
      // aggregate and must NOT read back as "scalar".
      if (known !== undefined) return known < 0 ? undefined : known;
    }
  }
  if (typeof t !== 'string') {
    if (t.kind === 'tuple') return t.elements.length;
    if (t.kind === 'list' && t.dimensions?.length === 1) return t.dimensions[0];
  }
  // A selection has the width of its arms, and a `Block` the width of its
  // value (its last operand). A `Block` that ends with one of its locals
  // has the width of the last value assigned to that local, because the
  // frame of the block's locals exists only while the block compiles.
  // Arms with no width are not read; arms of different widths give none.
  if (
    !collectionTyped &&
    (isFunction(expr, 'If') ||
      isFunction(expr, 'Which') ||
      isFunction(expr, 'Block'))
  ) {
    memo ??= new Map();
    if (memo.has(expr)) return memo.get(expr);
    memo.set(expr, undefined);
    let values: ReadonlyArray<Expression>;
    if (expr.operator === 'Block') {
      let last = expr.ops[expr.nops - 1];
      if (last !== undefined && isSymbol(last)) {
        const local = last.symbol;
        for (const op of expr.ops)
          if (isFunction(op, 'Assign') && isSymbol(op.op1, local))
            last = op.op2;
          else if (isFunction(op, 'Declare') && isSymbol(op.op1, local)) {
            const v = declareValueOperand(op.ops);
            if (v !== undefined) last = v;
          }
      }
      values = last === undefined ? [] : [last];
    } else values = liveSelectionArms(expr);
    let width: number | undefined;
    for (const v of values) {
      const n = core.aggregateComponentCount(v, memo);
      if (n === undefined) continue;
      if (width !== undefined && width !== n) {
        width = undefined;
        break;
      }
      width = n;
    }
    memo.set(expr, width);
    return width;
  }
  // A `Sum` or a `Product` has the width of its body, read with each index
  // as a scalar (an index is an integer loop counter): the loop adds or
  // multiplies the values component by component.
  if (
    !collectionTyped &&
    (isFunction(expr, 'Sum') || isFunction(expr, 'Product')) &&
    expr.nops >= 2
  ) {
    memo ??= new Map();
    if (memo.has(expr)) return memo.get(expr);
    memo.set(expr, undefined);
    const indices = expr.ops
      .slice(1)
      .map((limits) =>
        isFunction(limits, 'Limits') && isSymbol(limits.op1)
          ? limits.op1.symbol
          : undefined
      );
    const width = indices.every((i) => i !== undefined)
      ? withRealLoopIndices(indices as string[], () =>
          core.aggregateComponentCount(expr.op1, memo)
        )
      : undefined;
    memo.set(expr, width);
    return width;
  }
  // An element-wise operator over a name whose width only a shape frame
  // gives (a shader input `vec2 uv`, a block local). The engine does not
  // know that width, so it types `2·uv` or `Sin(uv)` as a number. The
  // value has the width of its operands, as the emission gives it:
  // `2.0 * uv` and `_gpu_sin2(uv)` are `vec2` values. When two operands
  // have different widths, an operand is complex, or an operand is a
  // matrix or an array with no width, no width is given. `memo` keeps the
  // answer for each operand of one walk, so that a subexpression shared by
  // several operands is not walked again.
  //
  // The engine type of such a value can be a number, or a wider type such
  // as `any` or `number | vector<2>` (a `Block` local declared `any` or
  // `real` and assigned a point), so only a list or a tuple type, which
  // gives its own count above, skips this walk. `Abs` of a point, or of a
  // list of points, is not element-wise: it compiles to `Norm`, one length
  // per point (the `Abs` rewrite in `compileExpr`), so it has no width here.
  if (
    isFunction(expr) &&
    ELEMENTWISE_WIDTH_OPERATORS.has(expr.operator) &&
    !collectionTyped &&
    !(
      expr.operator === 'Abs' &&
      expr.nops === 1 &&
      (isTuple(expr.op1) ||
        isUnionOfPoints(expr.op1) ||
        isGatedPoint(expr.op1) ||
        isPointListValue(expr.op1) ||
        isGatedPointList(expr.op1))
    )
  ) {
    memo ??= new Map();
    if (memo.has(expr)) return memo.get(expr);
    let width: number | undefined;
    for (const op of expr.ops) {
      const n = core.isComplexValued(op)
        ? -1
        : core.aggregateComponentCount(op, memo);
      if (n === undefined) {
        if (!isNonScalarByShapeAlone(op)) continue;
      } else if (n >= 0 && (width === undefined || width === n)) {
        width = n;
        continue;
      }
      width = undefined;
      break;
    }
    memo.set(expr, width);
    return width;
  }
  return undefined;
}

/**
 * The decidedness analysis of one sub-expression of a branch condition, or
 * `null` when it cannot be analyzed (an impure relation on a target that
 * cannot bind, or a connective the analysis declines). Unlike
 * `conditionDecidability`, a sub-expression that is decided by construction
 * still gets a node: its VALUE takes part in the test of the connective
 * above it.
 */
export function conditionNode(
  cond: Expression,
  canBind: boolean,
  target?: CompileTarget<Expression>
): ConditionNode | null {
  if (isSymbol(cond, 'True') || isSymbol(cond, 'False'))
    return {
      negate: false,
      test: { kind: 'operands', expr: cond, operands: [] },
    };
  if (!isFunction(cond))
    return { negate: false, test: { kind: 'value', expr: cond } };
  const h = cond.operator;
  // `Not` is decided exactly when its operand is, so the node keeps the
  // operand's test and records the negation separately. The negation is
  // then applied to a DECIDED value — by exchanging the two answers of a
  // leaf, or by a guarded negation over a connective — never by an emitted
  // `!` over the condition itself, which would turn an undecided value into
  // a confident `true`.
  if (h === 'Not' && cond.nops === 1) {
    const inner = core.conditionNode(cond.ops[0], canBind, target);
    return inner === null ? null : { ...inner, negate: !inner.negate };
  }
  if (h === 'And' || h === 'Or')
    return connectiveNode(cond, h, canBind, target);
  if (!BRANCH_RELATIONS.has(h))
    return { negate: false, test: { kind: 'value', expr: cond } };
  // A pair with a NaN literal operand is decided whatever the other
  // operand holds: `NaN < x` is `False` and `NaN ≠ x` is `True` in the
  // interpreter while `x` has no value, and the plain comparison gives
  // that answer. So it needs no test, as `True` and `False` need none.
  if (
    cond.nops === 2 &&
    cond.ops.some((op) => isNanLiteral(op)) &&
    cond.ops.every((op) => op.isPure === true)
  )
    return {
      negate: false,
      test: { kind: 'operands', expr: cond, operands: [] },
    };
  // An `Equal`/`NotEqual` over an operand that may be a COLLECTION at run
  // time is the one relation whose compiled value is not a genuine boolean.
  // It lowers to the runtime dispatch (`_SYS.eq`/`_SYS.neq` in the
  // JavaScript target), and one element pair with no answer makes that
  // value the numeric absence marker instead of `true`/`false` (user ruling
  // of 2026-09-21). Decidedness must therefore be read off the condition's
  // own VALUE: the NaN test the other relations use reads an array operand
  // as decided and the marker is a falsy value, so the branch silently took
  // the else arm.
  //
  // The classification is the target's own (`collectionEqualityOperand`),
  // so it matches the operands its emitter sends to that dispatch — one
  // operand is enough, and an opaque top-typed application or a
  // scalar-or-list union counts. A target that declares none keeps the
  // conservative rule: every operand statically collection-typed. Reading
  // an ordinary SCALAR comparison off its value would be wrong in the other
  // direction: a NaN operand compares to a plain `false`, which the value
  // test would take as a decided answer.
  //
  // A TEXT operand is excluded. A string is a collection of its characters
  // in the lattice, but a string comparison lowers to the content-equality
  // helper, whose answer is a genuine boolean.
  const collectionEqualityOperand = target?.collectionEqualityOperand;
  if (
    (h === 'Equal' || h === 'NotEqual') &&
    cond.nops === 2 &&
    (collectionEqualityOperand !== undefined
      ? cond.ops.some((op) => !isTextAtom(op) && collectionEqualityOperand(op))
      : cond.ops.every(
          (op) => !isTextAtom(op) && op.type.matches('collection<any>')
        ))
  )
    return { negate: false, test: { kind: 'value', expr: cond } };
  // The operands are named again inside the test. An operand with effects
  // is therefore bound to a name first and evaluated once
  // (`withConditionOperands` for a lone relation, `kleeneRelationLeaf`
  // under a connective) — which needs a binding form. Without one the
  // relation is declined: inlining the operand would run its effects at
  // every naming. Two impure shapes are declined even with one, because
  // the binding would change what the relation evaluates:
  // - a CHAIN (`Less(5, 1, Random())`, three or more operands): the test
  //   binds every operand up front, where the chain's own emitted `&&`
  //   skips a later operand once an earlier pair is false — the draw
  //   would happen where the plain lowering makes none;
  // - the SAME impure node in two positions (`Less(d, d)` built from one
  //   boxed `d`): the binding is keyed on the node (`_codeOverrides`), so
  //   one draw would stand for the two evaluations that were written.
  // A relation whose compiled VALUE is the object null when an operand is
  // absent — a written absence operand, or the Kleene `Equal`/`NotEqual`
  // guard over an object-domain operand — is read by that value, which is
  // the undecided one. The operand test below would see no numeric operand
  // to test and call the relation decided, so the plain comparison took an
  // arm (the else arm for `Less(Missing, t)`). A caller that passes no
  // target is read as a target with an object null.
  if (
    (target === undefined || target.absence?.object !== undefined) &&
    (cond.ops.some(isAbsenceSymbol) ||
      ((h === 'Equal' || h === 'NotEqual') &&
        cond.nops === 2 &&
        cond.ops.some(isObjectDomainMissingOperand)))
  )
    return { negate: false, test: { kind: 'value', expr: cond } };
  // On the JavaScript target, a relation that has effects, or that reads
  // a local of a block being compiled, is read by its VALUE: the
  // comparison lowering (`unsuppliedComparisonGuard`) evaluates the
  // operands first, compares, and gives `undefined` when the comparison
  // has no value, and the selection takes the first arm only for `true`,
  // the next one only for `false`, and no arm otherwise. A test placed
  // before the comparison would skip an operand with effects (`If(Block(a
  // := n, 1) > 0, …)` assigns `a` in the interpreter), and the test of a
  // local is too strict (every caller input of its block,
  // `blockInputs`): placed first, it would make a comparison that is
  // `true` in the interpreter (`a < 1` after `a := 0`) take no arm.
  if (
    target?.language === 'javascript' &&
    target.bindExpr !== undefined &&
    (cond.isPure !== true || readsBlockLocal(cond, target)) &&
    guardTakesOperands(cond.ops)
  ) {
    CompilerState._poisonConditions.add(cond);
    return { negate: false, test: { kind: 'value', expr: cond } };
  }
  if (cond.isPure !== true) {
    if (!canBind || cond.nops > 2) return null;
    if (cond.nops === 2 && cond.op1 === cond.op2 && cond.op1.isPure !== true)
      return null;
  }
  // A CHAIN (`Less(x, 0, w)`) is the Kleene conjunction of its links, as in
  // the interpreter, where a chain stops at the first pair that is `False`:
  // one decidedly false link decides the chain whatever an absent operand
  // of another link holds. So with `x = 1` and `w` absent (or an unsupplied
  // input), `If(x < 0 < w, 1, 2)` is `2`. Read as one relation, the chain
  // was tested for every operand at once, and the absent `w` made it take
  // no arm. Every link is pure here (an impure chain is declined above), so
  // a middle operand compiled in two links is evaluated twice with no
  // observable difference. A chained `Equal`/`NotEqual` over an operand
  // that may be a collection is not split: it is not a conjunction of its
  // links (`Equal([1, 2, 3], [1, 2, 3], 3)` is the scalar `False`, where
  // the links would broadcast), and its own lowering declines it.
  const collectionChain =
    (h === 'Equal' || h === 'NotEqual') &&
    cond.ops.some(
      (op) =>
        !isTextAtom(op) &&
        (collectionEqualityOperand !== undefined
          ? collectionEqualityOperand(op)
          : op.type.matches('collection<any>'))
    );
  if (cond.nops > 2 && !collectionChain) {
    const ce = cond.engine;
    const links: Expression[] = [];
    for (let i = 0; i + 1 < cond.nops; i++)
      links.push(ce._fn(h, [cond.ops[i], cond.ops[i + 1]]));
    const nodes: ConditionNode[] = [];
    for (const link of links) {
      const node = core.conditionNode(link, canBind, target);
      if (node === null) return null;
      nodes.push(node);
    }
    return {
      negate: false,
      test: {
        kind: 'connective',
        expr: ce._fn('And', links),
        op: 'And',
        operands: nodes,
      },
    };
  }
  // A relation with a NaN operand is decided, with the value the compiled
  // comparison already answers: `false`, so the branch takes its next arm,
  // or `true` for `NotEqual`, so it takes its first arm (user decisions
  // 2026-10-20, Tycho rows 411 and 413, and 2026-10-23), also as a link of
  // a chain with an absent operand (`compileAbsentRelation`). The relation
  // is tested only for an ABSENT value: an operand typed with a `missing` arm
  // (`operandMayBeAbsent`) is tested itself, and, on a target that reads
  // its variables off a vars object, every variable the operand reads on
  // every evaluation is tested for `undefined` (`operandInputNodes`,
  // `operandDecidedConjuncts`): an unsupplied variable leaves the branch
  // undecided whatever arithmetic surrounds it (ruled 2026-09-02). `2r > 0`
  // therefore tests `_.r !== undefined`, not the product, and a comparison
  // that reads no variable (`Random() < 0.5`) is decided by construction.
  const readsVarsObject = target?.varsObjectName !== undefined;
  const operands: Expression[] = [];
  for (const op of cond.ops) {
    if (!mayBeUndecided(op, target)) continue;
    if (operandMayBeAbsent(op)) {
      operands.push(op);
      continue;
    }
    if (!readsVarsObject) continue;
    for (const s of operandInputNodes(op, target))
      if (!operands.some((o) => o.isSame(s))) operands.push(s);
  }
  return {
    negate: false,
    test: { kind: 'operands', expr: cond, operands },
  };
}

/**
 * `kleeneCondition`, and whether its value is always decided: `true` or
 * `false`, never the undecided value. A relation leaf whose operands need
 * no decidedness test is always decided (its compiled value is a genuine
 * boolean, see `ConditionTest`), and so is a connective whose operands are
 * all always decided. A value leaf is never known to be decided.
 */
export function kleeneConditionParts(
  node: ConditionNode,
  target: CompileTarget<Expression>,
  dialect: ConditionDialect
): { code: TargetSource; decided: boolean } {
  const t = node.test;
  if (t.kind === 'value')
    return {
      code: kleeneValueLeaf(t.expr, node.negate, target, dialect),
      decided: false,
    };
  if (t.kind === 'operands')
    return kleeneRelationLeaf(t, node.negate, target, dialect);
  return kleeneConnective(t, node.negate, target, dialect);
}

/** Walk a sum constructor pattern, appending conditions and capture
 * accessors. Returns `false` — leaving `conds`/`accessors` to be discarded
 * by the caller — when the pattern is not a sum constructor pattern this
 * compiler can lower. */
export function walkConstructorPattern(
  engine: ComputeEngine,
  p: Expression,
  base: string,
  conds: string[],
  accessors: Map<string, string>,
  bound: Set<string>,
  target: CompileTarget<Expression>
): boolean {
  if (!isFunction(p)) return false;
  const info = sumVariantInfo(engine, p.operator);
  if (info === undefined) return false;
  const ops = p.ops;
  // The pattern must be a saturated application: `plus(a, b)`, never
  // `plus(___)` or a wrong-arity application. (`red` — the bare symbol — is
  // not a function expression and never reaches here; `red()` is.)
  if (ops.length !== info.arity) return false;

  if (info.policy === 'tagged') {
    conds.push(`${base}?._tag === ${JSON.stringify(p.operator)}`);
    return ops.every((op, i) =>
      walkConstructorElement(
        engine,
        op,
        `${base}._ops[${i}]`,
        conds,
        accessors,
        bound,
        target
      )
    );
  }

  // ERASED. An unclassifiable variant can never reach here: it forces its
  // whole sum to the tagged policy.
  if (info.bucket === undefined) return false;
  conds.push(sumBucketTest(info.bucket, base, info.complexNumber));
  if (info.shape === 'nothing') return true;
  if (info.shape === 'value')
    return walkConstructorElement(
      engine,
      ops[0],
      base,
      conds,
      accessors,
      bound,
      target
    );
  // A tuple payload erases to the same JS array `Tuple` emits, of a fixed
  // length the constructor always produces.
  conds.push(`${base}.length === ${info.arity}`);
  return ops.every((op, i) =>
    walkConstructorElement(
      engine,
      op,
      `${base}[${i}]`,
      conds,
      accessors,
      bound,
      target
    )
  );
}

/** Walk a tier-2 fixed shape, appending JS boolean conditions (arity + literal
 * / pin element checks) and populating `accessors` (capture name → element
 * access code). Compiled `List`/`Tuple` values are JS arrays, so shapes lower
 * to `Array.isArray`, `.length`, `[i]`, and `.slice`. */
export function walkMatchShape(
  engine: ComputeEngine,
  node: ShapeNode,
  base: string,
  conds: string[],
  accessors: Map<string, string>,
  target: CompileTarget<Expression>,
  /** Receives the name of a `...rest` capture (see `matchCaptureTarget`). */
  sequenceNames?: Set<string>
): void {
  // Dictionary shapes are a tier-2 fixed shape for the interpreter, but the
  // compiler does not implement dict destructuring (native dict values have no
  // compiled array representation). Fail closed, naming the keys.
  if (node.kind === 'dict') {
    const keys = node.entries.map((e) => `'${e.key}'`).join(', ');
    throw new Error(
      `Could not compile \`Match\`: dictionary pattern {${keys}} is not compilable; ` +
        `rewrite with destructuring or guards.`
    );
  }
  conds.push(`Array.isArray(${base})`);
  const fixed = node.prefix.length + node.suffix.length;
  if (node.rest === undefined) conds.push(`${base}.length === ${fixed}`);
  else conds.push(`${base}.length >= ${fixed}`);

  node.prefix.forEach((el, i) =>
    walkMatchElement(
      engine,
      el,
      `${base}[${i}]`,
      conds,
      accessors,
      target,
      sequenceNames
    )
  );
  const sLen = node.suffix.length;
  node.suffix.forEach((el, j) =>
    walkMatchElement(
      engine,
      el,
      `${base}[${base}.length - ${sLen} + ${j}]`,
      conds,
      accessors,
      target,
      sequenceNames
    )
  );
  if (node.rest !== undefined && node.rest.key !== null) {
    const name = node.rest.key.replace(/^_+/, '');
    accessors.set(
      name,
      `${base}.slice(${node.prefix.length}, ${base}.length - ${sLen})`
    );
    sequenceNames?.add(name);
  }
}

/**
 * The emission part of `trySpecializedUserCall`: emit the call-shape
 * specialization of `h` that the call `h(args)` uses, and return its name
 * with what the call site needs to know. `undefined` when the call takes
 * no specialization. Also used to find the definition whose lane a call
 * returns (`userCallDefinition`), before the call is compiled.
 */
export function ensureSpecializedUserCallEmitted(
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
  | undefined {
  const registry = target.userFunctions;
  // On interval-js, a copy is made for one case only: a list of real
  // numbers that the interpreter binds WHOLE to a parameter whose element
  // type is open (the branch that sets `wholeListArgument` below). The
  // generic definition compiles the body against the open parameter type,
  // and a nested call can then refuse it: with `d(p) := … r(p) …` and `r`
  // typed by index reads, the parameter of `d` is inferred
  // `dictionary<any> | indexed_collection<any>`, which `r` refuses. The
  // copy typed by the argument (`vector<2>`) compiles, and its parameter
  // is the array of intervals that a list is on this target, which is
  // also how the generic definition receives a list bound whole
  // (`compile-interval-collections.test.ts`). Scalar, point and complex
  // arguments keep the generic definition on interval-js. ROADMAP CE-564.
  const interval = target.language === 'interval-javascript';
  if (
    !registry ||
    (target.language !== 'javascript' &&
      target.language !== 'glsl' &&
      target.language !== 'wgsl' &&
      !interval)
  )
    return undefined;
  if (
    registry.specializing?.has(h) ||
    userFunctionIsGeneric(engine, h, literal)
  )
    return undefined;
  const params = literal.ops.slice(1);
  // A private Typed parameter also enforces assignments to that binding.
  // Preserve the original mutation semantics instead of adding a promise
  // based only on the value passed at entry (`parametersCanBeTyped`).
  if (params.length !== args.length || !parametersCanBeTyped(literal))
    return undefined;
  const parameterNames = new Set(params.map(functionLiteralParameterName));
  const types: Type[] = [];
  const pointWidths: (number | undefined)[] = [];
  let preservesPoints: boolean | undefined;
  let narrower = false;
  let pointArgument = false;
  let listArgument = false;
  let complexArgument = false;
  let wholeListArgument = false;
  // How the interpreter binds a LIST argument at an untyped parameter
  // depends on the definition as a whole (`paramsAreScalar`): when every
  // parameter is scalar or untyped the call is BROADCAST over the list,
  // element by element; when any parameter is declared a point or a
  // collection every argument is bound WHOLE (`k(p: tuple, x) := 42` is
  // `42` over a list, the untyped `k(p, x) := 42` is `[42, 42]`).
  const bindsListsWhole = !userFunctionParamsAreScalar(engine, h);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // With no declared signature (a symbol declared `function`, then
    // assigned a literal), an untyped parameter is read from the slot of
    // the literal's own signature, not from the parameter symbol. A use in
    // the body narrows the symbol (`V·[cos θ, -sin θ]` makes `V` a
    // `number`), which is not an argument contract: the literal's slot
    // is `collection<any> | value`, and the interpreter binds a list
    // whole there. Read from the symbol, a list argument was refused
    // here, and the call took the generic definition (ROADMAP CE-564.4).
    const declared =
      userFunctionParamType(engine, h, i) ??
      (isSymbol(params[i])
        ? signatureParamType(literal.type.type, i)
        : undefined) ??
      params[i].type.type;
    // A parameter typed as a tuple ONLY by index reads in the body
    // (`r(p) := Floor(p[1]) + …` types `p` as `tuple<real>`) has no
    // contract: the reads do not prove that the argument is a point, and
    // the interpreter binds a list argument whole and runs the body with
    // the list (user decision of 2026-10-15, `isIndexReadTuple()` in
    // `boxed-expression/index-read-tuple.ts`). For an argument that is not
    // a point, that tuple is therefore read as an open parameter type, and
    // the specialization takes the argument's own type. Without this, the
    // generic definition compiles the body against the tuple: a nested
    // `f(p)` with `f(q) := Mod(q, 1) - 0.5` is then a tuple minus a number,
    // which is refused, while the interpreter maps `f` over the list.
    // A point argument keeps the tuple, so a call that the interpreter
    // refuses (`f((0.3, 1.4))`) is refused here too.
    const openIndexReadTuple =
      isIndexReadTuple(declared) && !isSinglePointArg(a);
    const declaredIsOpen =
      openIndexReadTuple ||
      declared === 'unknown' ||
      declared === 'any' ||
      declared === 'value';
    let t = a.type.type;
    if (isSinglePointArg(a)) {
      if (interval) return undefined;
      pointArgument = true;
      const width = core.aggregateComponentCount(a);
      if (width === undefined) return undefined;
      t = {
        kind: 'tuple',
        elements: Array.from({ length: width }, () => ({
          type: 'number' as Type,
        })),
      };
      // Being one atomic point does not prove scalar coordinates. A
      // runtime tuple may contain lists in any coordinate, and rebuilding
      // it as tuple<number, ...> would erase component broadcasting.
      //
      // That hazard exists only where the DECLARED parameter type admits a
      // point with a list coordinate (`unknown`, or coordinates typed
      // `broadcastable<number>`). Where it admits none — `P: list<number> |
      // tuple<number, number>` — the interpreter rejects such an argument
      // with an `incompatible-type` error before the body runs, so the only
      // points the call can carry have scalar coordinates and the
      // `tuple<number, …>` rebuild is exact (ruled 2026-09-11).
      if (
        target.language === 'javascript' &&
        provenScalarPointWidth(a, target) !== width &&
        declaredPointAdmitsListCoordinate(declared, width)
      ) {
        const actual = compilationType(a);
        if (typeof actual !== 'string' && actual.kind === 'tuple') t = actual;
        else return undefined;
      }
    } else if (
      target.language === 'javascript'
        ? isConstructedScalar(a, target)
        : isSubtype(operandTypeInContext(a, target), 'number') ||
          isSubtype(a.type.type, 'boolean') ||
          // A complex parameter of the enclosing shader definition (`w` in
          // the complex copy of `g(w) := f(w) + 1`) is recorded in the
          // local shape frame as a 2-component value, so its type in
          // context reads as a pair, not a number. Its own type and its
          // lane still say it is a complex scalar.
          (isSubtype(a.type.type, 'number') && core.isComplexValued(a))
    ) {
      if (core.isComplexValued(a)) {
        // A COMPLEX argument. JavaScript keeps its own rule: its complex
        // lane is chosen by the compile mode, and a strict compile
        // declines. A shader target has no such mode, and its ordinary
        // definition types an undeclared parameter `float`, so the call
        // would decline. Instead the call gets a copy of the definition
        // whose parameter is typed `complex` (a `vec2`/`vec2f`
        // parameter), and the body is compiled with that parameter
        // complex. The copy has its own name (`_fn_f_complex`), since
        // WGSL has no overloading, and is emitted only when a call needs
        // it. A parameter declared `real` rejects the `complex` type
        // below, so that call still declines: the declaration is a
        // contract.
        if (target.language === 'javascript' || interval) return undefined;
        t = 'complex';
        complexArgument = true;
      } else t = isSubtype(t, 'boolean') ? 'boolean' : 'number';
    } else if (
      (target.language === 'javascript' || interval) &&
      bindsListsWhole &&
      isRealListArg(a) &&
      paramElementTypeIsOpen(engine, h, i)
    ) {
      wholeListArgument = true;
      // A LIST of real numbers that the interpreter binds WHOLE (the
      // definition declares or infers a collection parameter, so no
      // parameter list is all scalar). This branch applies only when the
      // element type of the parameter is open (`paramElementTypeIsOpen`):
      // the function has an inferred signature, or the parameter is
      // declared `unknown`, `any`, `value`, or a collection with no stated
      // element type (`collection`, `list`). A parameter DECLARED with an
      // element type is the host's contract, and the call keeps the
      // generic definition. So a parameter typed
      // `indexed_collection<number>` (elements possibly complex) comes
      // here only when the signature is inferred from the body, not when
      // it is declared. The generic definition compiles its body against a
      // broad type: an element read `l[i]` of unknown type declines as
      // "scalar arithmetic over a list-valued operand", a `Length(l)` of a
      // `collection` declines as "not an indexed collection", and a
      // `number` element takes the complex lane. The helper specialized to
      // the argument's own list type compiles the body with real elements,
      // as a declared `(list<real>) -> …` signature does. The key is the
      // argument's type, so each distinct list type has one helper, and a
      // nested chain `d(s(u(L)))` compiles one helper per function (the
      // type of each inner call follows its argument, `callResultType`).
      // An argument typed `indexed_collection<E>` (a comprehension, a
      // `Map`) is typed `list<E>` here: the compiled value is an array
      // either way, and a parameter declared `list` then admits it, as the
      // interpreter binds it. The compiled argument is always a
      // materialized, finite JavaScript array, never a lazy iterator: only
      // `Take` and `TakeWhile` lower an infinite pipeline as a lazy stream
      // (`emitLazyStream` in `javascript-target.ts`), and both return an
      // array. An infinite collection anywhere else, including as a call
      // argument, makes the compile fail (the `Range` handler and
      // `collArg` throw), so the call falls back to the interpreter.
      // Witness: Tycho item 323, three helpers declared as bare `function`
      // or as `(list) -> unknown`.
      const own = a.type.type;
      const element = collectionElementType(own);
      t =
        isSubtype(own, 'list<any>') || element === undefined
          ? own
          : { kind: 'list', elements: element };
    } else if (
      target.language === 'javascript' &&
      (declared === 'unknown' || declared === 'any' || declared === 'value') &&
      isRealListArg(a)
    ) {
      // A LIST of real numbers at a parameter the definition leaves
      // untyped, beside a point argument (checked after the loop: a list
      // alone keeps the generic definition, which broadcasts the same way
      // and carries the last-call memo). Bound as the interpreter binds
      // it (`bindsListsWhole`): whole, with its own type, when the
      // definition declares a point or collection parameter — the helper
      // then compiles the parameter as the array it is at this ABI; or
      // broadcast at the call boundary otherwise — the helper is then the
      // one the scalar call gets (the ELEMENT type), and the call below
      // maps it over the list with the point held. The witness is the
      // Tycho code-generation audit document `njncrg9fkv`: `W(p, x, y, z)
      // := PointList(x·PointX(p), …)` with `p` declared "a point or a
      // list of points" and the scales untyped, called with `x = [0.8,
      // 0.2, 0.8, 0.2]` — the generic definition compiled against the
      // broad `p` reads its coordinate as a collection of numbers and the
      // `PointList` had no list source, so the call declined.
      listArgument = true;
      t = bindsListsWhole ? a.type.type : 'number';
    } else if (
      target.language !== 'javascript' &&
      !interval &&
      bindsListsWhole &&
      paramElementTypeIsOpen(engine, h, i) &&
      isShaderVectorListArg(a)
    ) {
      // A LIST of 2 to 4 real numbers on a shader target, at a parameter
      // that the interpreter binds WHOLE (the definition infers or
      // declares a collection parameter, as `R(V, θ) := [Σ V·[cos θ,
      // -sin θ], Σ V·[sin θ, cos θ]]` does) and whose element type is
      // open. The generic definition cannot be emitted: its parameter
      // type (`collection<any> | value`, or the `number` its symbol is
      // narrowed to) has no single shader type, or is a `float` that the
      // `vec2` argument does not convert to. The copy typed by the
      // argument (`list<real^2>`) has a `vec2` parameter, and the body
      // is compiled with that parameter a vector, which is how the
      // interpreter binds the list. Witness: the Tycho code-generation
      // census document `pqflulcixs` (ROADMAP CE-564.4).
      //
      // The element type is `real` only when the argument's elements are
      // finite reals. The parameter is emitted as a declared vector of
      // that element type, and the GPU finiteness proof
      // (`gpuProvablyFinite`, gpu-finite-proof.ts) then emits the built-in
      // `sin`, `sign`, `max` without the NaN guard. An element that can be
      // non-finite (a free symbol typed `number`, the `nan` of `0/0`, an
      // infinity) keeps its own type, so the guard stays: the interpreter
      // gives NaN for `sin(+∞)`, the built-in `sin` gives 0.
      const elt = collectionElementType(resolveTypeForCompilation(a.type.type));
      t = {
        kind: 'list',
        elements:
          elt !== undefined && isSubtype(elt, 'finite_real')
            ? 'real'
            : (elt ?? 'number'),
        dimensions: [core.aggregateComponentCount(a)!],
      };
    } else return undefined;
    if (!declaredIsOpen && !isSubtype(t, declared)) {
      if (isSubtype(a.type.type, declared)) t = declared;
      else return undefined;
    }
    if (declaredIsOpen || !isSubtype(declared, t)) narrower = true;
    types.push(t);
    let pointWidth: number | undefined;
    if (
      target.language === 'javascript' &&
      typeof t !== 'string' &&
      t.kind === 'tuple' &&
      provenScalarPointWidth(a, target) === t.elements.length
    ) {
      // An opaque call can mutate an array without assigning its binding.
      // Check effects only for calls with a constructed point argument.
      preservesPoints ??= isEmissionSkippable(
        [literal.op1],
        [...parameterNames].filter(
          (name): name is string => name !== undefined
        ),
        registry.root ?? target
      );
      if (preservesPoints) pointWidth = t.elements.length;
    }
    pointWidths.push(pointWidth);
  }
  // A RANGE SPECIALIZATION: an argument typed by a real range (the index
  // of a `Sum`, of a comprehension over a literal range, a number
  // literal) at a wider parameter, when the body typed by that range keeps
  // a radical on the real lane that the definition the call uses otherwise
  // promotes to the complex lane (`rangeSpecializedParameterTypes`). The
  // copy has its own name, and the call passes its scalar arguments to it
  // directly: each one is a constructed scalar (the branch above), so no
  // broadcast dispatch is needed.
  let rangeTypes: (Type | undefined)[] | undefined;
  if (
    target.language === 'javascript' &&
    !registry.lowering &&
    modePromotes() &&
    !pointArgument &&
    !listArgument &&
    !complexArgument &&
    types.every((t) => isSubtype(t, 'number'))
  )
    rangeTypes = rangeSpecializedParameterTypes(
      engine,
      h,
      literal,
      args.map((a) => a.type.type),
      registry
    );
  if (rangeTypes !== undefined) {
    rangeTypes.forEach((t, i) => {
      if (t !== undefined) types[i] = t;
    });
    narrower = true;
  }
  if (listArgument && !pointArgument) return undefined;
  // On interval-js, only a call with a list bound whole takes a copy (see
  // the comment on `interval` above).
  if (interval && !wholeListArgument) return undefined;
  const hasPointProof = pointWidths.some((w) => w !== undefined);
  if (!narrower && !hasPointProof) return undefined;
  if (isContradictedScalarDeclaration(engine.function(h, args)))
    return undefined;
  // A complex copy is never the scalar definition: it has its own name and
  // its own call boundary (a `vec2` argument), so it cannot share either
  // with the real definition. Nor is a range specialization: other calls
  // of the function use the definition without the range.
  const scalarDefinition =
    !bindsListsWhole &&
    !complexArgument &&
    rangeTypes === undefined &&
    types.every((t) => isSubtype(t, 'number'));
  // A declared tuple and a constructed point can have the same type.
  // Only the constructed variant may omit runtime shape checks.
  const proofKey = hasPointProof
    ? `#points:${pointWidths.map((w) => w ?? '').join(',')}`
    : '';
  // The key tells a closed record (a dictionary literal) from the open
  // record with the same fields: they print alike but are different
  // types, and the specializations differ.
  const key = `${h}#${types.map((t) => typeToIdentityKey(t)).join(';')}${proofKey}`;
  const cache = (registry.specializations ??= new Map());
  let specialized = cache.get(key);
  if (specialized === undefined) {
    specialized = literalWithParameterTypes(engine, literal, types);
    if (specialized === undefined) return undefined;
    cache.set(key, specialized);
  }
  if (!isFunction(specialized, 'Function')) return undefined;
  const active = (registry.specializing ??= new Set());
  active.add(h);
  let name: string | undefined;
  try {
    name = core.emitFunctionLiteralDefinition(
      h,
      specialized,
      target,
      registry,
      { key: scalarDefinition ? h : key, types, pointWidths }
    );
  } finally {
    active.delete(h);
  }
  if (name === undefined) return undefined;
  target.symbolDeps?.add(h);
  return {
    name,
    scalarDefinition,
    listArgument,
    bindsListsWhole,
    rangeKey: rangeTypes === undefined ? undefined : key,
  };
}

/**
 * The number of nodes in `body` that need a sign proof they do not have
 * (`radicalNeedsSignProof`), with the nodes in the bodies of the user
 * functions that `body` calls. A called function is counted with the
 * definition that the call would use: the range specialization when the
 * arguments of the call give one (`rangeSpecializedParameterTypes`), the
 * definition with its declared parameter types otherwise
 * (`declaredParameterLiteral`).
 *
 * The count is used to COMPARE two versions of one body: a version with
 * typed parameters is worth emitting only when it has fewer such nodes
 * than the version that would be emitted otherwise. A function that is
 * already being counted (a recursive call) adds nothing.
 *
 * The counts of called functions are kept for the compilation, by the
 * function name and the parameter types of the definition that is
 * counted.
 */
export function unprovenRadicalCount(
  engine: ComputeEngine,
  body: Expression,
  registry: UserFunctionRegistry,
  visiting: Set<string>
): number {
  // This memo belongs to this walk's binding and recursion context. Add a
  // cached subtotal at every occurrence, so shared nodes keep their weight.
  const subtotals = new Map<Expression, number>();
  const visit = (node: Expression): number => {
    if (!isFunction(node) || node._numericStore !== undefined) return 0;
    const cached = subtotals.get(node);
    if (cached !== undefined) return cached;
    const h = node.operator;
    let count = radicalNeedsSignProof(h, node.ops) ? 1 : 0;
    if (!visiting.has(h)) count += calleeCount(h, node.ops);
    for (const op of node.ops) count += visit(op);
    subtotals.set(node, count);
    return count;
  };
  const calleeCount = (h: string, args: ReadonlyArray<Expression>): number => {
    const callee = userFunctionLiteral(engine, h);
    if (callee === undefined || userFunctionIsGeneric(engine, h, callee))
      return 0;
    const types = rangeSpecializedParameterTypes(
      engine,
      h,
      callee,
      args.map((a) => a.type.type),
      registry,
      visiting
    );
    const definition =
      types === undefined
        ? declaredParameterLiteral(engine, h, callee, registry, visiting)
        : cachedLiteralWithParameterTypes(engine, h, callee, types, registry);
    if (definition === undefined) return 0;
    const memo = memoFor(radicalCountMemos, registry);
    const key = parameterTypesKey(
      h,
      definition.ops
        .slice(1)
        .map((p) => (isFunction(p, 'Typed') ? p.type.type : undefined))
    );
    let n = memo.get(key);
    if (n === undefined) {
      // Recorded first, so a recursive call reached while the body is
      // counted adds nothing.
      memo.set(key, 0);
      visiting.add(h);
      try {
        n = core.unprovenRadicalCount(
          engine,
          definition.op1,
          registry,
          visiting
        );
      } finally {
        visiting.delete(h);
      }
      memo.set(key, n);
    }
    return n;
  };
  // The body is read as an emitted definition is compiled: the sign facts
  // of the caller (the values of an unrolled `Sum` index, the shapes of
  // its locals) do not apply to it.
  return core.withCallerBindingsHidden(() => visit(body));
}

export function ensureUserFunctionEmitted(
  engine: ComputeEngine,
  h: string,
  target: CompileTarget<Expression>,
  decline?: DeclineNote
): string | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;

  const literal = userFunctionLiteral(engine, h);
  // A multi-clause function has no single literal — it compiles to a guard
  // chain over its clause set (function-polymorphism design §8).
  if (literal === undefined)
    return tryEmitMultiClauseFunction(engine, h, target, decline);

  // A GENERIC user function is emitted as its BOUND reading, and declines
  // whole-fn when it has none (G3, generic-function-literals design §2.7).
  //
  // The decline exists because a polytype's parameters are open type
  // variables: the emitted code could neither coerce nor broadcast a call,
  // so a lifted call (`f([1,2,3])` under `(T) -> T where T: number`) ran the
  // scalar body on the array and silently computed a wrong value. Reading
  // each variable at its declared bound closes that hole for a BOUNDED
  // generic: the function is emitted once as the ground `(number) ->
  // number` it is bounded by, and its call sites get the same coercion and
  // broadcast wraps a ground signature earns, so `f([1,2,3])` broadcasts to
  // `[2,4,6]` exactly as the interpreter does. See
  // `userFunctionSignature` for why the bound is a sound reading.
  //
  // Two conditions gate it. The bound reading must be GROUND — an unbounded
  // `where T` names no type to compile against — and the target must be
  // JAVASCRIPT: the coercion and the `_SYS.bcastFn` broadcast the emitted
  // call boundary relies on are both JavaScript conventions, and a target
  // with its own definition lowering (the shader targets) synthesizes a
  // static signature this reading was never validated against. Every other
  // target keeps the whole-function decline and its sound interpreted
  // fallback. The declared signature is authoritative when there is one (an
  // E3 install stores a plain literal whose own arrow is ground); the
  // literal's own polytype covers the bare-assign route.
  let emitted = literal;
  if (userFunctionIsGeneric(engine, h, literal)) {
    if (target.language !== 'javascript') {
      if (decline)
        decline.reason =
          'a generic function is emitted as its bound reading, which is a ' +
          'JavaScript-target convention';
      return undefined;
    }
    const ground = userFunctionSignature(engine, h);
    if (ground === undefined) {
      if (decline)
        decline.reason =
          'a generic function whose type variables have no ground bound ' +
          'names no signature to emit against';
      return undefined;
    }
    emitted = literalAtGroundSignature(engine, literal, ground);
  } else if (
    target.language === 'javascript' &&
    !registry.lowering &&
    modePromotes()
  )
    // A parameter declared with a narrower real type than the literal
    // gives it (`(integer<1..16>) -> unknown` for `k ↦ √((k − 0.5)/16)`)
    // is compiled at the declared type when that keeps a radical of the
    // body on the real lane (`declaredParameterLiteral`).
    emitted = declaredParameterLiteral(engine, h, literal, registry);

  // The generated code bakes this user function's current definition: record
  // it in the capture set (see `CompileTarget.symbolDeps`). Symbols its body
  // consults are recorded by the body compile below.
  target.symbolDeps?.add(h);

  return core.emitFunctionLiteralDefinition(h, emitted, target, registry);
}

/**
 * Emit `literal` once into `registry.defs` as the named local function for
 * `h` (`const _fn_h = …`) and return that local name.
 *
 * Shared by the two routes that have a `Function` literal in hand: a
 * user-defined function (`ensureUserFunctionEmitted`) and the eta-expansion
 * of a bare built-in operator symbol used as a callback
 * (`ensureBuiltinCallbackEmitted`). Both therefore get the same shared
 * local, the same nested-CSE harvest of the body, and the same target
 * `lowering` hook.
 */
export function emitFunctionLiteralDefinition(
  h: string,
  literal: Expression & FunctionInterface,
  target: CompileTarget<Expression>,
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  specialization?: {
    key: string;
    types: readonly Type[];
    pointWidths?: readonly (number | undefined)[];
  },
  /**
   * Emit the INVARIANT-PREFIX VARIANT of `h` instead of its definition:
   * the same body, with every occurrence of each listed prefix expression
   * read from an extra parameter appended after the ordinary ones, in
   * list order (`ensureUserFunctionVariantEmitted`). Emitted through the
   * target's own definition lowering when it has one (the shader targets
   * receive the prefixes as `extraParams`), else as the JavaScript arrow
   * form.
   */
  prefixed?: {
    key: string;
    prefixes: ReadonlyArray<InvariantPrefix<Expression>>;
  }
): string | undefined {
  const name = userFunctionName(
    registry,
    prefixed?.key ?? specialization?.key ?? h
  );

  if (!registry.defs.has(name)) {
    // Re-entrant reference: `h`'s definition is on the in-flight compile
    // stack, so this is a (mutually) recursive call — emit the call by name.
    // The definition lands in `registry.defs` when its body compile
    // completes, and every def executes in the preamble before any call
    // runs, so the name is bound by call time (a mutually recursive def
    // referencing a later `const` is safe for the same reason). Runaway
    // recursion is backstopped by the JS call stack — a catchable
    // `RangeError` within milliseconds — consistent with compiled
    // unbounded `Loop`, which is likewise unguarded at run time.
    //
    // Where the target language forbids recursion outright — GLSL and WGSL
    // both do — there is no such call to emit: the name is not declared yet
    // and no shader compiler would accept it. Fail closed naming the
    // function instead.
    if (registry.compiling.has(name)) {
      if (registry.lowering?.noRecursion)
        throw new Error(
          `Could not compile \`${h}\`: a recursive (or mutually recursive) user-defined function ` +
            `has no lowering on target '${target.language ?? 'unknown'}' — ` +
            `the shader languages forbid recursion. Rewrite ${h} as a ` +
            `bounded loop (Sum/Product/Loop) before compiling.`
        );
      return name;
    }
    // The definitions stored while this one compiles may call it by name
    // (a re-entrant reference, see below); when its emission fails they
    // are removed, so that no definition keeps a call of a name that is
    // never emitted.
    const definedBefore = new Set(registry.defs.keys());
    registry.compiling.add(name);
    // The definition is shared by every call site, so it compiles with the
    // promotion of the compile mode, also when the call site is the value
    // of a real ascription (see `withPromotionUnsuppressed`).
    const suppressed = liftPromotionSuppression();
    // The definition is emitted at module level, outside the body that
    // calls it (`hideCheckedLocals`).
    const checkedLocals = hideCheckedLocals();
    try {
      const { params, bodyExpr, bodyTarget } = prepareUserFunctionBody(
        literal,
        target,
        registry,
        h
      );
      recordScalarParams(h, literal, bodyTarget);
      if (specialization?.pointWidths) {
        const widths = new Map<string, number>();
        literal.ops.slice(1).forEach((p, i) => {
          const width = specialization.pointWidths?.[i];
          const name = functionLiteralParameterName(p);
          if (width !== undefined && name !== undefined)
            widths.set(name, width);
        });
        recordConstructedPointParams(bodyTarget, widths);
      }
      // A target with its own definition lowering (the shader targets)
      // synthesizes the signature and compiles the body itself — a shader
      // function body is a STATEMENT position and its declaration needs
      // static parameter/return types, neither of which the JS arrow form
      // below can express. The `defs` entry still lands here, AFTER the body
      // compiled, so a nested dependency it emitted precedes it (GLSL
      // requires declaration before use).
      // The variant's extra parameters, one per prefix, and the body nodes
      // that read them. Every occurrence of a prefix expression in the
      // body — a conditional position included: reading a parameter that
      // is already bound evaluates nothing — gets the parameter's name as
      // its code override, so the body compile emits the name where it
      // would have emitted the expression. The names come from the
      // compilation's temporary-name counter, so they collide with nothing
      // in the artifact. The overrides are removed after the body compile,
      // whether or not it succeeds.
      const extraParams =
        prefixed?.prefixes.map(() => tempVar(bodyTarget)) ?? [];
      const overridden: Expression[] = [];
      if (prefixed !== undefined) {
        // Occurrences are matched by their MathJSON, not by `isSame`: the
        // prefixes were read off the engine's literal, while the body
        // compiled here may be the call-shape specialization's rebuild of
        // it, whose parameter symbols are bound in a different scope and
        // never `isSame` the originals. The MathJSON of a body node is the
        // same in both.
        const prefixJson = prefixed.prefixes.map((p) =>
          JSON.stringify(p.expr.json)
        );
        const matches: Array<[Expression, number]> = [];
        const match = (node: Expression): void => {
          if (!isFunction(node)) return;
          if (_codeOverrides.has(node)) return;
          const k = prefixed.prefixes.findIndex(
            (p, i) =>
              isFunction(p.expr) &&
              p.expr.operator === node.operator &&
              prefixJson[i] === JSON.stringify(node.json)
          );
          if (k >= 0) {
            matches.push([node, k]);
            return;
          }
          // The walk enters a `Block` (the canonical body is one) and
          // stops at every other binder, as the prefix analysis does.
          if (
            node.operator === 'Function' ||
            (node.operator !== 'Block' && node.operatorDefinition?.scoped)
          )
            return;
          for (const op of node.ops) match(op);
        };
        match(bodyExpr);
        // Every prefix must be read somewhere in THIS body. The prefixes
        // were read off the engine's literal, and a rebuilt literal can
        // differ from it; a prefix with no occurrence would be computed,
        // passed and never read, while the body computed it again inline.
        // Declining here sends the call site back to the ordinary call.
        const unread = prefixed.prefixes.findIndex(
          (_p, k) => !matches.some(([, j]) => j === k)
        );
        if (unread >= 0)
          throw new Error(
            `Could not compile \`${h}\`: the invariant prefix ` +
              `\`${prefixed.prefixes[unread].expr.toString()}\` has no ` +
              `occurrence in the emitted body, so no variant is emitted`
          );
        for (const [node, k] of matches) {
          _codeOverrides.set(node, extraParams[k]);
          overridden.push(node);
        }
      }
      const lowering = registry.lowering;
      if (lowering) {
        try {
          // The body of a target-lowered definition gets its OWN nested
          // harvest scope, exactly as the JavaScript arrow form below does:
          // the body is not part of the root tree, so without a harvest of
          // its own nothing inside it is ever a candidate and a subexpression
          // repeated in the body is emitted — and evaluated — once per
          // occurrence. A shader function body is a statement position with a
          // hoist sink, which is where the temporaries land
          // (`CompileTarget.cseMaterialize`). The Tycho code-generation audit
          // of 2026-09-08 measured this on the GLSL corpus: no `_fn_*` body
          // carried a single temporary, while bodies calling the same
          // function twice were common.
          const def = withEnforcedParams(literal, () =>
            withNestedCseHarvest(bodyExpr, bodyTarget, params, () =>
              lowering.define({
                id: h,
                name,
                params,
                body: bodyExpr,
                literal,
                parameterTypes: specialization?.types,
                target: bodyTarget,
                extraParams: prefixed?.prefixes.map((p, i) => ({
                  name: extraParams[i],
                  expr: p.expr,
                })),
              })
            )
          );
          // Wave 3 of the 2026-08-12 contradicted-declaration ruling, as a
          // BACKSTOP on what `define` was willing to emit. A lowering that
          // synthesizes a STATIC return type takes it from the body's
          // declared/ascribed type, while the `return` statement emits what the
          // body actually builds — so a scalar-declared, collection-
          // constructing body yields a declaration that disagrees with its own
          // return value (`float _fn_a(float t) { return vec2(…); }`), source
          // no shader compiler accepts, shipped behind `success: true` because
          // nothing downstream re-checks the preamble. Waves 1–2 gate the
          // CONSUMING positions of such a call; a bare `a(u)` has no consuming
          // head, so the definition still went out.
          //
          // Deliberately AFTER `define`, not before: every target-specific
          // decline (`the return value has no static GLSL type`, the `At`
          // aggregate-index diagnostic, the identifier checks) throws from
          // inside `define` and is strictly more informative about ITS shape.
          // Running last means this gate only ever speaks for a definition that
          // emitted cleanly — exactly the case nothing else catches — and never
          // masks a better message. The `defs` entry is still written after the
          // body compiled, so a nested dependency it emitted precedes it (GLSL
          // requires declaration before use). A throw here does not always end
          // the compilation: when the definition was emitted because an
          // analysis asked for the lane of a call before the call compiled
          // (`userCallDefinition`), the throw is caught there and the call
          // takes another route (it is inlined, or its own compilation fails).
          // The nested dependencies that this emission already wrote into
          // `defs` are then removed if nothing references them
          // (`pruneUnreferencedVariantBases`, which receives every definition
          // written during such an emission).
          //
          // The gate lives in this shared emission path keyed on a property the
          // TARGET declares, rather than inside the GPU `define` hook: the
          // contradiction is a property of the FUNCTION, the same one waves 1–2
          // read from the call site, and every emission route (bare call, value
          // position, nested dependency) funnels through here. Targets without
          // a static return type are structurally untouched — JavaScript (no
          // lowering at all) keeps the bare `a(u)` shape the ruling protects,
          // interval-js uses that same untyped arrow form, and a future
          // dynamically-typed definition lowering (a Python `def` — the only
          // user-function lowering Python could gain; it declines with "Unknown
          // operator" today) would have no return type to contradict.
          if (
            lowering.staticReturnType === true &&
            isContradictedScalarFunctionBody(bodyExpr)
          )
            throw new Error(
              `Could not compile \`${h}\`: the declaration of '${h}' says it returns a scalar ` +
                `('${bodyExpr.type.toString()}'), but its body constructs a ` +
                `collection. The declaration is contradicted by the body, so ` +
                `the emitted definition would declare a scalar return type ` +
                `over a collection return value. Fix the declaration (e.g. ` +
                `'-> list<number>') or evaluate instead.`
            );
          assertExtraParamsRead(h, def, extraParams, 1);
          (registry.literals ??= new Map()).set(name, literal);
          registry.defs.set(name, def);
          return name;
        } finally {
          for (const node of overridden) _codeOverrides.delete(node);
        }
      }
      // A list-building recursion is emitted as a loop over its step
      // instead of the natively recursive arrow below, when the target and
      // the definition allow it (`emitListRecursionLoop`). A definition the
      // loop form declines takes the ordinary arrow.
      //
      // A call-shape specialization whose key is `h` itself is the SCALAR
      // definition: the call has only scalar arguments, and the
      // specialization is emitted under the ordinary name, so it is the
      // definition that every call of `h` reaches. A function with no
      // declared signature (assigned with no declaration, or declared
      // `function`) comes here: its parameter is open (`unknown`), and the
      // scalar argument of the call narrows it to `number`. The loop is
      // then built from the function's own literal, not from the rebuilt
      // copy: `listRecursionPlan` recognizes a recursive call only when
      // the call reaches the literal it is given, and the copy is not the
      // value of `h`. That is also the definition this name had before
      // the parameter was narrowed, so the loop gives the values of the
      // generic definition. When the loop form declines, the copy is
      // emitted as the ordinary arrow below. Any other specialization (a
      // range, a point, a list or a complex copy) has its own name and
      // keeps the arrow.
      const loopLiteral =
        specialization === undefined
          ? literal
          : specialization.key === h
            ? userFunctionLiteral(literal.engine as unknown as ComputeEngine, h)
            : undefined;
      if (lowering === undefined && loopLiteral !== undefined) {
        const loop = emitListRecursionLoop(
          h,
          name,
          loopLiteral,
          target,
          registry,
          prefixed !== undefined
        );
        if (loop === 'declined-variant') return undefined;
        if (loop !== undefined) {
          // The loop form returns a list: its value is not a scalar.
          userFunctionLanes(registry).byName.set(loop, undefined);
          return loop;
        }
      }
      // Each emitted definition body gets its OWN nested harvest scope in
      // the same session (§5.4): its own regions and candidates — the body
      // is not part of the root tree — but the same naming counter, so temp
      // names never collide across the artifact. Duplication inside a called
      // definition is therefore recovered once, in the emitted function.
      // The body compiles under a frame binding each complex-lane parameter
      // to `true`, so every operand analysis inside it — and so the emitted
      // arithmetic — treats that parameter as the `{re, im}` object the
      // call site actually passes. The frame is ISOLATED (it replaces the
      // enclosing `_localComplex` frames instead of stacking on them): an
      // emitted definition is a module-level function, so when this
      // emission is triggered from inside a `Block` or another definition's
      // body, the caller's local shapes must not reach this body — a
      // global read here that happens to share a name with a caller's
      // complex local would otherwise be lowered complex over its plain
      // numeric value. This is the same discipline the GPU definition
      // lowering applies to its own parameter frame.
      // A parameter the signature DECLARES complex is complex in the body
      // for every call site, so it is entered here whether or not this
      // emission carries call-site lanes. Without it the body read the
      // parameter in the real lane while the call site handed it a
      // `{ re, im }` — `_fn_Q = (z) => ({ re: z + 0, im: 1 })` over an
      // object, i.e. `re: '[object Object]0'` behind `success: true`.
      //
      // This is not radical PROMOTION and does not go through
      // `promotesRadicalToComplex`: nothing is being inferred complex from an
      // operand's sign. The author WROTE `(complex) -> complex`, and the
      // call site is made to honour it (`coerceToComplex` /`_SYS.cplx`), so
      // the lane here is that declaration being read back — which is why
      // the Tycho-190 rule ("the lane comes from the operand, never the
      // node type") is not in tension with it.
      // Whether the emitted body returns a `{re, im}` object by
      // construction, decided inside the same frames the body compiled
      // under (`complexShapedEmission`), so a call site can skip the
      // idempotent lift-at-use wrap (`liftWideResult`).
      let complexShaped = false;
      let body: TargetSource;
      // A promotion recorded while this body compiles belongs to this
      // definition, not to the code that asked for it: it is recorded on
      // the definition (`promotedDefinitions`), and the report counts it
      // only while the definition is in the emitted code (see
      // `pruneUnreferencedVariantBases`).
      const outerPromoted = CompilerState._promoted;
      CompilerState._promoted = false;
      const promotedDefs = memoFor(promotedDefinitions, registry);
      promotedDefs.delete(name);
      try {
        body = emitWithRecursiveLaneRetry(registry, name, () => {
          const frames = {
            complex: new Map<string, boolean>(),
            vector: new Map<string, number>(),
          };
          addDeclaredComplexParams(h, literal, target, frames);
          return core.withLocalShapeFrame(
            frames.complex,
            frames.vector,
            () =>
              withEnforcedParams(literal, () =>
                withNestedCseHarvest(bodyExpr, bodyTarget, params, () => {
                  const code = compileDefinitionBody(bodyExpr, bodyTarget);
                  complexShaped = complexShapedEmission(bodyExpr);
                  recordUserFunctionLane(bodyTarget, h, name, bodyExpr);
                  return code;
                })
              ),
            true
          );
        });
      } finally {
        for (const node of overridden) _codeOverrides.delete(node);
        if (CompilerState._promoted) promotedDefs.set(name, true);
        CompilerState._promoted = outerPromoted;
      }
      assertExtraParamsRead(h, body, extraParams, 0);
      if (complexShaped) (registry.complexShaped ??= new Set()).add(h);
      (registry.literals ??= new Map()).set(name, literal);
      const statements = javascriptStatements(bodyTarget);
      const allParams = [...params, ...extraParams];
      registry.defs.set(
        name,
        statements?.has(body)
          ? `const ${name} = (${allParams.join(', ')}) => { ${statements.functionBody(body)} };`
          : `const ${name} = (${allParams.join(', ')}) => ${body};`
      );
      // A variant is never memoized: the last-call memo keys on the
      // ordinary parameters, and a variant's value depends on the extra
      // ones as well.
      if (
        prefixed === undefined &&
        lastCallMemoEligible(h, bodyExpr, params, bodyTarget, complexShaped)
      )
        (registry.memoizable ??= new Map()).set(name, { params, body });
    } catch (e) {
      removeDefinitionsAddedSince(registry, definedBefore);
      throw e;
    } finally {
      registry.compiling.delete(name);
      restorePromotionSuppression(suppressed);
      CompilerState._checkedLocals = checkedLocals;
    }
  }

  return name;
}

/**
 * Remove, in place from `registry.defs`, every emitted invariant-prefix
 * VARIANT and every BASE of one (`registry.variantBases`, recorded by
 * `ensureUserFunctionVariantEmitted`) that nothing in the artifact
 * references: neither the root code `rootCode` nor another definition
 * names it. A repetition site that hoists a callee's prefix calls the
 * variant, not the base, but the base was already emitted by the
 * call-shape specialization the site's first call went through; and on a
 * target with its own call lowering a variant can be emitted and then
 * refused at the call site, which falls back to the base. The definitions
 * emitted because an analysis asked for the lane of a call before the
 * call was compiled (`userCallDefinition`) are removed on the same terms:
 * the call may have been folded, or compiled through another route. A
 * definition's declaration has no effect on any target, so an
 * unreferenced one is dead text. A hoisted constant list literal
 * (`registry.listLiterals`, recorded by `hoistConstantListLiteral`) is
 * removed on the same terms: the literal is emitted when its `List` node
 * compiles, and a parent that then folds the read of a literal cell to the
 * cell itself leaves the local unread. Only these definitions are removed: every
 * other definition is kept whether or not the artifact names it, so an
 * artifact without them is emitted exactly as before. Repeated to a fixed point, since
 * removing one definition can leave another that only it referenced
 * unreferenced in turn. Called by each target where it assembles its
 * preamble, before any pass that counts references to a definition.
 */
export function pruneUnreferencedVariantBases(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  rootCode: string
): void {
  const defs = registry.defs;
  const candidates = new Set<string>(_userFunctionLanes.get(registry)?.onAsk);
  for (const [variant, base] of registry.variantBases ?? []) {
    candidates.add(variant);
    candidates.add(base);
  }
  for (const name of registry.listLiterals?.values() ?? [])
    candidates.add(name);
  if (candidates.size === 0) return;
  for (let changed = true; changed;) {
    changed = false;
    for (const name of candidates) {
      if (!defs.has(name)) continue;
      const named = identifierPattern(name);
      if (named.test(rootCode)) continue;
      let referenced = false;
      for (const [other, code] of defs)
        if (other !== name && named.test(code)) {
          referenced = true;
          break;
        }
      if (referenced) continue;
      defs.delete(name);
      changed = true;
    }
  }
  // A removed definition is not in the emitted code, so a promotion in
  // its body does not describe that code: compute the report again. The
  // report is only lowered here, never raised.
  const basis = CompilerState._lastReportBasis;
  if (
    basis !== undefined &&
    basis.registry === registry &&
    CompilerState._lastReport.promoted &&
    !basis.promotedOutsideDefinitions &&
    !hasPromotedDefinition(registry)
  )
    CompilerState._lastReport = {
      mode: basis.complexDiscipline ? 'complex' : 'strict',
      promoted: false,
    };
}

/**
 * The occurrence state machine (§6.1), interposed between `compile()` and
 * the emission proper.
 *
 * Three states per candidate, per region instance: unseen → compile the
 * right-hand side through (so it does not self-reference), then append the
 * binding and emit the name; `'defining'` → compile through (we are inside
 * the candidate's own right-hand side); `'bound'` → emit the name, an
 * identifier, atomic at any precedence.
 *
 * Appending AFTER the right-hand side compiles is what makes the binding
 * list dependency-ordered for free: a nested candidate's binding was
 * appended while the outer one's right-hand side was being compiled.
 */
export function compileWithCse(
  expr: Expression,
  target: CompileTarget<Expression>,
  prec: number
): TargetSource {
  const session = target.cse;
  if (session === undefined || !session.enabled)
    return core._compileInner(expr, target, prec);

  const top = session.instances[session.instances.length - 1];
  if (top === undefined) return core._compileInner(expr, target, prec);

  // Emission has entered a binding scope this instance does not describe (a
  // binder body with no push/pop site of its own): compile the subtree under
  // a blind instance, so unknown territory degrades to the pre-CSE emission
  // instead of resolving a name whose value would be captured.
  if (top.boundVars !== target.boundVars)
    return withCseRegion(target, undefined, () =>
      core._compileInner(expr, target, prec)
    );

  // A temporary an ENCLOSING instance has already bound for this structure
  // is in scope here and already evaluated: referencing it evaluates
  // nothing new, so it is preferred over binding (or inlining) the
  // structure again in this instance.
  const available = availableCseBinding(session, expr);
  if (available !== undefined) return available;

  // A statement-declaring target cannot place a new declaration inside a
  // lazy expression that runs conditionally: a declaration hoisted out of
  // it would run unconditionally. The exception is the captured branch of
  // a conditional's statement form, a statement position of its own where
  // the declaration is captured into the branch — `cseCanMaterialize`
  // reports it. Already-bound enclosing values remain usable above either
  // way.
  if (
    target.cseMaterialize &&
    target.cseCanMaterialize?.(target) !== true &&
    session.instances.some(
      (instance) => cseRegionOf(instance)?.kind === 'lazy-operand'
    )
  )
    return core._compileInner(expr, target, prec);

  const candidate = candidateAt(cseRegionOf(top), expr);
  if (candidate === undefined) return core._compileInner(expr, target, prec);

  const inlineCode = _cseInlineCode.get(top)?.get(candidate);
  if (inlineCode !== undefined)
    return prec === 0 ? inlineCode : `(${inlineCode})`;

  const state = top.state.get(candidate);
  if (state === 'bound') return top.names.get(candidate)!;
  if (state === 'defining') return core._compileInner(expr, target, prec);

  top.state.set(candidate, 'defining');
  // The right-hand side is folded like any other emission (`foldEmitted`):
  // `compile()` folds only what `compileWithCse` RETURNS, and for a bound
  // candidate that is the temporary's name, never its code.
  const rhs = foldEmitted(expr, target, core._compileInner(expr, target, 0));
  // A target whose multi-statement constructs are bare statement sequences
  // (Python, GPU) has no expression-position form for such a right-hand
  // side. Leave the candidate `'defining'`: every occurrence then compiles
  // inline, exactly as before — a lost optimization, never invalid source.
  // The right-hand side above was compiled at precedence 0; the CALLER's
  // precedence is what this position needs, so mirror the `'defining'`
  // branch and recompile when they differ.
  if (target.bareStatementBlocks === true && rhs.includes('\n'))
    return prec === 0 ? rhs : core._compileInner(expr, target, prec);
  // A right-hand side that folded to a constant (`cseInlineConstant`) is
  // not bound either: a temporary would hide the constant from the fold of
  // every expression that reads it. The candidate stays `'defining'` for
  // the same reason as above, so each later occurrence compiles to the
  // same constant code. Cache that code in this instance: compiling every
  // occurrence again would expand all paths through a shared graph.
  if (target.cseInlineConstant?.(rhs) === true) {
    let inlined = _cseInlineCode.get(top);
    if (inlined === undefined) {
      inlined = new Map();
      _cseInlineCode.set(top, inlined);
    }
    inlined.set(candidate, rhs);
    return prec === 0 ? rhs : `(${rhs})`;
  }

  const name = cseTempVar(target);
  if (target.cseMaterialize) {
    if (!target.cseMaterialize(expr, name, rhs, target))
      return prec === 0 ? rhs : core._compileInner(expr, target, prec);
  } else top.bindings.push([name, rhs]);
  top.state.set(candidate, 'bound');
  top.names.set(candidate, name);
  return name;
}
// Install the hubs (see compiler-core-hooks.ts).
const hubs: CoreHooks = {
  compile,
  isComplexValued,
  foldCostEstimate,
  linearAlgebraOperandLane,
  bigOpBoundConstant,
  compileExpr,
  unprovenRadicalCount,
  compileLoopBody,
  shaderSelectionStatement,
  elementComplexness,
  operandElementLane,
  constantFoldValue,
  conditionNode,
  noteLocalComplex,
  walkMatchShape,
  walkConstructorPattern,
  kleeneConditionParts,
  emitFunctionLiteralDefinition,
  ensureUserFunctionEmitted,
  aggregateComponentCount,
  withLocalShapeFrame,
  realOperandGuard,
  promotesRadicalToComplex,
  withCallerBindingsHidden,
  _compileInner,
  compileWithCse,
  ensureSpecializedUserCallEmitted,
  pruneUnreferencedVariantBases,
  hasCodeOverride,
};
Object.assign(core, hubs);
