import type { BoxedDefinition } from './types-definitions';
import type { IComputeEngine as ComputeEngine } from './types-engine';
import type { BoxedExpression, ExpressionInput } from './types-expression';
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
export type EvaluateOptions = KernelEvaluateOptions<BoxedExpression>;

/**
 * Map-like interface keyed by boxed expressions.
 *
 * @category Assumptions
 */
export type ExpressionMapInterface<U> = KernelExpressionMapInterface<
  U,
  BoxedExpression
>;

/** A single rule application step with provenance. */
export type RuleStep = KernelRuleStep<BoxedExpression>;

/** A list of rule application steps. */
export type RuleSteps = KernelRuleSteps<BoxedExpression>;

/**
 * Assumption predicates bound to this compute engine.
 *
 * @category Assumptions
 */
export type Assumption = KernelAssumption<BoxedExpression, ComputeEngine>;

/**
 * Rule replacement callback specialized to boxed expressions.
 *
 * @category Rules
 */
export type RuleReplaceFunction = KernelRuleReplaceFunction<BoxedExpression>;

/**
 * Rule condition callback with access to the compute engine.
 *
 * @category Rules
 */
export type RuleConditionFunction = KernelRuleConditionFunction<
  BoxedExpression,
  ComputeEngine
>;

/**
 * Dynamic rule callback.
 *
 * @category Rules
 */
export type RuleFunction = KernelRuleFunction<BoxedExpression>;

/**
 * Rule declaration specialized to boxed expression and compute engine types.
 *
 * @category Rules
 */
export type Rule = KernelRule<
  BoxedExpression,
  ExpressionInput,
  ComputeEngine
>;

/** A boxed/normalized rule form. */
export type BoxedRule = KernelBoxedRule<BoxedExpression, ComputeEngine>;

/** Collection of boxed rules. */
export type BoxedRuleSet = KernelBoxedRuleSet<BoxedExpression, ComputeEngine>;

/**
 * Assignable value for `ce.assign()`.
 *
 * @category Compute Engine
 */
export type AssignValue = KernelAssignValue<
  BoxedExpression,
  ExpressionInput,
  ComputeEngine
>;

/** Lexical scope specialized to boxed definitions. */
export type Scope = KernelScope<BoxedDefinition>;

/** Evaluation context specialized to this engine/runtime model. */
export type EvalContext = KernelEvalContext<BoxedExpression, BoxedDefinition>;
