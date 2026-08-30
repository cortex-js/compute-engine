import type {
  BoxedDefinition,
  BoxedValueDefinition,
} from './types-definitions.js';
import type { IComputeEngine as ComputeEngine } from './types-engine.js';
import type { Expression, ExpressionInput } from './types-expression.js';
import type {
  Assumption as KernelAssumption,
  AssignValue as KernelAssignValue,
  BoxedRule as KernelBoxedRule,
  BoxedRuleSet as KernelBoxedRuleSet,
  EvaluateOptions as KernelEvaluateOptions,
  EvalContext as KernelEvalContext,
  ExpressionMapInterface as KernelExpressionMapInterface,
  FactRecord as KernelFactRecord,
  FactSubject as KernelFactSubject,
  Rule as KernelRule,
  RuleConditionFunction as KernelRuleConditionFunction,
  RuleFunction as KernelRuleFunction,
  RuleReplaceFunction as KernelRuleReplaceFunction,
  RuleStep as KernelRuleStep,
  RuleSteps as KernelRuleSteps,
  ExplainStep as KernelExplainStep,
  Explanation as KernelExplanation,
  Scope as KernelScope,
  InspectableScope as KernelInspectableScope,
  NarrowingSink as KernelNarrowingSink,
  ScopeDeclaration as KernelScopeDeclaration,
  ScopeNarrowing as KernelScopeNarrowing,
} from './types-kernel-evaluation.js';

export type {
  AssumeResult,
  ExplainOperation,
  ExplainVerbosity,
} from './types-kernel-evaluation.js';

/**
 * Options for evaluating boxed expressions.
 *
 * This is the compute-engine-specialized form of the generic kernel type.
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = KernelEvaluateOptions;

/**
 * Map-like interface keyed by boxed expressions.
 *
 * @category Assumptions
 */
export type ExpressionMapInterface<U> = KernelExpressionMapInterface<
  U,
  Expression
>;

/** A single rule application step with provenance. */
export type RuleStep = KernelRuleStep<Expression>;

/** A list of rule application steps. */
export type RuleSteps = KernelRuleSteps<Expression>;

/** One step of an `Explanation`. See `expr.explain()`. */
export type ExplainStep = KernelExplainStep<Expression>;

/** A structured step-by-step explanation. See `expr.explain()`. */
export type Explanation = KernelExplanation<Expression>;

/**
 * Assumption predicates bound to this compute engine.
 *
 * @category Assumptions
 */
export type Assumption = KernelAssumption<Expression, ComputeEngine>;

/**
 * Rule replacement callback specialized to boxed expressions.
 *
 * @category Rules
 */
export type RuleReplaceFunction = KernelRuleReplaceFunction<Expression>;

/**
 * Rule condition callback with access to the compute engine.
 *
 * @category Rules
 */
export type RuleConditionFunction = KernelRuleConditionFunction<
  Expression,
  ComputeEngine
>;

/**
 * Dynamic rule callback.
 *
 * @category Rules
 */
export type RuleFunction = KernelRuleFunction<Expression>;

/**
 * Rule declaration specialized to boxed expression and compute engine types.
 *
 * @category Rules
 */
export type Rule = KernelRule<Expression, ExpressionInput, ComputeEngine>;

/** A boxed/normalized rule form. */
export type BoxedRule = KernelBoxedRule<Expression, ComputeEngine>;

/** Collection of boxed rules. */
export type BoxedRuleSet = KernelBoxedRuleSet<Expression, ComputeEngine>;

/**
 * Assignable value for `ce.assign()`.
 *
 * @category Compute Engine
 */
export type AssignValue = KernelAssignValue<
  Expression,
  ExpressionInput,
  ComputeEngine
>;

/** Lexical scope specialized to boxed definitions. */
export type Scope = KernelScope<BoxedDefinition>;

/** A caller-owned, readable lexical scope — the product of
 * `ce.createScope()`. Specialized to boxed definitions. */
export type InspectableScope = KernelInspectableScope<BoxedDefinition>;

/** One entry of an {@link InspectableScope} harvest. */
export type ScopeDeclaration = KernelScopeDeclaration<BoxedDefinition>;

/** One outer-definition narrowing observed by an {@link InspectableScope}. */
export type ScopeNarrowing = KernelScopeNarrowing<BoxedDefinition>;

/** Where `_infer()` routes narrowing captures. @internal */
export type NarrowingSink = KernelNarrowingSink<BoxedDefinition>;

/** Evaluation context specialized to this engine/runtime model. */
export type EvalContext = KernelEvalContext<
  Expression,
  BoxedDefinition,
  BoxedValueDefinition
>;

/**
 * One subject of an assumption, specialized to this engine/runtime model.
 *
 * @category Assumptions
 */
export type FactSubject = KernelFactSubject<BoxedValueDefinition>;

/**
 * One assertion recorded by `assume()`, specialized to this engine/runtime
 * model. The assumptions store maps a normalized fact to a list of these.
 *
 * @category Assumptions
 */
export type FactRecord = KernelFactRecord<BoxedValueDefinition>;
