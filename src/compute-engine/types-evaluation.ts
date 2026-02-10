import type { BoxedDefinition } from './types-definitions';
import type { IComputeEngine as ComputeEngine } from './types-engine';
import type { Expression, ExpressionInput } from './types-expression';
import type {
  Assumption as KernelAssumption,
  AssumeResult,
  AssignValue as KernelAssignValue,
  BoxedRule as KernelBoxedRule,
  BoxedRuleSet as KernelBoxedRuleSet,
  EvaluateOptions as KernelEvaluateOptions,
  EvalContext as KernelEvalContext,
  ExpressionMapInterface as KernelExpressionMapInterface,
  Rule as KernelRule,
  RuleConditionFunction as KernelRuleConditionFunction,
  RuleFunction as KernelRuleFunction,
  RuleReplaceFunction as KernelRuleReplaceFunction,
  RuleStep as KernelRuleStep,
  RuleSteps as KernelRuleSteps,
  Scope as KernelScope,
} from './types-kernel-evaluation';

export type { AssumeResult };

/**
 * Options for evaluating boxed expressions.
 *
 * This is the compute-engine-specialized form of the generic kernel type.
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = KernelEvaluateOptions<Expression>;

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
export type Rule = KernelRule<
  Expression,
  ExpressionInput,
  ComputeEngine
>;

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

/** Evaluation context specialized to this engine/runtime model. */
export type EvalContext = KernelEvalContext<Expression, BoxedDefinition>;
