/** Internal opt-in scalar slice; intentionally absent from target registration. */
import type { Type } from '../../common/type/types.js';
import type { Expression } from '../global-types.js';
import type {
  CompilationOptions,
  CompilationResult,
  CompileTarget,
} from './types.js';
import {
  hasInferredType,
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
  readBinding,
  resolvedValueDefinition,
} from '../boxed-expression/type-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { parseType } from '../../common/type/parse.js';
import {
  finitePartOfType,
  functionResult,
  indexElementType,
  isNonRealNumber,
  isPointElementType,
} from '../../common/type/utils.js';
import { resolveDerivativeFunctionLiteral } from '../derivative-function-literal.js';
import {
  assumedRealNonNegative,
  fixedLogBase,
  realPowerExponent,
  withoutNaNMember,
} from './compile-real-analysis.js';
import {
  negativeBaseRealPow,
  principalComplexPow,
} from './constant-folding.js';
import { asRational } from '../boxed-expression/numerics.js';
import { realPowerBranchTerms } from '../numerics/real-power.js';
import { MAX_MATRIX_POWER_EXPONENT } from '../numerics/value-scaled-caps.js';
import { flattenMayOpenKeptValue } from '../library/linear-algebra.js';
import { NON_NEGATIVE_REAL_TYPE } from './compiler-naming.js';
import {
  JavaScriptTarget,
  integrateDepth,
  isIndexedCollectionOperand,
  isNonFiniteBound,
  logSpaceOpaque,
  type JavaScriptBody,
  type JavaScriptBodyEmitter,
  type JavaScriptBodyNames,
} from './javascript-target.js';
import { BaseCompiler } from './base-compiler.js';
import { exactRationalDivisor } from './compiler-type-facts.js';
import {
  SHIFT_JUMP_HEADS,
  closedExactJump,
  foldValueImpure,
  tryConstantFold,
} from './compile-folding.js';
import {
  foldCaptureRefusal,
  foldedValueInRadians,
} from './compile-folded-values.js';
import { exactDoubleValue } from '../numeric-value/exact-integer-value.js';
import {
  hasUnknownsWithMemo,
  type ReferencesMemo,
} from '../boxed-expression/abstract-boxed-expression.js';
import { CompilerState } from './compiler-state.js';
import { realOnlyLoweringOf } from './compiler-core.js';
import { core } from './compiler-core-hooks.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import {
  declaredTypeSource,
  declareTypeOperand,
  declareValueOperand,
} from './compile-declarations.js';
import {
  userFunctionLiteral,
  userFunctionParamsAreScalar,
  userFunctionSignature,
} from './compile-assignment-checks.js';
import { paramsAreScalar } from '../boxed-expression/boxed-function.js';
import { userFunctionSignatureIsInferred } from './compile-callbacks.js';
import { rangeSpecializedParameterTypes } from './compile-user-specialization.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { INVERSE_TRIG_OPERATORS } from '../symbolic/angular-unit.js';
import { derivativeClosedForm } from './derivative-closed-form.js';
import { jetDerivativeTarget } from './jet-derivative.js';
import { storedDefinitions } from './compile-integrals.js';
import { isUserDefinedFunction } from './compile-statements.js';
import { nonScalarEnclosingBindings } from '../boxed-expression/enclosing-binding-result-type.js';
import { isLibraryOperator, systemScopeBinding } from './builtin-callback.js';
import { isOpaqueVarsSource, varsObjectSpelling } from './cse.js';
import { entryIsPure, inferSourcePurity } from './function-purity.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';
import {
  typeFragment,
  walkIf,
  walkBlock,
  walkAssign,
  walkBreak,
  walkCountedLoop,
  walkAggregate,
  fragmentTypeToString,
  fragmentScopeBinds,
  hasShortText,
  nodeText,
  type FragmentConversion,
  type FragmentDeclaredInput,
  type FragmentElementType,
  type FragmentListType,
  type FragmentValueFacts,
  type FragmentValueType,
  type FragmentDefinition,
  type FragmentRule,
  type FragmentFunction,
  type FragmentScope,
  type FragmentFacts,
  type FragmentAnnotation,
  type FragmentContext,
  type FragmentWalker,
} from './fragment.js';
import {
  attachScalarFragment,
  type ScalarRepresentation,
  type ScalarFragmentHelper,
  type ScalarFragmentCapture,
} from './javascript-fragment-facts.js';
import { shallowApplicationEffects } from '../boxed-expression/effects-of.js';
import {
  isCoFiniteEffects,
  isImpurityLabel,
  isPureComputedEffects,
} from '../../common/type/effects.js';
import type {
  EffectFact,
  IRHostBinding,
  IRProgram,
  IRState,
} from './structured-ir.js';
import { verifyJavaScriptProgram } from './javascript-structured-policy.js';
import {
  COLLECTION_HEADS,
  FOLD_OPERATORS,
  FUNCTION_OPERAND_HEADS,
  functionOperandOf,
  functionOperandParts,
  hasRows,
  literalSeedOf,
  matrixResultCanBeAbsent,
  recordUserFunctionOperand,
  userFunctionOperandSymbol,
  lowerStructuredProgram,
  MAPPED_OPERATORS,
  valueType as structuredValueType,
  piMultipleFactor,
  powerForm,
  preparedNodesOf,
  randomDomainOf,
  recordStructuredPreparation,
  STRUCTURED_OPERATION_LIMIT,
  StructuredLimitError,
  StructuredDeclineError,
  structuredPreparationOf,
  type StructuredCapture,
  type StructuredInput,
  decidedBranch,
  FUNCTIONS,
  type BroadcastForm,
  type RealCallForm,
  type StructuredForm,
  type StructuredIntegral,
  type StructuredNumericRoutine,
  type StructuredPreparation,
} from './javascript-structured-lower.js';
import { initialPanelsForDimensions } from '../numerics/gauss-kronrod.js';
import { complexContinuation } from './complex-continuation.js';
import { logSpaceProduct } from '../symbolic/log-space-product.js';
import { staticCollectionWidth } from './compile-linear-algebra.js';
import { linearAlgebraLane } from './compile-lanes.js';
import { MIN_UNROLLED_WIDTH } from './fixed-width-unroll.js';
import { emitStructuredProgram } from './javascript-structured-emit.js';
import {
  lowerBigintProgram,
  StructuredBigintRefusal,
} from './javascript-structured-bigint.js';
import { bigintLaneAnalysisFor } from './compile-bigint-lane.js';
import {
  analyzeExecution,
  type ExecutionAnalysis,
} from './structured-execution.js';
import { CompileDeclineError, isCompileDeclineError } from './diagnostics.js';
import { CancellationError } from '../../common/interruptible.js';
import { isShippableCode } from '../kernel-pool.js';

// Each operator states its own rule for a real or a complex result. There
// is no shared default: a rule that reads "a complex operand gives a complex
// result" is right for `Add` and `Negate`, and wrong for an operator whose
// result can be complex for real operands, or real for complex operands.

/** `Add`: the sum is complex when one of its operands is complex; each real
 *  operand of a complex sum is converted (`real-to-complex`). Otherwise the
 *  sum is real. Reads only the facts of the operands. */
const addRule = {
  walk: (node, scope, context, w) => {
    const lane = (isFunction(node) ? node.ops : []).some(
      (operand) => w.value(operand, scope, context).representation === 'complex'
    )
      ? 'complex'
      : 'real';
    return w.signatures(node, scope, context, [
      { operands: [lane], rest: lane, result: lane },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/** `Add` on the structured route: the rule of `addRule`, but a real
 *  operand of a complex sum keeps its representation (no `real-to-complex`
 *  conversion). The emitter adds it to the real part only, as the existing
 *  emitter does (`Add` in `javascript-target.ts`): `z + 1` is
 *  `{ re: z.re + 1, im: z.im }`, so a `-0` imaginary part of `z` stays
 *  `-0`, where `z.im + 0` would give `0`. The existing route keeps
 *  `addRule`, whose conversions its emitter checks. */
const structuredAddRule = {
  walk: (node, scope, context, w) => {
    const facts = operandFacts(node, scope, context, w);
    if (!facts.some((f) => f.representation === 'complex'))
      return addRule.walk(node, scope, context, w);
    if (facts.some((f) => f.type.kind === 'boolean'))
      return w.refuse(
        node,
        'signature',
        'Add with a boolean operand is not in the structured route'
      );
    return w.valueFacts(
      node,
      { kind: 'complex' },
      facts.map((f) => w.convert(f, f.type)!)
    );
  },
} satisfies FragmentRule<ScalarRepresentation>;

/** `Negate`: complex when its one operand is complex, otherwise real. Reads
 *  only the facts of the operand. */
const negateRule = {
  walk: (node, scope, context, w) => {
    const operand = isFunction(node) ? node.ops[0] : undefined;
    const lane =
      operand !== undefined &&
      w.value(operand, scope, context).representation === 'complex'
        ? 'complex'
        : 'real';
    return w.signatures(node, scope, context, [
      { operands: [lane], result: lane },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/**
 * `Sqrt` on the existing route is the one operator whose result is still
 * decided by the reader of the existing compiler, `isComplexValued()`. The
 * square root of a real operand is complex when the operand is provably
 * negative, or, in the `complex` mode, when its sign is not known. The
 * reader depends on the compiler state of the compilation, so the
 * annotation of a program with a `Sqrt` is built under that state
 * (`withOutermostCompilerState()`). The structured route decides the same
 * rule from facts (`structuredRadicalRule()`).
 */
const sqrtRule = {
  walk: (node, scope, context, w) => {
    const lane = BaseCompiler.isComplexValued(node) ? 'complex' : 'real';
    return w.signatures(node, scope, context, [
      { operands: [lane], result: lane },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

const definition: FragmentDefinition<ScalarRepresentation> = {
  name: 'JS scalar',
  rules: {
    Add: addRule,
    Negate: negateRule,
    Sqrt: sqrtRule,
    If: { walk: walkIf },
  },
  typeOfSymbol(node) {
    const type = node.type.type;
    if (isSubtype(type, 'boolean')) return { kind: 'boolean' };
    if (isSubtype(type, 'integer')) return { kind: 'integer' };
    if (isSubtype(type, 'real')) return { kind: 'real' };
    if (isSubtype(type, 'complex')) return { kind: 'complex' };
    return undefined;
  },
  representationOfBinding: representation,
  representationOfValue: representation,
  functionOf: () => undefined,
};
function representation(type: {
  kind: string;
}): ScalarRepresentation | undefined {
  if (type.kind === 'integer' || type.kind === 'real') return 'number';
  if (type.kind === 'boolean' || type.kind === 'complex') return type.kind;
  return undefined;
}

//
// The rules of the structured route
//
// The operators below are admitted only by the structured route
// (`ScalarFragmentJavaScriptTarget` constructed with `'structured'`). The
// existing emitter of the fragment does not have their rules, so the
// existing route refuses them as before ("unsupported head").
//

/**
 * Whether `expr` has no unknown in `scope`: every symbol in it is a
 * constant or has a value, and none is a name that a form binds in `scope`
 * (a parameter, a local, an index, the variable of an integral, a
 * derivative or a limit). The existing compiler reads a bound name as a
 * variable also when the engine has a value for it
 * (`isNameBoundByCompilation()` in `knownExponentPower()`); `unknowns`
 * leaves out such a name when its symbol is the global one (the variable
 * of `D` and of a rewritten literal).
 */
function hasNoUnknown<R>(expr: Expression, scope: FragmentScope<R>): boolean {
  return (
    expr.unknowns.length === 0 &&
    !expr.symbols.some((name) => fragmentScopeBinds(scope, name))
  );
}

/** The facts of the operands of `node`, in order. */
function operandFacts(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
) {
  return (isFunction(node) ? node.ops : []).map((operand) =>
    w.value(operand, scope, context)
  );
}

/**
 * The literal that the existing compiler writes in place of the node `node`
 * with `constantFold: false`, or `undefined` when it writes the code of the
 * node. The existing compiler folds a function whose result jumps at a point
 * (`JUMP_FUNCTIONS`: `Floor`, `Mod`, `Sign`, the comparisons, …) applied to
 * closed exact operands (`closedExactJump()` in `compile-folding.ts`) with
 * the exact value of its operands, also with `constantFold: false`
 * (`tryConstantFold()`): with the captures `N = 1/3` and
 * `M = 3333333333333333/10^16`, `Less(M, N)` is `true`, and the comparison
 * of their doubles is `false`. Every other node, `Sign(3)` (an integer
 * literal in the safe range) or `Mod(x, 2)`, keeps its code.
 *
 * The route calls the same two functions at the same node: the pass asks
 * for the value of each function node before its rule
 * (`FragmentDefinition.constantValue`), top down, as the existing compiler
 * calls `tryConstantFold()` at each node before its handler, and a node
 * that reads a name that a form binds is not asked
 * (`mentionsCompileBoundName()` refuses its fold there). The fold runs with
 * the compiler state of the outermost compilation
 * (`withOutermostCompilerState()`). Its code is a number literal or the
 * literal `true` or `false`, which is read back as its value
 * (`jumpFoldLiteral()`); the fold records the names that it reads in
 * `symbolDeps` (`recordJumpFoldReads()`). Any other code declines, and so
 * does a fold inside another compilation.
 */
function closedJumpFold(
  node: Expression,
  registry: StructuredRegistry
): Expression | undefined {
  const known = registry.foldResults.get(node);
  if (known !== undefined) return known ?? undefined;
  const { target } = registry;
  if (!closedExactJump(node, target)) {
    registry.foldResults.set(node, null);
    return undefined;
  }
  if (CompilerState._compileDepth !== 0)
    throw new Error(
      `JS scalar fragment: ${nodeText(node)} reads no input, parameter or ` +
        `local, and the structured route folds it as the existing compiler ` +
        `does only in an outermost compilation`
    );
  // The existing compiler folds inside its outermost compilation
  // (`compileExpressionInFrame()`), at a depth of at least 1. The fold
  // compiles the literal that it writes, and its evaluation can compile
  // too (a `Sum` compiles its body): at the depth 0 of the route, each such
  // compilation would be an outermost one, which empties the memos and
  // resets the shared step budgets of the compilation in progress
  // (`resetOutermostCompilation()` in `compiler-core.ts`).
  const code = withOutermostCompilerState(target, () => {
    CompilerState._compileDepth += 1;
    try {
      return tryConstantFold(node, target, 0);
    } finally {
      CompilerState._compileDepth -= 1;
    }
  });
  if (code === undefined) {
    registry.foldResults.set(node, null);
    return undefined;
  }
  const value = jumpFoldLiteral(code);
  if (value === undefined)
    throw new Error(
      `JS scalar fragment: the existing compiler folds ${nodeText(node)} ` +
        `to the code ${code}, which is not a number or a boolean literal`
    );
  registry.folds.set(node, value);
  const ce = node.engine;
  const literal =
    typeof value === 'boolean'
      ? value
        ? ce.True
        : ce.False
      : ce.number(value);
  registry.foldResults.set(node, literal);
  return literal;
}

/** The value of the JavaScript code `code` of a folded node when it is a
 *  number literal (`3`, `-0.5`, `1e+30`, `-Infinity`, `NaN`, also in
 *  parentheses) or `true` or `false`; `undefined` for other code. */
function jumpFoldLiteral(code: string): number | boolean | undefined {
  let text = code.trim();
  while (text.startsWith('(') && text.endsWith(')'))
    text = text.slice(1, -1).trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (
    /^-?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|Infinity)$/.test(text) ||
    text === 'NaN'
  )
    return Number(text);
  return undefined;
}

/**
 * `Multiply`: real operands, or operands of which at least one is complex.
 * A real product with an exact rational factor `p/q` whose denominator is
 * not a power of two (`exactRationalDivisor()`: the canonical form writes
 * `x/49` as `Multiply(1/49, x)`) has a real result, and the lowering writes
 * it as the existing emitter does, a division by `q`
 * (`multiplyByRational()`).
 *
 * A product with a complex operand has a complex result, and each operand
 * keeps its fact: a real operand is not converted. The lowering writes the
 * code of the existing emitter (`Multiply` in `javascript-target.ts`), each
 * operand evaluated once, in order: for two operands, the product of the
 * parts, with a real operand as a factor of each part (`x·z` is
 * `{ re: x * z.re, im: x * z.im }`), and for a complex literal with finite
 * parts and a real operand `v` the parts `p·v` and `q·v` of the literal
 * `p + qi`, a part 0 written `0` and a part 1 written `v` (`i·x` is
 * `{ re: 0, im: x }`); for three operands or more, the left fold of the
 * products in their order, with the run of real factors before the first
 * complex one as one real product. A rational factor of a complex product
 * is its double, as the existing emitter writes it.
 */
const multiplyRule = {
  walk: (node, scope, context, w) => {
    if (!isFunction(node) || node.nops < 2)
      return w.refuse(
        node,
        'signature',
        'a product of fewer than two operands is not in the structured route'
      );
    const facts = operandFacts(node, scope, context, w);
    if (facts.some((f) => f.type.kind === 'complex')) {
      if (facts.some((f) => f.type.kind === 'boolean'))
        return w.refuse(
          node,
          'signature',
          'a product with a boolean operand is not in the structured route'
        );
      return w.valueFacts(
        node,
        { kind: 'complex' },
        facts.map((f) => w.convert(f, f.type)!)
      );
    }
    // A product with an exact rational factor `p/q` is a division by `q`
    // (`multiplyByRational()` in the lowering): its result is real.
    if (node.ops.some((op) => exactRationalDivisor(op) !== undefined)) {
      if (facts.some((f) => f.type.kind === 'boolean'))
        return w.refuse(
          node,
          'signature',
          'a product with a boolean operand is not in the structured route'
        );
      return w.valueFacts(
        node,
        { kind: 'real' },
        facts.map((f) => w.convert(f, { kind: 'real' })!)
      );
    }
    return w.signatures(node, scope, context, [
      { operands: ['real'], rest: 'real', result: 'real' },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/**
 * Whether `operand`, an operand of an ordering comparison, is a closed
 * operand whose exact value is the undirected infinity: `ComplexInfinity`,
 * `-5·ComplexInfinity`, `Cot(Pi)`. The existing compiler writes `false` for
 * an ordering with such an operand, also with `constantFold: false`
 * (`constantPoleOrdering()` in `compile-real-analysis.ts`), where the code
 * of the operand is a double with an order (`Infinity`, or
 * `_SYS.cot(3.141592653589793)`, a finite number). The test is the one of
 * `isConstantPole()` there, and shares its memo: the operand is evaluated
 * only when it is pure and every symbol in it is a constant or a name with
 * an assigned value that the program does not bind (`bound`: a parameter,
 * a local, an index), so a sum over an index (`Sum(Sin(j), Limits(j, 1,
 * N))`) is not evaluated. The test admits every operand that
 * `isConstantPole()` admits (it does not exclude an input, nor an operand
 * that `foldValueBlocked()` excludes), so a pole that the existing compiler
 * writes `false` is refused, and some others are refused too.
 */
function isClosedPole(
  operand: Expression,
  bound: (name: string) => boolean
): boolean {
  if (isNumber(operand))
    return operand.isInfinity === true && operand.isComplex;
  if (!isFunction(operand) && !isSymbol(operand)) return false;
  // The answer of each function node object, so a shared subtree is
  // walked once.
  const closedNodes = new Map<Expression, boolean>();
  const closed = (node: Expression): boolean => {
    if (isNumber(node)) return true;
    if (isSymbol(node))
      return (
        !bound(node.symbol) &&
        (node.isConstant ||
          node.engine._getSymbolValue(node.symbol) !== undefined)
      );
    if (isFunction(node)) {
      let known = closedNodes.get(node);
      if (known === undefined) {
        known = node.ops.every(closed);
        closedNodes.set(node, known);
      }
      return known;
    }
    return false;
  };
  if (!closed(operand) || !operand.isPure) return false;
  const memo = CompilerState._constantPoleMemo;
  let pole = memo.get(operand);
  if (pole === undefined) {
    const value = operand.evaluate();
    pole = isNumber(value) && value.isInfinity === true && value.isComplex;
    memo.set(operand, pole);
  }
  return pole;
}

/** Whether a scope below the root scope of `scope` binds `name` (a
 *  parameter, a local, an index): the names that `isNameBoundByCompilation()`
 *  sees in the existing compiler, except the inputs. */
function boundBelowRoot(
  scope: FragmentScope<ScalarRepresentation>,
  name: string
): boolean {
  for (
    let s: FragmentScope<ScalarRepresentation> | undefined = scope;
    s?.parent !== undefined;
    s = s.parent
  )
    if (s.bindings.has(name)) return true;
  return false;
}

/**
 * `Less`, `LessEqual`, `Equal` and `NotEqual`: real operands, a boolean
 * result. The
 * canonical form writes `GreaterEqual(a, b)` as `LessEqual(b, a)`. A
 * comparison of closed exact operands that the existing compiler folds is
 * its literal (`closedJumpFold()`), and does not reach this rule. `Equal` is the exact
 * comparison `===` of two numbers, and `NotEqual` its negation `!==`, which
 * is true for a `NaN` operand, as the interpreter answers (the existing
 * emitter, `compileJSEquality()`); a complex operand needs a comparison per
 * component, which the structured route does not have.
 *
 * A comparison of three operands or more (a chain) is the conjunction of
 * its adjacent pairs, which stops at the first pair that is false, as the
 * interpreter evaluates it (`evaluateChainOperands()` in
 * `library/relational-operator.ts`); `NotEqual` too (adjacent pairs, not
 * "pairwise distinct"; the canonical form keeps a `NotEqual` chain only when
 * a middle operand is not pure). The lowering evaluates each operand once
 * (`chain()` in `javascript-structured-lower.ts`); the order of the
 * evaluations and the refusals that keep the order of the existing emitter
 * are `chainForms()`.
 */
function comparisonRule(operator: 'Less' | 'LessEqual' | 'Equal' | 'NotEqual') {
  return {
    walk: (node, scope, context, w) => {
      const nops = isFunction(node) ? node.nops : 0;
      if (nops < 2)
        return w.refuse(
          node,
          'signature',
          `${operator} with ${nops} operands is not in the structured route, which admits two or more`
        );
      const pole =
        operator === 'Less' || operator === 'LessEqual'
          ? (node as Expression & { ops: readonly Expression[] }).ops.find(
              (operand) =>
                isClosedPole(operand, (name) => boundBelowRoot(scope, name))
            )
          : undefined;
      if (pole !== undefined)
        return w.refuse(
          node,
          'signature',
          `${operator} has the operand ${nodeText(pole)}, whose value is ` +
            `the undirected infinity: the existing compiler writes \`false\` ` +
            `for an ordering with it (constantPoleOrdering())`
        );
      const facts = operandFacts(node, scope, context, w);
      if (facts.some((f) => f.type.kind === 'complex'))
        return w.refuse(
          node,
          'signature',
          `${operator} with a complex operand is not in the structured route`
        );
      if (
        operator !== 'Equal' &&
        operator !== 'NotEqual' &&
        facts.some((f) => f.type.kind === 'boolean')
      )
        return w.refuse(
          node,
          'signature',
          `${operator} with a boolean operand is not in the structured route`
        );
      return w.signatures(node, scope, context, [
        nops === 2
          ? { operands: ['real', 'real'], result: 'boolean' }
          : { operands: ['real'], rest: 'real', result: 'boolean' },
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * The facts of `node` for an operator of real operands (`Mod`, `Floor`,
 * `Divide`): `operands` operands, none complex and none boolean. The type
 * of the result is `type` of the facts of the operands, and each operand is
 * read as itself, or as a real when the result is real. The type is read
 * from the facts, not from the engine type of the node: an operand that
 * reads a local has a real fact also when the local is declared `integer`.
 */
function realOperatorFacts(
  operator: string,
  operands: number,
  type: (
    facts: readonly FragmentValueFacts<ScalarRepresentation>[]
  ) => 'real' | 'integer'
) {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== operands)
        return w.refuse(
          node,
          'signature',
          `${operator} with other than ${operands} operand${operands === 1 ? '' : 's'} is not in the structured route`
        );
      const facts = operandFacts(node, scope, context, w);
      for (const kind of ['complex', 'boolean'] as const)
        if (facts.some((f) => f.type.kind === kind))
          return w.refuse(
            node,
            'signature',
            `${operator} with a ${kind} operand is not in the structured route`
          );
      const result = type(facts);
      return w.valueFacts(
        node,
        { kind: result },
        facts.map((f) =>
          w.convert(f, result === 'integer' ? f.type : { kind: 'real' })!
        )
      );
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

const integerWhenAll = (
  facts: readonly FragmentValueFacts<ScalarRepresentation>[]
): 'real' | 'integer' =>
  facts.every((f) => f.type.kind === 'integer') ? 'integer' : 'real';

/**
 * `Mod`: the floored remainder of two real operands, written
 * `_SYS.floorMod(a, b)`. Its result has the sign
 * of the divisor, as the interpreter gives it: `Mod(-7, 3)` is `2`,
 * `Mod(7, -3)` is `-2`, `Mod(-7.5, 2)` is `0.5`, and `Mod(5, 0)` is not a
 * number. `_SYS.floorMod` throws for an operand beyond the safe integer
 * range or infinite. The result is an integer when both operands are.
 *
 * The existing emitter (`Mod` in `javascript-target.ts`) writes
 * `_SYS.floorMod` only in its third case, and the route refuses the other
 * two, which it reads with the same predicates (literals and engine types):
 *
 * - the plain `((a) % (b))` when both operands are integer-valued and
 *   non-negative and the divisor is the literal 1, or each operand is a
 *   literal or of a static type in `integer<0..2^53 - 1>`
 *   (`isSafeNonNegativeInteger()`): `%` never throws and keeps `-0`
 *   (`Mod(n, 2)` with `n: integer<0..100>` is `-0` at `n = -0`);
 * - `((a - Math.floor(a)) % 1)` or `_SYS.fract(a)` for every other operand
 *   with the literal divisor 1: `Mod(k, 1)` at `k = 2^60` is `0` there, and
 *   `_SYS.floorMod` throws. The two spellings compute the same value of `a`
 *   (`_SYS.fract(x)` is `(x - Math.floor(x)) % 1`), and the route writes
 *   `_SYS.fract(a)` (the form `mod-one`), `a` evaluated once. It refuses a
 *   dividend that the compiler proves integer-valued, or that has an integer
 *   type: with a proof that it is not negative too (a proof that can read
 *   the range of a loop index), the existing emitter writes `a % 1`, which
 *   is `-0` at `a = -0`, where `_SYS.fract(a)` is `0`.
 *
 * A `Mod` of closed exact operands that the existing compiler folds is its
 * literal (`closedJumpFold()`), and does not reach this rule.
 */
const modFacts = realOperatorFacts('Mod', 2, integerWhenAll);
const modRule = (forms: Map<Expression, StructuredForm>) =>
  ({
    walk: (node, scope, context, w) => {
      if (isFunction(node) && node.nops === 2) {
        const [a, b] = node.ops;
        if (isNumber(b) && b.im === 0 && b.re === 1) {
          const refuseInteger = () =>
            w.refuse(
              node,
              'signature',
              `Mod of the integer ${nodeText(a)} and the literal divisor 1 is ` +
                `not in the structured route: the existing emitter writes % ` +
                `for a dividend that it proves integer-valued and not negative`
            );
          if (
            isSubtype(a.type.type, 'integer') ||
            BaseCompiler.isIntegerValued(a)
          )
            return refuseInteger();
          const facts = modFacts.walk(node, scope, context, w);
          // A dividend that the pass types as an integer, whatever its engine
          // type (`Length(LQ)`): the form `mod-one` has a real operand.
          if (facts.type.kind === 'integer') return refuseInteger();
          forms.set(node, 'mod-one');
          return facts;
        }
        if (isSafeNonNegativeInteger(a) && isSafeNonNegativeInteger(b))
          return w.refuse(
            node,
            'signature',
            `Mod of ${nodeText(a)} and ${nodeText(b)}, each a literal or of a ` +
              `type in integer<0..2^53 - 1>, is not in the structured route: the ` +
              `existing emitter writes % for it`
          );
      }
      return modFacts.walk(node, scope, context, w);
    },
  }) satisfies FragmentRule<ScalarRepresentation>;

/** The integers from `0` to `2^53 - 1`, both included. */
const SAFE_NON_NEGATIVE_INTEGER_TYPE = parseType(
  `integer<0..${Number.MAX_SAFE_INTEGER}>`
);

/** `isSafeNonNegativeInteger()` of `javascript-target.ts`, which is not
 *  exported: a number literal that is an integer from 0 to `2^53 - 1`, or
 *  an operand whose engine type is a subtype of `integer<0..2^53 - 1>`. */
function isSafeNonNegativeInteger(expr: Expression): boolean {
  if (isNumber(expr))
    return (
      !expr.isComplex &&
      Number.isInteger(expr.re) &&
      expr.re >= 0 &&
      expr.re <= Number.MAX_SAFE_INTEGER
    );
  const t = expr.type?.type;
  return t !== undefined && isSubtype(t, SAFE_NON_NEGATIVE_INTEGER_TYPE);
}

/**
 * `Floor`: the greatest integer not greater than its real operand, written
 * `Math.floor(x)`. The result is an integer, as the engine type of
 * `Floor(x)` is: `Floor(-2.5)` is `-3`. `Floor(-0)` is `-0`, where the
 * interpreter gives `0`, as on the existing route.
 */
const floorFacts = realOperatorFacts('Floor', 1, () => 'integer');
/** The rule of `Floor`. `inputs`: the parameters of the root function
 *  (`inexactJumpConstant()`). */
const floorRuleOf = (inputs: ReadonlySet<string>) =>
  ({
    walk: (node, scope, context, w) => {
      const constant = isFunction(node)
        ? inexactJumpConstant(node.ops, scope, inputs)
        : undefined;
      if (constant !== undefined)
        return w.refuse(
          node,
          'signature',
          `Floor of an operand with the exact constant ${nodeText(constant)}, ` +
            `which no double holds exactly, is not in the structured route: the ` +
            `existing compiler rewrites such a node or declines it ` +
            `(inexact-jump-operand)`
        );
      return floorFacts.walk(node, scope, context, w);
    },
  }) satisfies FragmentRule<ScalarRepresentation>;
const floorRule = floorRuleOf(new Set());

/**
 * A closed subtree of `operands` whose exact value no double holds, or
 * `undefined`. The existing compiler rewrites a rounding function whose
 * operand adds such a constant to integer variables, so that the constant
 * is rounded alone, and declines the other shapes of integer variables and
 * such a constant (`jumpShiftRewrite()` in `compile-folding.ts`): with a
 * double of the constant, `Floor(k + 2/3)` at `k = 2^52` is `2^52 + 1`,
 * where the exact value is `2^52`. The structured route has neither the
 * rewrite nor its decline, and refuses every operand with such a constant:
 * this is wider than the existing rule, which keeps the structural code of
 * an operand with a real variable (`Floor(x + 1/3)`).
 *
 * Three closed nodes are not such constants. A number literal that a
 * double holds (an integer of the significand, `1/2`) or that is a float.
 * A rational literal that is the factor of a product which the lowering
 * writes as a division (`multiplyByRational()`: the first factor of the
 * product for which `exactRationalDivisor()` answers), because the code
 * divides by the denominator: `Floor(k/49)`, `Floor(29n/50)`. A captured
 * symbol whose value is an integer that a double holds
 * (`Floor((k - 1)/N)` with `N = 32`). A rounding node inside the operand
 * is judged on its own.
 *
 * Every other closed node is such a constant: `Sqrt(2)`, a second rational
 * factor of a product, and a captured symbol whose value is a rational or
 * a float. The emitter writes the value of a capture as a number literal,
 * so a capture `N = 1/49` in `Floor(N * k)` would be the rounded double
 * `0.0204…`, and the code would give 0 at `k = 49`, where the value is 1.
 * The existing rule gives its exemptions to literals only, too.
 *
 * A name that a scope of the program binds (a parameter, a local, the
 * index of a loop or of a `Sum`, the variable of an integral: the names of
 * `scope` and of its parents but the root, which holds the inputs) is a
 * variable, also when the engine has a value for it (`t := 1/3` and
 * `Floor(t)` in the integrand of `∫ … dt`); so is the variable of a
 * `Limits` or an `Element` clause in the operand. A node that holds a
 * function literal (the integrand of an `Integrate`) or a bound name is
 * not a constant, and its operands are judged in turn. A parameter of the
 * root function (`inputs`) is bound too: the existing compiler binds it
 * (`lambdaTarget()`), where the root scope of the pass holds it with the
 * captures. A closed condition (`2 < 3`) is not a number, and an `If` or a
 * `Which` whose constant conditions select a branch is that branch
 * (`decidedBranch()`).
 *
 * A node object reached on several paths (a DAG) is visited once: the
 * verdict of a function node does not depend on its parent, and is
 * remembered, and the question whether a node has unknowns keeps one memo
 * for the call (`hasUnknownsWithMemo()`).
 */
function inexactJumpConstant(
  operands: readonly Expression[],
  scope?: FragmentScope<ScalarRepresentation>,
  inputs: ReadonlySet<string> = new Set()
): Expression | undefined {
  const unknowns: ReferencesMemo = new Map();
  const bound = new Set<string>(inputs);
  for (let s = scope; s?.parent !== undefined; s = s.parent)
    for (const name of s.bindings.keys()) bound.add(name);
  const binds = new Map<Expression, boolean>();
  /** `node` is or holds a function literal or a bound name. */
  const holdsBinding = (node: Expression): boolean => {
    if (isSymbol(node)) return bound.has(node.symbol);
    if (!isFunction(node)) return false;
    let known = binds.get(node);
    if (known === undefined) {
      known = node.operator === 'Function' || node.ops.some(holdsBinding);
      binds.set(node, known);
    }
    return known;
  };
  const verdicts = new Map<Expression, Expression | undefined>();
  const exact = (n: Expression): boolean => {
    if (!isNumber(n)) return false;
    if (!n.isExact) return true;
    const nv = n.numericValue;
    return typeof nv === 'number' || exactDoubleValue(nv) !== undefined;
  };
  /** `node` is the factor of `parent` that the lowering divides by. */
  const divisionFactor = (
    node: Expression,
    parent: Expression | undefined
  ): boolean =>
    isFunction(parent, 'Multiply') &&
    parent.ops.find((op) => exactRationalDivisor(op) !== undefined) === node;
  /** An integer that a double holds, as the value of a captured symbol. */
  const safeInteger = (value: Expression | undefined): boolean =>
    value !== undefined &&
    isNumber(value) &&
    value.isExact &&
    value.im === 0 &&
    Number.isSafeInteger(value.re);
  const visit = (
    node: Expression,
    parent: Expression | undefined
  ): Expression | undefined => {
    // A closed node that is not pure (`6·Random()`) is not a constant: the
    // existing compiler folds only a pure node and writes the code of this
    // one, whose operands are judged in turn.
    if (isSymbol(node) && bound.has(node.symbol)) return undefined;
    if (isFunction(node) && node.operator === 'Function') return undefined;
    if (
      !hasUnknownsWithMemo(node, unknowns) &&
      (!isFunction(node) || node.isPure) &&
      !holdsBinding(node)
    ) {
      if (isNumber(node))
        return exact(node) || divisionFactor(node, parent) ? undefined : node;
      // `True` and `False` are not numbers: the rule of `Floor` refuses a
      // boolean operand.
      if (isSymbol(node, 'True') || isSymbol(node, 'False')) return undefined;
      if (isSubtype(node.type.type, 'boolean')) return undefined;
      if (isSymbol(node) && safeInteger(resolvedValueDefinition(node)?.value))
        return undefined;
      return node;
    }
    if (!isFunction(node) || SHIFT_JUMP_HEADS.has(node.operator))
      return undefined;
    if (verdicts.has(node)) return verdicts.get(node);
    let found: Expression | undefined;
    const clause = node.operator === 'Limits' || node.operator === 'Element';
    const selected = decidedBranch(node, (name) => bound.has(name));
    for (const op of selected !== undefined
      ? [selected]
      : clause
        ? node.ops.slice(1)
        : node.ops) {
      found = visit(op, node);
      if (found !== undefined) break;
    }
    verdicts.set(node, found);
    return found;
  };
  for (const op of operands) {
    const found = visit(op, undefined);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * `Divide`: the real quotient of two real operands, written `a / b`. The
 * result is real, also for integer operands. A zero divisor gives
 * `±Infinity` or `NaN`, where the interpreter gives `ComplexInfinity` or
 * `NaN`, as on the existing route. The canonical form writes a quotient by
 * a number literal as a product (`Divide(k, 2)` is `Multiply(1/2, k)`).
 *
 * A quotient with a complex operand has a complex result, and each operand
 * keeps its fact: a real operand is not converted. The emitter writes the
 * code of the existing emitter (`Divide` in `javascript-target.ts`): the
 * quotient of each part by a real divisor, and for a complex divisor the
 * textbook formula guarded by the test of `complexQuotient()`, with
 * `_SYS.cdivedge` where the formula is not accurate.
 */
const realDivideRule = realOperatorFacts('Divide', 2, () => 'real');
const divideRule = {
  walk: (node, scope, context, w) => {
    if (isFunction(node) && node.nops === 2) {
      const facts = operandFacts(node, scope, context, w);
      if (facts.some((f) => f.type.kind === 'boolean'))
        return w.refuse(
          node,
          'signature',
          'Divide with a boolean operand is not in the structured route'
        );
      if (facts.some((f) => f.type.kind === 'complex'))
        return w.valueFacts(
          node,
          { kind: 'complex' },
          facts.map((f) => w.convert(f, f.type)!)
        );
    }
    return realDivideRule.walk(node, scope, context, w);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/**
 * `Loop` over `Element(k, Range(a, b))`, as a statement: the rule of a
 * counted loop of the pass (`walkCountedLoop()`), and bounds whose facts
 * are integers. The admission of the structured route checks the rest of
 * the form (no step, no guard, the statements of the body). A `Loop` over
 * `Element(c, L)` with a list `L` (a name) binds `c` to each element of the
 * list in turn, a number or a tuple, as the existing emitter writes
 * `for (const c of L)`.
 */
const loopRule = {
  walk: (node, scope, context, w) => {
    const spec = isFunction(node) && node.nops === 2 ? node.op2 : undefined;
    // A loop with no index set, with several, or over the elements of a
    // list (`for c in all`): one scope binds every index. The source of the
    // first index set is typed where the loop is, the source of each later
    // one in that scope, with the indexes before it bound.
    if (
      isFunction(node) &&
      (node.nops !== 2 || loopClauseKind(node.op2) === 'list')
    ) {
      const inner = w.open(node, scope);
      for (const [i, clause] of node.ops.slice(1).entries()) {
        const at = i === 0 ? scope : inner;
        const kind = loopClauseKind(clause);
        const c = clause as Expression & {
          op1: Expression & { symbol: string };
          op2: Expression & { ops: readonly Expression[] };
        };
        if (kind === 'range') {
          for (const bound of c.op2.ops)
            if (w.value(bound, at, context).type.kind !== 'integer')
              return w.refuse(
                node,
                'signature',
                `The bound \`${nodeText(bound)}\` of \`Loop\` does not have an integer ` +
                  `fact: the structured route reads a bound as an integer`
              );
          w.bind(c.op1, inner, c.op1.symbol, { kind: 'integer' }, 'index');
          continue;
        }
        if (kind === undefined)
          return w.refuse(
            node,
            'signature',
            `Loop over \`${nodeText(clause)}\` is not in the structured route`
          );
        const list = w.value(c.op2, at, context);
        const element = listElementType(list);
        if (element === undefined)
          return w.refuse(
            node,
            'signature',
            `Loop over \`${nodeText(c.op2)}\` of the type ` +
              `\`${fragmentTypeToString(list.type)}\` is not in the structured route, ` +
              `which visits the elements of a list of reals, of integers or of tuples`
          );
        w.bind(c.op1, inner, c.op1.symbol, element, 'index');
      }
      w.type(node.op1, inner, {
        place: 'statement',
        fn: context.fn,
        loop: { kind: 'loop', scope: inner },
        parallel: context.parallel,
      });
      return { type: { kind: 'statement' } };
    }
    if (
      !isFunction(spec, 'Element') ||
      spec.nops !== 2 ||
      !isFunction(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      return w.refuse(
        node,
        'signature',
        'Loop is in the structured route only over Element(k, Range(a, b))'
      );
    for (const bound of spec.op2.ops)
      if (w.value(bound, scope, context).type.kind !== 'integer')
        return w.refuse(
          node,
          'signature',
          `The bound \`${nodeText(bound)}\` of \`Loop\` does not have an integer ` +
            `fact: the structured route reads a bound as an integer`
        );
    return walkCountedLoop(node, scope, context, w);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/** `Min` and `Max`: real operands, written `Math.min()` and `Math.max()`. */
function extremumRule(operator: 'Min' | 'Max') {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops < 2)
        return w.refuse(
          node,
          'signature',
          `${operator} of fewer than two operands is not in the structured route`
        );
      const facts = operandFacts(node, scope, context, w);
      if (facts.some((f) => f.type.kind === 'complex'))
        return w.refuse(
          node,
          'signature',
          `${operator} with a complex operand is not in the structured route`
        );
      if (facts.some((f) => f.type.kind === 'boolean'))
        return w.refuse(
          node,
          'signature',
          `${operator} with a boolean operand is not in the structured route`
        );
      return w.signatures(node, scope, context, [
        { operands: ['real'], rest: 'real', result: 'real' },
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/** `And` and `Or`: boolean operands, a boolean result. Each operand after
 *  the first is evaluated only when the earlier ones do not decide the
 *  result (the lowering puts it in a region of its own). */
function logicalRule(operator: 'And' | 'Or') {
  return {
    walk: (node, scope, context, w) => {
      // The canonical form keeps `And(C)` and `Or(C)`; the representation
      // has a region for each operand after the first, and needs one.
      if (!isFunction(node) || node.nops < 2)
        return w.refuse(
          node,
          'signature',
          `${operator} of fewer than two operands is not in the structured route`
        );
      if (
        operandFacts(node, scope, context, w).some(
          (f) => f.type.kind !== 'boolean'
        )
      )
        return w.refuse(
          node,
          'signature',
          `${operator} with an operand that is not a boolean is not in the structured route`
        );
      return w.signatures(node, scope, context, [
        { operands: ['boolean'], rest: 'boolean', result: 'boolean' },
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/** The sign of a real value, as far as the facts tell it. */
type Sign = 'nonnegative' | 'negative' | 'unknown';

/** The values of the captured bindings, by the symbol nodes that read
 *  them (`StructuredRegistry.captures`). */
type SnapshotOf = (symbol: Expression) => number | undefined;

/**
 * The sign of the real operand `node` of a `Sqrt` (or of the operator
 * `head`: `Ln`, `Power`), from facts of the
 * program: the value of a literal or of a captured snapshot (non-negative,
 * `-0` included, or negative), the declared type of a name (a subtype of
 * `real<0..>` is non-negative, a type whose values are all negative is
 * negative), and the operators whose result is non-negative when their
 * operands are: `Add`, `Multiply` and `Divide` of non-negative operands,
 * `Max` with one non-negative operand, `Min` of non-negative operands,
 * `Sqrt` of a non-negative operand; and `Abs` of an operand, and `Power`
 * with an even integer literal exponent, when the type of the operand (the
 * base) is not one of numbers that are not real. A function node whose own
 * type is one of numbers that are not real has an unknown sign. Every other
 * node has an unknown sign. A `NaN` literal has an unknown sign.
 *
 * These are the rules of `assumedRealNonNegative()` (`compile-real-
 * analysis.ts`) for the operators of the structured route, so a sign that
 * this function finds, the existing compiler finds too. That reader also
 * reads the sign facts of the engine (`isNonNegative`, an assumption, the
 * range of a computed type), which this function does not model. When the
 * engine knows a sign that this function does not find, the answer of the
 * existing compiler can differ, and this function returns a refusal: the
 * structured route declines the program, and never gives another value.
 * `deep`: the check of the engine applies to the operands that the rules
 * read too (the `complex` mode, where a non-negative sum of operands that
 * the engine proves non-negative makes a real square root); otherwise only
 * to `node` (the `strict` mode, where only a negative operand changes the
 * result).
 *
 * `memo`: the sign of each function node object of one call, so a node
 * reached on several paths is computed once. A call reads one operand in
 * one scope, with one `snapshotOf`, `deep` and `head`; the memo is not kept
 * across calls, so each radical of a shared subtree walks the distinct
 * nodes below it once (quadratic in the distinct nodes, not exponential).
 */
function signOf(
  node: Expression,
  snapshotOf: SnapshotOf,
  deep: boolean,
  head = 'Sqrt',
  memo = new Map<Expression, Sign | { refusal: string }>()
): Sign | { refusal: string } {
  if (!isFunction(node)) return signOfNode(node, snapshotOf, deep, head, memo);
  let sign = memo.get(node);
  if (sign === undefined) {
    sign = signOfNode(node, snapshotOf, deep, head, memo);
    memo.set(node, sign);
  }
  return sign;
}

function signOfNode(
  node: Expression,
  snapshotOf: SnapshotOf,
  deep: boolean,
  head: string,
  memo: Map<Expression, Sign | { refusal: string }>
): Sign | { refusal: string } {
  const refusal = (sign: string) => ({
    refusal:
      `the engine knows that the operand ${nodeText(node)} of ${head} is ` +
      `${sign}, and the structured route does not`,
  });
  /** `realAssumed()` of `assumedRealNonNegative()`: the type of `e` is not
   *  one of numbers that are not real. */
  const realAssumed = (e: Expression): boolean => !isNonRealNumber(e.type.type);
  const fromValue = (v: number): Sign =>
    Number.isNaN(v) ? 'unknown' : v >= 0 ? 'nonnegative' : 'negative';
  let sign: Sign | { refusal: string } = 'unknown';
  const snapshot = isSymbol(node) ? snapshotOf(node) : undefined;
  if (snapshot !== undefined) sign = fromValue(snapshot);
  else if (isNumber(node))
    sign = node.im === 0 ? fromValue(node.re) : 'unknown';
  else if (isSymbol(node) && !hasNoDeclaredType(node)) {
    // The type of a name with no declared type is inferred, and is not
    // read: its sign is unknown here, and the check of the engine facts
    // below declines where the engine knows it.
    const type = withoutNaNMember(node.type.type);
    if (type !== undefined && isSubtype(type, NON_NEGATIVE_REAL_TYPE))
      sign = 'nonnegative';
    else if (type !== undefined && isSubtype(type, 'real<..<0>'))
      sign = 'negative';
  } else if (isFunction(node) && !isNonRealNumber(node.type.type)) {
    const signs = (): (Sign | { refusal: string })[] =>
      node.ops.map((op) => signOf(op, snapshotOf, deep, head, memo));
    const op = node.operator;
    // With no operand, the sign is unknown, as in `assumedRealNonNegative()`.
    if (
      (op === 'Add' ||
        op === 'Multiply' ||
        op === 'Divide' ||
        op === 'Min' ||
        op === 'Max') &&
      node.nops > 0
    ) {
      const operands = signs();
      const found = operands.find((s) => typeof s === 'object');
      if (found !== undefined) return found;
      const nonNegative = operands.map((s) => s === 'nonnegative');
      // `Min` and `Max` need every operand of a real type.
      const extremum = op === 'Min' || op === 'Max';
      if (
        (!extremum || node.ops.every(realAssumed)) &&
        (op === 'Max' ? nonNegative.some(Boolean) : nonNegative.every(Boolean))
      )
        sign = 'nonnegative';
    } else if (op === 'Sqrt' && node.nops === 1) {
      const [operand] = signs();
      if (typeof operand === 'object') return operand;
      if (operand === 'nonnegative') sign = 'nonnegative';
    } else if (op === 'Abs' && node.nops === 1) {
      if (realAssumed(node.op1)) sign = 'nonnegative';
    } else if (
      op === 'Power' &&
      node.nops === 2 &&
      isNumber(node.op2) &&
      node.op2.im === 0 &&
      Number.isInteger(node.op2.re) &&
      node.op2.re % 2 === 0 &&
      realAssumed(node.op1)
    )
      sign = 'nonnegative';
  }
  if (typeof sign === 'object') return sign;
  // The check of the sign facts of the engine (see above).
  if (node.isNegative === true && sign !== 'negative')
    return refusal('negative');
  if (sign === 'negative' && node.isNegative !== true)
    return refusal('not negative');
  if (deep && sign !== 'nonnegative') {
    const type = withoutNaNMember(node.type.type);
    if (
      node.isNonNegative === true ||
      (type !== undefined && isSubtype(type, NON_NEGATIVE_REAL_TYPE))
    )
      return refusal('non-negative');
  }
  return sign;
}

/**
 * `Sqrt` on the structured route, for the compile mode `mode`. The rule
 * reads the fact of its operand, the sign of the operand (`signOf()`) and
 * the mode, and calls no reader of the existing compiler. It gives the
 * result that `isComplexValued()` gives for the same node, or declines:
 *
 * - A complex operand: a complex result in both modes (`Sqrt(z)` with
 *   `z: complex` is `_SYS.csqrt(z)`).
 * - The `strict` mode, a real operand: complex when the operand is
 *   negative (`Sqrt(-2)`, written `_SYS.csqrt(({ re: -2, im: 0 }))`, or
 *   `Sqrt(n)` with `n: real<..-1>`), real otherwise (`Sqrt(x)` with
 *   `x: real` is `Math.sqrt(x)`, `NaN` for a negative `x`).
 * - The `complex` mode, a real operand: real when the operand is
 *   non-negative (`Sqrt(p)` with `p: real<0..>`, `Sqrt(Max(0, x))`,
 *   `Sqrt(2)`), complex otherwise (`Sqrt(x)` with `x: real` is
 *   `_SYS.csqrt(({ re: x, im: 0 }))`, `2i` at `x = -4`).
 * - An operand whose sign the engine knows and `signOf()` does not find
 *   (`Sqrt(a)` after `assume(a > 0)` is found, from the narrowed type of
 *   `a`; `Sqrt(Add(q, 1))` for a computed `q` that the engine proves
 *   non-negative is not): declined.
 *
 * The real operand of a complex square root is converted
 * (`real-to-complex`). The result of a real square root is `real`, also
 * for an integer operand.
 *
 * `Ln` has the same rule (`structuredRadicalRule('Ln', …)`): the existing
 * compiler decides `Sqrt`, `Ln` and `Log` by one branch of
 * `isComplexValued()` and one promotion rule (`promotesRadicalToComplex()`
 * for the heads of `PROMOTABLE_RADICAL_HEADS`). `Ln(x)` with `x: real` is
 * `Math.log(x)` in the `strict` mode (`NaN` for a negative `x`, `-Infinity`
 * for 0) and `_SYS.cln(({ re: x, im: 0 }))` in the `complex` mode;
 * `Ln(n)` with `n: real<..-1>` is `_SYS.cln` in both modes.
 *
 * In the `strict` mode the existing compiler makes a negative operand
 * complex only when the type of the node, without its infinities, is one of
 * numbers that are not real. When the rule finds a negative operand and the
 * type of the node is not such a type, it declines.
 */
function structuredRadicalRule(
  head: 'Sqrt' | 'Ln',
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf
) {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 1)
        return w.refuse(
          node,
          'signature',
          `${head} with other than one operand is not in the structured route`
        );
      const facts = w.value(node.op1, scope, context);
      if (facts.type.kind === 'boolean')
        return w.refuse(
          node,
          'signature',
          `${head} with a boolean operand is not in the structured route`
        );
      let lane: 'real' | 'complex' = 'complex';
      if (facts.representation !== 'complex') {
        const real = radicalLane(node, node.op1, head, mode, snapshotOf);
        if (typeof real === 'object')
          return w.refuse(node, 'signature', real.refusal);
        lane = real;
      }
      return w.signatures(node, scope, context, [
        { operands: [lane], result: lane },
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * The lane of `node`, an application of `Sqrt`, `Ln` or `Log` (`head`), for
 * its real operand `operand` (`structuredRadicalRule()`): `complex` in the
 * `strict` mode when the operand is negative, in the `complex` mode when
 * it is not proved non-negative, and `real` otherwise; a refusal when the
 * engine knows a sign that `signOf()` does not find, or, in the `strict`
 * mode, when the operand is negative and the type of `node` is not one of
 * numbers that are not real.
 */
function radicalLane(
  node: Expression,
  operand: Expression,
  head: 'Sqrt' | 'Ln' | 'Log',
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf
): 'real' | 'complex' | { refusal: string } {
  const sign = signOf(operand, snapshotOf, mode === 'complex', head);
  if (typeof sign === 'object') return sign;
  if (
    mode === 'strict' &&
    sign === 'negative' &&
    !isNonRealNumber(finitePartOfType(node.type.type))
  )
    return {
      refusal:
        `the operand ${nodeText(operand)} of ${head} is negative and the ` +
        `type of ${nodeText(node)} is ${node.type.toString()}: the ` +
        `existing compiler reads both, and the structured route does not`,
    };
  return mode === 'complex'
    ? sign === 'nonnegative'
      ? 'real'
      : 'complex'
    : sign === 'negative'
      ? 'complex'
      : 'real';
}

/**
 * `Log` on the structured route, for the compile mode `mode`: `Log(x)` (the
 * logarithm in base 10) and `Log(x, b)`. The existing emitter (`Log` in
 * `javascript-target.ts`) decides the lane of `Log` with the rule of `Sqrt`
 * and `Ln` (`isComplexValued()`, `promotesToComplexLane()`), applied to
 * every operand: the node is complex when an operand is negative and the
 * type of the node is not real, or, in the `complex` mode, when an operand
 * is not proved non-negative (`radicalLane()`).
 *
 * - No base, or the number literal 10 or 2 as the base
 *   (`fixedLogBase()`): `Math.log10(x)` or `Math.log2(x)` on the real lane,
 *   `_SYS.clog10` or `_SYS.clog2` of the converted operand on the complex
 *   lane (`Log(x)` with `x: real` in the `complex` mode is
 *   `_SYS.clog10(({ re: x, im: 0 }))`). The route writes the same calls
 *   (the forms `log10`, `log2`).
 * - Another base, both operands on the real lane:
 *   `(Math.log(x) / Math.log(b))`, as the route writes it (the form
 *   `log-quotient`). On the complex lane the handler writes a complex
 *   quotient, which the route declines.
 * - A complex operand: declined (the handler writes `_SYS.clog10(z)` or
 *   the complex quotient).
 */
function structuredLogRule(
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf,
  forms: Map<Expression, StructuredForm>
) {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || (node.nops !== 1 && node.nops !== 2))
        return w.refuse(
          node,
          'signature',
          'Log with other than one or two operands is not in the structured route'
        );
      const facts = operandFacts(node, scope, context, w);
      for (const kind of ['complex', 'boolean'] as const)
        if (facts.some((f) => f.type.kind === kind))
          return w.refuse(
            node,
            'signature',
            `Log with a ${kind} operand is not in the structured route`
          );
      const fixed = fixedLogBase(node.ops);
      const lanes: ('real' | 'complex')[] = [];
      for (const operand of fixed === undefined ? node.ops : [node.op1]) {
        const lane = radicalLane(node, operand, 'Log', mode, snapshotOf);
        if (typeof lane === 'object')
          return w.refuse(node, 'signature', lane.refusal);
        lanes.push(lane);
      }
      if (fixed === undefined) {
        if (lanes.includes('complex'))
          return w.refuse(
            node,
            'signature',
            `Log of ${nodeText(node.op1)} in the base ${nodeText(node.op2)} ` +
              `is complex, and the structured route does not have the complex ` +
              `quotient that the existing emitter writes`
          );
        forms.set(node, 'log-quotient');
        return w.valueFacts(
          node,
          { kind: 'real' },
          facts.map((f) => w.convert(f, { kind: 'real' })!)
        );
      }
      const lane = lanes[0];
      forms.set(node, fixed === 10 ? 'log10' : 'log2');
      return w.valueFacts(
        node,
        { kind: lane },
        facts.map((f, i) =>
          w.convert(f, i === 0 ? { kind: lane } : { kind: 'real' })!
        )
      );
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * Whether `piMultiple()` (`compile-real-analysis.ts`) reads past the head of
 * the operand `x` of `Sin`, `Cos` or `Tan`, when `x` reads `Pi`: a symbol (it
 * answers for `Pi` itself), a negation, a quotient and a product. For every
 * other operand it answers `undefined`, and the handler writes the call of
 * the operand (`Math.sin(Math.asin(a) + Math.PI)`), as the route writes it.
 */
function readsAsPiMultiple(x: Expression): boolean {
  return (
    x.symbols.includes('Pi') &&
    (isSymbol(x) ||
      isFunction(x, 'Negate') ||
      isFunction(x, 'Divide') ||
      isFunction(x, 'Multiply'))
  );
}

/**
 * The facts of `head` (`Sin`, `Cos` or `Tan`) of a real operand that reads
 * `Pi`, whose facts are `facts`. The existing emitter writes `_SYS.sinpi(u)`,
 * `_SYS.cospi(u)` or `_SYS.tanpi(u)` for a multiple `π·u` (`piMultiple()`),
 * the angle `u` in half-turns, so that `sin(π·u)` is `0` at an integer
 * `u`, where `Math.sin(Math.PI * 2)` is `-2.4e-16`. The route writes the
 * same call for `Multiply(Pi, u)` with a real or an integer `u` that does
 * not read `Pi` (`piMultipleFactor()`, the form `pi-multiple`), with the
 * code of the same operand `u`. The other operands that `piMultiple()`
 * reads (`readsAsPiMultiple()`) are refused: a product of more factors, a
 * quotient, a negation (for which `piMultiple()` builds a new node), and
 * the symbol `Pi`. In the `complex` mode a node whose type is not real
 * (`Sin(π/x)` has the type `number`) is refused: the compiler wraps the
 * call in `_SYS.cplx()` there (`liftWideResult()`), as for the real call of
 * `structuredFunctionRule()`.
 */
function piMultipleFacts(
  head: 'Sin' | 'Cos' | 'Tan',
  node: Expression,
  facts: FragmentValueFacts<ScalarRepresentation>,
  forms: Map<Expression, StructuredForm>,
  w: FragmentWalker<ScalarRepresentation>,
  mode: 'strict' | 'complex'
) {
  const u = isFunction(node) ? piMultipleFactor(node.op1) : undefined;
  if (u === undefined || facts.type.kind === 'complex')
    return w.refuse(
      node,
      'signature',
      `${head} of an operand that reads Pi is in the structured route only ` +
        `as Multiply(Pi, u): the existing emitter writes another multiple of ` +
        `Pi with _SYS.sinpi, _SYS.cospi or _SYS.tanpi of a new expression`
    );
  if (
    mode === 'complex' &&
    !isSubtype(finitePartOfType(node.type.type), 'real')
  )
    return w.refuse(
      node,
      'signature',
      `${nodeText(node)} has the type ${node.type.toString()}, which is ` +
        `not real, in the complex mode: the existing compiler wraps the ` +
        `real call in _SYS.cplx`
    );
  forms.set(node, 'pi-multiple');
  return w.valueFacts(node, { kind: 'real' }, [
    w.convert(facts, { kind: 'real' })!,
  ]);
}

/**
 * How the existing emitter decides the lane of a head of
 * `structuredScalarFunctionRule()` for a real operand:
 *
 * - `type`: by the type of the node, without its infinities and `NaN`
 *   (`isComplexValued()`): a real type is real, a type of numbers that are
 *   not real is complex, and a wide type (`number`) is real in the `strict`
 *   mode and complex in the `complex` mode, where the handler writes the
 *   real call and the compiler wraps it in `_SYS.cplx()` (`Cot(x)` with
 *   `x: real` has the type `number`). The handler writes the real call, so
 *   the route admits the real lane only.
 * - `inverse`: the same reading of the type, but the handler writes the
 *   complex helper of the converted operand for a type of numbers that are
 *   not real (`resultIsComplexValued()`): `Arcsin(x)` with `x: real` has
 *   the type `complex`, and is `_SYS.casin(({ re: x, im: 0 }))`.
 * - `operand`: the lane of the operand (`COMPLEX_PROPAGATING_HEADS`), the
 *   type is not read.
 */
type ScalarFunctionLane = 'type' | 'inverse' | 'operand';

/**
 * Which complex operands of a head the structured route admits, from the
 * code that the handler of the existing emitter writes for them:
 *
 * - `any`: every complex operand, in both modes. The handler tests whether
 *   the operand is complex (`isComplexValued()`) before any other form, and
 *   writes the runtime helper of the operand.
 * - `no-pi`: a complex operand that does not read `Pi`, in both modes. For
 *   an operand `i·π·u` the handler writes another helper
 *   (`imaginaryPiMultiple()`: `_SYS.csinhipi(u)`), and that form reads
 *   `Pi`.
 * - `name`: a complex operand that is a name, in the `strict` mode. The
 *   handlers of `Arcosh` and `Artanh` test the operand as those of `any`
 *   do; no compilation of the engine has another complex operand for them.
 * - `none`: no complex operand: the head has a real lowering only.
 *
 * In the `complex` mode the existing compiler wraps the helper in
 * `_SYS.cplx()` when the type of the node is wide (`liftWideResult()` in
 * `compile-inner.ts`); a complex helper returns an `{re, im}` object, which
 * `_SYS.cplx()` returns as it is, so the route writes the helper alone.
 */
type ComplexOperands = 'any' | 'no-pi' | 'name' | 'none';

/**
 * The heads of `structuredScalarFunctionRule()`: the lane rule of each, and
 * the complex operands that it admits (`ComplexOperands`). `jump`: a head
 * of `JUMP_FUNCTIONS`, whose node of closed exact operands is its literal
 * when the existing compiler folds it (`closedJumpFold()`); `rounding`: a
 * head of `SHIFT_JUMP_HEADS`,
 * refused for an operand with an exact constant that no double holds
 * (`inexactJumpConstant()`).
 */
/**
 * The heads of an operand of `Fract` whose code on the existing route is
 * never a name or digits: an operation written with an operator, or a call
 * of a function with no identity lowering. `Abs`, `Conjugate`, `Ceil`,
 * `Floor`, `Round`, `Truncate`, `Typed` and a block can be written as their
 * operand (`identityPassthrough()`), and are not here.
 */
const FRACT_OPERAND_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Sqrt',
  'Exp',
  'Ln',
  'Sin',
  'Cos',
  'Tan',
  'Sinh',
  'Cosh',
  'Tanh',
  'Arctan',
  'Erf',
  'Gamma',
]);

const SCALAR_FUNCTION_HEADS: Readonly<
  Record<
    string,
    {
      readonly lane: ScalarFunctionLane;
      readonly complex: ComplexOperands;
      readonly jump?: 'jump' | 'rounding';
      /** The refusal of a real operand: the handler writes code that a
       *  parent can group wrongly. */
      readonly realRefusal?: string;
    }
  >
> = {
  Tan: { lane: 'type', complex: 'any' },
  Cot: { lane: 'type', complex: 'any' },
  Sec: { lane: 'type', complex: 'any' },
  Csc: { lane: 'type', complex: 'any' },
  Sinh: { lane: 'type', complex: 'no-pi' },
  Cosh: { lane: 'type', complex: 'no-pi' },
  Arctan: { lane: 'type', complex: 'any' },
  Arsinh: { lane: 'type', complex: 'any' },
  Gamma: { lane: 'type', complex: 'any' },
  // `_SYS.cconj(z)`, the function `conjugate`.
  Conjugate: { lane: 'type', complex: 'any' },
  Erf: { lane: 'type', complex: 'none' },
  Erfc: { lane: 'type', complex: 'none' },
  Digamma: { lane: 'type', complex: 'none' },
  Haversine: { lane: 'type', complex: 'none' },
  Arcsin: { lane: 'inverse', complex: 'any' },
  Arccos: { lane: 'inverse', complex: 'any' },
  Arcosh: { lane: 'inverse', complex: 'name' },
  Artanh: { lane: 'inverse', complex: 'name' },
  Sign: { lane: 'operand', complex: 'any', jump: 'jump' },
  Ceil: { lane: 'type', complex: 'none', jump: 'rounding' },
  Round: { lane: 'type', complex: 'none', jump: 'rounding' },
  // `(Math.PI / 2 - Math.atan(x))`, `Math.asinh(1 / (x))`; a complex
  // operand: `_SYS.cacot(z)`, `_SYS.cacsch(z)`.
  Arccot: { lane: 'type', complex: 'any' },
  Arcsch: { lane: 'type', complex: 'any' },
  // `Math.asin(1 / (x))`, `Math.acos(1 / (x))`, `Math.atanh(1 / (x))`,
  // `Math.acosh(1 / (x))`; the complex helper of the converted operand for
  // a type of numbers that are not real (`resultIsComplexValued()`).
  Arccsc: { lane: 'inverse', complex: 'any' },
  Arcsec: { lane: 'inverse', complex: 'any' },
  Arcoth: { lane: 'inverse', complex: 'any' },
  Arsech: { lane: 'inverse', complex: 'any' },
  // `(Math.cosh(x) / Math.sinh(x))`, the operand evaluated once; a complex
  // operand `i·π·u`: `_SYS.ccothipi(u)` (`imaginaryPiMultiple()`).
  Coth: { lane: 'type', complex: 'no-pi' },
  // A real operand is `1 / Math.cosh(x)` and `1 / Math.sinh(x)` with no
  // parentheses, which a parent groups as written: `2 / Sech(x)` is
  // `2 / 1 / Math.cosh(x)`, `2·sech(x)`.
  Sech: {
    lane: 'type',
    complex: 'no-pi',
    realRefusal:
      'Sech of a real operand is not in the structured route: the existing ' +
      'emitter writes 1 / Math.cosh(x) with no parentheses, which a parent ' +
      'groups as written',
  },
  Csch: {
    lane: 'type',
    complex: 'no-pi',
    realRefusal:
      'Csch of a real operand is not in the structured route: the existing ' +
      'emitter writes 1 / Math.sinh(x) with no parentheses, which a parent ' +
      'groups as written',
  },
  // `_SYS.factorial(x)`, `_SYS.factorial2(x)`, `Math.trunc(x)` and
  // `x - Math.floor(x)`: real lowerings only. `Fract` of a name or a number
  // literal is declined (`structuredScalarFunctionRule()`).
  Factorial: { lane: 'type', complex: 'none' },
  Factorial2: { lane: 'type', complex: 'none' },
  Truncate: { lane: 'type', complex: 'none', jump: 'rounding' },
  Fract: { lane: 'type', complex: 'none', jump: 'rounding' },
};

/**
 * The refusal of the complex operand `operand` of `head` in the mode `mode`
 * by the rule `complex` (`ComplexOperands`), or `undefined`.
 */
function complexOperandRefusal(
  head: string,
  operand: Expression,
  complex: ComplexOperands,
  mode: 'strict' | 'complex'
): string | undefined {
  if (complex === 'none')
    return `${head} with a complex operand is not in the structured route`;
  if (complex === 'no-pi')
    return operand.symbols.includes('Pi')
      ? `${head} of the complex operand ${nodeText(operand)}, which reads ` +
          `Pi, is not in the structured route: the existing emitter writes ` +
          `another helper for a multiple of i·π`
      : undefined;
  if (complex === 'name') {
    if (!isSymbol(operand))
      return (
        `${head} of the complex operand ${nodeText(operand)} is in the ` +
        `structured route only when the operand is a name`
      );
    if (mode === 'complex')
      return (
        `${head} of a complex operand in the complex mode is not in the ` +
        `structured route`
      );
  }
  return undefined;
}

/**
 * The functions of one operand of `SCALAR_FUNCTION_HEADS` on the structured
 * route, for the compile mode `mode`. The handler of each in the existing
 * emitter (`javascript-target.ts`) writes, in its order:
 *
 * - For a complex operand (`isComplexValued()`), a runtime helper of it:
 *   `_SYS.ctan(z)`, `_SYS.casin(z)`, `_SYS.cgamma(z)`, `_SYS.csign(z)`,
 *   `_SYS.cconj(z)` (the form `conjugate`), …; `Sinh` and `Cosh` write
 *   `_SYS.csinhipi(u)` and `_SYS.ccoshipi(u)` for `i·π·u`
 *   (`imaginaryPiMultiple()`). `Erf`, `Erfc`, `Digamma`, `Ceil` and `Round`
 *   have a real lowering only (`isRealOnlyLowering()`), which declines a
 *   complex operand in the `strict` mode and guards it in the `complex`
 *   mode; `Haversine` writes its real code. The route admits the complex
 *   operands of `ComplexOperands`, the same helper of the same operand, and
 *   declines the others.
 * - `Tan` of a multiple of `Pi`: `_SYS.tanpi(u)`, as `Sin` and `Cos`
 *   (`piMultipleFacts()`).
 * - `Arcsin`, `Arccos`, `Arcosh`, `Artanh` of a real operand, when the
 *   type of the node is one of numbers that are not real
 *   (`resultIsComplexValued()`): the complex helper of the converted
 *   operand. The type of `Arcsin(x)` is `complex` for `x: real`, and
 *   `number` for a name `x` with no declared type, so the same program
 *   is `_SYS.casin(({ re: x, im: 0 }))` with the declaration and
 *   `Math.asin(x)` without it. The route reads the same type
 *   (`ScalarFunctionLane`).
 * - `Conjugate` of a real operand: the operand itself
 *   (`identityPassthrough()`, the form `identity`).
 * - `Ceil` and `Round` of an operand that the compiler proves an integer:
 *   the operand itself (`identityPassthrough()`). `Math.ceil` and the code
 *   of `Round` give the same double for every integer, `-0`, an infinity and
 *   `NaN`, so the route writes them for every real operand. `Round` is
 *   admitted for `ce.roundingTies` `'away-from-zero'` only, whose code is
 *   `(Math.sign(x) * Math.round(Math.abs(x)))` (`jsRoundToInteger()`); a
 *   `Ceil` or a `Round` with a second operand (a step) is declined.
 * - Otherwise the real call: `_SYS.tan(x)`, `Math.sinh(x)`, `_SYS.erf(x)`,
 *   `_SYS.gamma(x)`, `Math.sign(x)`, `(1 - Math.cos(x)) / 2` for
 *   `Haversine`, …. A literal operand is not folded (`_SYS.erf(2.5)`).
 *
 * The result of a real operand is real, also for an integer operand; the
 * result of `Conjugate` has the fact of its operand.
 */
function structuredScalarFunctionRule(
  head: string,
  mode: 'strict' | 'complex',
  forms: Map<Expression, StructuredForm>,
  inputs: ReadonlySet<string> = new Set()
) {
  const { lane, complex, jump, realRefusal } = SCALAR_FUNCTION_HEADS[head];
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 1)
        return w.refuse(
          node,
          'signature',
          `${head} with other than one operand is not in the structured route`
        );
      if (jump === 'rounding') {
        const constant = inexactJumpConstant(node.ops, scope, inputs);
        if (constant !== undefined)
          return w.refuse(
            node,
            'signature',
            `${head} of an operand with the exact constant ${nodeText(constant)}, ` +
              `which no double holds exactly, is not in the structured route: the ` +
              `existing compiler rewrites such a node or declines it ` +
              `(inexact-jump-operand)`
          );
      }
      if (head === 'Round' && node.engine.roundingTies !== 'away-from-zero')
        return w.refuse(
          node,
          'signature',
          `Round with the rounding of ties ${node.engine.roundingTies} is not ` +
            `in the structured route, which has the ties away from zero only`
        );
      const [facts] = operandFacts(node, scope, context, w);
      if (facts.type.kind === 'boolean')
        return w.refuse(
          node,
          'signature',
          `${head} with a boolean operand is not in the structured route`
        );
      if (facts.type.kind === 'complex') {
        const refusal = complexOperandRefusal(head, node.op1, complex, mode);
        if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
        if (head === 'Conjugate') forms.set(node, 'conjugate');
        return w.valueFacts(node, { kind: 'complex' }, [
          w.convert(facts, facts.type)!,
        ]);
      }
      if (realRefusal !== undefined)
        return w.refuse(node, 'signature', realRefusal);
      // The handler of `Fract` writes `t - Math.floor(t)` in its parent with
      // no parentheses when the code of the operand is a name or digits
      // (`inlineExpression()`): `2 · Fract(b)` with a parameter `b` is
      // `2 * b - Math.floor(b)` (CE-1196), and so is `2 · Fract(Abs(p))`
      // with `p: real<0..>`, whose operand the existing emitter writes as
      // `p` (`identityPassthrough()`). The rule admits only an operand whose
      // code is certainly not a name or digits: an arithmetic operation with
      // an operator, or a call that no lowering writes as its operand
      // (`FRACT_OPERAND_HEADS`); another operand is bound in a function
      // that the handler calls, one term.
      if (
        head === 'Fract' &&
        !(isFunction(node.op1) && FRACT_OPERAND_HEADS.has(node.op1.operator))
      )
        return w.refuse(
          node,
          'signature',
          `Fract of the operand ${nodeText(node.op1)} is not in the ` +
            `structured route: the existing emitter writes x - Math.floor(x) ` +
            `in its parent with no parentheses when the code of the operand ` +
            `is a name or digits (CE-1196)`
        );
      if (head === 'Tan' && readsAsPiMultiple(node.op1))
        return piMultipleFacts(head, node, facts, forms, w, mode);
      let result: 'real' | 'complex' = 'real';
      if (lane !== 'operand') {
        const type = finitePartOfType(node.type.type);
        if (isNonRealNumber(type)) {
          if (lane !== 'inverse')
            return w.refuse(
              node,
              'signature',
              `${nodeText(node)} has the type ${node.type.toString()}, which is ` +
                `not real: the existing compiler reads its value as complex, and ` +
                `its handler writes the real call`
            );
          result = 'complex';
        } else if (mode === 'complex' && !isSubtype(type, 'real'))
          return w.refuse(
            node,
            'signature',
            `${nodeText(node)} has the type ${node.type.toString()}, which is ` +
              `not real, in the complex mode: the existing compiler wraps the ` +
              `real call in _SYS.cplx`
          );
      }
      if (head === 'Conjugate') {
        forms.set(node, 'identity');
        return w.valueFacts(node, facts.type, [w.convert(facts, facts.type)!]);
      }
      return w.valueFacts(node, { kind: result }, [
        w.convert(facts, { kind: result })!,
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * The heads of `realCallRule()`: the lowering of each number of operands
 * (`RealCallForm`; `variadic`: of two operands or more), and:
 *
 * - `continuation`: a head of `COMPLEX_CONTINUATION_HEADS`, whose handler
 *   writes the complex kernel of lifted operands (`continuationCall()` in
 *   `javascript-target.ts`) in the `complex` mode when the value can be
 *   complex (`continuesToComplex()`). The rule admits it in that mode only
 *   when `complexContinuation()` proves the value real.
 * - `result`: the kind of the result, `real` when absent; `operand` for
 *   `Real` (the operand itself), `join` for `Clamp` (an integer when the
 *   three operands are).
 * - `operand`: `boolean` for `Boole`, whose operand is a condition; the
 *   operands of every other head are reals or integers.
 * - `domain`: the operands, by index, that must be provably non-negative
 *   (`nonNegative`, `isNonNegative`) or positive (`positive`,
 *   `isPositive`), where the existing kernel gives `NaN` or a wrong real
 *   number outside that range (`why`): `CosIntegral(x)` for a negative `x`
 *   is `Ci(|x|)`, where the value is `Ci(|x|) + iπ` (CE-1225);
 *   `GammaRegularized(2, -0.5)`, `Gamma(1, -1)`, `AGM(-2.5, -1)` and
 *   `Beta(-3, 2)` are `NaN`, where the interpreter has a finite value
 *   (CE-1226, CE-1227).
 */
type RealCallEntry = {
  readonly arities: Readonly<Record<number, RealCallForm | 'identity'>>;
  readonly variadic?: RealCallForm;
  readonly continuation?: true;
  readonly result?: 'integer' | 'operand' | 'join';
  readonly operand?: 'boolean';
  readonly domain?: {
    readonly nonNegative?: readonly number[];
    readonly positive?: readonly number[];
    readonly why: string;
  };
};

/** The `domain` of the kernels that give `NaN` for a negative argument,
 *  where the interpreter has a finite value for some of these arguments. */
const NAN_BELOW_ZERO =
  'the existing kernel gives NaN for a negative argument, where the ' +
  'interpreter has a finite value for some of them';

const REAL_CALL_HEADS: Readonly<Record<string, RealCallEntry>> = {
  // Real-only heads mapped to one helper (`stringHelperIsRealOnly()`), or
  // listed in `JS_REAL_ONLY_LOWERINGS` or `REAL_ONLY_BY_DEFINITION`.
  Heaviside: { arities: { 1: { call: 'heaviside' } } },
  GammaLn: { arities: { 1: { call: 'ln-gamma' } } },
  Sinc: { arities: { 1: { call: 'sinc' } } },
  Erfi: { arities: { 1: { call: 'erfi' } } },
  ErfInv: { arities: { 1: { call: 'erf-inv' } } },
  Trigamma: { arities: { 1: { call: 'trigamma' } } },
  FresnelS: { arities: { 1: { call: 'fresnel-s' } } },
  FresnelC: { arities: { 1: { call: 'fresnel-c' } } },
  SinIntegral: { arities: { 1: { call: 'sin-integral' } } },
  CosIntegral: {
    arities: { 1: { call: 'cos-integral' } },
    domain: {
      nonNegative: [0],
      why:
        'the existing kernel gives Ci(|x|) for a negative x, where the ' +
        'value is Ci(|x|) + iπ',
    },
  },
  ExpIntegralEi: { arities: { 1: { call: 'exp-integral-ei' } } },
  LogIntegral: { arities: { 1: { call: 'log-integral' } } },
  DirichletEta: { arities: { 1: { call: 'dirichlet-eta' } } },
  DirichletBeta: { arities: { 1: { call: 'dirichlet-beta' } } },
  Zeta: { arities: { 1: { call: 'zeta' }, 2: { call: 'zeta-generalized' } } },
  StieltjesGamma: {
    arities: { 1: { call: 'stieltjes' }, 2: { call: 'stieltjes-generalized' } },
  },
  GammaRegularized: {
    arities: { 2: { call: 'gamma-q' } },
    domain: { nonNegative: [1], why: NAN_BELOW_ZERO },
  },
  Beta: {
    arities: { 2: { call: 'beta' } },
    domain: {
      positive: [0, 1],
      why:
        'the existing kernel gives NaN at a non-positive integer, where ' +
        'the value can be a finite limit',
    },
  },
  Binomial: { arities: { 2: { call: 'real-binomial' } } },
  Choose: { arities: { 2: { call: 'real-binomial' } } },
  ClausenCl: { arities: { 2: { call: 'clausen' } } },
  EllipticF: { arities: { 2: { call: 'elliptic-f' } } },
  EllipticPi: { arities: { 2: { call: 'elliptic-pi' } } },
  BesselJ: { arities: { 2: { call: 'bessel-j' } } },
  BesselY: { arities: { 2: { call: 'bessel-y' } } },
  BesselI: { arities: { 2: { call: 'bessel-i' } } },
  BesselK: { arities: { 2: { call: 'bessel-k' } } },
  // `_SYS.agm(1, x)` for one operand.
  AGM: {
    arities: { 1: { call: 'agm', before: 1 }, 2: { call: 'agm' } },
    domain: { nonNegative: [0, 1], why: NAN_BELOW_ZERO },
  },
  PolyGamma: { arities: { 2: { call: 'polygamma' } } },
  Remainder: { arities: { 2: { call: 'real-remainder' } } },
  // `((_a) => _a.length ? _a.reduce((_x, _y) => _SYS.gcd(_x, _y)) : 0)([…])`.
  GCD: { arities: {}, variadic: { fold: 'real-gcd' } },
  LCM: { arities: {}, variadic: { fold: 'real-lcm' } },
  // `_SYS.chop(x, tolerance)`, the tolerance of the engine
  // (`realCallRule()`).
  Chop: { arities: { 1: { call: 'chop' } } },
  Clamp: { arities: { 3: 'clamp' }, result: 'join' },
  KroneckerDelta: {
    arities: { 1: 'kronecker-delta' },
    variadic: 'kronecker-delta',
    result: 'integer',
  },
  Boole: { arities: { 1: 'boole' }, result: 'integer', operand: 'boolean' },
  Real: { arities: { 1: 'identity' }, result: 'operand' },
  Imaginary: { arities: { 1: 'imaginary' }, result: 'integer' },
  Argument: { arities: { 1: 'argument' } },
  // The heads with a complex continuation.
  HurwitzZeta: { arities: { 2: { call: 'hurwitz-zeta' } }, continuation: true },
  PolyLog: { arities: { 2: { call: 'polylog' } }, continuation: true },
  LambertW: {
    arities: { 1: { call: 'lambert-w' }, 2: { call: 'lambert-w-branch' } },
    continuation: true,
  },
  EllipticK: { arities: { 1: { call: 'elliptic-k' } }, continuation: true },
  // The incomplete `EllipticE(φ, m)` is real-only; `complexContinuation()`
  // answers `real` for it.
  EllipticE: {
    arities: {
      1: { call: 'elliptic-e' },
      2: { call: 'elliptic-e-incomplete' },
    },
    continuation: true,
  },
};

/** The rule of `Gamma(s, z)`, the upper incomplete gamma: the head is also
 *  a head of `SCALAR_FUNCTION_HEADS` for one operand. */
const UPPER_GAMMA: RealCallEntry = {
  arities: { 2: { call: 'gamma-upper' } },
  continuation: true,
  domain: { nonNegative: [1], why: NAN_BELOW_ZERO },
};

/** The rule of `Gamma`: `upper` for two operands, `gamma` otherwise. */
function upperGammaRule(
  gamma: ReturnType<typeof structuredScalarFunctionRule>,
  upper: ReturnType<typeof realCallRule>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) =>
      (isFunction(node) && node.nops === 2 ? upper : gamma).walk(
        node,
        scope,
        context,
        w
      ),
  };
}

/** The heads whose code can throw on JavaScript (`canThrow()` in
 *  `javascript-structured-lower.ts`). */
const THROWING_HEADS: ReadonlySet<string> = new Set([
  'Mod',
  'Remainder',
  'GCD',
  'LCM',
  'ReplaceAt',
]);

/** Whether the code of `node` can throw: a node of `THROWING_HEADS`, or a
 *  call that is not a library operator (a helper or a function of the
 *  host). */
function mayThrow(node: Expression): boolean {
  const seen = new Set<Expression>();
  const visit = (n: Expression): boolean => {
    if (!isFunction(n) || seen.has(n)) return false;
    seen.add(n);
    if (THROWING_HEADS.has(n.operator) || !isLibraryOperator(n, n.operator))
      return true;
    return n.ops.some(visit);
  };
  return visit(node);
}

/** The numbers of operands of an entry of `REAL_CALL_HEADS`, in a message. */
function realCallArities(entry: {
  readonly arities: Readonly<Record<number, unknown>>;
  readonly variadic?: unknown;
}): string {
  const counts = Object.keys(entry.arities).map(Number);
  const variadic = entry.variadic !== undefined;
  if (counts.length === 0) return 'two operands or more';
  return (
    counts.map((n) => `${n}`).join(' or ') +
    (variadic
      ? ' operand or more'
      : counts.at(-1) === 1
        ? ' operand'
        : ' operands')
  );
}

/**
 * The library heads that the existing emitter writes as calls of real
 * kernels of their operands (`REAL_CALL_HEADS`), on the structured route,
 * for the compile mode `mode`. The handler of each in the existing emitter
 * (`javascript-target.ts`) writes, for real operands:
 *
 * - one runtime helper of the operands: a plain name (`Heaviside:
 *   '_SYS.heaviside'`, `GammaRegularized: '_SYS.gammaQ'`), or a function of
 *   the operands that calls one (`_SYS.polygamma(n, x)`, `_SYS.agm(1, x)`
 *   for `AGM(x)`, `_SYS.chop(x, ${ce.tolerance})`, `_SYS.zeta(s)` and
 *   `_SYS.zetaGeneralized(s, a)`, `_SYS.remainder(a, b)`), with no
 *   parentheses that a parent needs: a call. A literal operand is not
 *   folded, but a node of closed exact operands of a head of
 *   `JUMP_FUNCTIONS` (`Heaviside`, `Remainder`, `Chop`) is its literal
 *   (`closedJumpFold()`).
 * - `GCD` and `LCM`: the `reduce` of `_SYS.gcd` or `_SYS.lcm` over the
 *   array of the operands, which is the operand itself for one operand
 *   (declined here). `_SYS.remainder`, `_SYS.gcd` and `_SYS.lcm` throw a
 *   `RangeError` for an operand beyond the safe integers or infinite, on
 *   both routes.
 * - `KroneckerDelta`: `(x === 0 ? 1 : 0)`, or the test of each operand
 *   against the first one with `===`; `Clamp`: `Math.min(Math.max(x, lo),
 *   hi)`; `Boole`: `((c) ? 1 : 0)`; `Real`: the operand
 *   (`identityPassthrough()`); `Imaginary`: `0`; `Argument`:
 *   `Math.atan2(0, (x) + 0)`.
 *
 * Each of these heads is real-only on this target (`isRealOnlyLowering()`)
 * or real by definition, so the existing compiler reads its value as real
 * whatever the type of the node, and writes no `_SYS.cplx()` around it. A
 * complex operand is declined: the existing compiler declines it in the
 * `strict` mode, and guards it at run time in the `complex` mode
 * (`realOperandGuard()`), or writes the complex code of `Real`,
 * `Imaginary`, `Argument` and `KroneckerDelta`. A head with a complex
 * continuation (`HurwitzZeta`, `PolyLog`, `LambertW`, `EllipticK`,
 * `EllipticE`, `Gamma` of two operands) writes the complex kernel in the
 * `complex` mode unless `complexContinuation()` proves the value real; the
 * rule reads the same predicate on the same operands. A list operand is
 * declined: the existing compiler broadcasts the head.
 */
function realCallRule(
  head: string,
  mode: 'strict' | 'complex',
  forms: Map<Expression, StructuredForm>,
  binds: PassBinds,
  entry: RealCallEntry = REAL_CALL_HEADS[head]
) {
  return {
    walk: (node, scope, context, w) => {
      const nops = isFunction(node) ? node.nops : 0;
      let form: RealCallForm | 'identity' | undefined = Object.hasOwn(
        entry.arities,
        nops
      )
        ? entry.arities[nops]
        : nops >= 2
          ? entry.variadic
          : undefined;
      if (!isFunction(node) || form === undefined)
        return w.refuse(
          node,
          'signature',
          `${head} with ${nops} operand${nops === 1 ? '' : 's'} is not in the ` +
            `structured route, which has ${realCallArities(entry)}`
        );
      const facts = operandFacts(node, scope, context, w);
      const operandKind = entry.operand ?? 'number';
      for (const f of facts) {
        const kind = f.type.kind;
        if (operandKind === 'boolean' ? kind !== 'boolean' : kind === 'boolean')
          return w.refuse(
            node,
            'signature',
            `${head} with an operand of the type \`${fragmentTypeToString(f.type)}\` ` +
              `is not in the structured route`
          );
        if (kind === 'complex')
          return w.refuse(
            node,
            'signature',
            `${head} with a complex operand is not in the structured route: ` +
              `the existing compiler declines it in the strict mode, and in ` +
              `the complex mode it writes complex code or a guard of the operand`
          );
        if (operandKind !== 'boolean' && kind !== 'real' && kind !== 'integer')
          return w.refuse(
            node,
            'signature',
            `${head} with an operand of the type \`${fragmentTypeToString(f.type)}\` ` +
              `is not in the structured route: the existing compiler ` +
              `broadcasts the head over a list`
          );
      }
      // A predicate of the engine about an operand that names a binding of
      // the pass reads an engine symbol of the same name (`PassBinds`).
      const bound = (operand: Expression): boolean =>
        namesBound(operand, (name) => binds(name, scope));
      const { domain } = entry;
      if (domain !== undefined) {
        const outside = node.ops.find(
          (operand, i) =>
            (domain.nonNegative?.includes(i) === true ||
              domain.positive?.includes(i) === true) &&
            (bound(operand) ||
              (domain.positive?.includes(i) === true
                ? operand.isPositive !== true
                : operand.isNonNegative !== true))
        );
        if (outside !== undefined)
          return w.refuse(
            node,
            'signature',
            `${nodeText(node)} with the operand ${nodeText(outside)}, which ` +
              `is not provably ${domain.positive?.includes(node.ops.indexOf(outside)) === true ? 'positive' : 'non-negative'}` +
              `${bound(outside) ? ' (it names a parameter, a local or an index)' : ''}, ` +
              `is not in the structured route: ${domain.why}`
          );
      }
      // The existing compiler evaluates every operand of `KroneckerDelta`
      // and of the fold of `GCD` and `LCM` before it compares or folds; the
      // route compares the second operand before it evaluates the third,
      // and folds the first two before it evaluates the third, so that a
      // throw of a later operand comes after the throw of the fold, or
      // does not come.
      if (
        (form === 'kronecker-delta' ||
          (typeof form === 'object' && 'fold' in form)) &&
        node.nops >= 3
      ) {
        const throwing = node.ops.slice(2).find(mayThrow);
        if (throwing !== undefined)
          return w.refuse(
            node,
            'signature',
            `${nodeText(node)} with the operand ${nodeText(throwing)}, which ` +
              `can throw, after the second is not in the structured route: ` +
              `the existing compiler evaluates every operand first`
          );
      }
      if (
        entry.continuation === true &&
        mode === 'complex' &&
        node.ops.some(bound)
      )
        return w.refuse(
          node,
          'signature',
          `${nodeText(node)} names a parameter, a local or an index, and in ` +
            `the complex mode the existing compiler decides from the types ` +
            `of the engine whether it writes the complex kernel of ${head}`
        );
      if (
        entry.continuation === true &&
        mode === 'complex' &&
        complexContinuation(head, node.ops) !== 'real'
      )
        return w.refuse(
          node,
          'signature',
          `${nodeText(node)} can have a complex value, and in the complex mode ` +
            `the existing emitter writes the complex kernel of ${head}`
        );
      // `Chop` has the type of its operand: the existing compiler reads a
      // node of the type `number` as complex in the complex mode and writes
      // `_SYS.cplx(_SYS.chop(…))`.
      if (
        head === 'Chop' &&
        mode === 'complex' &&
        (bound(node.op1) ||
          !isSubtype(finitePartOfType(node.type.type), 'real'))
      )
        return w.refuse(
          node,
          'signature',
          `${nodeText(node)} has the type ${node.type.toString()}, which the ` +
            `existing compiler reads as a complex value in the complex mode`
        );
      // The tolerance of the engine, a number literal of the code.
      if (head === 'Chop')
        form = { call: 'chop', after: node.engine.tolerance ?? 1e-10 };
      forms.set(node, form);
      if (form === 'identity')
        return w.valueFacts(node, facts[0].type, [
          w.convert(facts[0], facts[0].type)!,
        ]);
      const result: 'real' | 'integer' =
        entry.result === 'integer'
          ? 'integer'
          : entry.result === 'join' &&
              facts.every((f) => f.type.kind === 'integer')
            ? 'integer'
            : 'real';
      return w.valueFacts(
        node,
        { kind: result },
        facts.map((f) =>
          w.convert(
            f,
            operandKind === 'boolean' ||
              form === 'kronecker-delta' ||
              result === 'integer'
              ? f.type
              : { kind: 'real' }
          )!
        )
      );
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * `Sin`, `Cos`, `Tanh`, `Abs` (one operand), `Arctan2` and `Hypot` (two
 * operands; `Math.hypot(a, b)` for two real operands) on
 * the structured route, for the compile mode `mode`. The real code of each
 * is total, and its result is real for real operands: the handler of the
 * existing emitter (`javascript-target.ts`) writes `Math.sin`, `Math.cos`,
 * `Math.tanh`, `Math.abs` or `Math.atan2` of a real operand, and the
 * structured route writes the same call. The result is `real`, also for
 * integer operands, but `Abs` of an integer operand is an integer.
 *
 * The cases where the existing handler writes other code are declined:
 *
 * - `Sin` and `Cos` of an operand that reads `Pi`: the handler writes
 *   `_SYS.sinpi(u)` or `_SYS.cospi(u)` for a multiple `π·u`
 *   (`piMultiple()`), which gives `0` for `sin(π)` where `Math.sin(π)` is
 *   `1.2e-16`. The route writes the same call for `Multiply(Pi, u)`
 *   (`piMultipleFacts()`), and refuses the other operands that
 *   `piMultiple()` reads past their head (`readsAsPiMultiple()`), which is
 *   wider than that rule. An operand that reads `Pi` under another head
 *   (`Math.asin(a) + Math.PI`) is the call of the operand on both routes.
 * - A complex operand: the handler writes one runtime helper of the
 *   operand (`_SYS.csin`, `_SYS.ccos`, `_SYS.ctanh`, `_SYS.cabs`), tested
 *   before every other form, but `Tanh` of `i·π·u` is `_SYS.ctanhipi(u)`
 *   and `Abs` of a sum of a real and an imaginary part is
 *   `Math.hypot(a, b)` (`tryGetJSComplexParts()`). The route admits every
 *   complex operand of `Sin` and `Cos` that does not read as a multiple of
 *   `Pi` (`readsAsPiMultiple()`), a complex operand of `Tanh` that
 *   does not read `Pi` (`ComplexOperands`), in both modes, and a complex
 *   operand of `Abs` that is a name; it declines the others. In the
 *   `complex` mode the handler wraps the helper of `Sin`, `Cos` and `Tanh`
 *   in `_SYS.cplx()`, which returns the object of the helper as it is.
 *   `Arctan2` and `Hypot` with a complex operand are declined.
 * - A real operand and a node whose type, without its infinities and
 *   `NaN`, is not real in the `complex` mode, or one of numbers that are
 *   not real: the compiler wraps the real call in `_SYS.cplx()` there
 *   (`liftWideResult()`), or reads it as complex. `Sin(a/y)` with `a`, `y`
 *   of the type `real` has the type `number`.
 *
 * `Abs` of a real operand that the existing emitter proves non-negative
 * (`isNonNegative()` of `compile-conditions.ts`: a number literal that is
 * at least 0, `-0` included, or an operand whose `isNonNegative` is `true`)
 * is the operand itself on the existing route (`identityPassthrough()`).
 * The rule reads the same predicate and records the form `abs-identity`,
 * which the lowering writes as the operand: `1 / Abs(p)` with
 * `p: real<0..>` is `-Infinity` at `p = -0` on both routes, where
 * `Math.abs` would give `Infinity`. Every other `Abs` records `abs`.
 */
function structuredFunctionRule(
  head: 'Sin' | 'Cos' | 'Tanh' | 'Abs' | 'Arctan2' | 'Hypot',
  mode: 'strict' | 'complex',
  forms: Map<Expression, StructuredForm>
) {
  const arity = head === 'Arctan2' || head === 'Hypot' ? 2 : 1;
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== arity)
        return w.refuse(
          node,
          'signature',
          `${head} with other than ${arity} operand${arity === 1 ? '' : 's'} is not in the structured route`
        );
      const facts = operandFacts(node, scope, context, w);
      if (facts.some((f) => f.type.kind === 'boolean'))
        return w.refuse(
          node,
          'signature',
          `${head} with a boolean operand is not in the structured route`
        );
      if ((head === 'Sin' || head === 'Cos') && readsAsPiMultiple(node.op1))
        return piMultipleFacts(head, node, facts[0], forms, w, mode);
      if (facts.some((f) => f.type.kind === 'complex')) {
        const refusal =
          head === 'Arctan2' || head === 'Hypot'
            ? `${head} with a complex operand is not in the structured route`
            : head === 'Abs'
              ? !isSymbol(node.op1)
                ? `Abs of the complex operand ${nodeText(node.op1)} is in the ` +
                  `structured route only when the operand is a name: the ` +
                  `existing emitter writes Math.hypot of the parts of some ` +
                  `complex operands`
                : undefined
              : complexOperandRefusal(
                  head,
                  node.op1,
                  head === 'Tanh' ? 'no-pi' : 'any',
                  mode
                );
        if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
        if (head === 'Abs') forms.set(node, 'abs');
        return w.valueFacts(
          node,
          { kind: head === 'Abs' ? 'real' : 'complex' },
          [w.convert(facts[0], facts[0].type)!]
        );
      }
      // A real operand: the handler writes the real call, and the compiler
      // reads the node by its type, as for the lane `type` of
      // `ScalarFunctionLane`. In the `complex` mode it wraps the call in
      // `_SYS.cplx()` when the type is wide (`Sin(a/y)` with `a`, `y` of
      // the type `real` has the type `number`).
      const type = finitePartOfType(node.type.type);
      if (isNonRealNumber(type))
        return w.refuse(
          node,
          'signature',
          `${nodeText(node)} has the type ${node.type.toString()}, which is ` +
            `not real: the existing compiler reads its value as complex, and ` +
            `its handler writes the real call`
        );
      if (mode === 'complex' && !isSubtype(type, 'real'))
        return w.refuse(
          node,
          'signature',
          `${nodeText(node)} has the type ${node.type.toString()}, which is ` +
            `not real, in the complex mode: the existing compiler wraps the ` +
            `real call in _SYS.cplx`
        );
      if (head === 'Abs') {
        const operand = node.op1;
        const nonNegative = isNumber(operand)
          ? operand.im === 0 && operand.re >= 0
          : operand.isNonNegative === true;
        forms.set(node, nonNegative ? 'abs-identity' : 'abs');
      }
      const integer = head === 'Abs' && facts[0].type.kind === 'integer';
      return w.valueFacts(
        node,
        { kind: integer ? 'integer' : 'real' },
        facts.map((f) => w.convert(f, integer ? f.type : { kind: 'real' })!)
      );
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * `Power` on the structured route, for the compile mode `mode`, in the
 * forms of `powerForm()`; every other `Power` is refused. The existing
 * emitter (`Power` in `javascript-target.ts`) decides each form so:
 *
 * - `Power(x, 2)`: `(x * x)` for a name or a literal, `_SYS.pow2(x)`
 *   (`x * x`) for another real operand, and the product of the components
 *   for a complex one. The route writes the product of the value with
 *   itself. A real operand gives a real result, an integer one an integer,
 *   a complex one a complex result.
 * - `Power(ExponentialE, x)`, the canonical form of `Exp(x)`: `Math.exp(x)`
 *   for a real exponent that is not a number literal, as the route writes
 *   it (`exp`). For a number literal exponent the handler writes other
 *   code (`(Math.E * Math.E)` for 2): declined. An exponent that reads no
 *   input, parameter or local (only constants and captured bindings) is
 *   declined too: the compiler replaces it by its value when that value is
 *   not an integer (`knownExponentPower()`), and then writes the code of a
 *   number literal exponent (`Math.sqrt(Math.E)` for `e^c` with
 *   `c = 0.5`). For a complex exponent it
 *   writes `_SYS.cexp(z)`, or `_SYS.cexppi(u)` for `a + iπu`
 *   (`eulerPiSplit()`, which needs an exponent that reads `Pi`); the route
 *   admits a complex exponent that does not read `Pi` (`e^(i·x)` is
 *   `_SYS.cexp(({ re: 0, im: _.x }))`), in both modes: the compiler does
 *   not wrap a `Power` in `_SYS.cplx()`. For a real exponent the handler
 *   reads the type of the node,
 *   without its infinities and `NaN` (`resultIsComplexValued()`, and
 *   `resultIsWideUnderComplexDiscipline()` in the `complex` mode): the
 *   route declines a real exponent for which that type is one of numbers
 *   that are not real in the `strict` mode, and is not real in the
 *   `complex` mode. The `number` of `e^x` for a name `x` with no declared
 *   type is `Math.exp(x)` in the `strict` mode.
 * - `Power(b, 1.5)` and `Power(b, 3/2)`, for a real base that `signOf()`
 *   proves non-negative: the handler writes `(b * Math.sqrt(b))` for a
 *   name or a literal and `_SYS.pow3h(b)` (`b * Math.sqrt(b)`) for another
 *   base (`realRadicalPower()`, which reads `assumedRealNonNegative()`, the
 *   rules that `signOf()` mirrors). The route writes the product of the
 *   base and its square root, the base evaluated once. For another base the
 *   handler writes `Math.pow(b, 1.5)` in the `strict` mode, the form
 *   `real-pow` (`constantPowerForm()`), and `_SYS.cpow` in the `complex`
 *   mode, declined.
 * - A finite real number literal base, with a number literal exponent: the
 *   handler folds the power of two finite number literals to a literal
 *   before every other rule, also with `constantFold: false`
 *   (`tryGetConstant()` of both operands): `Math.pow(b, e)`, or for a `NaN`
 *   power the principal complex value, the real root of a negative base or
 *   `NaN` (`foldedLiteralPower()`). The route writes the same literal, the
 *   form `{ folded }`, and declines a folded value whose shape is not the
 *   one that the parent reads. It is not a product of the base: `10^1.5` is
 *   `31.622776601683793` folded and `31.622776601683796` as
 *   `b * Math.sqrt(b)`.
 * - An exponent that is not a number literal (`s^(d/2)`): the handler
 *   writes `_SYS.pow(b, e)` (the power of the interpreter for a real base
 *   and a real exponent, the function `pow`) when both operands are real
 *   and the node is not on the complex lane. In the `strict` mode the node
 *   is on the complex lane when the type of the node, without its
 *   infinities and `NaN`, is one of numbers that are not real
 *   (`resultIsComplexValued()`); in the `complex` mode also when that type
 *   is not real, as the `number` of `x^y` (the handler writes `_SYS.cpow`
 *   there, `resultIsWideUnderComplexDiscipline()`). The rule declines
 *   these, a complex operand, a base that is a symbol named
 *   `ExponentialE`, and an exponent with no unknown (every symbol in it
 *   has a value: a constant, an assigned symbol, also a local or a
 *   parameter that has one in its scope). The compiler replaces some of
 *   these by their value (`knownExponentPower()`: an exponent that reads
 *   an assigned symbol and has a value that is not an integer) and then
 *   writes the code of a literal exponent; the rule declines all of them,
 *   which is wider. A number literal base is admitted: with an
 *   exponent that is not a literal, the handler does not fold it.
 * - A float literal exponent that is not an integer (`ln(u)^1.6`): for a
 *   real base that the engine does not prove non-negative, the handler
 *   reads the exponent as the interpreter does (`negativeBaseFloatPower()`,
 *   with `realPowerBranchTerms()`), and when its recovered denominator `q`
 *   is odd writes the real root, `Math.pow(Math.abs(b), e)`, negated for a
 *   negative base when the recovered numerator is odd. This comes before
 *   the complex promotion, in both modes, and the parent reads the node as
 *   real (`isComplexValued()`). The route writes `abs-pow` (an even
 *   numerator) or `signed-pow` (an odd one), and declines the exponent
 *   `2/3` (`_SYS.pow2(Math.cbrt(b))`, `realRadicalPower()`). A complex base
 *   takes the branch of the handler for it, before these:
 *   `_SYS.cpow(b, e)`, or a chain of products for an integer exponent from
 *   3 to 8 (`constantPowerForm()`). A base that the engine proves
 *   non-negative and an exponent with an even or no recovered denominator
 *   take the other branches of the handler, as an integer exponent (`x^3`,
 *   `x^-2`) and an exact exponent (`5/2`) do: `constantPowerForm()` gives
 *   the form of each.
 *
 * The rule records the form of each node that it admits
 * (`StructuredForm`); the lowering reads that record.
 */
function structuredPowerRule(
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf,
  forms: Map<Expression, StructuredForm>,
  varsKeys?: ReadonlyMap<string, unknown>
) {
  return {
    walk: (node, scope, context, w) => {
      const form = powerForm(node);
      if (!isFunction(node) || form === undefined)
        return w.refuse(
          node,
          'signature',
          isFunction(node) && node.nops === 2
            ? `Power with the exponent ${nodeText(node.op2)} is not in the ` +
                `structured route, which has a finite real number literal ` +
                `exponent, an exponent that is not a number literal, and the ` +
                `base ExponentialE`
            : 'Power with other than two operands is not in the structured route'
        );
      const realType = isSubtype(finitePartOfType(node.type.type), 'real');
      if (form === 'exp') {
        const exponent = w.value(node.op2, scope, context);
        const kind = exponent.type.kind;
        const refusal =
          kind === 'boolean' || kind === 'list'
            ? `the exponential of a ${kind} is not in the structured route`
            : isNumber(node.op2)
              ? `the exponential of the number literal ${nodeText(node.op2)} ` +
                `is not in the structured route: the existing emitter writes ` +
                `other code for it`
              : hasNoUnknown(node.op2, scope)
                ? `the exponential of ${nodeText(node.op2)}, which reads no ` +
                  `input, parameter or local, is not in the structured route: ` +
                  `the existing compiler replaces such an exponent by its value ` +
                  `when the value is not an integer (knownExponentPower())`
                : kind === 'complex' && node.op2.symbols.includes('Pi')
                  ? `the exponential of the complex operand ${nodeText(node.op2)}, ` +
                    `which reads Pi, is not in the structured route: the ` +
                    `existing emitter writes _SYS.cexppi for an exponent a + iπu`
                  : kind !== 'complex' &&
                      (mode === 'strict'
                        ? isNonRealNumber(finitePartOfType(node.type.type))
                        : !realType)
                    ? `the exponential ${nodeText(node)} has the type ` +
                      `${node.type.toString()}, which is not real`
                    : undefined;
        if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
        const result = kind === 'complex' ? 'complex' : 'real';
        forms.set(node, 'exp');
        return w.valueFacts(node, { kind: result }, [
          w.convert(exponent, { kind: result })!,
        ]);
      }
      const [base, exponent] = operandFacts(node, scope, context, w);
      if (base.type.kind === 'boolean' || exponent.type.kind === 'boolean')
        return w.refuse(
          node,
          'signature',
          'Power with a boolean operand is not in the structured route'
        );
      if (form === 'variable') {
        const type = finitePartOfType(node.type.type);
        // A complex base or exponent: the handler writes `_SYS.cpow(b, e)`
        // of the code of both operands, which reads a real operand `x` as
        // `x + 0i`, the value of the converted operand (the form
        // `complex-pow`). Its other complex branches read a constant
        // exponent (a chain of products for an integer from 2 to 8,
        // `tryGetConstant()`), declined with an exponent that has no
        // unknown, as for a real power.
        if (base.type.kind === 'complex' || exponent.type.kind === 'complex') {
          if (isSymbol(node.op1, 'ExponentialE'))
            return w.refuse(
              node,
              'signature',
              `Power of a symbol ExponentialE that a scope declares is not ` +
                `in the structured route`
            );
          if (hasNoUnknown(node.op2, scope))
            return w.refuse(
              node,
              'signature',
              `Power with a complex operand and the exponent ` +
                `${nodeText(node.op2)}, which has no unknown, is not in the ` +
                `structured route: the existing emitter can read such an ` +
                `exponent as a constant (tryGetConstant())`
            );
          forms.set(node, 'complex-pow');
          return w.valueFacts(node, { kind: 'complex' }, [
            w.convert(base, { kind: 'complex' })!,
            w.convert(exponent, { kind: 'complex' })!,
          ]);
        }
        const refusal = isSymbol(node.op1, 'ExponentialE')
          ? `Power of a symbol ExponentialE that a scope declares is not ` +
            `in the structured route`
          : hasNoUnknown(node.op2, scope)
            ? `the exponent ${nodeText(node.op2)} of Power has no ` +
              `unknown (each symbol in it has a value), and is not in ` +
              `the structured route: the existing compiler can replace ` +
              `such an exponent by its value (knownExponentPower())`
            : mode === 'strict' && isNonRealNumber(type)
              ? `the power ${nodeText(node)} has the type ` +
                `${node.type.toString()}, which is not real: the existing ` +
                `emitter writes the complex power`
              : mode === 'complex' && !isSubtype(type, 'real')
                ? `the power ${nodeText(node)} has the type ` +
                  `${node.type.toString()}, which is not real, in the ` +
                  `complex mode: the existing emitter writes the complex power`
                : undefined;
        if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
        forms.set(node, 'pow');
        return w.valueFacts(node, { kind: 'real' }, [
          w.convert(base, { kind: 'real' })!,
          w.convert(exponent, { kind: 'real' })!,
        ]);
      }
      const literal = node.op1;
      if (
        isNumber(literal) &&
        literal.im === 0 &&
        Number.isFinite(literal.re)
      ) {
        const folded = foldedLiteralPower(node, mode);
        if ('refusal' in folded)
          return w.refuse(node, 'signature', folded.refusal);
        forms.set(node, folded);
        return w.valueFacts(
          node,
          { kind: typeof folded.folded === 'number' ? 'real' : 'complex' },
          [w.convert(base, base.type)!, w.convert(exponent, exponent.type)!]
        );
      }
      if (form === 'square') {
        // The existing emitter reads through a square root under an even
        // power (`realRadicalPower()` in `javascript-target.ts`): for a
        // radicand it proves non-negative, `Power(Sqrt(r), 2)` is written as
        // `r` itself. The product of this route, `Math.sqrt(r) * Math.sqrt(r)`,
        // is another double (`2.0000000000000004` at `r = 2`), so the form
        // is refused.
        if (isFunction(node.op1, 'Sqrt'))
          return w.refuse(
            node,
            'signature',
            `the square of the square root ${nodeText(node.op1)} is not in ` +
              `the structured route: the existing emitter writes the radicand ` +
              `itself when it proves it non-negative`
          );
        // For a real base, the handler writes `_SYS.cpow` before the square
        // when the node is on the complex lane, as for the other number
        // literal exponents (`constantPowerForm()`): `Power(Floor(a/y), 2)`
        // has the type `number`.
        const nodeType = finitePartOfType(node.type.type);
        if (
          base.type.kind !== 'complex' &&
          (mode === 'strict'
            ? isNonRealNumber(nodeType)
            : !isSubtype(nodeType, 'real'))
        )
          return w.refuse(
            node,
            'signature',
            `the power ${nodeText(node)} has the type ${node.type.toString()}, ` +
              `which is not real${mode === 'complex' ? ', in the complex mode' : ''}: ` +
              `the existing emitter writes the complex power`
          );
        forms.set(node, 'square');
        const type =
          base.type.kind === 'integer'
            ? { kind: 'integer' as const }
            : base.type.kind === 'complex'
              ? { kind: 'complex' as const }
              : { kind: 'real' as const };
        return w.valueFacts(node, type, [
          w.convert(base, base.type)!,
          w.convert(exponent, exponent.type)!,
        ]);
      }
      // A number literal exponent other than 2 (the forms `float`,
      // `integer`, `rational` and `three-halves` of `powerForm()`).
      const chosen = constantPowerForm(
        node,
        form,
        base.type.kind,
        mode,
        snapshotOf,
        varsKeys
      );
      if (typeof chosen === 'object')
        return w.refuse(node, 'signature', chosen.refusal);
      forms.set(node, chosen);
      // A complex base: the chain lowers the base only, `pow` both operands,
      // the exponent converted.
      if (chosen === 'complex-chain' || chosen === 'complex-pow')
        return w.valueFacts(node, { kind: 'complex' }, [
          w.convert(base, base.type)!,
          w.convert(
            exponent,
            chosen === 'complex-pow' ? { kind: 'complex' } : exponent.type
          )!,
        ]);
      // The products of `product-power` keep an integer base an integer, as
      // `square` does; the other forms have a real result. Only the base of
      // `three-halves`, `product-power` and `reciprocal-square` is lowered.
      const integer =
        chosen === 'product-power' && base.type.kind === 'integer';
      const lowersExponent =
        chosen === 'real-pow' ||
        chosen === 'abs-pow' ||
        chosen === 'signed-pow';
      return w.valueFacts(node, { kind: integer ? 'integer' : 'real' }, [
        w.convert(base, integer ? base.type : { kind: 'real' })!,
        w.convert(exponent, lowersExponent ? { kind: 'real' } : exponent.type)!,
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/** A value written as the existing emitter writes it, `String(v)`, and read
 *  back: the same double, but `0` for `-0`. */
const printedDouble = (v: number): number => Number(String(v));

/**
 * Whether `head(...ops)` has a type, without its infinities and `NaN`, that
 * is one of numbers that are not real: the test of the existing emitter for
 * a folded literal (`resultIsComplexValued()` in `javascript-target.ts`),
 * which reads the type of the structural form of the node.
 */
function foldsToComplex(
  head: 'Power' | 'Root',
  ops: readonly Expression[]
): boolean {
  try {
    const type = ops[0].engine.function(head, [...ops], {
      form: 'structural',
    }).type;
    return isNonRealNumber(finitePartOfType(type.type));
  } catch {
    return false;
  }
}

/**
 * The folded value of `node`, a `Power` or a `Root` of two finite real
 * number literals whose value `value` the existing emitter writes, or the
 * refusal of the route. `readsComplex`: the parent of the node in the
 * existing compiler reads it as a complex value (`isComplexValued()`). A
 * complex value must be read as complex. A real value read as complex is,
 * in the `complex` mode and for a type that is not one of numbers that are
 * not real, the complex value `v + 0i`: the existing compiler writes
 * `_SYS.cplx(v)` around it (`Root(-2, 2.2)` has the type `number`, and
 * `Root(-2, -4)` is promoted: `_SYS.cplx(NaN)`), as a value that is not a
 * literal. Every other real value read as complex is refused.
 */
function foldedLiteral(
  node: Expression,
  value: number | { re: number; im: number },
  mode: 'strict' | 'complex',
  readsComplex: boolean
): { folded: number | { re: number; im: number } } | { refusal: string } {
  // A `NaN` fold where the interpreter has a finite value is not a caveat
  // of compiled code: `Root(-2, -4)` folds to `NaN` (and to `_SYS.cplx(NaN)`
  // in the `complex` mode), and its value is `0.5946… - 0.5946…i`. A `NaN`
  // fold whose interpreter value is not a finite number (`(-1e-200)^(-5/3)`
  // is `-2.15e333`, an infinity as a double) is kept.
  const nan =
    typeof value === 'number'
      ? Number.isNaN(value)
      : Number.isNaN(value.re) || Number.isNaN(value.im);
  if (nan) {
    const exact = node.N();
    if (Number.isFinite(exact.re) && Number.isFinite(exact.im))
      return {
        refusal:
          `the ${node.operator === 'Power' ? 'power' : 'root'} ${nodeText(node)} ` +
          `of number literals is folded to NaN by the existing emitter, and ` +
          `its value is the finite number ${nodeText(exact)}`,
      };
  }
  const type = finitePartOfType(node.type.type);
  if (
    mode === 'complex' &&
    typeof value === 'number' &&
    readsComplex &&
    !isNonRealNumber(type)
  )
    return { folded: { re: value, im: 0 } };
  if (readsComplex !== (typeof value === 'object'))
    return {
      refusal:
        `the ${node.operator === 'Power' ? 'power' : 'root'} ${nodeText(node)} ` +
        `of number literals has the type ${node.type.toString()}, and the ` +
        `existing compiler folds it to a ${typeof value === 'object' ? 'complex' : 'real'} ` +
        `value that it reads as ${readsComplex ? 'complex' : 'real'}` +
        (mode === 'complex' ? ' in the complex mode' : ''),
    };
  return { folded: value };
}

/**
 * `Power(b, e)` of two finite real number literals (the base is one; the
 * forms of `powerForm()` other than `exp` and `variable` have a finite real
 * number literal exponent): the `Power` handler of the existing emitter
 * folds it before every other branch, also with `constantFold: false`, and
 * writes `String(v)`:
 *
 * - `v = Math.pow(b, e)` when it is not `NaN`;
 * - otherwise the principal complex power of the interpreter
 *   (`principalComplexPow()`, written `({ re: …, im: … })`) when the type of
 *   the node is one of numbers that are not real, the real root of a
 *   negative base when the exponent is read as a rational with an odd
 *   denominator (`negativeBaseRealPow()`), and `NaN` otherwise.
 *
 * The route writes the same value as a literal, the form `{ folded }`: the
 * printed double, so `-0` is `0` as in the code of the existing emitter.
 */
function foldedLiteralPower(
  node: Expression,
  mode: 'strict' | 'complex'
): { folded: number | { re: number; im: number } } | { refusal: string } {
  if (!isFunction(node) || !isNumber(node.op1) || !isNumber(node.op2))
    return { refusal: 'Power of two number literals expected' };
  const [base, exponent] = [node.op1.re, node.op2.re];
  const r = Math.pow(base, exponent);
  let value: number | { re: number; im: number };
  if (!Number.isNaN(r)) value = printedDouble(r);
  else if (foldsToComplex('Power', node.ops)) {
    const c = principalComplexPow(base, exponent);
    value = { re: printedDouble(c.re), im: printedDouble(c.im) };
  } else
    value = printedDouble(negativeBaseRealPow(base, node.op2, exponent) ?? NaN);
  // How the parent reads the node (`isComplexValued()`): real for an
  // exponent read as a rational with an odd denominator
  // (`realPowerExponent()`, before the other branches); complex, in the
  // `complex` mode, for an exponent that is not an integer and a base not
  // proved non-negative (`promotesRadicalToComplex()`); else complex for a
  // type, without its infinities and `NaN`, that is one of numbers that are
  // not real, or that is not real in the `complex` mode.
  const type = finitePartOfType(node.type.type);
  const readsComplex =
    BaseCompiler.realPowerExponent(node.ops) === undefined &&
    (isNonRealNumber(type) ||
      (mode === 'complex' &&
        (!isSubtype(type, 'real') ||
          (!Number.isInteger(exponent) && !assumedRealNonNegative(node.op1)))));
  return foldedLiteral(node, value, mode, readsComplex);
}

/**
 * `Root(x, n)` of two finite real number literals, with `n` not 0: the
 * `Root` handler of the existing emitter folds it first, and writes
 * `String(v)`: `v = Math.pow(x, 1/n)` when it is not `NaN`; otherwise, for a
 * negative radicand, `-Math.pow(-x, 1/n)` for an odd integer degree or a
 * degree read as a rational with an odd numerator and an odd denominator
 * (`realRootDegreeTerms()`), `Math.pow(-x, 1/n)` for one with an even
 * numerator, the principal complex power for a node whose type is one of
 * numbers that are not real, and `NaN` otherwise. The route writes the same
 * value as a literal (the form `{ folded }`).
 */
function foldedLiteralRoot(
  node: Expression,
  mode: 'strict' | 'complex'
): { folded: number | { re: number; im: number } } | { refusal: string } {
  if (!isFunction(node) || !isNumber(node.op1) || !isNumber(node.op2))
    return { refusal: 'Root of two number literals expected' };
  const [radicand, degree] = [node.op1.re, node.op2.re];
  const r = Math.pow(radicand, 1 / degree);
  let value: number | { re: number; im: number };
  if (!Number.isNaN(r)) value = printedDouble(r);
  else {
    const realRoot =
      radicand < 0 ? BaseCompiler.realRootDegreeTerms(node.op2) : undefined;
    if (
      radicand < 0 &&
      ((Number.isInteger(degree) && degree % 2 !== 0) ||
        realRoot?.oddNumerator === true)
    )
      value = printedDouble(-Math.pow(-radicand, 1 / degree));
    else if (realRoot !== undefined)
      value = printedDouble(Math.pow(-radicand, 1 / degree));
    else if (foldsToComplex('Root', node.ops)) {
      const c = principalComplexPow(radicand, 1 / degree);
      value = { re: printedDouble(c.re), im: printedDouble(c.im) };
    } else value = NaN;
  }
  // How the parent reads the node (`isComplexValued()`): complex for a
  // type, without its infinities and `NaN`, that is one of numbers that are
  // not real; in the `complex` mode also for a type that is not real, and
  // for an even integer degree and a radicand not proved non-negative
  // (`promotesRadicalToComplex()`).
  const type = finitePartOfType(node.type.type);
  const readsComplex =
    isNonRealNumber(type) ||
    (mode === 'complex' &&
      (!isSubtype(type, 'real') ||
        (Number.isInteger(degree) &&
          degree % 2 === 0 &&
          !assumedRealNonNegative(node.op1))));
  return foldedLiteral(node, value, mode, readsComplex);
}

/**
 * The form of `Power(b, e)` for a real number literal exponent `e` other
 * than 2 (the forms `float`, `integer`, `rational` and `three-halves` of
 * `powerForm()`) and a base `b` that is not a finite number literal, with
 * the base of the kind `baseKind`, or the refusal of the route. The form is
 * the code that the `Power` handler of the existing emitter writes, in the
 * order of its branches:
 *
 * - A complex base (tested before every other branch): for an integer
 *   exponent from 2 to 8, a chain of complex products of the base, bound
 *   once, the form `complex-chain` (the exponent 2 is the form `square` of
 *   `powerForm()`); for every other exponent `_SYS.cpow(b, e)`, the form
 *   `complex-pow`, whose exponent is converted (`real-to-complex`):
 *   `_SYS.cpow` reads a number `e` as `e + 0i`.
 * - A float exponent with an odd recovered denominator `q`, for a base that
 *   the engine does not prove non-negative (`realPowerExponent()`, before
 *   the complex lane): `abs-pow` or `signed-pow` (above), but `2/3`, for
 *   which `realRadicalPower()` writes `_SYS.pow2(Math.cbrt(b))`, is
 *   refused. An exact exponent with an odd denominator (`8/5`) is refused,
 *   and so is an exact exponent whose terms are not safe integers.
 * - The complex lane: in the `strict` mode a node whose type, without its
 *   infinities and `NaN`, is one of numbers that are not real; in the
 *   `complex` mode a node whose type is not real, and, for an exponent that
 *   is not an integer, a base that `signOf()` does not prove non-negative
 *   (`promotesRadicalToComplex()` reads `assumedRealNonNegative()`, which
 *   `signOf()` mirrors). Refused: the handler writes `_SYS.cpow`.
 * - An integer exponent: `1`, the base, or its reciprocal for `0`, `1` and
 *   `-1`, refused (their canonical forms are not a power); a square root
 *   base and an exponent of at least 2, refused (`realRadicalPower()`
 *   reads through it); `_SYS.pow3(b)` to `_SYS.pow5(b)` for 3 to 5, the
 *   form `product-power`; `(1 / b / b)` for `-2` and a base that is a name
 *   or a literal that the option `vars` does not map, the form
 *   `reciprocal-square`; `Math.pow(b, e)` for every
 *   other safe integer, the form `real-pow`.
 * - Another exponent: the product of the base and its square root for `1.5`
 *   and a base that `signOf()` proves non-negative (`three-halves`), and
 *   for `2.5` (refused); `Math.sqrt`, `1 / Math.sqrt` and `Math.cbrt` for
 *   `0.5`, `-0.5` and `1/3`, refused; `Math.pow(b, e)` otherwise, the form
 *   `real-pow` (`x^1.1`, `x^1.5` for an `x` of unknown sign in the `strict`
 *   mode, `p^1.6` for a `p` that the engine proves non-negative).
 *
 * The base that is a symbol named `ExponentialE` that a scope declares is
 * refused, as for an exponent that is not a literal.
 */
function constantPowerForm(
  node: Expression,
  form: 'float' | 'integer' | 'rational' | 'three-halves',
  baseKind: string,
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf,
  varsKeys?: ReadonlyMap<string, unknown>
): Extract<StructuredForm, string> | { refusal: string } {
  const refuse = (refusal: string) => ({ refusal });
  if (!isFunction(node) || !isNumber(node.op2))
    return refuse('Power with an exponent that is not a number literal');
  const [base, exponent] = [node.op1, node.op2];
  const value = exponent.re;
  if (baseKind === 'complex')
    return Number.isInteger(value) && value >= 3 && value <= 8
      ? 'complex-chain'
      : 'complex-pow';
  if (isSymbol(base, 'ExponentialE'))
    return refuse(
      `Power of a symbol ExponentialE that a scope declares is not in the ` +
        `structured route`
    );
  const twoThirds = refuse(
    `Power with the exponent 2/3 is not in the structured route: the ` +
      `existing emitter writes the square of the cube root`
  );
  if (form === 'float' && base.isNonNegative !== true) {
    const terms = realPowerBranchTerms(undefined, value);
    if (terms !== undefined && terms[1] % 2 !== 0) {
      if (value === 2 / 3) return twoThirds;
      return terms[0] % 2 !== 0 ? 'signed-pow' : 'abs-pow';
    }
  }
  if (form === 'rational') {
    const terms = asRational(exponent);
    if (
      terms === undefined ||
      !Number.isSafeInteger(Number(terms[0])) ||
      !Number.isSafeInteger(Number(terms[1]))
    )
      return refuse(
        `Power with the exact exponent ${nodeText(exponent)}, whose terms ` +
          `are not safe integers, is not in the structured route`
      );
    if (Number(terms[1]) % 2 !== 0)
      return refuse(
        `Power with the exact exponent ${nodeText(exponent)}, whose ` +
          `denominator is odd, is not in the structured route: the existing ` +
          `emitter writes the real root of a negative base (realPowerExponent())`
      );
  }
  if (value === 2 / 3) return twoThirds;
  const type = finitePartOfType(node.type.type);
  const notReal =
    mode === 'strict'
      ? isNonRealNumber(type)
        ? `the power ${nodeText(node)} has the type ${node.type.toString()}, ` +
          `which is not real: the existing emitter writes the complex power`
        : undefined
      : !isSubtype(type, 'real')
        ? `the power ${nodeText(node)} has the type ${node.type.toString()}, ` +
          `which is not real, in the complex mode: the existing emitter ` +
          `writes the complex power`
        : undefined;
  if (Number.isInteger(value)) {
    if (notReal !== undefined) return refuse(notReal);
    if (!Number.isSafeInteger(value))
      return refuse(
        `Power with the exponent ${nodeText(exponent)}, an integer beyond ` +
          `the safe integers, is not in the structured route`
      );
    if (value === 0 || value === 1 || value === -1)
      return refuse(
        `Power with the exponent ${value} is not in the structured route: ` +
          `the existing emitter writes ` +
          (value === 0 ? '1' : value === 1 ? 'the base' : 'its reciprocal')
      );
    if (isFunction(base, 'Sqrt') && value >= 2)
      return refuse(
        `the power ${nodeText(node)} of a square root is not in the ` +
          `structured route: the existing emitter reads through the square ` +
          `root (realRadicalPower())`
      );
    if (value >= 3 && value <= 5) return 'product-power';
    // The existing emitter writes `Math.pow` for a name that the option
    // `vars` maps (`varsKeys`).
    if (
      value === -2 &&
      (isSymbol(base) || isNumber(base)) &&
      !(isSymbol(base) && varsKeys?.has(base.symbol))
    )
      return 'reciprocal-square';
    return 'real-pow';
  }
  // `realRadicalPower()` reads the sign of the base for `1.5` and `2.5`, and
  // the `complex` mode promotes a base that it does not prove non-negative.
  const sign =
    mode === 'complex' || value === 1.5 || value === 2.5
      ? signOf(base, snapshotOf, true, 'Power')
      : 'unknown';
  if (typeof sign === 'object') return refuse(sign.refusal);
  if (mode === 'complex' && sign !== 'nonnegative')
    return refuse(
      `Power with the exponent ${value} is in the structured route only for ` +
        `a base that it proves non-negative, and not for ${nodeText(base)} ` +
        `(the complex mode): the existing emitter writes the complex power`
    );
  if (notReal !== undefined) return refuse(notReal);
  if (sign === 'nonnegative' && value === 1.5) {
    if (!isSubtype(type, 'real'))
      return refuse(
        `Power with the exponent 1.5 of the non-negative base ` +
          `${nodeText(base)} is in the structured route only when the type ` +
          `of the power is real, and not for ${node.type.toString()}`
      );
    return 'three-halves';
  }
  if (sign === 'nonnegative' && value === 2.5)
    return refuse(
      `Power with the exponent 2.5 of a base that is proved non-negative is ` +
        `not in the structured route: the existing emitter writes the product ` +
        `of the square of the base and its square root`
    );
  if (value === 0.5 || value === -0.5 || value === 1 / 3)
    return refuse(
      `Power with the exponent ${value} is not in the structured route: the ` +
        `existing emitter writes ` +
        (value === 0.5
          ? 'Math.sqrt'
          : value === -0.5
            ? 'the reciprocal of Math.sqrt'
            : 'Math.cbrt')
    );
  return 'real-pow';
}

/**
 * `Root(x, n)` on the structured route, for the compile mode `mode`. The
 * `Root` handler of the existing emitter (`javascript-target.ts`) writes,
 * for a real radicand and a real degree:
 *
 * - two finite number literals, with a degree that is not 0: folded
 *   (`foldedLiteralRoot()`). The route writes the same literal, the form
 *   `{ folded }`.
 * - a complex radicand or degree: `_SYS.croot`. Refused.
 * - a node on the complex lane (in the `strict` mode a type that is one of
 *   numbers that are not real; an even integer degree and a radicand that
 *   is not proved non-negative in the `complex` mode): `_SYS.cpow`. The
 *   rule refuses a type that is not real in the `complex` mode, which is
 *   wider, and covers the `_SYS.cplx()` that the handler writes around a
 *   real root of the type `number` there (`Root(x, k)`).
 * - the degree 3: `Math.cbrt(x)`, the form `cbrt`.
 * - the degree 2, an odd integer degree, a degree read as a rational with
 *   an odd denominator, another literal degree: `Math.sqrt`, the signed
 *   power, `Math.pow`. Refused: the canonical form of `Root(x, 2)` is
 *   `Sqrt(x)`, and the engine's own compilations do not reach the others
 *   (`\sqrt[5]{x}` is `Root(x, 5)`, which declines).
 * - a degree that is not a number literal: `_SYS.root(x, n)`, the form
 *   `root`. A degree with no unknown (each symbol in it has a value) is
 *   refused, as for the exponent of `Power`.
 */
function structuredRootRule(
  mode: 'strict' | 'complex',
  forms: Map<Expression, StructuredForm>
) {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 2)
        return w.refuse(
          node,
          'signature',
          'Root with other than two operands is not in the structured route'
        );
      const [radicand, degree] = operandFacts(node, scope, context, w);
      if (radicand.type.kind === 'boolean' || degree.type.kind === 'boolean')
        return w.refuse(
          node,
          'signature',
          'Root with a boolean operand is not in the structured route'
        );
      if (radicand.type.kind === 'complex' || degree.type.kind === 'complex')
        return w.refuse(
          node,
          'signature',
          'Root with a complex operand is not in the structured route: the ' +
            'existing emitter writes _SYS.croot'
        );
      const type = finitePartOfType(node.type.type);
      const literal = isNumber(node.op2);
      // Two finite real literals, with a degree that is not 0: folded.
      if (
        literal &&
        isNumber(node.op1) &&
        node.op1.im === 0 &&
        Number.isFinite(node.op1.re) &&
        node.op2.im === 0 &&
        Number.isFinite(node.op2.re) &&
        node.op2.re !== 0
      ) {
        const folded = foldedLiteralRoot(node, mode);
        if ('refusal' in folded)
          return w.refuse(node, 'signature', folded.refusal);
        forms.set(node, folded);
        return w.valueFacts(
          node,
          { kind: typeof folded.folded === 'number' ? 'real' : 'complex' },
          [w.convert(radicand, radicand.type)!, w.convert(degree, degree.type)!]
        );
      }
      const refusal =
        literal && !(isNumber(node.op2) && node.op2.isSame(3))
          ? `Root with the degree ${nodeText(node.op2)} is not in the ` +
            `structured route, which has the degree 3 and a degree that is ` +
            `not a number literal`
          : !literal && hasNoUnknown(node.op2, scope)
            ? `the degree ${nodeText(node.op2)} of Root has no unknown ` +
              `(each symbol in it has a value), and is not in the ` +
              `structured route`
            : mode === 'strict' && isNonRealNumber(type)
              ? `the root ${nodeText(node)} has the type ` +
                `${node.type.toString()}, which is not real: the existing ` +
                `emitter writes the complex power`
              : mode === 'complex' && !isSubtype(type, 'real')
                ? `the root ${nodeText(node)} has the type ` +
                  `${node.type.toString()}, which is not real, in the ` +
                  `complex mode: the existing emitter writes a complex value`
                : undefined;
      if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
      forms.set(node, literal ? 'cbrt' : 'root');
      return w.valueFacts(node, { kind: 'real' }, [
        w.convert(radicand, { kind: 'real' })!,
        w.convert(degree, literal ? degree.type : { kind: 'real' })!,
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * The operands of `node` that the admission checks and the rules type: all
 * its operands, but only the exponent of `Power(ExponentialE, x)`, whose
 * base is the constant of the exponential (`powerForm()`) and not a read of
 * a binding.
 */
function admittedOperands(node: Expression): readonly Expression[] {
  if (!isFunction(node)) return [];
  // The domain of `Random` is not a value (`randomRule`), and a literal
  // seed of `WithRandomSeed` is no read (`literalSeedOf()`).
  if (node.operator === 'Random' && isLibraryOperator(node, 'Random'))
    return [];
  if (
    node.operator === 'WithRandomSeed' &&
    isLibraryOperator(node, 'WithRandomSeed') &&
    node.nops === 2 &&
    literalSeedOf(node.op1) !== undefined
  )
    return [node.op2];
  return powerForm(node) === 'exp' ? [node.op2] : node.ops;
}

/** The rules of the structured route that read the compile mode or the
 *  captured values of a compilation. `annotateStructured()` puts them in
 *  the place of the entries of `structuredRules`, which only admit the
 *  heads. */
function modeRules(
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf,
  forms: Map<Expression, StructuredForm>,
  binds: PassBinds,
  inputs: ReadonlySet<string>,
  varsKeys?: ReadonlyMap<string, unknown>
): Record<string, FragmentRule<ScalarRepresentation>> {
  return {
    Sqrt: structuredRadicalRule('Sqrt', mode, snapshotOf),
    Ln: structuredRadicalRule('Ln', mode, snapshotOf),
    Power: structuredPowerRule(mode, snapshotOf, forms, varsKeys),
    Root: structuredRootRule(mode, forms),
    Sin: structuredFunctionRule('Sin', mode, forms),
    Cos: structuredFunctionRule('Cos', mode, forms),
    Tanh: structuredFunctionRule('Tanh', mode, forms),
    Abs: structuredFunctionRule('Abs', mode, forms),
    Arctan2: structuredFunctionRule('Arctan2', mode, forms),
    Hypot: structuredFunctionRule('Hypot', mode, forms),
    Log: structuredLogRule(mode, snapshotOf, forms),
    Mod: modRule(forms),
    WithRandomSeed: seededRule(mode),
    ...Object.fromEntries(
      Object.keys(SCALAR_FUNCTION_HEADS).map((head) => [
        head,
        structuredScalarFunctionRule(head, mode, forms, inputs),
      ])
    ),
    ...Object.fromEntries(
      Object.keys(REAL_CALL_HEADS).map((head) => [
        head,
        realCallRule(head, mode, forms, binds),
      ])
    ),
    // `Gamma(s, z)` by the rule of the heads of real calls, `Gamma(x)` by
    // the rule of `SCALAR_FUNCTION_HEADS`.
    Gamma: upperGammaRule(
      structuredScalarFunctionRule('Gamma', mode, forms, inputs),
      realCallRule('Gamma', mode, forms, binds, UPPER_GAMMA)
    ),
  };
}

/**
 * The rule `rule` of `If` or `Which`, but a node used as a value whose
 * constant conditions select a branch (`decidedBranch()`) has the facts of
 * that branch, and records it (the form `{ selected }`): the existing
 * emitter writes that branch alone.
 */
function decidedSelectionRule(
  rule: typeof ifRule | typeof whichRule,
  forms: Map<Expression, StructuredForm>,
  binds: PassBinds
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const decided =
        context.place !== 'statement'
          ? decidedBranch(node, (name) => binds(name, scope))
          : undefined;
      if (decided === undefined) return rule.walk(node, scope, context, w);
      forms.set(node, { selected: decided });
      return w.value(decided, scope, context);
    },
  };
}

/**
 * Whether a scope of the pass binds the name `name` in `scope`: a
 * parameter of the root function (an input of `compileFunction()`), or a
 * parameter, a local or an index of a scope below the root. The engine
 * answers a predicate of such a name (`isNonNegative`, its type, its value)
 * from the definition of an engine symbol of the same name.
 */
type PassBinds = (
  name: string,
  scope: FragmentScope<ScalarRepresentation>
) => boolean;

/** Whether `node` names a name for which `bound` is true. */
function namesBound(
  node: Expression,
  bound: (name: string) => boolean
): boolean {
  if (isSymbol(node)) return bound(node.symbol);
  return isFunction(node) && (bound(node.operator) || node.symbols.some(bound));
}

/**
 * The names that a form of `root` binds anywhere in it: the parameters of
 * a `Function`, the names that a `Declare` or an `Assign` writes, and the
 * index of a `Limits` or an `Element` clause. The admission has no scopes,
 * and reads a name bound in another part of the tree as bound too.
 */
function namesBoundIn(root: Expression): ReadonlySet<string> {
  const names = new Set<string>();
  const seen = new Set<Expression>();
  const nameOf = (node: Expression): string | undefined =>
    isSymbol(node)
      ? node.symbol
      : isFunction(node) && node.nops > 0 && isSymbol(node.op1)
        ? node.op1.symbol
        : undefined;
  const visit = (node: Expression): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    const binders =
      node.operator === 'Function'
        ? node.ops.slice(1)
        : ['Declare', 'Assign', 'Limits', 'Element'].includes(node.operator)
          ? node.ops.slice(0, 1)
          : [];
    for (const binder of binders) {
      const name = nameOf(binder);
      if (name !== undefined) names.add(name);
    }
    node.ops.forEach(visit);
  };
  visit(root);
  return names;
}

/** The refusals of an `If` or a `Which` whose constant conditions select a
 *  branch, in the admission. `bound`: the names that a form binds. `root`:
 *  `node` is the root of the program or the body of a function. */
function refuseSelections(
  node: Expression,
  bound: (name: string) => boolean,
  root: boolean
): void {
  // At the root, the selection has no parent to group it.
  if (!root) refuseUngroupedSelection(node, bound);
  refuseWideSelection(node, bound);
  refuseComplexSelection(node, bound);
  refuseOperandSelection(node, bound, root);
}

/**
 * Refuse an `If` or a `Which` whose constant conditions select a branch,
 * as an operand, unless that branch is a symbol with no value: the route
 * writes the selected branch in the parent, which sees through it (a
 * literal `0` that a complex sum drops, a haversine that the parent groups
 * with no parentheses), where the existing compiler writes the selection
 * as a computed operand in parentheses: `z + Which(2 < 3, 0, True, 1)` at
 * `z = {re: -0, im: 1}` has the real part `-0` on the route and `0` there.
 * At the root of the program or of a function body, the selection has no
 * parent.
 */
function refuseOperandSelection(
  node: Expression,
  bound: (name: string) => boolean,
  root: boolean
): void {
  if (root) return;
  const selected = decidedBranch(node, bound);
  if (selected === undefined) return;
  if (
    isSymbol(selected) &&
    resolvedValueDefinition(selected)?.value === undefined
  )
    return;
  throw new Error(
    `JS scalar fragment: ${nodeText(node)} has conditions of a constant ` +
      `type and selects ${nodeText(selected)} as an operand, which the ` +
      `existing compiler writes as a computed operand in parentheses`
  );
}

/**
 * Refuse an `If` of three operands whose condition has a constant type and
 * whose selected branch is not a symbol or a number: the existing compiler
 * writes the code of that branch with no parentheses around it, so that
 * `2 * If(2 < 3, x + 1, 0)` is `2 * _.x + 1` there (CE-1224).
 */
function refuseUngroupedSelection(
  node: Expression,
  bound: (name: string) => boolean
): void {
  if (!isFunction(node) || node.nops !== 3) return;
  if (node.operator !== 'If' || !isLibraryOperator(node, 'If')) return;
  const selected = decidedBranch(node, bound);
  if (selected === undefined || isSymbol(selected) || isNumber(selected))
    return;
  throw new Error(
    `JS scalar fragment: ${nodeText(node)} has a condition of a constant ` +
      `type, and the existing compiler writes the branch ` +
      `${nodeText(selected)} that it selects with no parentheses`
  );
}

/**
 * Refuse an `If` or a `Which` whose constant conditions select a branch
 * when the type of the node is not a number type: a dead branch of another
 * type (a name with no declared type) widens it, and the existing compiler
 * writes the parent of the node from that type (`2/3 · (x + Which(1.5 ≤ 1,
 * u, True, 0.5))` is a broadcast there), not from the selected branch.
 */
function refuseWideSelection(
  node: Expression,
  bound: (name: string) => boolean
): void {
  if (decidedBranch(node, bound) === undefined) return;
  if (isSubtype(node.type.type, 'number')) return;
  throw new Error(
    `JS scalar fragment: ${nodeText(node)} has conditions of a constant ` +
      `type and the type ${node.type.toString()}, which is not a number ` +
      `type, and the existing compiler writes its parent from that type`
  );
}

/**
 * Refuse an `If` or a `Which` whose constant conditions select a branch
 * that is a complex constant: the existing compiler reads the node as a
 * computed complex value, and the route writes the literal in the parent,
 * so that `x + Which(2 < 3, i, True, 0)` at `x = -0` is `{re: -0, im: 1}`
 * on the route and `{re: 0, im: 1}` there.
 */
function refuseComplexSelection(
  node: Expression,
  bound: (name: string) => boolean
): void {
  const selected = decidedBranch(node, bound);
  if (selected === undefined || selected.unknowns.length > 0) return;
  if (isSubtype(selected.type.type, 'real')) return;
  throw new Error(
    `JS scalar fragment: ${nodeText(node)} has conditions of a constant ` +
      `type and selects the complex constant ${nodeText(selected)}, which ` +
      `the existing compiler reads as a computed complex value`
  );
}

/** The rule of `If` of the pass: the value of an `If` can be a list. An
 *  `If` with no else branch used as a value is a `Which` of one clause. */
const ifRule = {
  walk: (node, scope, context, w) =>
    isFunction(node) && node.nops === 2 && context.place !== 'statement'
      ? selectionRule(node, scope, context, w)
      : walkIf(node, scope, context, w),
} satisfies FragmentRule<ScalarRepresentation>;

const whichRule = {
  walk: (node, scope, context, w) => selectionRule(node, scope, context, w),
} satisfies FragmentRule<ScalarRepresentation>;

/** The entry of `structuredRules` for a head of `modeRules()`. */
const withoutMode = (head: string): FragmentRule<ScalarRepresentation> => ({
  walk: () => {
    throw new Error(
      `JS scalar fragment invariant: ${head} without its compile mode`
    );
  },
});

/** The rules of the structured route. The rules of `modeRules()` read the
 *  compile mode and the captured values of a compilation:
 *  `annotateStructured()` puts them in their place, and these entries only
 *  admit the heads. */
const structuredRules: Record<string, FragmentRule<ScalarRepresentation>> = {
  Sqrt: withoutMode('Sqrt'),
  Ln: withoutMode('Ln'),
  Sin: withoutMode('Sin'),
  Cos: withoutMode('Cos'),
  Tanh: withoutMode('Tanh'),
  Abs: withoutMode('Abs'),
  Arctan2: withoutMode('Arctan2'),
  Hypot: withoutMode('Hypot'),
  Log: withoutMode('Log'),
  ...Object.fromEntries(
    Object.keys(SCALAR_FUNCTION_HEADS).map((head) => [head, withoutMode(head)])
  ),
  ...Object.fromEntries(
    Object.keys(REAL_CALL_HEADS).map((head) => [head, withoutMode(head)])
  ),
  Add: withRealFromRealOperands(withListLengthIntegers(structuredAddRule)),
  Negate: withRealFromRealOperands(withListLengthIntegers(negateRule)),
  If: ifRule,
  Which: whichRule,
  Sum: {
    walk: (node, scope, context, w) => aggregateRule(node, scope, context, w),
  },
  Product: {
    walk: (node, scope, context, w) => aggregateRule(node, scope, context, w),
  },
  Multiply: withRealFromRealOperands(withListLengthIntegers(multiplyRule)),
  Less: comparisonRule('Less'),
  LessEqual: comparisonRule('LessEqual'),
  Equal: comparisonRule('Equal'),
  NotEqual: comparisonRule('NotEqual'),
  Mod: withoutMode('Mod'),
  Floor: floorRule,
  Divide: divideRule,
  Power: withoutMode('Power'),
  Root: withoutMode('Root'),
  Loop: loopRule,
  // A `Break` with no value in a counted loop; its place in the loop is the
  // rule of the admission (`checkStructuredStatement()`).
  Break: { walk: walkBreak },
  // A `Continue` with no value has the rule of a `Break`; its place is the
  // rule of the admission (`checkStructuredStatement()`).
  Continue: { walk: walkBreak },
  And: logicalRule('And'),
  Or: logicalRule('Or'),
  Min: foldOrExtremumRule('Min'),
  Max: foldOrExtremumRule('Max'),
  List: {
    walk: (node, scope, context, w) => listLiteralRule(node, scope, context, w),
  },
  Tuple: {
    walk: (node, scope, context, w) => tupleRule(node, scope, context, w),
  },
  At: { walk: (node, scope, context, w) => atRule(node, scope, context, w) },
  Length: {
    walk: (node, scope, context, w) => lengthRule(node, scope, context, w),
  },
  Comprehension: {
    walk: (node, scope, context, w) =>
      comprehensionRule(node, scope, context, w),
  },
  ReplaceAt: {
    walk: (node, scope, context, w) => replaceAtRule(node, scope, context, w),
  },
  Not: {
    walk: (node, scope, context, w) => notRule.walk(node, scope, context, w),
  },
  Typed: withoutMode('Typed'),
  // `Return(v)` where the admission admits it, in tail position of a
  // function body: the value `v`.
  Return: {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 1)
        return w.refuse(
          node,
          'signature',
          'Return is in the structured route only as Return(value)'
        );
      const value = w.value(node.op1, scope, context);
      return w.valueFacts(node, value.type, [w.convert(value, value.type)!]);
    },
  },
  Random: {
    walk: (node, scope, context, w) => randomRule.walk(node, scope, context, w),
  },
  WithRandomSeed: withoutMode('WithRandomSeed'),
  ...Object.fromEntries(
    Object.keys(COLLECTION_HEADS)
      .filter((head) => head !== 'Count')
      .map((head) => [
        head,
        {
          walk: (node, scope, context, w) =>
            collectionRule(node, scope, context, w),
        } satisfies FragmentRule<ScalarRepresentation>,
      ])
  ),
  // The heads with a function operand read the compile mode
  // (`functionOperandRule()`); `annotateStructured()` puts their rules here.
  ...Object.fromEntries(
    Object.keys(FUNCTION_OPERAND_HEADS).map((head) => [head, withoutMode(head)])
  ),
};

/** The heads whose rule applies to each element of a list operand on the
 *  structured route (`elementwiseRule()`). */
const ELEMENTWISE_HEADS = ['Add', 'Multiply', 'Negate', 'Divide'];

/** `Min` and `Max` on the structured route: the fold of one list or tuple
 *  (`foldRule()`), or the rule of real operands (`extremumRule()`), which
 *  refuses a list operand beside other operands (`withoutListOperands()`). */
function foldOrExtremumRule(
  operator: 'Min' | 'Max'
): FragmentRule<ScalarRepresentation> {
  const scalar = withoutListOperands(
    operator,
    withRealFromRealOperands(extremumRule(operator))
  );
  return {
    walk: (node, scope, context, w) =>
      isFoldNode(node)
        ? foldRule(node, scope, context, w)
        : scalar.walk(node, scope, context, w),
  };
}

/** The heads whose rule reads a list operand itself; every other rule of
 *  the structured route refuses one (`withoutListOperands()`). The rules of
 *  `ELEMENTWISE_HEADS` read a list operand element-wise
 *  (`elementwiseRule()`). */
export const LIST_OPERAND_HEADS = [
  'If',
  'Loop',
  'At',
  'Length',
  'Comprehension',
  'ReplaceAt',
  'Typed',
  'List',
  'Tuple',
  'Min',
  'Max',
  ...ELEMENTWISE_HEADS,
  // The rule of an aggregate reads its index sets (`Limits`), which are not
  // values, and refuses a body that is a list.
  'Sum',
  'Product',
  // The functions of lists and the heads with a function operand read their
  // list operands themselves (`collectionRule()`, `functionOperandRule()`).
  ...Object.keys(COLLECTION_HEADS),
  ...Object.keys(FUNCTION_OPERAND_HEADS),
];

/**
 * The heads of `LIST_OPERAND_HEADS` whose rule reads a list of lists (an
 * operand or a result whose type is a list of lists) on the structured
 * route: the reads and the copies of slice 1 of
 * `docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`. Every
 * other rule of `LIST_OPERAND_HEADS` refuses one (`withoutNestedOperands()`),
 * so that no rule written for a list of numbers admits a list of lists by
 * accident; each slice adds its heads here. `Count` reads a list of lists
 * only with no predicate (`Count(M)`, the number of rows).
 */
export const NESTED_OPERAND_HEADS: ReadonlySet<string> = new Set([
  'If',
  'At',
  'Length',
  'List',
  'Comprehension',
  'ReplaceAt',
  'Typed',
  'First',
  'Last',
  'Second',
  'Third',
  'Most',
  'IsEmpty',
  'Count',
  'Rest',
  'Take',
  'Drop',
  'Reverse',
  'Join',
  'ListJoin',
  'RotateLeft',
  'RotateRight',
  // Slice 3: the matrix functions (`matrixFunctionRule()`).
  'Determinant',
  'Trace',
  'Transpose',
  'RowReduce',
  'Inverse',
  'MatrixPower',
  'MatrixMultiply',
  'Diagonal',
  'Flatten',
  'Norm',
  'Dot',
  // Slice 2: element-wise arithmetic of lists of lists
  // (`nestedElementwise()`), and `Map` of the rows (`functionOperandRule()`).
  'Map',
  'Add',
  'Multiply',
  'Negate',
  'Divide',
]);

/**
 * The rule `rule` of `head`, a head of `LIST_OPERAND_HEADS` that is not in
 * `NESTED_OPERAND_HEADS` (or `Count` with a predicate), with a refusal of a
 * list of lists: after the rule, the result of the node and each operand
 * that it typed (also an operand of its `Element` or `Limits` clauses, and
 * one typed in the scope that the node opens) must not have the type of a
 * list of lists. The rule of `withoutListOperands()` refuses every list for
 * the heads outside `LIST_OPERAND_HEADS`.
 */
function withoutNestedOperands(
  head: string,
  rule: FragmentRule<ScalarRepresentation>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const facts =
        'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      if (head === 'Count' && isFunction(node) && node.nops === 1) return facts;
      const inner = scope.inner.get(node);
      const nestedType = (operand: Expression) => {
        const f = scope.facts.get(operand) ?? inner?.facts.get(operand);
        return f !== undefined && 'type' in f && isNestedListType(f.type)
          ? f.type
          : undefined;
      };
      const operands = opsOfNode(node).flatMap((op) =>
        isFunction(op, 'Element') || isFunction(op, 'Limits')
          ? [op, ...op.ops]
          : [op]
      );
      const nested = operands.find((op) => nestedType(op) !== undefined);
      if (nested !== undefined)
        return w.refuse(
          node,
          'signature',
          `${head} with the operand ${nodeText(nested)} of the type ` +
            `\`${fragmentTypeToString(nestedType(nested)!)}\`, a list of lists, is not ` +
            `in the structured route, which reads a list of lists with At, Length, ` +
            `First, Last, Count, Take, Drop, Rest, Reverse, Join, the rotations, ` +
            `ReplaceAt, a list literal or a comprehension of rows, and the matrix functions`
        );
      if ('type' in facts && isNestedListType(facts.type))
        return w.refuse(
          node,
          'signature',
          `${head} whose value has the type \`${fragmentTypeToString(facts.type)}\`, ` +
            `a list of lists, is not in the structured route`
        );
      return facts;
    },
  };
}

/** The operands of `node`, or none. */
function opsOfNode(node: Expression): readonly Expression[] {
  return isFunction(node) ? node.ops : [];
}

/**
 * The type of a local on the structured route (`FragmentDefinition.localType`):
 *
 * - a local declared with a type (`Declare(t, 'real', v)`, a `let` with a
 *   type) has the declared type, whatever the kind of its value
 *   (`declaredLocalType()`). The pass converts each value written to it to
 *   that type where a conversion has the value of the existing compiler (an
 *   integer to a real, a list of integers to a list of reals), and refuses
 *   the others: a complex value of a `real`
 *   local (the existing compiler writes `_SYS.crealElements(v)`, `NaN` for
 *   a value that is not real, in the `complex` mode, and declines in the
 *   `strict` mode), a number of a list local, a list of a scalar local.
 *   A write of a real value to an integer local is refused too.
 * - a local declared with no type (`Declare(c, {value: Mod(k, 3)})`, a
 *   `let`) is an integer when its value is an integer and its type, as the
 *   engine infers it from every value written to it, is `integer`. Every
 *   other such local has the rule of the pass, which widens an integer to a
 *   real: a `let` local written later with a real value (`let c = 1` then
 *   `c := c + x` with `x: real`), which the interpreter accepts and for
 *   which the engine infers `real`. With an integer local, a loop bound
 *   (`Range(1, m)`) and an integer parameter of a helper can read the
 *   local.
 *
 * A `let` local that `isLengthLocal` accepts is an integer too: each value
 * written to it is an integer computed from the length of a list
 * (`integerFromListLength()`), or has the type `integer`. The engine infers
 * `integer | signed_infinity` or `real` for such a local (`let n =
 * Length(L)`).
 */
function structuredLocalType(
  local: {
    name: string;
    declaration?: Expression;
    value: { kind: string };
    declared: string | undefined;
    inferred: Type | undefined;
  },
  isLengthLocal: (name: string) => boolean = () => false,
  mode: 'strict' | 'complex' = 'strict'
): DeclaredLocalType | undefined {
  // A local declared `unknown` with a value is a `let` (`admitFunctionBody()`):
  // the rule of a local with no declared type, and otherwise the type of its
  // value, an integer widened to a real as the pass widens a `let`.
  if (local.declared === 'unknown') {
    const kind = local.value.kind;
    return (
      structuredLocalType(
        { ...local, declared: undefined },
        isLengthLocal,
        mode
      ) ??
      (kind === 'integer'
        ? { kind: 'real' }
        : kind === 'real' ||
            kind === 'complex' ||
            kind === 'boolean' ||
            kind === 'list'
          ? (local.value as DeclaredLocalType)
          : undefined)
    );
  }
  const declared = declaredLocalType(local.declared, mode);
  if (declared !== undefined) return declared;
  if (local.value.kind === 'list') return structuredListLocalType(local);
  if (local.value.kind !== 'integer') return undefined;
  if (local.declared === undefined && isLengthLocal(local.name))
    return { kind: 'integer' };
  if (
    local.declared === undefined &&
    local.inferred !== undefined &&
    local.inferred !== 'unknown' &&
    isSubtype(local.inferred, 'integer')
  )
    return { kind: 'integer' };
  return undefined;
}

type DeclaredLocalType =
  { kind: 'integer' | 'real' | 'complex' | 'boolean' } | FragmentListType;

/** The type of a local declared with the type `declared` (its spelling, as
 *  `declaredTypeSource()` reads it), for the declared types that the
 *  admission of the structured route admits (`admitFunctionBody()`), or
 *  `undefined` (no declared type). In the `complex` mode, a local declared
 *  `complex` is complex: a real value of it (its initializer or a later
 *  write) is refused by the check of the writes (`checkLocalWrites()`),
 *  because the existing compiler holds that value as a number and reads it
 *  in another shape (`let t = _.x`, then `_SYS.cplx(t)` after a write,
 *  `{re: 4, im: 0}`, and `(t).re` with no write, `NaN`). In the `strict`
 *  mode it keeps the type of its value: the existing compiler declines a
 *  real value of a type `real` there, and writes a real value of the type
 *  `number` as a number (`let t = 2 * _.xn`). */
function declaredLocalType(
  declared: string | undefined,
  mode: 'strict' | 'complex'
): DeclaredLocalType | undefined {
  switch (declared) {
    case 'complex':
      return mode === 'complex' ? { kind: declared } : undefined;
    case 'integer':
    case 'real':
    case 'boolean':
      return { kind: declared };
    // A local declared `number`, which the admission admits in the `strict`
    // mode only (`admitFunctionBody()`).
    case 'number':
      return mode === 'strict' ? { kind: 'real' } : undefined;
    case 'list<real>':
      return { kind: 'list', element: { kind: 'real' } };
    case 'list<integer>':
      return { kind: 'list', element: { kind: 'integer' } };
    // A list of `number` elements, real in the `strict` mode
    // (`structuredListType()`).
    case 'list<number>':
      return mode === 'strict'
        ? { kind: 'list', element: { kind: 'real' } }
        : undefined;
  }
  return (
    tupleListLocalType(declared, mode) ?? nestedListLocalType(declared, mode)
  );
}

/** The list type of a local declared with a list of rows of reals or of
 *  integers (`list<list<real>>`, `matrix`, `matrix<2x2>`, and in the `strict`
 *  mode `list<list<number>>`: `structuredNestedListType()`), or `undefined`
 *  for another declared type. A local of a higher rank has no type: a write
 *  of rows of integers to it would need a conversion that the route has for
 *  rows of reals only (`integer-rows-to-real-rows`). */
function nestedListLocalType(
  declared: string | undefined,
  mode: 'strict' | 'complex'
): FragmentListType | undefined {
  if (declared === undefined || !/^(list<list<|matrix\b)/.test(declared))
    return undefined;
  let type: Type;
  try {
    type = parseType(declared);
  } catch {
    return undefined;
  }
  const list = structuredNestedListType(type, mode);
  return list !== undefined &&
    !('refusal' in list) &&
    list.element.kind === 'list' &&
    (list.element.element.kind === 'real' ||
      list.element.element.kind === 'integer')
    ? list
    : undefined;
}

/** The list type of a local declared with a list of tuples
 *  (`list<tuple<number, number, number, integer>>`, a list of points,
 *  `structuredListType()`), or `undefined` for another declared type. */
function tupleListLocalType(
  declared: string | undefined,
  mode: 'strict' | 'complex'
): FragmentListType | undefined {
  if (declared === undefined || !/^list<tuple<.*>>$/.test(declared))
    return undefined;
  let type: Type;
  try {
    type = parseType(declared);
  } catch {
    return undefined;
  }
  const list = structuredListType(type, mode);
  return list !== undefined &&
    !('refusal' in list) &&
    list.element.kind === 'point'
    ? list
    : undefined;
}

/**
 * The empty list literals that are the value of a local declared with a
 * list of tuples (`let out: list<tuple<real, real>> = []`, or a later
 * `out = []`), with the element type of the local. The rule of `List`
 * gives such a literal the type of the local (`listLiteralRule()`): the
 * existing emitter writes `[]` for each, and the local holds a list of
 * tuples.
 */
const EMPTY_TUPLE_LISTS = new WeakMap<
  Expression,
  FragmentListType['element']
>();

/** Record in `EMPTY_TUPLE_LISTS` the empty list literals that `body`
 *  writes to a local declared with a list of tuples. A name is declared
 *  once on the structured route, so the declarations of the body give the
 *  type of each write. */
function markEmptyTupleLists(
  body: Expression,
  mode: 'strict' | 'complex'
): void {
  const declared = new Map<string, FragmentListType['element']>();
  const isEmpty = (node: Expression | undefined) =>
    isFunction(node, 'List') && node.nops === 0;
  // A node object reached twice is visited once: a tree can share its
  // subtrees (a doubling graph of depth 40).
  const seen = new Set<Expression>();
  const visit = (node: Expression): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    if (node.operator === 'Declare' && isSymbol(node.op1)) {
      const list = tupleListLocalType(declaredTypeSource(node.op2), mode);
      if (list !== undefined) {
        declared.set(node.op1.symbol, list.element);
        const value = declareValueOperand(node.ops);
        if (value !== undefined && isEmpty(value))
          EMPTY_TUPLE_LISTS.set(value, list.element);
      }
    }
    if (node.operator === 'Assign' && isSymbol(node.op1) && isEmpty(node.op2)) {
      const element = declared.get(node.op1.symbol);
      if (element !== undefined) EMPTY_TUPLE_LISTS.set(node.op2, element);
    }
    for (const op of node.ops) visit(op);
  };
  visit(body);
}

/**
 * The type of a `let` local whose value is a list, on the structured route,
 * by the rule of a scalar local (`structuredLocalType()`): a list of
 * integers when its value is one and the engine infers a subtype of
 * `list<integer>` from every value written to it, and otherwise a list of
 * reals (`let L = [0 for j in 1..n]` and later `L = replaceAt(L, k, x)`
 * with `x: real`). `undefined`: the type of the value.
 */
function structuredListLocalType(local: {
  value: { kind: string };
  declared: string | undefined;
  inferred: Type | undefined;
}): FragmentListType | undefined {
  const value = local.value as FragmentListType;
  if (local.declared !== undefined || value.element.kind !== 'integer')
    return undefined;
  if (
    local.inferred !== undefined &&
    local.inferred !== 'unknown' &&
    isSubtype(local.inferred, 'list<integer>')
  )
    return undefined;
  return { kind: 'list', element: { kind: 'real' } };
}

/**
 * Whether `node` is an integer computed from the length of a list with
 * integer arithmetic, on the structured route:
 *
 * - `Length(L)` (the library operator) of a symbol `L` of a list type of
 *   the structured route (`structuredListType()`);
 * - a symbol that `isIntegerName` accepts: at the admission, a local each
 *   of whose values is such an integer or has the type `integer`; in the
 *   pass, a name whose fact is `integer`;
 * - a call of a helper that `isIntegerCall` accepts: at the admission, a
 *   helper whose declared result is `integer`; in the pass, a call whose
 *   fact is `integer`. The engine types a call of a user function with a
 *   list argument `integer | list<any>`, and the pass gives it the fact of
 *   the value of the helper body, which the rule of `Typed` checks against
 *   the declared result;
 * - `Add`, `Negate`, `Multiply` or `Mod` (the library operators) whose
 *   operands each have the type `integer`, are such an integer, or are a
 *   symbol that `isIntegerOperand` accepts (at the admission, a local with
 *   no value so far that is not such an integer), one of them at least being
 *   such an integer.
 *
 * Such a node is an integer, although the engine types it otherwise: the
 * engine types `Length(L)` of a list whose length is not declared as
 * `integer | signed_infinity` (an infinite collection has an infinite
 * length), and `Length(L) - 1` as `real | signed_infinity`. A list of the
 * structured route is a JavaScript array, whose length is a finite integer,
 * and a sum, a product, a negation and a floored remainder of integers are
 * integers (`Mod` with a zero divisor gives `NaN`, as the rule of `Mod`
 * admits for integer operands). The admission (`checkLoop`, `checkWrite`),
 * the type of a `let` local (`structuredLocalType()`), the fact of `Add`,
 * `Negate` and `Multiply` (`withListLengthIntegers()`) and the bound of a
 * loop (`loopBoundFromFact`) read this one rule.
 */
function integerFromListLength(
  node: Expression,
  isIntegerName: (symbol: Expression & { symbol: string }) => boolean,
  isIntegerCall: (call: Expression) => boolean = () => false,
  isIntegerOperand: (symbol: Expression & { symbol: string }) => boolean = () =>
    false
): boolean {
  if (isSymbol(node)) return isIntegerName(node);
  if (isFunction(node) && !isLibraryOperator(node, node.operator))
    return isIntegerCall(node);
  if (!isFunction(node)) return false;
  if (node.operator === 'Length')
    return (
      node.nops === 1 &&
      isSymbol(node.op1) &&
      isAdmittedList(node.op1.type.type)
    );
  if (!['Add', 'Negate', 'Multiply', 'Mod'].includes(node.operator))
    return false;
  let found = false;
  for (const operand of node.ops) {
    if (
      integerFromListLength(
        operand,
        isIntegerName,
        isIntegerCall,
        isIntegerOperand
      )
    )
      found = true;
    else if (
      !isSubtype(operand.type.type, 'integer') &&
      !(isSymbol(operand) && isIntegerOperand(operand))
    )
      return false;
  }
  return found;
}

/**
 * The rule `rule` of `Add`, `Negate` or `Multiply`, with an integer fact
 * for a node computed from the length of a list whose operands all have
 * integer facts (`integerFromListLength()`): the signatures read the engine
 * type of the node, which is not `integer` there.
 */
function withListLengthIntegers(
  rule: Extract<FragmentRule<ScalarRepresentation>, { walk: unknown }>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const facts = rule.walk(node, scope, context, w);
      if (!('representation' in facts) || facts.type.kind !== 'real')
        return facts;
      const operands = operandFacts(node, scope, context, w);
      const isInteger = (n: Expression) =>
        w.value(n, scope, context).type.kind === 'integer';
      if (
        !operands.every((f) => f.type.kind === 'integer') ||
        !integerFromListLength(node, isInteger, isInteger)
      )
        return facts;
      return w.valueFacts(
        node,
        { kind: 'integer' },
        operands.map((f) => w.convert(f, f.type)!)
      );
    },
  };
}

/**
 * The rule `rule` of `Add`, `Negate`, `Multiply`, `Min` or `Max`, with a
 * real fact where it gives an integer fact and an operand has a fact that
 * is not an integer. The signatures read the engine type of the node, which
 * can be `integer` where the fact of an operand is `real`: the engine
 * infers `list<integer>` for `let M = g(L)` with `L` a list of integers,
 * where the fact of `M` is the declared result `list<real>` of `g`, so
 * `M[1]` has a real fact and an integer engine type. A sum of an integer and
 * a real is not an integer.
 */
function withRealFromRealOperands(
  rule: FragmentRule<ScalarRepresentation>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const facts =
        'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      if (!('representation' in facts) || facts.type.kind !== 'integer')
        return facts;
      const operands = operandFacts(node, scope, context, w);
      if (operands.every((f) => f.type.kind === 'integer')) return facts;
      return w.valueFacts(
        node,
        { kind: 'real' },
        operands.map((f) => w.convert(f, { kind: 'real' })!)
      );
    },
  };
}

//
// Lists on the structured route
//
// A list input of the program and a list parameter of a helper are read
// with `At` and `Length`, and passed whole to a helper parameter of the same
// list type. `Comprehension` over a range makes a list and `ReplaceAt` a new
// list from a list. A list can be the value of a local (`listLocals`), a
// carried value, the value of an `If`, of a helper and of the program. It is
// not an operand of any other operator: `withoutListOperands()` refuses a
// list operand. A list of integers is read as a list of reals where a list of
// reals is expected (`passesListArgument`): both are one array of numbers.
//

/**
 * The fragment type of a list input or a list parameter of the declared
 * engine type `type` on the structured route: a list of integers for a
 * subtype of `list<integer>`, a list of reals for another subtype of
 * `list<real>`. Each is a JavaScript array of numbers, the value that the
 * existing emitter reads with `_SYS.atNumeric` and `.length`, and that the
 * entry check of `run()` accepts as it accepts it for the existing route
 * (a plain array; a typed array or a string throws). This admits
 * `list<real>`, `vector<real>`, `list<integer>`, a list with a declared
 * length (`list<real^5>`: the length is not part of the type, and the code
 * reads the length of the array, as the existing emitter does) and a list
 * of a subtype of `real` (`list<finite_real>`), and a list of tuples of
 * the tuple types of `structuredTupleType()` (a list of points, an array of
 * arrays).
 *
 * A refusal, with its message, for every other list type: a list of lists
 * or a matrix, a list of complex numbers (its elements are `{re, im}`
 * objects, and the structured route has no list of them), a list of
 * booleans (the existing emitter reads it with `_SYS.at`) and, in the
 * `complex` mode or with no mode, a list of `number` (`vector`), whose
 * elements can be complex there. The result is
 * `undefined` for a type that is not a list type: a tuple (the existing
 * emitter reads it with `_SYS.at`), `indexed_collection<real>` (a supertype
 * of a tuple) and a string keep the message of a binding that the route
 * has no type for.
 */
function structuredListType(
  type: Type,
  mode?: 'strict' | 'complex'
): FragmentListType | { refusal: string } | undefined {
  if (isSubtype(type, 'list<integer>'))
    return { kind: 'list', element: { kind: 'integer' } };
  if (isSubtype(type, 'list<real>'))
    return { kind: 'list', element: { kind: 'real' } };
  // In the `strict` mode, a flat list of `number` elements (`list<number>`,
  // `vector<n>`, `vector`, or of a union that `declaredNumberKind()` maps):
  // a list of reals, as the existing compiler reads it there
  // (`_SYS.atNumeric(L, i, "number")`, `(L).reduce((_a, _b) => _a + _b, 0)`;
  // "In `strict`, a value of type `number` must be real").
  if (
    mode === 'strict' &&
    typeof type === 'object' &&
    type.kind === 'list' &&
    (type.dimensions === undefined || type.dimensions?.length === 1) &&
    declaredNumberKind(type.elements, 'strict')?.kind === 'real'
  )
    return { kind: 'list', element: { kind: 'real' } };
  // A list of tuples of reals (a list of points): an array of arrays, as the
  // existing emitter reads it (`_SYS.atPoint(L, i, n)`).
  if (
    typeof type === 'object' &&
    type.kind === 'list' &&
    type.dimensions === undefined
  ) {
    const point = structuredTupleType(type.elements, mode);
    if (point !== undefined) return { kind: 'list', element: point };
  }
  const nested = structuredNestedListType(type, mode);
  if (nested !== undefined) return nested;
  // Another list type (`typeof type === 'object'`, of the kind `list`):
  // a string, a tuple or a set keeps the message of a binding with no type.
  if (typeof type === 'object' && type.kind === 'list')
    return {
      refusal:
        `the type ${typeToString(type)}, and the structured route admits a ` +
        `list only of the type list<real> or list<integer> ` +
        `(a JavaScript array of numbers)`,
    };
  return undefined;
}

/**
 * The fragment type of a list of lists of the engine type `type` on the
 * structured route (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`,
 * section 2): a list whose element is the fragment type of a row, to the
 * rank that the type states. A `matrix`, a `matrix<m×n>` and a
 * `tensor<U^(a×b×c)>` have the rank of their dimensions and the elements
 * of their cells (`number` cells are real in the `strict` mode, as a flat
 * `list<number>` is); a `list<T>` whose element `T` is a list type
 * (`list<list<real>>`, `list<vector<2>>`, `list<matrix<2x2>>`,
 * `list<list<tuple<real, real>>>`) is a list of the type of `T`
 * (`structuredListType()`). The type holds the rank only, not the lengths:
 * rows of a `list<list<real>>` can have different lengths, and the code
 * reads the length of each array, as the existing emitter does. Each is a
 * JavaScript array of arrays.
 *
 * A refusal, with its message, for a tensor whose rank the type does not
 * state (`tensor`, `tensor<real>`: R3 of `docs/COMPILATION-MODEL.md`), for
 * cells that are not real (`matrix<complex>`; `number` cells in the
 * `complex` mode or with no mode), and for every list of lists in the
 * `complex` mode, where the existing compiler reads the cells on the complex
 * lane. `undefined` for a type that is not a list of lists.
 */
function structuredNestedListType(
  type: Type,
  mode?: 'strict' | 'complex'
): FragmentListType | { refusal: string } | undefined {
  if (typeof type !== 'object' || type.kind !== 'list') return undefined;
  const dimensions = type.dimensions;
  const text = typeToString(type);
  if (dimensions === null)
    return {
      refusal:
        `the type ${text}, a tensor whose rank the type does not state, and the ` +
        `structured route admits a list of lists only of a declared rank ` +
        `(matrix, matrix<m×n>, list<list<real>>)`,
    };
  const rows =
    dimensions === undefined || dimensions.length === 1
      ? type.elements
      : undefined;
  if (
    (dimensions === undefined || dimensions.length < 2) &&
    !(typeof rows === 'object' && rows.kind === 'list')
  )
    return undefined;
  if (mode === 'complex')
    return {
      refusal:
        `the type ${text}, a list of lists, which is not in the structured route ` +
        `in the \`complex\` mode: the existing compiler reads its cells on the ` +
        `complex lane`,
    };
  if (rows !== undefined) {
    const row = structuredListType(rows, mode);
    if (row === undefined || 'refusal' in row)
      return {
        refusal:
          `the type ${text}, and the structured route admits a list of lists ` +
          `only of rows of reals, of integers or of tuples of reals, of a ` +
          `declared rank`,
      };
    return { kind: 'list', element: row };
  }
  // A rank of 2 or more from the dimensions, and the type of a cell.
  const cell = type.elements;
  const kind = isSubtype(cell, 'integer')
    ? 'integer'
    : isSubtype(cell, 'real') ||
        (mode === 'strict' &&
          declaredNumberKind(cell, 'strict')?.kind === 'real')
      ? 'real'
      : undefined;
  if (kind === undefined)
    return {
      refusal:
        `the type ${text}, and the structured route admits a matrix or a tensor ` +
        `only of real or integer cells (number cells in the \`strict\` mode)`,
    };
  let list: FragmentListType = { kind: 'list', element: { kind } };
  for (let level = 1; level < dimensions!.length; level++)
    list = { kind: 'list', element: list };
  return list;
}

/**
 * The fragment type of a tuple input, a tuple parameter or a tuple result of
 * the declared engine type `type` on the structured route: a point of the
 * size of the tuple, for a tuple of elements with no name, each of a
 * subtype of `real`, or, in the `strict` mode (`mode`), of the type
 * `number` (or a real with `NaN` and infinities, `declaredNumberKind()`),
 * which is real there ("In `strict`, a value of type `number` must be
 * real", `docs/COMPILATION-MODEL.md`). The existing emitter reads such a
 * tuple as a JavaScript array of numbers (`_SYS.at(P, k)`, `P[0]`,
 * `_SYS.atNumeric(P, k, "number")`). `undefined` for every other type: a
 * named tuple (a record of the language), a tuple of complex or boolean
 * elements, and a tuple of `number` elements in the `complex` mode or with
 * no mode keep the message of a binding that the route has no type for.
 */
function structuredTupleType(
  type: Type,
  mode?: 'strict' | 'complex'
): { kind: 'point'; size: number } | undefined {
  if (typeof type !== 'object' || type.kind !== 'tuple') return undefined;
  const elements = type.elements;
  if (
    elements.length === 0 ||
    elements.some(
      (e) =>
        e.name !== undefined ||
        !(
          isSubtype(e.type, 'real') ||
          (mode === 'strict' &&
            declaredNumberKind(e.type, 'strict')?.kind === 'real')
        )
    )
  )
    return undefined;
  return { kind: 'point', size: elements.length };
}

/** Whether `type` is a list type of the structured route. */
function isAdmittedList(type: Type): boolean {
  // A list of `number` elements is admitted in the `strict` mode only, and
  // its length is an integer there.
  const list = structuredListType(type, 'strict');
  return list !== undefined && !('refusal' in list);
}

/** The fragment type of a parameter of the declared engine type `type` on
 *  the structured route: a scalar type, or a list type
 *  (`structuredListType()`). Throws for another collection type. */
function structuredParameterType(
  type: Type,
  name: string | undefined,
  mode?: 'strict' | 'complex'
) {
  const scalar = scalarType(type);
  if (scalar !== undefined) return scalar;
  const tuple = structuredTupleType(type, mode);
  if (tuple !== undefined) return tuple;
  const list = structuredListType(type, mode);
  if (list !== undefined && 'refusal' in list)
    throw new Error(
      `JS scalar fragment: the parameter ${name ?? ''} has ${list.refusal}`
    );
  return list;
}

/** How the structured route holds a value of the type `type`: the
 *  representation of a scalar, and `array` for a list of reals, of integers
 *  or of tuples of reals (points), for a list of such lists at every depth
 *  (an array of arrays), and for a tuple of reals, as the existing emitter
 *  holds each. */
function structuredRepresentation(
  type: StructuredTypeShape
): ScalarRepresentation | undefined {
  if (type.kind === 'point') return 'array';
  if (type.kind !== 'list') return representation(type);
  const element = type.element;
  // A list of booleans is an array of JavaScript booleans, of one level
  // (`isBooleanList()`): a row of booleans has no representation.
  if (element?.kind === 'list')
    return element.element?.kind !== 'boolean' &&
      structuredRepresentation(element) === 'array'
      ? 'array'
      : undefined;
  const kind = element?.kind;
  return kind === 'real' ||
    kind === 'integer' ||
    kind === 'point' ||
    kind === 'boolean'
    ? 'array'
    : undefined;
}

/** The shape of a fragment type that `structuredRepresentation()` reads: a
 *  kind, and the element of a list, at every depth. */
type StructuredTypeShape = {
  readonly kind: string;
  readonly element?: StructuredTypeShape;
};

/** Whether `type` is a list of lists (a fragment list type whose element is
 *  a list), of any rank. */
function isNestedListType(type: { readonly kind: string }): boolean {
  return (
    type.kind === 'list' && (type as FragmentListType).element.kind === 'list'
  );
}

/** The type of a row that holds a row of the type `a` and a row of the type
 *  `b` (two rows of a list of lists): the same type, or the type that reads
 *  the other one with no conversion (`passesStructuredList()`: rows of
 *  integers beside rows of reals are rows of reals), or `undefined`. */
function joinedRows(
  a: FragmentListType,
  b: FragmentListType
): FragmentListType | undefined {
  if (fragmentTypeToString(a) === fragmentTypeToString(b)) return a;
  if (passesStructuredList(a, b)) return b;
  if (passesStructuredList(b, a)) return a;
  return undefined;
}

/** Whether a list of the type `argument` is read as a list of the type
 *  `parameter` with no conversion: a list of integers as a list of reals,
 *  both one JavaScript array of numbers, and rows of integers as rows of
 *  reals (rank 2). The lowering has a conversion for these two ranks only
 *  (`toLocal()`: `integer-list-to-real-list`, `integer-rows-to-real-rows`),
 *  so a list of a higher rank is read only as a list of its own type. */
function passesStructuredList(
  argument: FragmentListType,
  parameter: FragmentListType
): boolean {
  const a = argument.element;
  const p = parameter.element;
  if (a.kind === 'list' && p.kind === 'list')
    return (
      fragmentTypeToString(a) === fragmentTypeToString(p) ||
      (a.element.kind !== 'list' &&
        p.element.kind !== 'list' &&
        passesStructuredList(a, p))
    );
  return a.kind === 'integer' && p.kind === 'real';
}

/** The definition of the structured route: the existing definition, with a
 *  list input (a free symbol of a list type), and a list held as an
 *  `array` where it is an input, a parameter or a local. A list index has
 *  no representation, and the refusal says why (`bindingLimit`). */
const structuredDefinition: Pick<
  FragmentDefinition<ScalarRepresentation>,
  | 'typeOfSymbol'
  | 'representationOfBinding'
  | 'representationOfValue'
  | 'bindingLimit'
  | 'loopBoundFromFact'
  | 'passesListArgument'
  | 'mapsListArguments'
  | 'listLocals'
  | 'literalTupleComponents'
  | 'nestedLists'
> = {
  typeOfSymbol(node) {
    const scalar = definition.typeOfSymbol(node);
    if (scalar !== undefined) return scalar;
    const tuple = structuredTupleType(node.type.type);
    if (tuple !== undefined) return tuple;
    const list = structuredListType(node.type.type);
    return list === undefined || 'refusal' in list ? undefined : list;
  },
  // A list is held as an `array` where it is an input, a parameter or a
  // local; an index is an integer.
  representationOfBinding: (type, binding) =>
    type.kind === 'list' && binding.role === 'index'
      ? undefined
      : structuredRepresentation(type),
  listLocals: true,
  // A destructuring write of a literal tuple writes each operand to its
  // name, as the existing emitter does (`_tv1 = b; a = _tv1`).
  literalTupleComponents: true,
  // A list of lists, read by the rules of `NESTED_OPERAND_HEADS` only.
  nestedLists: true,
  representationOfValue: structuredRepresentation,
  // A bound computed from the length of a list with integer arithmetic,
  // whose fact is an integer (`integerFromListLength()`, with the names of
  // integer facts): the rule that `checkLoop` reads at the admission.
  loopBoundFromFact: (bound, isInteger) =>
    isInteger(bound) && integerFromListLength(bound, isInteger),
  // A list of integers and a list of reals are one JavaScript array of
  // numbers: the existing route passes the array to the helper, and the
  // interpreter reads the integers as reals; so are the rows of a list of
  // lists.
  passesListArgument: passesStructuredList,
  // A user function applied to each element of a list argument at a real
  // or integer parameter (`_SYS.mapFn(_fn_f, [1], L)` of the existing
  // emitter), for lists of lengths equal by construction or of one stated
  // width (`listsOfOneLength()`). A list of lists is mapped at its numbers
  // (`_SYS.mapFn(_fn_f, [2], A)`) only as the one list argument: the
  // lengths of the rows of two of them are not known to be equal.
  mapsListArguments: (lists, scope, context, w) =>
    lists.length < 2 ||
    (lists.every(
      (l) => (numericCellsOf(w.value(l, scope, context))?.rank ?? 0) === 1
    ) &&
      listsOfOneLength(lists, scope, context, w)),
  bindingLimit: (type, binding) =>
    type.kind === 'list'
      ? `The ${binding.role} \`${isSymbol(binding.symbol) ? binding.symbol.symbol : nodeText(binding.symbol)}\` ` +
        `has the type \`${fragmentTypeToString(type)}\`: the structured route admits a list ` +
        `only as an input, a parameter or a local, and not as a ${binding.role}`
      : undefined,
};

/**
 * `At(L, i)` on the structured route: `L` is a list input or a list
 * parameter (the type `list<real>` or `list<integer>`), and `i` one index
 * with an integer fact. The result has the type of an element. The
 * lowering writes the read as the existing emitter writes it for such a
 * list, `_SYS.atNumeric(L, i, "real")`: an index counts from 1, a negative
 * index from the end (`-1` is the last element), and an index out of range
 * (0, beyond the length) gives `NaN`, as in the interpreter for a list of
 * numbers. That `NaN` is the absent value of a numeric type
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"): every
 * operator applied to it other than `At`, `Length` and a discharge is
 * unspecified in compiled code. The helper also throws when the element is
 * an array, as on the existing route.
 *
 * A list of lists (`nestedLists`) is read by row: `At(M, i)` is the row
 * `i`, a list, which the lowering writes as the existing emitter writes the
 * read of a row, `undefined` for an index out of range; `At(M, i, j)` reads
 * the row `i`, then its element `j` (one index per level, the rank of `M`
 * at least the number of indexes), as `At(At(M, i), j)` does. A row read is
 * a value that can be absent: the admission admits it only where the
 * existing emitter gives the same value for an absent row
 * (`refuseAbsentRowUses()`).
 *
 * A list of numbers is also read at an index with a real fact and at a
 * list of indexes (a list literal, a `Range`, a list: a gather), with the
 * call of the existing emitter, `_SYS.atNumeric(L, i, "real")`: `NaN` for an
 * index that is not an integer position, and for a list of indexes a new
 * list with `NaN` at each index out of range (`at-real` and `gather`).
 *
 * Refused: an index with a real fact or a list of indexes for a base that
 * is not a list of numbers, a base that is not a list input or parameter,
 * more than one index of a list that is not a list of lists at each level.
 * The admission refuses, before this rule, more than one index of a base
 * that is not a list of lists, a `Range` index beside another index and a
 * string index (`structuredListRefusal()`).
 */
function atRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node) || node.nops < 2)
    return w.refuse(
      node,
      'signature',
      'At with no index is not in the structured route'
    );
  const [base, ...indexes] = operandFacts(node, scope, context, w);
  // A list of numbers read at a real index, or at a list of indexes (a
  // list literal, a `Range`, a list name: a gather): the read of the
  // existing emitter, `_SYS.atNumeric(L, i, "real")`, which gives `NaN` for
  // an index that is not an integer position, and a new list for a list of
  // indexes (`NaN` at each index out of range).
  if (indexes.length === 1 && indexes[0].type.kind !== 'integer') {
    const index = indexes[0];
    // A row read can be absent (an index out of range): the existing
    // emitter reads `undefined` for a gather of an absent row
    // (`At(At(M, k), Range(1, 3))`), where `_SYS.atNumeric` gives `NaN`. A
    // real index gives `NaN` on both.
    if (
      index.type.kind === 'list' &&
      isFunction(node.op1) &&
      ['At', 'First', 'Last', 'Second', 'Third'].includes(node.op1.operator) &&
      isNestedListType(w.value(node.op1.ops[0], scope, context).type)
    )
      return w.refuse(
        node,
        'signature',
        `At of the row ${nodeText(node.op1)} at a list of indexes is not ` +
          `in the structured route: the row can be absent, and the existing ` +
          `emitter reads undefined for a gather of an absent row`
      );
    const element =
      base.type.kind === 'list' ? collectionElement(base) : undefined;
    const indexElement =
      index.type.kind === 'list' ? collectionElement(index) : undefined;
    if (
      element !== undefined &&
      (index.type.kind === 'real' || indexElement !== undefined)
    )
      return w.valueFacts(
        node,
        index.type.kind === 'real'
          ? { kind: element }
          : { kind: 'list', element: { kind: element } },
        [w.convert(base, base.type)!, w.convert(index, index.type)!]
      );
  }
  // An element of a row whose engine type is not a number (`At([[]], k,
  // -1)`, of the type `missing`: the rows hold no element): the existing
  // emitter reads `undefined` for an absent row there, where the route reads
  // `NaN`.
  const rowRead = (n: Expression) =>
    isFunction(n) &&
    ['At', 'First', 'Last', 'Second', 'Third'].includes(n.operator) &&
    isNestedListType(w.value(n.ops[0], scope, context).type);
  if (
    (isNestedListType(base.type) || rowRead(node.op1)) &&
    !isSubtype(node.type.type, 'number') &&
    !isSubtype(node.type.type, 'list<any>') &&
    !isSubtype(node.type.type, 'tuple')
  )
    return w.refuse(
      node,
      'signature',
      `At of ${rowRead(node.op1) ? 'the row ' : ''}${nodeText(node.op1)} of the type ` +
        `\`${node.op1.type.toString()}\`, whose element has the type ` +
        `${node.type.toString()}, is not in the structured route: the existing ` +
        `emitter reads undefined for an absent row there`
    );
  for (const index of indexes)
    if (index.type.kind !== 'integer')
      return w.refuse(
        node,
        'signature',
        `At with an index of the type \`${fragmentTypeToString(index.type)}\` is ` +
          `not in the structured route, which reads an index of the type integer`
      );
  // A list of lists: one level per index, a row (a list) for each index
  // but the last, which reads an element of the last row read.
  if (isNestedListType(base.type) && base.representation === 'array') {
    let type: FragmentValueType | FragmentListType = base.type;
    for (const _ of indexes) {
      if (type.kind !== 'list')
        return w.refuse(
          node,
          'signature',
          `At with ${indexes.length} indexes of the type \`${fragmentTypeToString(base.type)}\` ` +
            `is not in the structured route, which reads one index per level of a list of lists`
        );
      type = type.element;
    }
    return w.valueFacts(node, type, [
      w.convert(base, base.type)!,
      ...indexes.map((index) => w.convert(index, index.type)!),
    ]);
  }
  if (indexes.length !== 1)
    return w.refuse(
      node,
      'signature',
      `At with ${indexes.length} indexes is not in the structured route, which reads ` +
        `one index of a list that is not a list of lists`
    );
  const index = indexes[0];
  // An element of a list of booleans (an element-wise comparison) is a
  // boolean: the existing emitter reads it with `_SYS.at`, `undefined` for
  // an index out of range.
  if (isBooleanList(base))
    return w.valueFacts(node, { kind: 'boolean' }, [
      w.convert(base, base.type)!,
      w.convert(index, index.type)!,
    ]);
  // An element of a list of tuples is a tuple (a point).
  const point = listElementType(base);
  const element = point?.kind === 'point' ? point : collectionElement(base);
  if (element === undefined)
    return w.refuse(
      node,
      'signature',
      `At in the structured route reads a list of reals, integers or tuples or a ` +
        `tuple of reals, and its first operand has the type ` +
        `\`${fragmentTypeToString(base.type)}\``
    );
  return w.valueFacts(
    node,
    typeof element === 'string' ? { kind: element } : element,
    [w.convert(base, base.type)!, w.convert(index, index.type)!]
  );
}

/**
 * `Length(L)` on the structured route: `L` is a list input or a list
 * parameter; the result is an integer, the length of the array, written
 * `L.length` as the existing emitter writes it. The engine types
 * `Length(L)` as `integer | signed_infinity` for a list whose length is
 * not declared (an infinite collection has an infinite length); a
 * JavaScript array has a finite length.
 */
function lengthRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node) || node.nops !== 1)
    return w.refuse(
      node,
      'signature',
      'Length with other than one operand is not in the structured route'
    );
  const [base] = operandFacts(node, scope, context, w);
  // The number of rows of a list of lists.
  if (
    collectionElement(base) === undefined &&
    listElementType(base) === undefined &&
    !isBooleanList(base) &&
    !(isNestedListType(base.type) && base.representation === 'array')
  )
    return w.refuse(
      node,
      'signature',
      `Length in the structured route reads a list of reals, integers or tuples or ` +
        `a tuple of reals, and its operand has the type ` +
        `\`${fragmentTypeToString(base.type)}\``
    );
  return w.valueFacts(node, { kind: 'integer' }, [w.convert(base, base.type)!]);
}

/**
 * The parts of `Comprehension(body, Element(j, Range(a, b)))` and of
 * `Comprehension(body, Element(j, Range(a, b), guard))`, a comprehension
 * with a guard, or `undefined` for another form. `Element` and `Range` are
 * the operators of the library.
 */
function comprehensionParts(node: Expression):
  | {
      body: Expression;
      index: string;
      from: Expression;
      to: Expression;
      guard?: Expression;
    }
  | undefined {
  if (!isFunction(node, 'Comprehension') || node.nops !== 2) return undefined;
  const spec = node.op2;
  if (
    !isFunction(spec, 'Element') ||
    !isLibraryOperator(spec, 'Element') ||
    (spec.nops !== 2 && spec.nops !== 3) ||
    !isSymbol(spec.op1) ||
    !isFunction(spec.op2, 'Range') ||
    !isLibraryOperator(spec.op2, 'Range') ||
    spec.op2.nops !== 2
  )
    return undefined;
  return {
    body: node.op1,
    index: spec.op1.symbol,
    from: spec.op2.op1,
    to: spec.op2.op2,
    ...(spec.nops === 3 ? { guard: spec.op3 } : {}),
  };
}

/**
 * The message of the refusal of a `Comprehension` that is of neither form
 * of the structured route (`comprehensionParts()`, `comprehensionClauses()`),
 * or `undefined`.
 */
function comprehensionRefusal(node: Expression): string | undefined {
  if (
    !isFunction(node, 'Comprehension') ||
    comprehensionParts(node) !== undefined
  )
    return undefined;
  const clauses = comprehensionClauses(node);
  if ('refusal' in clauses) return clauses.refusal;
  return undefined;
}

/** One generator of a `Comprehension` (`comprehensionClauses()`). */
type ComprehensionClause = {
  readonly index: string;
  readonly kind: 'range' | 'list';
  /** The `Range(a, b)` or the list value. */
  readonly source: Expression & { ops: readonly Expression[] };
  readonly guard?: Expression;
};

/**
 * The generators of `Comprehension(body, g_1, …, g_n)` of the general form
 * of the structured route: one or more generators, each
 * `Element(k, Range(a, b))` or `Element(c, V)` over a list value `V`
 * (`loopClauseKind()`), with an optional filter, as the existing emitter
 * writes them (`compileComprehension()`): nested loops, the first
 * outermost, whose innermost body pushes the value of `body`; the source
 * of a generator is evaluated in the loop of the generators before it,
 * once per pass there, and its filter skips the passes where it is not
 * `True`, with the inner loops. The interpreter's comprehension is a lazy
 * view, so the body, each filter and each source but the first must be
 * pure; a filter or a source reads no index of a later generator (the
 * interpreter reads the name around the comprehension there), and the
 * indexes have distinct names.
 */
function comprehensionClauses(
  node: Expression & { ops: readonly Expression[] }
): { clauses: readonly ComprehensionClause[] } | { refusal: string } {
  const specs = node.ops.slice(1);
  if (specs.length === 0)
    return {
      refusal: 'Comprehension with no generator is not in the structured route',
    };
  // A comprehension whose type is not a list (`list | missing` over the
  // empty list literal): the existing compiler reads an element of it with
  // `_SYS.atWithValueMarker`, `undefined` out of range, where a list of
  // numbers gives `NaN`.
  if (!isSubtype(node.type.type, 'list'))
    return {
      refusal:
        `Comprehension of the type ${node.type.toString()}, which is not a ` +
        `list, is not in the structured route`,
    };
  const clauses: ComprehensionClause[] = [];
  for (const spec of specs) {
    const kind = loopClauseKind(spec, true);
    if (kind === undefined)
      return {
        refusal:
          `Comprehension over ${nodeText(spec)} is not in the structured route, ` +
          `which admits a comprehension over Element(j, Range(a, b)) or over ` +
          `the elements of a list`,
      };
    const s = spec as Expression & {
      ops: readonly Expression[];
      op1: Expression & { symbol: string };
      op2: Expression & { ops: readonly Expression[] };
    };
    clauses.push({
      index: s.op1.symbol,
      kind,
      source: s.op2,
      ...(s.ops.length === 3 ? { guard: s.ops[2] } : {}),
    });
  }
  const indexes = clauses.map((c) => c.index);
  const repeated = indexes.find((n, i) => indexes.indexOf(n) !== i);
  if (repeated !== undefined)
    return {
      refusal: `Comprehension with two generators of the index ${repeated} is not in the structured route`,
    };
  for (const [i, c] of clauses.entries())
    for (const [part, label] of [
      [c.source, 'source'],
      [c.guard, 'filter'],
    ] as const) {
      if (part === undefined) continue;
      const read = symbolsOnce(part);
      const later = indexes
        .slice(part === c.guard ? i + 1 : i)
        .find((n) => read.has(n));
      if (later !== undefined)
        return {
          refusal:
            `Comprehension whose ${label} ${nodeText(part)} reads the index ` +
            `${later} of a later generator is not in the structured route`,
        };
    }
  const parts = [
    node.ops[0],
    ...clauses.flatMap((c, i) => [
      ...(i === 0 ? [] : [c.source]),
      ...(c.guard === undefined ? [] : [c.guard]),
    ]),
  ];
  const impure = parts.flatMap((part) => impureNodes(part)).at(0);
  if (impure !== undefined)
    return {
      refusal:
        `Comprehension of this form with the node ${nodeText(impure)}, which is ` +
        `not pure, in its body, a filter or a source after the first, is not ` +
        `in the structured route: the interpreter's comprehension is a lazy ` +
        `view, and the route makes the list at once`,
    };
  return { clauses };
}

/**
 * `Comprehension` of the general form (`comprehensionClauses()`): one scope
 * binds the indexes; the source of the first generator is typed where the
 * node is, the source of each later one in that scope with the indexes
 * before it; a range has integer bounds and an integer index, a list
 * value a list of numbers or tuples; a filter is a boolean. The result is
 * a list of the type of the body, as `comprehensionRule()` makes it.
 */
function generalComprehensionRule(
  node: Expression & { ops: readonly Expression[] },
  clauses: readonly ComprehensionClause[],
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const inner = w.open(node, scope);
  for (const [i, c] of clauses.entries()) {
    const at = i === 0 ? scope : inner;
    const spec = node.ops[i + 1] as Expression & { op1: Expression };
    if (c.kind === 'range') {
      for (const bound of c.source.ops)
        if (w.value(bound, at, context).type.kind !== 'integer')
          return w.refuse(
            node,
            'signature',
            `The bound \`${nodeText(bound)}\` of \`Comprehension\` does not have an ` +
              `integer fact: the structured route reads a bound as an integer`
          );
      w.bind(spec.op1, inner, c.index, { kind: 'integer' }, 'index');
    } else {
      const list = w.value(c.source, at, context);
      const element = listElementType(list);
      if (element === undefined)
        return w.refuse(
          node,
          'signature',
          `Comprehension over \`${nodeText(c.source)}\` of the type ` +
            `\`${fragmentTypeToString(list.type)}\` is not in the structured route, ` +
            `which visits the elements of a list of reals, of integers or of tuples`
        );
      w.bind(spec.op1, inner, c.index, element, 'index');
    }
    if (c.guard !== undefined) {
      const guard = w.value(c.guard, inner, { ...context, loop: undefined });
      if (guard.type.kind !== 'boolean')
        return w.refuse(
          node,
          'signature',
          `The filter \`${nodeText(c.guard)}\` of \`Comprehension\` does not have ` +
            `a boolean fact`
        );
    }
  }
  const body = w.value(node.ops[0], inner, { ...context, loop: undefined });
  const kind = body.type.kind;
  if (body.type.kind === 'point')
    return w.valueFacts(node, { kind: 'list', element: body.type });
  if (body.type.kind === 'list' && body.representation === 'array')
    return w.valueFacts(node, { kind: 'list', element: body.type });
  if (kind !== 'real' && kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      `Comprehension whose body has the type \`${fragmentTypeToString(body.type)}\` is ` +
        `not in the structured route, which makes a list of reals or of integers`
    );
  return w.valueFacts(node, { kind: 'list', element: { kind } });
}

/**
 * `Comprehension(body, Element(j, Range(a, b)))` on the structured route:
 * the list of the values of `body` for `j` from `a` to `b`, in steps of 1,
 * or of -1 when `b` is less than `a`, as the interpreter iterates
 * `Range(a, b)` (`Range(1, 0)` has the two elements 1 and 0). The bounds
 * have integer facts (an integer capture, `Power(N, 2)` of one, an integer
 * computed from the length of a list); the index is an integer in the
 * scope of the comprehension; the body has a real or an integer fact. The
 * result is a list of integers when the body is an integer, otherwise a
 * list of reals; both are a JavaScript array of numbers, as the existing
 * emitter makes it. A body that is a tuple or a list makes a list of
 * tuples or a list of lists. Refused: a bound with a real fact, a complex
 * or a boolean body. The admission refuses another form before this rule
 * (`comprehensionRefusal()`).
 */
function comprehensionRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const parts = comprehensionParts(node);
  // The general form: several generators, a list, a range with a step.
  if (parts === undefined && isFunction(node, 'Comprehension')) {
    const general = comprehensionClauses(node);
    if ('clauses' in general)
      return generalComprehensionRule(node, general.clauses, scope, context, w);
  }
  if (parts === undefined || !isFunction(node))
    return w.refuse(
      node,
      'signature',
      comprehensionRefusal(node) ??
        'Comprehension is not of the form of the structured route'
    );
  for (const bound of [parts.from, parts.to])
    if (w.value(bound, scope, context).type.kind !== 'integer')
      return w.refuse(
        node,
        'signature',
        `The bound \`${nodeText(bound)}\` of \`Comprehension\` does not have an ` +
          `integer fact: the structured route reads a bound as an integer`
      );
  const inner = w.open(node, scope);
  const spec = node.op2 as Expression & { op1: Expression };
  w.bind(spec.op1, inner, parts.index, { kind: 'integer' }, 'index');
  if (parts.guard !== undefined) {
    // The interpreter's comprehension is a lazy view: its guard and its body
    // are evaluated when an element is read, and the route makes the list
    // at once. The values agree only when both are pure.
    const impure = [parts.guard, parts.body]
      .flatMap((part) => impureNodes(part))
      .at(0);
    if (impure !== undefined)
      return w.refuse(
        node,
        'signature',
        `Comprehension with a guard whose guard or body has the node ${nodeText(impure)}, ` +
          `which is not pure, is not in the structured route: the interpreter's ` +
          `comprehension is a lazy view, and the route makes the list at once`
      );
    // The existing emitter throws a `RangeError` before its loop when the
    // range has more than 2^32 - 1 elements; the route has no such test, and
    // a guard that keeps few elements would run that loop. A bound is an
    // integer literal of at most 2^31 - 1 in magnitude, or the length of a
    // list, so that the range is shorter.
    const unbounded = [parts.from, parts.to].find(
      (b) =>
        !isFunction(b, 'Length') &&
        !(
          isNumber(b) &&
          Number.isInteger(b.re) &&
          Math.abs(b.re) <= 2 ** 31 - 1
        )
    );
    if (unbounded !== undefined)
      return w.refuse(
        node,
        'signature',
        `Comprehension with a guard and the bound ${nodeText(unbounded)} is not in ` +
          `the structured route, which admits an integer literal or a Length as a ` +
          `bound of a guarded comprehension: the existing emitter throws for a range ` +
          `of more than 2^32 - 1 elements, which the route does not test`
      );
    const guard = w.value(parts.guard, inner, { ...context, loop: undefined });
    if (guard.type.kind !== 'boolean')
      return w.refuse(
        node,
        'signature',
        `The guard \`${nodeText(parts.guard)}\` of \`Comprehension\` does not have ` +
          `a boolean fact`
      );
  }
  const body = w.value(parts.body, inner, { ...context, loop: undefined });
  const kind = body.type.kind;
  // A comprehension of tuples makes a list of points, as the existing
  // emitter pushes each array (`result.push([j, 2 * j])`).
  if (body.type.kind === 'point')
    return w.valueFacts(node, { kind: 'list', element: body.type });
  // A comprehension of rows makes a list of lists, as the existing emitter
  // pushes each array (`result.push([k, 2 * k])`), also a row read that is
  // absent (`refuseAbsentRowUses()`).
  if (body.type.kind === 'list' && body.representation === 'array')
    return w.valueFacts(node, { kind: 'list', element: body.type });
  if (kind !== 'real' && kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      kind === 'list'
        ? 'Comprehension whose body is a list (a list of lists) is not in the structured route'
        : `Comprehension whose body has the type \`${fragmentTypeToString(body.type)}\` is ` +
            `not in the structured route, which makes a list of reals or of integers`
    );
  return w.valueFacts(node, { kind: 'list', element: { kind } });
}

/**
 * The message of the refusal of a `Sum` or a `Product` that is not of the
 * form of the structured route, or `undefined`: the structured route admits
 * `Sum(body, Limits(k, a, b), …)` with one or more clauses `Limits` of the
 * library, each with a symbol index, and indexes of distinct names. The
 * existing emitter reads only such clauses (`extractLimits()` in
 * `javascript-target.ts`); a sum of a collection (`Sum(L)`, no index set)
 * folds the elements of the collection, which the structured route does not
 * have.
 */
function aggregateRefusal(node: Expression): string | undefined {
  if (
    !isFunction(node) ||
    (node.operator !== 'Sum' && node.operator !== 'Product') ||
    !isLibraryOperator(node, node.operator)
  )
    return undefined;
  const head = node.operator;
  // A sum or a product of one collection is a fold (`foldRule()`).
  if (node.nops === 1) return undefined;
  if (node.nops < 2)
    return (
      `${head} with no operand is not in the structured ` +
      `route, which admits ${head}(body, Limits(k, a, b)) and ${head} of a list or a tuple`
    );
  const names = new Set<string>();
  for (const clause of node.ops.slice(1)) {
    if (
      !isFunction(clause, 'Limits') ||
      !isLibraryOperator(clause, 'Limits') ||
      clause.nops !== 3 ||
      !isSymbol(clause.op1)
    )
      return (
        `${head} over ${nodeText(clause)} is not in the structured route, ` +
        `which admits an index set Limits(k, a, b)`
      );
    if (names.has(clause.op1.symbol))
      return `${head} with two indexes named ${clause.op1.symbol} is not in the structured route`;
    names.add(clause.op1.symbol);
  }
  return undefined;
}

/**
 * The refusal of the bound `bound` of a `Sum` or a `Product` on the
 * structured route, or `undefined`. The existing emitter reads a bound in one
 * of two ways (`emitSumProduct()` in `javascript-target.ts`): a bound with a
 * value at compile time (`bigOpBoundConstant()`: a number literal, or a
 * captured binding, whose value the structured route reads as its
 * snapshot) is the floor of that value; every other bound is code, floored
 * at run time. Refused, each with its own message:
 *
 * - a bound that is not a finite number (`isNonFiniteBound()`: `+∞`, a
 *   `NaN`, a type `infinity` or `nan`): the existing compiler refuses it
 *   without an iteration budget, and the structured route refuses it in
 *   every case;
 * - a number literal or a captured value whose floor is not a safe integer
 *   (`assertSafeBigOpBounds()`);
 * - a bound that holds a call that is not `pure` (`effectFact()`): the
 *   interpreter does not evaluate a big operator over a bound with an
 *   effect, and the existing compiler refuses such a bound;
 * - a bound that reads no input, parameter, local or index and is not a
 *   number literal or a captured name (`N - 1` with `N` captured), whose
 *   numeric value does not floor to a safe integer: the existing compiler
 *   folds such a bound only to check its range (`bigOpBoundValue()`), and
 *   declines it there. Another such bound is code on both routes (the
 *   capture reads its snapshot, then the floor and the run-time guard:
 *   `Math.floor(5 + -1)`), so it is admitted. The value is read with
 *   `N()`, not with the fold of the existing compiler: the two can differ
 *   only for a value at the limit of the safe integers.
 */
function aggregateBoundRefusal(
  head: string,
  bound: Expression,
  snapshotOf: SnapshotOf
): string | undefined {
  const name = `The bound \`${nodeText(bound)}\` of \`${head}\``;
  if (isNonFiniteBound(bound)) return `${name} is not a finite number`;
  const value = isNumber(bound)
    ? bound.im === 0
      ? bound.re
      : NaN
    : isSymbol(bound)
      ? snapshotOf(bound)
      : undefined;
  if (value !== undefined) {
    if (!Number.isFinite(value)) return `${name} is not a finite number`;
    if (!Number.isSafeInteger(Math.floor(value)))
      return `${name} is not a safe integer: the existing compiler declines it as out-of-range`;
    return undefined;
  }
  // Each node object once: a shared subtree is not walked once per path.
  const pure = new Set<Expression>();
  const impure = (e: Expression): boolean => {
    if (!isFunction(e) || pure.has(e)) return false;
    if (effectFact(e) !== 'pure' || e.ops.some(impure)) return true;
    pure.add(e);
    return false;
  };
  if (impure(bound))
    return `${name} has a call that is not pure: the interpreter does not evaluate a big operator over such a bound`;
  if (isFunction(bound) && bound.unknowns.length === 0) {
    const folded = bound.N();
    const v = isNumber(folded) && folded.im === 0 ? folded.re : NaN;
    if (Number.isFinite(v) && !Number.isSafeInteger(Math.floor(v)))
      return `${name} is not a safe integer: the existing compiler declines it as out-of-range`;
  }
  return undefined;
}

/**
 * Check, at the admission of the structured route, the bound `bound` of the
 * index of `node`: `check` checks it as a value; when `node` is a `Sum` or
 * a `Product`, the bound is refused first when it is not finite, and after
 * the check (which records a captured binding) for the other refusals of
 * `aggregateBoundRefusal()`.
 */
function checkAggregateBound(
  node: Expression,
  bound: Expression,
  registry: StructuredRegistry | undefined,
  check: (bound: Expression) => void
): void {
  const head = isFunction(node) ? node.operator : '';
  const aggregate = head === 'Sum' || head === 'Product';
  if (aggregate && isNonFiniteBound(bound))
    throw new Error(
      `JS scalar fragment: ${aggregateBoundRefusal(head, bound, () => undefined)}`
    );
  check(bound);
  if (!aggregate) return;
  const refusal = aggregateBoundRefusal(
    head,
    bound,
    registry === undefined ? () => undefined : snapshotReader(registry)
  );
  if (refusal !== undefined) throw new Error(`JS scalar fragment: ${refusal}`);
}

/** The name of the index of `node` in a message: `comprehension`, or the
 *  head (`Sum`, `Product`). */
function indexLabel(node: Expression): string {
  return isFunction(node, 'Comprehension')
    ? 'comprehension'
    : isFunction(node)
      ? node.operator
      : 'comprehension';
}

/**
 * `Sum(body, Limits(k, a, b), …)` and `Product(…)` on the structured route,
 * by the rule of the pass (`walkAggregate()`): each index is an integer in
 * the scope of the aggregate, the bounds of a clause are typed with the
 * indexes of the clauses before it, and the body with every index. A bound
 * has an integer or a real fact: the lowering floors it, as the existing
 * emitter does (`compileBound()` in `javascript-target.ts`). The body has a
 * real or an integer fact, and the aggregate has the fact of the body.
 * Refused: another form (`aggregateRefusal()`), a complex, boolean or list
 * body. The lowering writes the code of the existing emitter
 * (`aggregate()` in `javascript-structured-lower.ts`).
 */
function aggregateRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (isFoldNode(node)) return foldRule(node, scope, context, w);
  const refusal = aggregateRefusal(node);
  if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
  const facts = walkAggregate(node, scope, context, w, true);
  if (!('representation' in facts)) return facts;
  const kind = facts.type.kind;
  if (kind === 'list')
    return listAggregateFacts(node, facts, scope, context, w);
  if (kind !== 'real' && kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      `${node.operator} whose body has the type \`${fragmentTypeToString(facts.type)}\` ` +
        `is not in the structured route, which adds or multiplies reals or integers`
    );
  return facts;
}

/** The width that the engine type of `node` states for a list (`vector<3>`,
 *  `list<real^3>`), or `undefined`. */
function statedWidth(node: Expression): number | undefined {
  const t = node.type.type;
  return typeof t === 'object' &&
    t.kind === 'list' &&
    t.dimensions?.length === 1 &&
    t.dimensions[0] >= 0
    ? t.dimensions[0]
    : undefined;
}

/**
 * The facts `facts` of `Sum(body, Limits(k, a, b), …)` or `Product(…)`
 * whose body is a list of reals or of integers, on the structured route
 * (slice 4 of the design note
 * `docs/plans/2026-11-12-structured-broadcast-over-lists.md`). The existing
 * emitter writes a loop over each clause whose accumulator starts at
 * `null`, takes a copy of the first term, then adds (multiplies) each later
 * term element-wise (`_SYS.bcast((_a, _b) => _a + _b, acc, term)`), and
 * gives the number `0` (`1`) for an empty range, or the list of `w` zeros
 * (ones) when the type of the body states its width `w`. Its test of `NaN`
 * after each term reads the accumulator, an array, which is never `NaN`
 * when the terms have one length, so every term is evaluated: a term that
 * can throw throws at the same term. The lowering is `listAggregate()` in
 * `javascript-structured-lower.ts`.
 *
 * Admitted when every bound is a finite number literal, each range is not
 * empty (`a ≤ b` after the floor) or the body states its width, and the
 * length of the body is the same in every term: one `lengthKey()` that
 * reads no index, or a stated width. Refused otherwise, with the cause: a
 * bound that is not a literal (the existing compiler gives the number
 * `NaN` where the bound is not a safe integer, and the number `0` for an
 * empty range, where the value is a list), an empty range of a body of
 * unstated width, a body whose length can change with the index.
 */
function listAggregateFacts(
  node: Expression,
  facts: FragmentValueFacts<ScalarRepresentation>,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node)) return facts;
  const head = node.operator;
  const what = `${head} whose body ${nodeText(node.op1)} is a list`;
  const refuse = (cause: string) =>
    w.refuse(
      node,
      'signature',
      `${what} is not in the structured route: ${cause}`
    );
  if ((numericCellsOf(facts)?.rank ?? 0) !== 1)
    return refuse('the body is not a list of reals or of integers');
  const width = statedWidth(node.op1);
  // `aggregateRefusal()` admitted clauses `Limits(k, a, b)` only.
  const clauses = node.ops.slice(1).map((c) => (isFunction(c) ? c.ops : []));
  const indexes = new Set(
    clauses.map(([k]) => (k !== undefined && isSymbol(k) ? k.symbol : ''))
  );
  for (const [j, [, lower, upper]] of clauses.entries()) {
    const clause = node.ops[j + 1];
    const literal = (b: Expression) =>
      isNumber(b) && b.im === 0 && Number.isFinite(b.re);
    if (!literal(lower) || !literal(upper))
      return refuse(
        `the bound ${nodeText(literal(lower) ? upper : lower)} is not a number ` +
          `literal, and the existing compiler gives the number NaN where a bound ` +
          `is not a safe integer and the number ${head === 'Sum' ? 0 : 1} for an ` +
          `empty range, where the value of the profile is a list (write literal ` +
          `bounds, or fold explicitly: ${head} of the rows of a Map)`
      );
    if (
      width === undefined &&
      Math.floor((lower as Expression & { re: number }).re) >
        Math.floor((upper as Expression & { re: number }).re)
    )
      return refuse(
        `the range of ${nodeText(clause)} is empty, and the existing compiler ` +
          `gives the number ${head === 'Sum' ? 0 : 1} for it (declare the width ` +
          `of the body: \`vector<3>\` or \`list<real^3>\`)`
      );
  }
  if (width === undefined) {
    const key = lengthKey(node.op1, scope.inner.get(node) ?? scope, context, w);
    if (key === undefined || key.split(' ').some((token) => indexes.has(token)))
      return refuse(
        `the length of the body is not the same in every term by construction ` +
          `(declare its width: \`vector<3>\` or \`list<real^3>\`): the existing ` +
          `compiler gives NaN for two terms of different lengths`
      );
  }
  return facts;
}

/**
 * The refusal of a `Which` or of an `If` with no else branch, on the
 * structured route, before its operands are read, or `undefined`. The
 * existing emitter writes both as a chain of conditional expressions
 * (`compileExprWhich()` in `compile-conditionals.ts`, which also writes
 * `If(c, v)` used as a value): it drops a clause whose condition is the
 * symbol `False` and every clause after a condition `True`, and it has no
 * representation of `Nothing` as a value. So refused: a condition `True`
 * that is not the last one, a condition `False`, a value `Nothing`, and a
 * `Which` with an odd number of operands.
 */
function selectionRefusal(node: Expression): string | undefined {
  if (!isFunction(node)) return undefined;
  if (node.operator !== 'Which' && !(node.operator === 'If' && node.nops === 2))
    return undefined;
  const head = node.operator;
  const ops = node.ops;
  if (ops.length < 2 || ops.length % 2 !== 0)
    return `${head} with ${ops.length} operands is not in the structured route, which admits condition and value pairs`;
  for (let i = 0; i < ops.length; i += 2) {
    if (isSymbol(ops[i], 'True') && i !== ops.length - 2)
      return `${head} with the condition True before its last clause is not in the structured route: the existing compiler drops the clauses after it`;
    if (isSymbol(ops[i], 'False'))
      return `${head} with the condition False is not in the structured route: the existing compiler drops that clause`;
    if (isSymbol(ops[i + 1], 'Nothing'))
      return `${head} with the value Nothing is not in the structured route: compiled code has no representation of Nothing as a value`;
  }
  return undefined;
}

/**
 * `Which(c1, v1, …, cn, vn)`, and `If(c, v)` used as a value (an `If` with
 * no else branch, which the existing emitter writes as `Which(c, v)`), on
 * the structured route. Each condition has a boolean fact, and the last one
 * can be the symbol `True` (a default clause). Each value has a real or an
 * integer fact. The result is an integer when every value is, otherwise a
 * real. The lowering writes nested conditional expressions, as the existing
 * emitter does: the conditions are evaluated in order, and only until one
 * holds. When none holds (a `Which` with no default clause), the value is
 * `NaN`, the absent value of a number (`noBranchValue()` in
 * `compile-absence.ts`), where the interpreter gives `Missing`
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"). Refused: the
 * forms of `selectionRefusal()`, a complex, boolean or list value.
 */
function selectionRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const refusal = selectionRefusal(node);
  if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
  const ops = isFunction(node) ? node.ops : [];
  const head = isFunction(node) ? node.operator : 'Which';
  const conversions: FragmentConversion<ScalarRepresentation>[] = [];
  let integer = true;
  for (let i = 0; i < ops.length; i += 2) {
    const condition = w.value(ops[i], scope, context);
    if (condition.type.kind !== 'boolean')
      return w.refuse(
        node,
        'signature',
        `A condition of ${head} has the type \`${fragmentTypeToString(condition.type)}\`, not boolean`
      );
    const value = w.value(ops[i + 1], scope, context);
    const kind = value.type.kind;
    if (kind !== 'real' && kind !== 'integer')
      return w.refuse(
        node,
        'signature',
        `${head} with a value of the type \`${fragmentTypeToString(value.type)}\` is ` +
          `not in the structured route, which admits real and integer values`
      );
    if (kind !== 'integer') integer = false;
    conversions.push(
      w.convert(condition, condition.type)!,
      w.convert(value, value.type)!
    );
  }
  return w.valueFacts(
    node,
    { kind: integer ? 'integer' : 'real' },
    conversions
  );
}

/**
 * The operands that the admission of the structured route checks for a
 * value `node` that holds other values, or `undefined` for every other
 * node: `outer`, checked where `node` is; then, for each index of
 * `indexes` in order, its `bounds`, checked with the indexes before it
 * bound, and the index bound; then `inner`, checked with every index bound.
 *
 * - `Typed(value, T)`: `value`. It is admitted only as the value of a
 *   function body (`bodyValue`), where `executeEpsil()` writes it; anywhere
 *   else it throws.
 * - `Block(value)`, a block of one value (`executeEpsil()` writes each
 *   branch of an `If` so): `value`.
 * - `Comprehension(body, Element(j, Range(a, b)))`: `a` and `b`, then
 *   `body` with `j` bound. `refuseListHead()` refused another form.
 * - `Sum(body, Limits(k, a, b), …)` and `Product(…)`: the bounds of each
 *   clause, each index, then `body`. Another form throws
 *   (`aggregateRefusal()`).
 * - A head with a function operand (`FUNCTION_OPERAND_HEADS`: `Map`,
 *   `Filter`, `Count`, `Reduce`, `Scan`, `Apply`): the operands other than
 *   the function; with a function literal, its parameters as indexes with
 *   no bounds, then its body. A library operator as the function is no
 *   operand.
 *
 * Each head is the operator of the library: a user function of one of
 * these names is a helper call.
 */
function structuredValueParts(
  node: Expression,
  bodyValue: boolean,
  registry?: StructuredRegistry
):
  | {
      outer: readonly Expression[];
      inner: readonly Expression[];
      indexes?: readonly {
        readonly index: string;
        readonly bounds: readonly Expression[];
      }[];
    }
  | undefined {
  if (!isFunction(node) || !isLibraryOperator(node, node.operator))
    return undefined;
  if (node.operator === 'Sum' || node.operator === 'Product') {
    const refusal = aggregateRefusal(node);
    if (refusal !== undefined)
      throw new Error(`JS scalar fragment: ${refusal}`);
    return {
      outer: [],
      indexes: node.ops.slice(1).map((clause) => {
        const limits = clause as Expression & { ops: readonly Expression[] };
        return {
          index: (limits.ops[0] as Expression & { symbol: string }).symbol,
          bounds: [limits.ops[1], limits.ops[2]],
        };
      }),
      inner: [node.op1],
    };
  }
  // A definite integral (`integralParts()`): the bounds of each clause with
  // the variables before it, then the integrand. The admission reaches one
  // only when it has no closed form (`closedFormReplacement()`).
  const integral =
    node.operator === 'Integrate' ? integralParts(node) : undefined;
  if (integral !== undefined) {
    const alternative = registry?.integrals.get(node)?.alternative;
    return {
      outer: [],
      indexes: integral.clauses.map((c) => ({
        index: c.name,
        bounds: [c.lower, c.upper],
      })),
      inner:
        alternative === undefined
          ? [integral.body]
          : [integral.body, alternative],
    };
  }
  // A derivative or a limit that the route computes numerically
  // (`registry.routines`): its operands where it is, then its body with its
  // variable bound.
  const routine = registry?.routines.get(node);
  if (routine !== undefined)
    return {
      outer: routine.operands,
      indexes: [{ index: routine.name, bounds: [] }],
      inner: [routine.body],
    };
  if (node.operator === 'Typed') {
    if (!bodyValue)
      throw new Error(
        'JS scalar fragment: Typed is in the structured route only around the value of a function body'
      );
    return { outer: [node.ops[0]], inner: [] };
  }
  if (node.operator === 'Block' && node.nops === 1)
    return { outer: [node.op1], inner: [] };
  const parts = comprehensionParts(node);
  if (parts !== undefined)
    return {
      outer: [],
      indexes: [{ index: parts.index, bounds: [parts.from, parts.to] }],
      inner:
        parts.guard === undefined ? [parts.body] : [parts.guard, parts.body],
    };
  // The general form (`comprehensionClauses()`): the source of each
  // generator with the indexes before it, then the filters and the body
  // with every index; a filter reads no later index (refused there).
  const general =
    node.operator === 'Comprehension' ? comprehensionClauses(node) : undefined;
  if (general !== undefined && 'clauses' in general)
    return {
      outer: [],
      indexes: general.clauses.map((c) => ({
        index: c.index,
        bounds: c.kind === 'range' ? [...c.source.ops] : [c.source],
      })),
      inner: [
        ...general.clauses.flatMap((c) =>
          c.guard === undefined ? [] : [c.guard]
        ),
        node.op1,
      ],
    };
  // A head with a function operand (`functionOperandRule()`): its other
  // operands, then the body of a function literal with its parameters
  // bound. The function itself is not a value: a library operator or
  // another function is not checked here, and the rule refuses what it
  // does not admit.
  const position = Object.hasOwn(FUNCTION_OPERAND_HEADS, node.operator)
    ? FUNCTION_OPERAND_HEADS[node.operator]
    : undefined;
  if (
    position !== undefined &&
    !(node.operator === 'Count' && node.nops === 1)
  ) {
    const outer = node.ops.filter((_, i) => i !== position.fn);
    const fn = userFunctionOperand(node, position);
    const lambda =
      fn === undefined
        ? undefined
        : functionOperandParts(fn, position.arity ?? node.nops - 1);
    return {
      outer,
      ...(lambda === undefined
        ? {}
        : {
            indexes: lambda.parameters.map((p) => ({
              index: p.symbol.symbol,
              bounds: [],
            })),
          }),
      inner: lambda === undefined ? [] : [lambda.body],
    };
  }
  return undefined;
}

/**
 * The function operand of the head node `node` with a function operand at
 * `position` (`FUNCTION_OPERAND_HEADS`) on the structured route. A symbol
 * that is not a library operator and whose binding holds a function literal
 * (a user function: a helper of the engine or of a prelude, or a local
 * function of the body) is read as the literal `Function(f(arg_1, …), arg_1, …)`
 * of one parameter per argument of the head, made here once per node and
 * recorded (`recordUserFunctionOperand()`): the existing emitter calls the
 * compiled function `_fn_f` with the element (`L.map((_x) => _f(_x))`), or
 * with the accumulator and the element (`_f(_a, _b)`), once per element in
 * order, and so does a call of the helper in the body of the literal. The
 * call reaches the helper by the rules of a call (`collectStructuredHelper()`,
 * which checks that the call and the symbol reach one definition). Every
 * other operand is returned as it is.
 */
function userFunctionOperand(
  node: Expression & { ops: readonly Expression[] },
  position: { readonly fn: number; readonly arity?: number }
): Expression | undefined {
  const fn = node.ops[position.fn];
  const known = functionOperandOf(node);
  if (known !== fn || fn === undefined) return known;
  if (!isSymbol(fn) || isLibraryOperator(fn, fn.symbol)) return fn;
  if (userFunctionLiteralOf(fn) === undefined) return fn;
  const arity = position.arity ?? node.ops.length - 1;
  const parameters = Array.from({ length: arity }, (_, i) => `arg_${i + 1}`);
  const lambda = node.engine.expr([
    'Function',
    [fn.symbol, ...parameters],
    ...parameters,
  ]);
  const call = functionOperandParts(lambda, arity)?.body;
  if (call === undefined || !isFunction(call, fn.symbol)) return fn;
  recordUserFunctionOperand(node, fn, lambda, call);
  return lambda;
}

/** The function literal that the binding of the symbol `symbol` holds (the
 *  value of a value definition, or the literal of an operator definition),
 *  or `undefined`. */
function userFunctionLiteralOf(symbol: Expression): Expression | undefined {
  const read = readBinding(symbol);
  const held =
    read === undefined
      ? undefined
      : 'value' in read
        ? read.value.value
        : 'operator' in read
          ? (read.operator as { _lambdaLiteral?: Expression })._lambdaLiteral
          : undefined;
  return held !== undefined && isFunction(held, 'Function') ? held : undefined;
}

/** The function nodes of `node`, itself included, whose effect fact is not
 *  `pure` (`effectFact()`), each node object once. */
function impureNodes(node: Expression): Expression[] {
  const found: Expression[] = [];
  const seen = new Set<Expression>();
  const visit = (n: Expression) => {
    if (!isFunction(n) || seen.has(n)) return;
    seen.add(n);
    if (effectFact(n) !== 'pure') found.push(n);
    for (const op of n.ops) visit(op);
  };
  visit(node);
  return found;
}

/**
 * `ReplaceAt(L, k, v)` on the structured route: a new list, equal to `L`
 * but for the element at the index `k`, counted from 1 (a negative index
 * counts from the end), which is `v`. `L` is a list of reals or of
 * integers, `k` has an integer fact and `v` a real or an integer one. The
 * result is a list of integers when `L` and `v` are integers, otherwise a
 * list of reals. The lowering writes it as the existing emitter does, with
 * `_SYS.replaceAt` (a copy) or `_SYS.replaceAtInPlace`: an index out of
 * range (0, beyond the length) throws a `RangeError` there, where the
 * interpreter keeps the expression unevaluated (`docs/COMPILATION-MODEL.md`,
 * "Caveats of compiled code"). Refused: an index with a real fact (the
 * interpreter refuses a non-integer index; round it with `Floor`), an
 * element that is complex, boolean or a list, a list of another type.
 *
 * Of a list of lists `M` (`nestedReplaceAt()`): `ReplaceAt(M, i, r)` writes
 * the row `r`, and `ReplaceAt(M, i, j, x)` the element `j` of the row `i`.
 */
function replaceAtRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (isFunction(node) && node.nops >= 3) {
    const facts = operandFacts(node, scope, context, w);
    if (isNestedListType(facts[0].type) && facts[0].representation === 'array')
      return nestedReplaceAt(node, facts, w);
  }
  if (!isFunction(node) || node.nops !== 3)
    return w.refuse(
      node,
      'signature',
      'ReplaceAt with other than a list, one index and a value is not in the structured route'
    );
  const [list, index, value] = operandFacts(node, scope, context, w);
  // A list of numbers: a list of tuples (`ReplaceAt(LP, 1, 0)`) is refused.
  if (
    list.type.kind !== 'list' ||
    list.representation !== 'array' ||
    (list.type.element.kind !== 'real' && list.type.element.kind !== 'integer')
  )
    return w.refuse(
      node,
      'signature',
      `ReplaceAt in the structured route writes into a list of reals or ` +
        `integers, and its first operand has the type \`${fragmentTypeToString(list.type)}\``
    );
  if (index.type.kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      `ReplaceAt with an index of the type \`${fragmentTypeToString(index.type)}\` is ` +
        `not in the structured route, which reads an index of the type integer`
    );
  const kind = value.type.kind;
  if (kind !== 'real' && kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      `ReplaceAt with a value of the type \`${fragmentTypeToString(value.type)}\` is ` +
        `not in the structured route, which writes a real or an integer`
    );
  const element =
    list.type.element.kind === 'integer' && kind === 'integer'
      ? 'integer'
      : 'real';
  return w.valueFacts(node, { kind: 'list', element: { kind: element } }, [
    w.convert(list, list.type)!,
    w.convert(index, index.type)!,
    w.convert(value, value.type)!,
  ]);
}

/**
 * `ReplaceAt(M, i, r)` and `ReplaceAt(M, i, j, x)` of a list of lists `M`
 * on the structured route (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`,
 * section 4): a new list, equal to `M` but for the row `i`, which is the
 * row `r` (a list whose type reads as the type of a row of `M`), or for the
 * element `j` of the row `i`, which is `x` (a value of the type of an
 * element of a row: a real or an integer, or a row of a list of rank 3).
 * The indexes have integer facts. The result has the rows of `M`, and a row
 * of reals where a row of integers gets a real value. The lowering writes
 * the second form as two `replace-at`, `replace-at(M, i, replace-at(at(M, i),
 * j, x))`, which copies the outer array and the row `i`, as
 * `_SYS.replaceAtPath(M, i, j, x)` of the existing emitter does; an index
 * out of range throws on both. Refused: more than two indexes, a value of
 * another type, a tuple element.
 */
function nestedReplaceAt(
  node: Expression & { ops: readonly Expression[] },
  facts: readonly FragmentValueFacts<ScalarRepresentation>[],
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const list = facts[0];
  const indexes = facts.slice(1, -1);
  const value = facts[facts.length - 1];
  const refuse = (message: string) =>
    w.refuse(node, 'signature', `ReplaceAt ${message}`);
  if (indexes.length > 2)
    return refuse(
      `with ${indexes.length} indexes is not in the structured route, which writes a row or an element of a row`
    );
  // The existing compiler writes an element of a row only when the engine
  // type of the list is a list of lists at each level
  // (`assertWrittenLevelsAreLists()` in `javascript-target.ts`): not a union
  // (`list<list<real>> | list<vector<2>>`, a ragged literal).
  const engine = node.ops[0].type.type;
  if (
    indexes.length === 2 &&
    !(
      typeof engine === 'object' &&
      engine.kind === 'list' &&
      ((engine.dimensions?.length ?? 0) >= 2 ||
        (typeof engine.elements === 'object' &&
          engine.elements.kind === 'list'))
    )
  )
    return refuse(
      `of ${nodeText(node.ops[0])} of the type ${node.ops[0].type.toString()} with two ` +
        `indexes is not in the structured route: the existing compiler declines a ` +
        `write of an element of a row when the type does not settle a list at each level`
    );
  for (const index of indexes)
    if (index.type.kind !== 'integer')
      return refuse(
        `with an index of the type \`${fragmentTypeToString(index.type)}\` is ` +
          `not in the structured route, which reads an index of the type integer`
      );
  /** The type of the list `type` with a value of the type `v` at the depth
   *  `depth`, or `undefined` when `v` does not fit there. */
  const written = (
    type: FragmentListType,
    depth: number,
    v: FragmentValueType | FragmentListType
  ): FragmentListType | undefined => {
    const slot = type.element;
    if (depth > 1) {
      if (slot.kind !== 'list') return undefined;
      const inner = written(slot, depth - 1, v);
      return inner === undefined ? undefined : { kind: 'list', element: inner };
    }
    if (slot.kind === 'list')
      return v.kind === 'list' && value.representation === 'array'
        ? (() => {
            const row = joinedRows(slot, v);
            return row === undefined
              ? undefined
              : { kind: 'list', element: row };
          })()
        : undefined;
    if (slot.kind !== 'real' && slot.kind !== 'integer') return undefined;
    if (v.kind !== 'real' && v.kind !== 'integer') return undefined;
    return {
      kind: 'list',
      element: {
        kind:
          slot.kind === 'integer' && v.kind === 'integer' ? 'integer' : 'real',
      },
    };
  };
  const result = written(
    list.type as FragmentListType,
    indexes.length,
    value.type
  );
  if (result === undefined)
    return refuse(
      `of ${nodeText(node.ops[0])} of the type \`${fragmentTypeToString(list.type)}\` ` +
        `with a value of the type \`${fragmentTypeToString(value.type)}\` is not in ` +
        `the structured route, which writes a row of a list of lists, or a real or ` +
        `an integer element of a row`
    );
  return w.valueFacts(
    node,
    result,
    facts.map((f) => w.convert(f, f.type)!)
  );
}

//
// List literals, tuples, folds and element-wise arithmetic on the
// structured route (slice 1 of
// `docs/plans/2026-11-11-structured-collections-and-lambdas.md`). A list is
// flat, of reals or of integers; a tuple is a point of reals. Both are a
// JavaScript array of numbers, as the existing emitter writes them.
//

/** The message of the refusal of an element of the fact `facts` of a list
 *  literal or a tuple `head`, or `undefined` for a real or an integer. */
function elementRefusal(
  head: 'List' | 'Tuple',
  facts: FragmentValueFacts<ScalarRepresentation>
): string | undefined {
  const kind = facts.type.kind;
  if (kind === 'real' || kind === 'integer') return undefined;
  const what = head === 'List' ? 'a list literal' : 'a tuple';
  if (kind === 'list')
    return `${what} whose element is a list (a list of lists) is not in the structured route`;
  if (kind === 'point')
    return `${what} whose element is a tuple (a list of points) is not in the structured route`;
  return (
    `${what} with an element of the type \`${fragmentTypeToString(facts.type)}\` ` +
    `is not in the structured route, which makes ${head === 'List' ? 'a list' : 'a tuple'} of reals or of integers`
  );
}

/**
 * `List(a, b, …)` on the structured route: each element has a real or an
 * integer fact; the result is a list of integers when every element is an
 * integer (the empty list too), otherwise a list of reals, with no length in
 * its type. The lowering writes the operation `list`, which the emitter
 * writes `[a, b, …]`, the array literal of the existing emitter (which
 * also writes a list of number literals as a hoisted constant, the same
 * values). A list literal of tuples of one size is a list of points,
 * `[[a, b], [c, d]]`. Refused: an element that is a list, a tuple beside a
 * number or a tuple of another size, a complex number or a boolean.
 */
function listLiteralRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const facts = operandFacts(node, scope, context, w);
  // The empty list written to a local declared with a list of tuples.
  const empty = EMPTY_TUPLE_LISTS.get(node);
  if (empty !== undefined && facts.length === 0)
    return w.valueFacts(node, { kind: 'list', element: empty }, []);
  // A list of tuples of one size (a list of points): `[[1, 2], [x, 3]]`.
  const first = facts[0]?.type;
  if (first?.kind === 'point') {
    if (
      facts.some((f) => f.type.kind !== 'point' || f.type.size !== first.size)
    )
      return w.refuse(
        node,
        'signature',
        `a list literal of tuples of different sizes or of tuples and numbers ` +
          `is not in the structured route`
      );
    return w.valueFacts(
      node,
      { kind: 'list', element: first },
      facts.map((f) => w.convert(f, f.type)!)
    );
  }
  // A list of lists: each element a list, of one rank; the rows can have
  // different lengths (`[[x], [2, x]]`, which the engine types
  // `list<vector<1> | vector<2>>`), and a row of integers is read as a row
  // of reals beside a row of reals, as the existing emitter writes the same
  // array literal of arrays.
  if (first?.kind === 'list') {
    let row: FragmentListType | undefined = first;
    for (const f of facts)
      row =
        row === undefined ||
        f.type.kind !== 'list' ||
        f.representation !== 'array'
          ? undefined
          : joinedRows(row, f.type);
    if (row === undefined)
      return w.refuse(
        node,
        'signature',
        `a list literal of lists of different element types or of lists and ` +
          `other values is not in the structured route`
      );
    return w.valueFacts(
      node,
      { kind: 'list', element: row },
      facts.map((f) => w.convert(f, f.type)!)
    );
  }
  for (const f of facts) {
    const refusal = elementRefusal('List', f);
    if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
  }
  const element = facts.every((f) => f.type.kind === 'integer')
    ? 'integer'
    : 'real';
  return w.valueFacts(
    node,
    { kind: 'list', element: { kind: element } },
    facts.map((f) => w.convert(f, f.type)!)
  );
}

/**
 * `Tuple(a, b, …)` on the structured route: one or more elements, each with
 * a real or an integer fact; the result is a tuple of that many reals (the
 * fragment type `point`), an array of numbers, as the existing emitter
 * writes it (`[a, b]`). An integer element is a valid real: the same
 * number. Refused: an empty tuple, an element that is a list, a tuple, a
 * complex number or a boolean.
 */
function tupleRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const facts = operandFacts(node, scope, context, w);
  if (facts.length === 0)
    return w.refuse(
      node,
      'signature',
      'an empty tuple is not in the structured route'
    );
  for (const f of facts) {
    const refusal = elementRefusal('Tuple', f);
    if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
  }
  return w.valueFacts(
    node,
    { kind: 'point', size: facts.length },
    facts.map((f) => w.convert(f, f.type)!)
  );
}

/** Whether the facts `facts` are those of a list of booleans held as an
 *  array (the value of an element-wise comparison or connective,
 *  `broadcastRule()`). Only `At`, `Length`, the connectives and the
 *  condition of an element-wise selection read one
 *  (`refuseBooleanListUses()`). */
function isBooleanList(
  facts: FragmentValueFacts<ScalarRepresentation>
): boolean {
  return (
    facts.representation === 'array' &&
    facts.type.kind === 'list' &&
    facts.type.element.kind === 'boolean'
  );
}

/** The type of the elements of a list of the facts `facts` on the
 *  structured route: a real, an integer, or a point (a list of tuples);
 *  `undefined` for another value, a tuple included. */
function listElementType(
  facts: FragmentValueFacts<ScalarRepresentation>
): FragmentElementType | undefined {
  if (facts.representation !== 'array' || facts.type.kind !== 'list')
    return undefined;
  const element = facts.type.element;
  return element.kind === 'real' ||
    element.kind === 'integer' ||
    element.kind === 'point'
    ? element
    : undefined;
}

/** The type of a row of a list of lists of the facts `facts` on the
 *  structured route (a list of rank 2 or more), or `undefined` for another
 *  value. Only the rules of `NESTED_OPERAND_HEADS` read it. */
function rowsOf(
  facts: FragmentValueFacts<ScalarRepresentation>
): FragmentListType | undefined {
  if (facts.representation !== 'array' || facts.type.kind !== 'list')
    return undefined;
  const element = facts.type.element;
  return element.kind === 'list' ? element : undefined;
}

/** The kind of the elements of a list or a tuple of the facts `facts` on
 *  the structured route, or `undefined` for another value. */
function collectionElement(
  facts: FragmentValueFacts<ScalarRepresentation>
): 'real' | 'integer' | undefined {
  if (facts.representation !== 'array') return undefined;
  if (facts.type.kind === 'point') return 'real';
  if (facts.type.kind !== 'list') return undefined;
  const kind = facts.type.element.kind;
  return kind === 'real' || kind === 'integer' ? kind : undefined;
}

/**
 * `Sum(L)`, `Product(L)`, `Max(L)` and `Min(L)` of one list or tuple `L` on
 * the structured route: a fold of its elements, in order, with the
 * accumulator of the existing emitter (`(L).reduce((_a, _b) => _a + _b, 0)`
 * from `0` for a sum, from `1` for a product; `Math.max` from `-Infinity`
 * and `NaN` for an empty list, `Math.min` from `Infinity`). A sum or a
 * product of a tuple is written out, `(0 + P[0] + P[1])`, as the existing
 * emitter writes it. A sum or a product of integers is an integer; a
 * maximum or a minimum is a real (the accumulator `-Infinity`, and `NaN`
 * for an empty list). The lowering writes a `loop` over the elements
 * (`fold()` in `javascript-structured-lower.ts`). Refused: an operand that
 * is not a list or a tuple of reals or integers.
 */
function foldRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const head = isFunction(node) ? node.operator : '';
  const [collection] = operandFacts(node, scope, context, w);
  const element =
    collection === undefined ? undefined : collectionElement(collection);
  if (collection === undefined || element === undefined)
    return w.refuse(
      node,
      'signature',
      `${head} of one operand of the type ` +
        `\`${collection === undefined ? 'none' : fragmentTypeToString(collection.type)}\` ` +
        `is not in the structured route, which folds a list or a tuple of reals or of integers`
    );
  const kind =
    (head === 'Sum' || head === 'Product') && element === 'integer'
      ? 'integer'
      : 'real';
  return w.valueFacts(node, { kind }, [
    w.convert(collection, collection.type)!,
  ]);
}

//
// Matrix functions on the structured route (slice 3 of
// `docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`).
//

/** The heads of the matrix functions on the structured route
 *  (`matrixFunctionRule()`); `Norm` is one when it reads a list of lists or
 *  an order, and `Dot` when it reads a list of lists. */
const MATRIX_HEADS: Readonly<Record<string, true>> = {
  Determinant: true,
  Trace: true,
  Transpose: true,
  RowReduce: true,
  Inverse: true,
  MatrixPower: true,
  MatrixMultiply: true,
  Diagonal: true,
  Flatten: true,
  Norm: true,
};

/** The kind and the rank of the numbers of a value of the facts `facts`: a
 *  list of reals or of integers, or a list of such lists at every depth,
 *  held as an array; `undefined` for another value (a tuple, a list of
 *  tuples). */
function numericCellsOf(
  facts: FragmentValueFacts<ScalarRepresentation>
): { kind: 'real' | 'integer'; rank: number } | undefined {
  if (facts.representation !== 'array') return undefined;
  let type: FragmentValueType | FragmentListType = facts.type;
  let rank = 0;
  while (type.kind === 'list') {
    rank += 1;
    type = type.element;
  }
  return rank >= 1 && (type.kind === 'real' || type.kind === 'integer')
    ? { kind: type.kind, rank }
    : undefined;
}

/** The fragment type of a list of the rank `rank` (1 or more) of numbers of
 *  the kind `kind`. */
function numericListType(
  kind: 'real' | 'integer',
  rank: number
): FragmentListType {
  let type: FragmentListType = { kind: 'list', element: { kind } };
  for (let r = 1; r < rank; r++) type = { kind: 'list', element: type };
  return type;
}

/** Whether the engine type of `node` is a matrix: a list type of two
 *  stated dimensions (`matrix`, `matrix<m×n>`), whose rows have one length
 *  (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`,
 *  section 2). */
function isEngineMatrix(node: Expression): boolean {
  const type = node.type.type;
  return (
    typeof type === 'object' &&
    type.kind === 'list' &&
    type.dimensions?.length === 2
  );
}

/**
 * The matrix functions on the structured route, for a matrix: a list of
 * lists of rank 2 of reals or of integers (`numericCellsOf()`), as the
 * existing emitter writes each head on the real lane (`javascript-target.ts`,
 * `linearAlgebraHelper()`); the lowering is `collection()` in
 * `javascript-structured-lower.ts`, with the names of
 * `docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`, section
 * 4:
 *
 * - `Determinant(M)` and `Trace(M)`: a real, `_SYS.det(M)` and
 *   `_SYS.trace(M)` (`NaN` for a matrix that is not square, or rows of
 *   different lengths). Refused when the engine type of the node is not a
 *   number (`Trace` of a `list<list<real>>` is `number | tensor`, and the
 *   existing compiler writes its parent with `_SYS.bcast`).
 * - `Transpose(M)` of a matrix by its engine type (`isEngineMatrix()`): a
 *   matrix of the same numbers, `_SYS.transpose(M)`. Refused: rows of
 *   different lengths (`list<list<real>>`), whose transpose has `undefined`
 *   elements, and a rank other than 2.
 * - `RowReduce(M)` and `Inverse(M)`: a matrix of reals, `_SYS.rref(M)` and
 *   `_SYS.inv(M)` (which throws for a matrix that is not square).
 * - `MatrixPower(M, p)` with an integer exponent (an integer fact, and an
 *   integer literal or an engine type `integer`, as the existing compiler
 *   requires): a matrix of reals, `_SYS.matpow(M, p)` (which throws for a
 *   matrix that is not square and an exponent other than 1). Refused: a
 *   literal exponent beyond the limit of the interpreter, which the existing
 *   compiler declines. `Power(M, n)` of a `matrix` is `MatrixPower` in the
 *   canonical form, and `Power(M, -1)` is `Inverse`.
 * - `MatrixMultiply(A, B)` and `Dot(A, B)` with a matrix operand: the
 *   matrix product `_SYS.matmul(A, B)` of two matrices (a matrix of reals),
 *   of a matrix and a list, or of a list and a matrix (a list of reals);
 *   `MatrixMultiply` of two lists is their inner product, a real, as `Dot`.
 * - `Diagonal(M)` of a matrix by its engine type: the list of its diagonal;
 *   `Diagonal(L)` of a list: the square matrix with `L` on its diagonal,
 *   `_SYS.diagonal(…)`.
 * - `Flatten(L)` of a list of any rank of reals or of integers: the list of
 *   its numbers in order, `L.flat(Infinity)`.
 * - `Norm(M)` of a list of lists of any rank, and `Norm(L, p)` of a list,
 *   a tuple or a list of lists with a real or integer order `p`:
 *   `_SYS.norm(M)` and `_SYS.norm(L, p)`. Refused: an order that is not a
 *   number (`"Frobenius"`).
 *
 * A list result can have no value (`matrixResultCanBeAbsent()`): the
 * admission refuses its uses but the value of the program, the operand of
 * a matrix function and the list of an `At` (`refuseAbsentMatrixUses()`).
 *
 * `undefined` for `Dot` of no list of lists and for `Norm` of one list or
 * tuple of numbers: the rule of `collectionRule()` reads them.
 */
function matrixFunctionRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> | undefined {
  if (!isFunction(node)) return undefined;
  const head = node.operator;
  const refuse = (message: string): never =>
    w.refuse(node, 'signature', `${head} ${message}`);
  const facts = operandFacts(node, scope, context, w);
  const cells = facts.map(numericCellsOf);
  const nested = cells.some((c) => c !== undefined && c.rank >= 2);
  if (head === 'Dot' && !nested) return undefined;
  if (head === 'Norm' && !nested && node.nops === 1) return undefined;
  const conversions = facts.map((f) => w.convert(f, f.type)!);
  const describe = (i: number) =>
    `${nodeText(node.ops[i])} of the type \`${fragmentTypeToString(facts[i].type)}\``;
  const arity = (n: number) => {
    if (node.nops !== n)
      refuse(
        `with ${node.nops} operands is not in the structured route, which reads ${n}`
      );
  };
  /** The kind of the numbers of the operand `i`, a matrix (a list of lists
   *  of rank 2 of reals or of integers). */
  const matrixAt = (i: number): 'real' | 'integer' => {
    const c = cells[i];
    if (c === undefined || c.rank !== 2)
      refuse(
        `of ${describe(i)} is not in the structured route, which reads a matrix ` +
          `(a list of lists of reals or of integers of rank 2)`
      );
    return c!.kind;
  };
  /** Refuse the operand `i` that is not a matrix by its engine type. */
  const rectangularAt = (i: number) => {
    if (!isEngineMatrix(node.ops[i]))
      refuse(
        `of ${nodeText(node.ops[i])} of the type ${node.ops[i].type.toString()} is not in ` +
          `the structured route, which reads a matrix by its type (matrix, ` +
          `matrix<m×n>): rows of different lengths give undefined elements`
      );
  };
  const value = (type: FragmentValueType | FragmentListType) =>
    w.valueFacts(node, type, conversions);
  // The existing compiler reads each list operand of these heads with
  // `collArg()`, which declines an operand that is not an indexed
  // collection by its engine type (`Determinant(MatrixMultiply(A, B))`,
  // whose operand has the type `matrix | number | vector`), and `Flatten`
  // of an operand whose type does not show which elements are lists.
  if (head !== 'Norm')
    node.ops.forEach((op, i) => {
      if (cells[i] === undefined) return;
      if (!isIndexedCollectionOperand(op))
        refuse(
          `of ${nodeText(op)} of the type ${op.type.toString()} is not in the structured ` +
            `route, which reads an operand that is a list by its type, as the existing ` +
            `compiler does`
        );
      if (head === 'Flatten' && flattenMayOpenKeptValue(op.type.type, Infinity))
        refuse(
          `of ${nodeText(op)} of the type ${op.type.toString()} is not in the structured ` +
            `route, which reads an operand whose type shows which elements are lists, as ` +
            `the existing compiler does`
        );
    });
  switch (head) {
    case 'Determinant':
    case 'Trace':
      arity(1);
      matrixAt(0);
      if (!isSubtype(node.type.type, 'number'))
        refuse(
          `of the type ${node.type.toString()} is not in the structured route: the existing ` +
            `compiler reads a value of a type that admits a list with _SYS.bcast`
        );
      return value({ kind: 'real' });
    case 'Transpose': {
      arity(1);
      const kind = matrixAt(0);
      rectangularAt(0);
      return value(numericListType(kind, 2));
    }
    case 'RowReduce':
    case 'Inverse':
      arity(1);
      matrixAt(0);
      return value(numericListType('real', 2));
    case 'MatrixPower': {
      arity(2);
      matrixAt(0);
      const p = node.op2;
      if (
        facts[1].type.kind !== 'integer' ||
        !(
          (isNumber(p) && p.isInteger === true) ||
          isSubtype(p.type.type, 'integer')
        )
      )
        refuse(
          `with ${describe(1)} is not in the structured route, which reads an integer ` +
            `exponent: the interpreter takes the principal square root of a matrix ` +
            `for a half-integer exponent, which _SYS.matpow does not compute`
        );
      if (isNumber(p) && Math.abs(p.re) > MAX_MATRIX_POWER_EXPONENT)
        refuse(
          `with an exponent beyond ${MAX_MATRIX_POWER_EXPONENT} is not in the structured ` +
            `route: the interpreter keeps the power symbolic`
        );
      return value(numericListType('real', 2));
    }
    case 'MatrixMultiply':
    case 'Dot': {
      arity(2);
      const ranks = cells.map((c, i) => {
        if (c === undefined || c.rank > 2)
          refuse(
            `of ${describe(i)} is not in the structured route, which reads a matrix ` +
              `or a list of reals or of integers`
          );
        return c!.rank;
      });
      if (ranks[0] === 1 && ranks[1] === 1) return value({ kind: 'real' });
      return value(
        numericListType('real', ranks[0] === 2 && ranks[1] === 2 ? 2 : 1)
      );
    }
    case 'Diagonal': {
      arity(1);
      const c = cells[0];
      if (c === undefined || c.rank > 2)
        refuse(
          `of ${describe(0)} is not in the structured route, which reads a matrix or a ` +
            `list of reals or of integers`
        );
      if (c!.rank === 1) return value(numericListType(c!.kind, 2));
      rectangularAt(0);
      return value(numericListType(c!.kind, 1));
    }
    case 'Flatten': {
      arity(1);
      const c = cells[0];
      if (c === undefined)
        refuse(
          `of ${describe(0)} is not in the structured route, which reads a list of ` +
            `reals or of integers, at any rank`
        );
      // `Flatten([])` has the type `list` (any elements): the existing
      // compiler reads an element of it with `_SYS.atWithValueMarker`,
      // `undefined` out of range.
      if (!isSubtype(node.type.type, 'list<number>'))
        refuse(
          `of the type ${node.type.toString()} is not in the structured route, which ` +
            `makes a list of numbers by its type`
        );
      return value(numericListType(c!.kind, 1));
    }
    case 'Norm': {
      if (node.nops !== 1 && node.nops !== 2)
        refuse(
          `with ${node.nops} operands is not in the structured route, which reads a list and an order`
        );
      if (
        cells[0] === undefined &&
        !(
          facts[0].type.kind === 'point' &&
          collectionElement(facts[0]) !== undefined
        )
      )
        refuse(
          `of ${describe(0)} is not in the structured route, which reads a list of ` +
            `reals or of integers at any rank, or a tuple of reals`
        );
      if (
        node.nops === 2 &&
        facts[1].type.kind !== 'real' &&
        facts[1].type.kind !== 'integer'
      )
        refuse(
          `with the order ${describe(1)} is not in the structured route, which reads ` +
            `an order that is a real or an integer`
        );
      if (!isSubtype(node.type.type, 'number'))
        refuse(
          `of the type ${node.type.toString()} is not in the structured route: the existing ` +
            `compiler reads a value of a type that admits a list with _SYS.bcast`
        );
      return value({ kind: 'real' });
    }
  }
  return undefined;
}

//
// Functions of lists and function operands on the structured route (slices
// 2 and 3 of `docs/plans/2026-11-11-structured-collections-and-lambdas.md`).
//

/**
 * The functions of lists on the structured route, for a list of reals or
 * of integers (`collectionElement()`), as the existing emitter writes each
 * head for an array of numbers (`javascript-target.ts`); the lowering is
 * `collection()` in `javascript-structured-lower.ts`:
 *
 * - `Norm(L)`, `Mean(L)`, `Median(L)` and `Variance(L)` of a list or a
 *   tuple: a real, the runtime helper (`_SYS.norm(L)`, …). Refused: `Norm`
 *   with an order (`Norm(L, 1)`).
 * - `Dot(L, M)`: of two lists, a real, `_SYS.matmul(L, M)` (not a number
 *   for lists of different lengths, where the interpreter gives an error);
 *   of two tuples of one size below `MIN_UNROLLED_WIDTH`, the sum of the
 *   products of their elements in order, `P[0] * Q[0] + P[1] * Q[1]`, as
 *   the existing emitter writes it; from that width on it calls
 *   `_SYS.matmul`, and the tuples are refused.
 * - `Take(L, n)`, `Drop(L, n)` with an integer count, `Rest(L)` (`Drop(L,
 *   1)`), `Reverse(L)` and `Sort(L)` of a list, and `Join(L, M, …)` and
 *   `ListJoin(L, M, …)` of two or more lists: a new list of the elements of
 *   the operands (a list of integers when every list is one). All but `Sort`
 *   also read a list of tuples of one size (a list of points), and keep its
 *   tuples as they are (the new array holds the arrays of the elements of
 *   its operand, which no operation writes). A count beyond the length takes or
 *   drops every element, and a negative count counts from the end, as in
 *   the interpreter. Refused: a tuple (the existing emitter writes an array
 *   where the interpreter keeps a tuple), a count with a real fact (the
 *   existing emitter rounds it, the interpreter does not), `Sort` with an
 *   ordering function.
 * - `RotateLeft(L, k)` and `RotateRight(L, k)` of a list with an integer
 *   shift (1 when absent): a new list, `_SYS.rotl(L, k)` and
 *   `_SYS.rotr(L, k)`. Refused: a tuple, a shift with a real fact (the
 *   runtime rounds it).
 * - `First(L)` and `Last(L)` of a list or a tuple: the element at 1 or -1
 *   (`at`), `NaN` for an empty list, as `(L[0] ?? NaN)` and `_SYS.at(L,
 *   -1)` of the existing emitter.
 * - `Count(L)` of a list or a tuple: its length, an integer.
 * - `Range(a, b)` and `Range(b)` (from 1) with integer bounds: the list of
 *   the integers from `a` to `b`, in steps of 1, or of -1 when `b < a`
 *   (`Range(1, 0)` is `[1, 0]`), the values of `_SYS.range(a, b, b >= a ? 1
 *   : -1)`. Refused: a bound with a real fact.
 * - `Range(a, b, step)` with real or integer bounds and step: the list
 *   `a, a + step, a + 2·step, …` up to `b`, the values of `_SYS.range(a, b,
 *   step)`, a list of integers when the three are integers (an empty list
 *   for a step of the other sign, or a step 0 at run time). Refused: the
 *   literal step 0, which the existing compiler declines.
 * - The matrix functions, `Norm` of a list of lists or with an order, and
 *   `Dot` of a list of lists: `matrixFunctionRule()`.
 * - The statistics of `STATISTICS_HEADS` of a list or a tuple, and
 *   `Covariance(L, M)`, `Correlation(L, M)` of two lists: a real, the
 *   runtime helper of the head (`_SYS.populationVariance(L)`).
 * - `Ordering(L)`: the positions in sorted order, a list of integers;
 *   `Unique(L)`: the first of each value, `[...new Set(L)]`; `IndexOf(L, x)`
 *   and `Contains(L, x)` of a list of numbers and a number: an integer
 *   (`_SYS.idxt`, 0 for none) and a boolean (`L.includes(x)`). Refused: a
 *   list of tuples or of lists, `Ordering(L, f)`.
 * - `Repeat(x, n)` of a number and an integer count, `Linspace(a, b, n)` and
 *   `Linspace(a, b)` (50 elements) of finite number literals and an integer
 *   count, `Slice(L, a, b)` of a list of numbers and two numbers: a new
 *   list, the text of the existing emitter. Refused: a real count of
 *   `Repeat` (the existing code throws for a fraction), a bound of
 *   `Linspace` that is not a finite literal (the existing code gives the
 *   number `NaN` for a bound that is not finite, another shape).
 * - `Second(L)`, `Third(L)` as `First`; `Most(L)`, the list without its last
 *   element; `IsEmpty(L)`, a boolean; `Append(L, x)` of a list of numbers
 *   and a number, a list of integers when both are.
 * - `Take(L, x)` and `Drop(L, x)` also read a real count, which the
 *   existing emitter rounds (`Math.round`).
 */
function collectionRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node))
    return w.refuse(node, 'signature', 'expected a function of lists');
  const head = node.operator;
  const refuse = (message: string) =>
    w.refuse(node, 'signature', `${head} ${message}`);
  const arity = (n: number) => {
    if (node.nops !== n)
      refuse(
        `with ${node.nops} operands is not in the structured route, which reads ${n}`
      );
  };
  // A function of lists whose value is a number and whose engine type
  // admits a list (`Norm(At(LQ, -1))` of a list of tuples `LQ` has the type
  // `list<number>`): the existing compiler reads such a value as a possible
  // list, and writes its parent with `_SYS.bcast` (`x · (2 / Norm(…))` is
  // `x * (2 / n)` there, `x * 2 / n` on the route, another double).
  // A matrix function of a list of lists (`matrixFunctionRule()`); `Dot` of
  // a list of lists is a matrix product, whose value is a list.
  if (Object.hasOwn(MATRIX_HEADS, head) || head === 'Dot') {
    const matrix = matrixFunctionRule(node, scope, context, w);
    if (matrix !== undefined) return matrix;
  }
  if (
    ['Norm', 'Mean', 'Median', 'Variance', 'Dot', ...STATISTICS_HEADS].includes(
      head
    ) &&
    !isSubtype(node.type.type, 'number')
  )
    return refuse(
      `of the type ${node.type.toString()} is not in the structured route: the existing ` +
        `compiler reads a value of a type that admits a list with _SYS.bcast`
    );
  const facts = operandFacts(node, scope, context, w);
  const conversions = facts.map((f) => w.convert(f, f.type)!);
  const describe = (i: number) =>
    `${nodeText(node.ops[i])} of the type \`${fragmentTypeToString(facts[i].type)}\``;
  /** The element kind of the operand `i`, a list (or a tuple with `tuples`)
   *  of reals or of integers. */
  const elementAt = (i: number, tuples: boolean): 'real' | 'integer' => {
    const element = collectionElement(facts[i]);
    if (element === undefined || (!tuples && facts[i].type.kind === 'point'))
      refuse(
        `of ${describe(i)} is not in the structured route, which reads a list ` +
          `${tuples ? 'or a tuple ' : ''}of reals or of integers`
      );
    return element!;
  };
  const integerAt = (i: number) => {
    if (facts[i].type.kind !== 'integer')
      refuse(
        `with ${describe(i)} is not in the structured route, which reads an integer there`
      );
  };
  /** The operand `i` is a real or an integer. */
  const numberAt = (i: number) => {
    if (facts[i].type.kind !== 'real' && facts[i].type.kind !== 'integer')
      refuse(
        `with ${describe(i)} is not in the structured route, which reads a real or an integer there`
      );
  };
  /** The element kind of the list (not a tuple) of numbers `i`. */
  const numbersAt = (i: number) => elementAt(i, false);
  /** The element type of the list operand `i`: a real, an integer, or a
   *  point (a list of tuples, whose elements a slice, a rotation or a join
   *  keeps as they are: the inner arrays are shared, and no operation
   *  writes a tuple). */
  const listElementAt = (i: number): FragmentListType['element'] => {
    const element = listElementType(facts[i]) ?? rowsOf(facts[i]);
    if (element === undefined)
      refuse(
        `of ${describe(i)} is not in the structured route, which reads a list ` +
          `of reals, of integers, of tuples or of lists`
      );
    return element!;
  };
  switch (head) {
    case 'Norm':
    case 'Mean':
    case 'Median':
    case 'Variance':
      arity(1);
      elementAt(0, true);
      return w.valueFacts(node, { kind: 'real' }, conversions);
    case 'Dot': {
      arity(2);
      const [a, b] = facts;
      if (a.type.kind === 'point' || b.type.kind === 'point') {
        if (
          a.type.kind !== 'point' ||
          b.type.kind !== 'point' ||
          a.type.size !== b.type.size
        )
          refuse(
            `of ${describe(0)} and ${describe(1)} is not in the structured route, ` +
              `which reads two lists or two tuples of one size`
          );
        // From `MIN_UNROLLED_WIDTH` on, the existing compiler calls
        // `_SYS.matmul`, whose sum starts at `+0`, in place of the sum of
        // the products (`compileStaticInnerProduct()`): the two differ in
        // the sign of a zero (`-0` for five products `0 · -1`).
        const size = a.type.kind === 'point' ? a.type.size : 0;
        if (size >= MIN_UNROLLED_WIDTH)
          refuse(
            `of two tuples of ${size} elements is not in the structured ` +
              `route, which reads tuples of fewer than ${MIN_UNROLLED_WIDTH}`
          );
        return w.valueFacts(node, { kind: 'real' }, conversions);
      }
      elementAt(0, false);
      elementAt(1, false);
      return w.valueFacts(node, { kind: 'real' }, conversions);
    }
    case 'Take':
    case 'Drop': {
      arity(2);
      const element = listElementAt(0);
      // A real count is rounded (`Math.round`), as the existing emitter
      // and the interpreter round it.
      numberAt(1);
      return w.valueFacts(node, { kind: 'list', element }, conversions);
    }
    case 'PopulationVariance':
    case 'StandardDeviation':
    case 'PopulationStandardDeviation':
    case 'Skewness':
    case 'Kurtosis':
    case 'Mode':
    case 'InterquartileRange':
      arity(1);
      elementAt(0, true);
      return w.valueFacts(node, { kind: 'real' }, conversions);
    case 'Covariance':
    case 'Correlation':
      arity(2);
      numbersAt(0);
      numbersAt(1);
      return w.valueFacts(node, { kind: 'real' }, conversions);
    case 'Ordering':
      arity(1);
      numbersAt(0);
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: 'integer' } },
        conversions
      );
    case 'Unique':
      arity(1);
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: numbersAt(0) } },
        conversions
      );
    case 'IndexOf':
    case 'Contains':
      arity(2);
      numbersAt(0);
      numberAt(1);
      return w.valueFacts(
        node,
        { kind: head === 'Contains' ? 'boolean' : 'integer' },
        conversions
      );
    case 'Repeat':
      arity(2);
      numberAt(0);
      // The existing code throws for a count that is not an integer.
      integerAt(1);
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: facts[0].type.kind as 'real' } },
        conversions
      );
    case 'Linspace': {
      if (node.nops !== 2 && node.nops !== 3)
        refuse(
          `with ${node.nops} operands is not in the structured route, which reads two bounds and a count`
        );
      // The existing code gives the number NaN, not a list, for a bound
      // that is not finite: only finite number literals are bounds here.
      if (
        node.ops
          .slice(0, 2)
          .some((b) => !isNumber(b) || b.im !== 0 || !Number.isFinite(b.re))
      )
        refuse(
          'with a bound that is not a finite number literal is not in the structured route: ' +
            'the existing code gives the number NaN, not a list, for a bound that is not finite'
        );
      if (node.nops === 3) integerAt(2);
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: 'real' } },
        conversions
      );
    }
    case 'Slice':
      arity(3);
      numberAt(1);
      numberAt(2);
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: numbersAt(0) } },
        conversions
      );
    case 'Most': {
      arity(1);
      const element = listElementAt(0);
      return w.valueFacts(node, { kind: 'list', element }, conversions);
    }
    case 'IsEmpty':
      arity(1);
      listElementAt(0);
      return w.valueFacts(node, { kind: 'boolean' }, conversions);
    case 'Append': {
      arity(2);
      const element = numbersAt(0);
      numberAt(1);
      return w.valueFacts(
        node,
        {
          kind: 'list',
          element: {
            kind:
              element === 'integer' && facts[1].type.kind === 'integer'
                ? 'integer'
                : 'real',
          },
        },
        conversions
      );
    }
    case 'RotateLeft':
    case 'RotateRight': {
      if (node.nops !== 1 && node.nops !== 2)
        refuse(
          `with ${node.nops} operands is not in the structured route, which reads a list and a shift`
        );
      const element = listElementAt(0);
      if (node.nops === 2) integerAt(1);
      return w.valueFacts(node, { kind: 'list', element }, conversions);
    }
    case 'Rest':
    case 'Reverse': {
      arity(1);
      const element = listElementAt(0);
      return w.valueFacts(node, { kind: 'list', element }, conversions);
    }
    case 'Sort': {
      arity(1);
      const element = elementAt(0, false);
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: element } },
        conversions
      );
    }
    case 'Join':
    case 'ListJoin': {
      if (node.nops < 2)
        refuse(
          `with ${node.nops} operands is not in the structured route, which joins two lists or more`
        );
      // Lists of tuples of one size join to a list of tuples; a list of
      // tuples beside a list of numbers (also the empty literal) is refused
      // with that cause.
      // Lists of lists join to a list of lists whose rows read the rows of
      // each operand (`joinedRows()`); a list of lists beside a list of
      // numbers is refused.
      const rowsAt = facts.findIndex((f) => rowsOf(f) !== undefined);
      if (rowsAt >= 0) {
        let row: FragmentListType | undefined = rowsOf(facts[rowsAt]);
        facts.forEach((f, i) => {
          const other = rowsOf(f);
          row =
            row === undefined || other === undefined
              ? undefined
              : joinedRows(row, other);
          if (row === undefined)
            refuse(
              `of ${describe(rowsAt)} and ${describe(i)} is not in the structured route, ` +
                `which joins lists of one element type`
            );
        });
        return w.valueFacts(node, { kind: 'list', element: row! }, conversions);
      }
      const tupleAt = facts.findIndex(
        (f) => listElementType(f)?.kind === 'point'
      );
      const first = tupleAt < 0 ? listElementAt(0) : listElementAt(tupleAt);
      if (first.kind === 'point') {
        facts.forEach((_, i) => {
          const element = listElementAt(i);
          if (element.kind !== 'point' || element.size !== first.size)
            refuse(
              `of ${describe(tupleAt)} and ${describe(i)} is not in the structured route, ` +
                `which joins lists of one element type`
            );
        });
        return w.valueFacts(
          node,
          { kind: 'list', element: first },
          conversions
        );
      }
      const elements = facts.map((_, i) => elementAt(i, false));
      return w.valueFacts(
        node,
        {
          kind: 'list',
          element: {
            kind: elements.every((e) => e === 'integer') ? 'integer' : 'real',
          },
        },
        conversions
      );
    }
    case 'First':
    case 'Last':
    case 'Second':
    case 'Third': {
      arity(1);
      // `First`, `Second` or `Third` of a list whose element type does not
      // decide the value of a read past the end (`never`, the type of the
      // elements of `[]`): the existing emitter writes `_SYS.nth(L, i)`,
      // `undefined` for an empty list, where the route reads `NaN`
      // (`compileNthElement()` in `javascript-target.ts`).
      if (
        head !== 'Last' &&
        indexElementType(node.ops[0].type.type) === 'never'
      )
        refuse(
          `of ${nodeText(node.ops[0])}, whose elements have the type never, ` +
            `is not in the structured route: the existing emitter reads ` +
            `undefined for an empty list`
        );
      // The first or last tuple of a list of tuples, `_SYS.atPoint(L, 1,
      // n)` and `_SYS.atPoint(L, -1, n)`; the first or last row of a list
      // of lists, a row read (`atRule()`).
      const point = listElementType(facts[0]) ?? rowsOf(facts[0]);
      if (point?.kind === 'point' || point?.kind === 'list')
        return w.valueFacts(node, point, conversions);
      return w.valueFacts(node, { kind: elementAt(0, true) }, conversions);
    }
    case 'Count':
      arity(1);
      // The length of a list of tuples, and the number of rows of a list
      // of lists, too.
      if (
        listElementType(facts[0])?.kind !== 'point' &&
        rowsOf(facts[0]) === undefined
      )
        elementAt(0, true);
      return w.valueFacts(node, { kind: 'integer' }, conversions);
    case 'Range': {
      if (node.nops < 1 || node.nops > 3)
        refuse(
          `with ${node.nops} operands is not in the structured route, which admits Range(a, b, step), Range(a, b) and Range(b)`
        );
      if (node.nops < 3) {
        facts.forEach((_, i) => integerAt(i));
        return w.valueFacts(
          node,
          { kind: 'list', element: { kind: 'integer' } },
          conversions
        );
      }
      // With a step, the bounds and the step are reals or integers: the
      // existing emitter calls `_SYS.range(a, b, step)` for each of them,
      // and the runtime counts the elements with the tolerance of the
      // interpreter (`rangeCount()`).
      facts.forEach((f, i) => {
        if (f.type.kind !== 'real' && f.type.kind !== 'integer')
          refuse(
            `with ${describe(i)} is not in the structured route, which reads a real or an integer there`
          );
      });
      // The existing compiler declines a literal step 0.
      const step = node.ops[2];
      if (isNumber(step) && step.re === 0 && step.im === 0)
        refuse(
          'with the literal step 0 is not in the structured route: the existing compiler declines it'
        );
      return w.valueFacts(
        node,
        {
          kind: 'list',
          element: {
            kind: facts.every((f) => f.type.kind === 'integer')
              ? 'integer'
              : 'real',
          },
        },
        conversions
      );
    }
  }
  return refuse('is not a function of lists of the structured route');
}

/** The statistics of one list or tuple of numbers, and of two lists
 *  (`collectionRule()`), each the runtime helper of its head. */
const STATISTICS_HEADS = [
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
  'Skewness',
  'Kurtosis',
  'Mode',
  'InterquartileRange',
  'Covariance',
  'Correlation',
];

/**
 * The heads with a function operand on the structured route in the compile
 * mode `mode`, as the existing emitter writes them for an array of numbers:
 * the function is not a value of the program. A lambda literal
 * (`functionOperandParts()`) is lowered inline, its body once per element,
 * with its parameters bound in the scope of the node (`index` bindings); a
 * library operator is its operation. The lowering is in
 * `javascript-structured-lower.ts` (`functionOperand()`):
 *
 * - `Map(f, L)` of one list or tuple `L`: a list of the values of `f` at
 *   the elements, in order (`L.map(_f)`); a list of integers when each value
 *   is. `f` is a lambda of one parameter with a real or an integer value,
 *   or a library operator of `MAPPED_OPERATORS`.
 * - `Filter(L, p)`: the list of the elements of the list `L` for which the
 *   lambda `p` is true (`L.filter(_f)`). `Count(L, p)`: their number, an
 *   integer (`L.filter(_f).length`).
 * - `Reduce(L, op)` and `Reduce(L, op, init)` of a list `L`, with an
 *   operator of `FOLD_OPERATORS`: the fold from the first element (`NaN`
 *   for an empty list) or from `init`; an integer when `init` and the
 *   elements are, and with no `init` a real. `Reduce(L, f, init)` with a
 *   lambda of two parameters (the accumulator, a real, and the element):
 *   a real. A lambda with no `init` is refused, as the existing compiler
 *   refuses it.
 * - `Scan(L, op)`, `Scan(L, op, init)`, `Scan(L, f)` and `Scan(L, f, init)`:
 *   the list of the accumulators of the same fold after each element (with
 *   no `init`, the first is the first element).
 * - `Apply(f, a1, …)` of a lambda of one parameter per argument: the value
 *   of the body with each parameter bound to the value of its argument
 *   (`((t) => body)(a)`), a real, an integer or a boolean.
 *
 * Refused: in the `complex` mode, a lambda (the existing compiler compiles
 * its body with the parameters of the type `number`, and so on the complex
 * lane in places: `Apply((t) => t + 1, x)` is
 * `_SYS.cplx(((t) => ({ re: (_SYS.cplx(t)).re + 1, … }))(_.x))`) and every
 * operator but `Floor`; a lambda whose body is not one value; a function
 * given at run time, a user function, a `Composition`, a parameter typed
 * other than `integer`, `real` or `number`, a parameter typed `integer`
 * that takes a real;
 * `Map` over several lists; an operand that is not a list of reals or of
 * integers; a body whose value is not a number (a boolean for a predicate);
 * a trigonometric operator when `ce.angularUnit` is not radians; a library
 * operator that an option of the host maps (`hosts`). A body that
 * is not pure, draws, calls the host or can abort is refused after the
 * annotation (`refuseLazyFunctionOperands()`): the interpreter's `Map`,
 * `Filter` and `Scan` are lazy views that compute an element when it is
 * read, where the route makes the list at once.
 */
function functionOperandRule(
  mode: 'strict' | 'complex',
  hosts?: StructuredHosts
) {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node))
        return w.refuse(node, 'signature', 'expected a function operand');
      const head = node.operator;
      // `Count(L)` with no predicate is a function of lists.
      if (head === 'Count' && node.nops === 1)
        return collectionRule(node, scope, context, w);
      const refuse = (message: string): never =>
        w.refuse(node, 'signature', `${head} ${message}`);
      const position = FUNCTION_OPERAND_HEADS[head];
      if (position === undefined) return refuse('takes no function operand');
      // A user function is the literal of one call of it
      // (`userFunctionOperand()`), which the admission recorded.
      const fn = functionOperandOf(node);
      const arity = position.arity ?? node.nops - 1;
      const lambda =
        fn === undefined ? undefined : functionOperandParts(fn, arity);
      const operator =
        lambda === undefined &&
        fn !== undefined &&
        isSymbol(fn) &&
        isLibraryOperator(fn, fn.symbol)
          ? fn.symbol
          : undefined;
      // A library operator that the host maps (`vars`, `functions`,
      // `operators`): the existing emitter calls the source of the entry for
      // each element, the route the operation of the library.
      // `structuredHosts()` already refuses a `functions` or `operators`
      // entry for a name of the library.
      if (
        operator !== undefined &&
        (hosts?.vars.has(operator) === true ||
          hosts?.heads.has(operator) === true)
      )
        refuse(
          `with the operator ${operator}, which an option of the host maps, is ` +
            `not in the structured route: the existing emitter calls the source ` +
            `of the entry`
        );
      // The function literal of a user function (`userFunctionOperand()`).
      const user = fn !== node.ops[position.fn];
      // A user function whose name an option of the host maps (`vars: { f:
      // … }`, a `functions` or an `operators` entry): the existing emitter
      // calls the source of the entry for each element, the route the
      // definition of the engine.
      const named = node.ops[position.fn];
      if (
        user &&
        isSymbol(named) &&
        (hosts?.vars.has(named.symbol) === true ||
          hosts?.heads.has(named.symbol) === true)
      )
        refuse(
          `with the user function ${named.symbol}, which an option of the host maps, ` +
            `is not in the structured route: the existing emitter calls the source of the entry`
        );
      if (lambda !== undefined && mode === 'complex')
        refuse(
          `with ${user ? 'the user function ' + nodeText(node.ops[position.fn]) : 'a function literal'} ` +
            `is not in the structured route in the complex mode: ` +
            `the existing compiler compiles its body with parameters of the type number, on the complex lane in places`
        );
      // A parameter annotated with a type that the engine type of the
      // element (or of the initial value, or of an argument of `Apply`) does
      // not prove: a parameter of a user function (`fd(v: real)` mapped over
      // a `list<number>`), or a tuple annotation of a function literal or of
      // a user function (`(p: tuple<integer, integer>) ↦ …` over a
      // `list<tuple<real, real>>`). The existing compiler declines it, as it
      // cannot check the annotation in the compiled callback; the interpreter
      // refuses each element. A scalar annotation of a function literal is
      // checked on its fact (`body()`).
      if (lambda !== undefined) {
        const literal = user
          ? userFunctionLiteralOf(node.ops[position.fn])
          : undefined;
        const declared = user
          ? literal === undefined
            ? undefined
            : functionOperandParts(literal, arity)?.parameters
          : lambda.parameters;
        // The list is the other operand of `Map` (its second) and the first
        // of `Filter`, `Count`, `Reduce` and `Scan`.
        const list =
          head === 'Apply' || head === 'Tabulate'
            ? undefined
            : node.ops[position.fn === 0 ? 1 : 0];
        // `Tabulate` applies its function to the integers from 1.
        const element: Type | undefined =
          head === 'Tabulate'
            ? 'integer'
            : list === undefined
              ? undefined
              : (indexElementType(list.type.type) ?? undefined);
        const argumentTypes: (Type | undefined)[] =
          head === 'Apply'
            ? node.ops.slice(1).map((op) => op.type.type)
            : head === 'Reduce' || head === 'Scan'
              ? [node.nops === 3 ? node.op3.type.type : element, element]
              : [element];
        declared?.forEach((p, i) => {
          if (
            p.type === undefined ||
            (!user && p.type !== 'tuple' && p.type !== 'list')
          )
            return;
          let annotation: Type;
          try {
            annotation =
              p.type === 'tuple'
                ? parseType(p.tuple!)
                : p.type === 'list'
                  ? parseType(p.list!)
                  : p.type;
          } catch {
            annotation = 'unknown';
          }
          const t = argumentTypes[i];
          if (t === undefined || !isSubtype(t, annotation))
            refuse(
              `with ${user ? 'the user function ' + nodeText(node.ops[position.fn]) : 'a function literal'}, whose parameter ` +
                `${p.symbol.symbol} is annotated ${typeToString(annotation)}, is not in the structured route ` +
                `for an argument of the type ${t === undefined ? 'unknown' : typeToString(t)}: ` +
                `the existing compiler declines it`
            );
        });
      }
      // A local function of the body (declared `function`, with no value
      // at compile time): the engine types its calls `unknown`, and the
      // existing compiler reads the list that `Map` makes of it by the shape
      // of each element at run time (`_SYS.atWithValueMarker`).
      if (
        lambda === undefined &&
        fn !== undefined &&
        isSymbol(fn) &&
        operator === undefined &&
        fn.valueDefinition !== undefined &&
        fn.valueDefinition.value === undefined &&
        fn.valueDefinition.type.type === 'function'
      )
        refuse(
          `with the local function ${nodeText(fn)} is not in the structured route: the engine ` +
            `types a call of a local function unknown, and the existing compiler reads the ` +
            `list that it makes by the shape of each element at run time`
        );
      if (lambda === undefined && operator === undefined)
        refuse(
          `with the function ${fn === undefined ? 'none' : nodeText(fn)} is not in the structured route, ` +
            `which admits a function literal of ${arity} parameter${arity === 1 ? '' : 's'} with a body of one value, ` +
            `a user function with a function literal as its value, or a library operator`
        );
      /** The facts of an operand that is not the function. */
      const value = (operand: Expression) => w.value(operand, scope, context);
      /** The element kind of the list (or with `tuples`, the tuple) `L`. */
      const elementOf = (operand: Expression, tuples: boolean) => {
        // The existing compiler declines a function of the elements of the
        // empty list literal, whose element type is `never`.
        if (isFunction(operand, 'List') && operand.nops === 0)
          refuse(
            `of the empty list literal is not in the structured route: the existing compiler ` +
              `declines a function of its elements, whose type is never`
          );
        const facts = value(operand);
        const element = collectionElement(facts);
        if (element === undefined || (!tuples && facts.type.kind === 'point'))
          refuse(
            `of ${nodeText(operand)} of the type \`${fragmentTypeToString(facts.type)}\` is not in the ` +
              `structured route, which reads a list ${tuples ? 'or a tuple ' : ''}of reals or of integers`
          );
        return { facts, element: element! };
      };
      /** The element type of the list `L`: a real, an integer, or a point
       *  (a list of tuples), which a function literal takes. */
      const elementTypeOf = (operand: Expression, tuples: boolean) => {
        const facts = value(operand);
        const element = listElementType(facts);
        if (element?.kind === 'point') {
          if (lambda === undefined)
            refuse(
              `of ${nodeText(operand)} of the type \`${fragmentTypeToString(facts.type)}\` with ` +
                `an operator is not in the structured route, which applies a function literal ` +
                `or a user function to a tuple`
            );
          return { facts, element };
        }
        const scalar = elementOf(operand, tuples);
        return { facts: scalar.facts, element: { kind: scalar.element } };
      };
      /** Type the body of the lambda with its parameters bound to `types`,
       *  in the scope of the node. `predicate`: the body is the predicate
       *  of `Filter` or `Count`, whose value is only tested. */
      const body = (
        types: readonly (
          'real' | 'integer' | FragmentElementType | FragmentListType
        )[],
        predicate = false
      ) => {
        const inner = w.open(node, scope);
        lambda!.parameters.forEach((p, i) => {
          const t = types[i];
          const type = typeof t === 'string' ? { kind: t } : t;
          // A typed parameter takes an element of its type: an integer is a
          // real, and `number` is real in the `strict` mode. A parameter
          // typed with a tuple type (the element type of a list of tuples)
          // takes a tuple of its size.
          const declaredTuple =
            p.type === 'tuple' && p.tuple !== undefined
              ? structuredTupleType(parseType(p.tuple), mode)
              : undefined;
          // A parameter typed with a list type takes a row of a list of
          // lists (`Map` of rows), and only one.
          if (
            p.type !== undefined &&
            (p.type === 'tuple'
              ? type.kind !== 'point' || declaredTuple?.size !== type.size
              : p.type === 'list'
                ? type.kind !== 'list'
                : type.kind === 'point' ||
                  type.kind === 'list' ||
                  (p.type === 'integer' && type.kind !== 'integer'))
          )
            refuse(
              `whose parameter ${p.symbol.symbol} is declared ${p.tuple ?? p.list ?? p.type} and takes ` +
                `a ${type.kind === 'point' ? 'tuple' : type.kind} is not in the structured route`
            );
          // A row is a parameter, held as an array, as an argument of a
          // helper is: a list is not an index.
          w.bind(
            p.symbol,
            inner,
            p.symbol.symbol,
            type,
            type.kind === 'list' ? 'parameter' : 'index'
          );
        });
        // A body whose engine type admits a value that is not a number or a
        // boolean (`fm(L)` of `fm: (list<real>) -> real` has the type
        // `list<any> | real`): the existing compiler reads the list it
        // makes with `_SYS.atWithValueMarker`, which gives `undefined` out
        // of range where the route gives `NaN`. A predicate is tested, not
        // read: its fact must be a boolean (`predicate()`), and the existing
        // compiler tests the boolean that its code of a possible list gives
        // for the scalar operands of the program (`e[4] < c[4]` of a tuple
        // `e` that the engine types `unknown` is `_SYS.bcast((a, b) => a <
        // b, …)` of two numbers there).
        const engineType = lambda!.body.type.type;
        if (
          !predicate &&
          !isSubtype(engineType, 'number') &&
          !isSubtype(engineType, 'boolean') &&
          !(
            head === 'Map' &&
            structuredTupleType(engineType, mode) !== undefined
          ) &&
          // A row: the function of a `Map` of the rows of a list of lists.
          !(head === 'Map' && isSubtype(engineType, 'list<number>'))
        )
          refuse(
            `whose function has a value of the type ${lambda!.body.type.toString()} is not in the ` +
              `structured route, which admits a number or a boolean`
          );
        return w.value(lambda!.body, inner, { ...context, loop: undefined });
      };
      const numeric = (facts: FragmentValueFacts<ScalarRepresentation>) => {
        const kind = facts.type.kind;
        if (kind !== 'real' && kind !== 'integer')
          refuse(
            `whose function has a value of the type \`${fragmentTypeToString(facts.type)}\` ` +
              `is not in the structured route, which admits a real or an integer value`
          );
        return kind as 'real' | 'integer';
      };
      const predicate = (facts: FragmentValueFacts<ScalarRepresentation>) => {
        if (facts.type.kind !== 'boolean')
          refuse(
            `whose predicate has a value of the type \`${fragmentTypeToString(facts.type)}\`, not boolean, ` +
              `is not in the structured route`
          );
      };
      const list = (element: 'real' | 'integer') =>
        ({ kind: 'list', element: { kind: element } }) as const;
      // A value, or an element of a list value, of a type of numbers that
      // are not real (`Map(Ln, L)` has the type `list<complex |
      // signed_infinity>`): the existing compiler reads it on the complex
      // lane where it is read (`At(Map(Ln, [x]), 1) + 2` is `{ re: …, im:
      // … }`), where the route reads the real number of its kernel.
      // The application of the closed form of a derivative
      // (`closedFormReplacement()`) is read in the lane of its body with the
      // parameters of the arguments (`withDerivativeArgument()`), not of
      // its engine type, whose parameters have no type.
      const engineType = node.type.type;
      const element = indexElementType(engineType) ?? engineType;
      if (
        isNonRealNumber(finitePartOfType(element)) &&
        !DERIVATIVE_APPLICATIONS.has(node)
      )
        refuse(
          `of the type ${node.type.toString()} is not in the structured route: the existing ` +
            `compiler reads a value of numbers that are not real on the complex lane`
        );
      switch (head) {
        case 'Map': {
          if (node.nops !== 2)
            refuse(
              'over several lists is not in the structured route, which maps one list or tuple'
            );
          // A function literal of the rows of a list of lists of rank 2
          // (slice 2 of the nested lists): its parameter takes each row as
          // it is (`M.map((_x) => _f(_x))`), and its value is a number or a
          // row, a list of numbers.
          const rows =
            lambda === undefined ? undefined : rowsOf(value(node.op2));
          if (rows !== undefined) {
            const facts = value(node.op2);
            if (numericCellsOf(facts)?.rank !== 2)
              refuse(
                `of ${nodeText(node.op2)} of the type \`${fragmentTypeToString(facts.type)}\` is not ` +
                  `in the structured route, which maps the rows of a list of lists of reals ` +
                  `or of integers of rank 2`
              );
            const mapped = body([rows]);
            if (mapped.type.kind === 'list') {
              if (numericCellsOf(mapped)?.rank !== 1)
                refuse(
                  `whose function has a value of the type \`${fragmentTypeToString(mapped.type)}\` ` +
                    `is not in the structured route, which maps a row to a number or to a list of numbers`
                );
              return w.valueFacts(
                node,
                { kind: 'list', element: mapped.type },
                [w.convert(facts, facts.type)!]
              );
            }
            return w.valueFacts(node, list(numeric(mapped)), [
              w.convert(facts, facts.type)!,
            ]);
          }
          if (lambda !== undefined) {
            // A function literal of a list of numbers or of tuples, whose
            // parameter takes each element as it is
            // (`L.map((_x) => _f(_x))`), and whose value is a number or a
            // tuple (a new array for each element).
            const { facts, element } = elementTypeOf(node.op2, true);
            const mapped = body([element]);
            if (mapped.type.kind === 'point' && facts.type.kind === 'point')
              refuse(
                `of a tuple with a function whose value is a tuple is not in the structured route, ` +
                  `which maps a list to a list of tuples`
              );
            return w.valueFacts(
              node,
              mapped.type.kind === 'point'
                ? { kind: 'list', element: mapped.type }
                : list(numeric(mapped)),
              [w.convert(facts, facts.type)!]
            );
          }
          const { facts, element } = elementOf(node.op2, true);
          const conversions = [w.convert(facts, facts.type)!];
          const mapped = Object.hasOwn(MAPPED_OPERATORS, operator!)
            ? MAPPED_OPERATORS[operator!]
            : undefined;
          if (mapped === undefined)
            refuse(
              `of the operator ${operator} is not in the structured route, which maps the operators ` +
                `${Object.keys(MAPPED_OPERATORS).join(', ')}`
            );
          if (mode === 'complex' && mapped!.complex !== true)
            refuse(
              `of the operator ${operator} is not in the structured route in the complex mode: ` +
                `the existing emitter writes a complex function of each element`
            );
          if (mapped!.trig === true && node.engine.angularUnit !== 'rad')
            refuse(
              `of the operator ${operator} is not in the structured route with angles in another unit than radians`
            );
          // The result kind of the operation of an element.
          const kind =
            mapped!.kind === 'floor' ||
            ((mapped!.kind === 'negate' || mapped!.fn === 'abs') &&
              element === 'integer')
              ? 'integer'
              : 'real';
          return w.valueFacts(node, list(kind), conversions);
        }
        case 'Filter':
        case 'Count':
        case 'CountIf':
        case 'Any':
        case 'All':
        case 'Find':
        case 'IndexWhere':
        case 'Position':
        case 'TakeWhile':
        case 'DropWhile': {
          if (node.nops !== 2) refuse('with other than a list and a predicate');
          if (lambda === undefined)
            refuse(
              'with an operator as its predicate is not in the structured route, which admits a function literal'
            );
          // `Find` of a list of tuples gives `NaN` for no match in the
          // existing code, not a tuple: a list of numbers only.
          const { facts, element } =
            head === 'Find'
              ? (() => {
                  const scalar = elementOf(node.op1, false);
                  return {
                    facts: scalar.facts,
                    element: { kind: scalar.element } as FragmentElementType,
                  };
                })()
              : elementTypeOf(node.op1, false);
          predicate(body([element], true));
          const type: FragmentValueType | FragmentListType =
            head === 'Filter' || head === 'TakeWhile' || head === 'DropWhile'
              ? { kind: 'list', element }
              : head === 'Position'
                ? { kind: 'list', element: { kind: 'integer' } }
                : head === 'Any' || head === 'All'
                  ? { kind: 'boolean' }
                  : head === 'Find'
                    ? { kind: 'real' }
                    : { kind: 'integer' };
          return w.valueFacts(node, type, [w.convert(facts, facts.type)!]);
        }
        case 'Tabulate': {
          if (node.nops !== 2)
            refuse(
              'with other than one count is not in the structured route, which tabulates one dimension'
            );
          if (lambda === undefined)
            refuse(
              'with an operator is not in the structured route, which admits a function literal'
            );
          const count = value(node.op2);
          if (count.type.kind !== 'integer')
            refuse(
              `with ${nodeText(node.op2)} of the type \`${fragmentTypeToString(count.type)}\` is not in the ` +
                `structured route, which reads an integer count`
            );
          return w.valueFacts(node, list(numeric(body(['integer']))), [
            w.convert(count, count.type)!,
          ]);
        }
        case 'Reduce':
        case 'Scan': {
          if (node.nops !== 2 && node.nops !== 3)
            refuse('with other than a list, a function and an initial value');
          const { facts, element } = elementOf(node.op1, false);
          const conversions = [w.convert(facts, facts.type)!];
          let init: 'real' | 'integer' | undefined;
          if (node.nops === 3) {
            const initial = value(node.op3);
            init = numeric(initial);
            conversions.push(w.convert(initial, initial.type)!);
          }
          let kind: 'real' | 'integer';
          if (lambda !== undefined) {
            if (head === 'Reduce' && init === undefined)
              refuse(
                'with a function literal or a user function and no initial value is not in the structured route: ' +
                  'the existing compiler refuses it'
              );
            numeric(body(['real', element]));
            kind = 'real';
          } else {
            if (!Object.hasOwn(FOLD_OPERATORS, operator!))
              refuse(
                `by the operator ${operator} is not in the structured route, which folds with Add, Multiply, Max and Min`
              );
            kind =
              element === 'integer' &&
              init !== 'real' &&
              !(head === 'Reduce' && init === undefined)
                ? 'integer'
                : 'real';
          }
          return w.valueFacts(
            node,
            head === 'Scan' ? list(kind) : { kind },
            conversions
          );
        }
        case 'Apply': {
          if (lambda === undefined)
            refuse(
              'of an operator is not in the structured route, which applies a function literal'
            );
          const args = node.ops.slice(1).map((a) => value(a));
          const result = body(args.map((a) => numeric(a)));
          const kind = result.type.kind;
          if (kind !== 'real' && kind !== 'integer' && kind !== 'boolean')
            refuse(
              `whose function has a value of the type \`${fragmentTypeToString(result.type)}\` ` +
                `is not in the structured route, which admits a real, an integer or a boolean value`
            );
          return w.valueFacts(
            node,
            { kind: kind as 'real' | 'integer' | 'boolean' },
            args.map((a) => w.convert(a, a.type)!)
          );
        }
      }
      return refuse('takes no function operand');
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/** Whether `node` is the fold of one collection that `foldRule` types: a
 *  `Sum`, `Product`, `Max` or `Min` of the library with one operand. */
function isFoldNode(node: Expression): boolean {
  return (
    isFunction(node) &&
    node.nops === 1 &&
    ['Sum', 'Product', 'Max', 'Min'].includes(node.operator) &&
    isLibraryOperator(node, node.operator)
  );
}

/**
 * A key of the length of the list `node`, typed in `scope`, that two lists
 * share when their lengths are equal by construction, or `undefined` when
 * no such key is known: a read of a name (two reads of one name in one
 * expression read one value), a list literal (its number of elements), an
 * element-wise result (the key of its list operands, which its rule found
 * equal: a head of `ELEMENTWISE_HEADS`, or a head that the engine
 * broadcasts, whose list value has the length of its list operands,
 * `broadcastRule()`), `ReplaceAt(L, …)`, `RotateLeft(L, k)` and
 * `RotateRight(L, k)` (the key of `L`), and a comprehension over
 * `Element(j, Range(a, b))` with no guard whose bounds are number literals
 * or names (the text of the bounds: two comprehensions over one range have
 * one length).
 */
function lengthKey(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): string | undefined {
  if (isSymbol(node)) return `name ${node.symbol}`;
  // A call of a helper applied to each element of its list arguments
  // (`mapsListArguments`): the length of those lists, which its rule found
  // equal.
  const fn = isFunction(node)
    ? w.definition.functionOf(node, scope)
    : undefined;
  if (fn !== undefined) {
    const list = fn.arguments.find((argument, i) => {
      const parameter = fn.parameterTypes[i];
      return (
        parameter !== undefined &&
        parameter.kind !== 'list' &&
        w.value(argument, scope, context).type.kind === 'list'
      );
    });
    return list === undefined ? undefined : lengthKey(list, scope, context, w);
  }
  if (!isFunction(node) || !isLibraryOperator(node, node.operator))
    return undefined;
  if (node.operator === 'List') return `literal ${node.nops}`;
  // A comprehension with a guard (`Element(j, Range(a, b), c)`) keeps the
  // elements that the guard admits.
  const parts =
    node.operator === 'Comprehension' ? comprehensionParts(node) : undefined;
  if (
    parts !== undefined &&
    parts.guard === undefined &&
    [parts.from, parts.to].every((bound) => isNumber(bound) || isSymbol(bound))
  )
    return `range ${nodeText(parts.from)} ${nodeText(parts.to)}`;
  // A rotation has the length of its list.
  if (
    (node.operator === 'ReplaceAt' && node.nops === 3) ||
    ((node.operator === 'RotateLeft' || node.operator === 'RotateRight') &&
      node.nops >= 1)
  )
    return lengthKey(node.op1, scope, context, w);
  if (ELEMENTWISE_HEADS.includes(node.operator) || isBroadcastHead(node)) {
    const list = node.ops.find(
      (op) => w.value(op, scope, context).type.kind === 'list'
    );
    return list === undefined ? undefined : lengthKey(list, scope, context, w);
  }
  return undefined;
}

/**
 * The rule `rule` of `head` (`ELEMENTWISE_HEADS`), with an element-wise
 * form for an operand that is a list: the interpreter applies the operator
 * to each element (`L + 1` is a list), and the existing emitter writes
 * `_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), L, 1)`, which evaluates each
 * operand once, then applies the operator to the elements and to the
 * scalar operands. The result is a list of the values, of integers when
 * every element and every scalar operand is an integer (a quotient is a
 * real). The lowering writes a `build` over the length of the list whose
 * body applies the operation of the head to the elements
 * (`elementwise()` in `javascript-structured-lower.ts`): the code of the
 * closure of the existing emitter, a sum, a product or a quotient of the
 * values of the operands, not the code of the scalar rule (`Multiply(1/3,
 * L)` multiplies by the double of `1/3`, as `_SYS.bcast` does, and does not
 * divide by 3).
 *
 * Refused: a tuple operand (the interpreter refuses a tuple and a number in
 * a sum), a complex or a boolean operand, a list of other elements, and two
 * list operands whose lengths are not equal by construction (`lengthKey()`):
 * `_SYS.bcast` gives `NaN` for two lists of different lengths, a value of
 * another shape (the design note, open choice 5).
 *
 * `kindOf` gives the kind of the elements of the result from whether every
 * element and every scalar operand is an integer (`broadcastRule()` gives
 * its own: a real, an integer for `Floor`, a boolean for a comparison).
 */
function elementwiseRule(
  head: string,
  rule: FragmentRule<ScalarRepresentation>,
  kindOf: (integer: boolean) => 'real' | 'integer' | 'boolean' = (integer) =>
    integer && head !== 'Divide' ? 'integer' : 'real'
): Extract<FragmentRule<ScalarRepresentation>, { walk: unknown }> {
  return {
    walk: (node, scope, context, w) => {
      const facts = operandFacts(node, scope, context, w);
      const aggregate = facts.findIndex(
        (f) => f.type.kind === 'list' || f.type.kind === 'point'
      );
      if (aggregate < 0 || !isFunction(node))
        return 'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      const point = facts.findIndex((f) => f.type.kind === 'point');
      if (point >= 0)
        return w.refuse(
          node,
          'signature',
          `${head} with the tuple operand ${nodeText(node.ops[point])} is not in the ` +
            `structured route, which reads a tuple with At and Length and folds it`
        );
      // Lists of lists: element-wise at every depth, with scalar operands
      // (`nestedElementwise()`).
      if (facts.some((f) => (numericCellsOf(f)?.rank ?? 0) >= 2))
        return nestedElementwise(head, node, facts, scope, context, w, kindOf);
      for (const [i, f] of facts.entries()) {
        const kind = f.type.kind;
        if (kind === 'list') {
          if (collectionElement(f) === undefined)
            return w.refuse(
              node,
              'signature',
              `${head} with the list operand ${nodeText(node.ops[i])} of the type ` +
                `\`${fragmentTypeToString(f.type)}\` is not in the structured route`
            );
          continue;
        }
        if (kind !== 'real' && kind !== 'integer')
          return w.refuse(
            node,
            'signature',
            `${head} of a list and the operand ${nodeText(node.ops[i])} of the type ` +
              `\`${fragmentTypeToString(f.type)}\` is not in the structured route, ` +
              `which applies an operator to the elements of a list of reals or of integers and to real operands`
          );
        // A name with no declared type can hold a list for the existing
        // compiler, which then multiplies the operands by their shape at
        // run time (`_SYS.mulChecked`), in another order.
        // In the `strict` mode a name with no declared type, or declared
        // `unknown`, is a real scalar input of the profile, and the existing
        // compiler writes the same `_SYS.bcast` closure as for a real name;
        // in the `complex` mode its fact is complex.
        const undeclared = undeclaredNames(node.ops[i]).find((name) => {
          const role = w.binding(scope, name.symbol)?.role;
          if (role === 'local' || role === 'index') return false;
          const fact = scope.facts.get(name);
          return !(
            fact !== undefined &&
            'type' in fact &&
            (fact.type.kind === 'real' || fact.type.kind === 'integer')
          );
        });
        if (undeclared !== undefined)
          return w.refuse(
            node,
            'signature',
            `${head} of a list and the operand ${nodeText(node.ops[i])}, which reads ` +
              `the name ${nodeText(undeclared)} with no declared type, is not in the ` +
              `structured route: the existing compiler reads such a name as a possible list`
          );
      }
      const lists = node.ops.filter((_, i) => facts[i].type.kind === 'list');
      if (lists.length > 1) {
        const keys = lists.map((op) => lengthKey(op, scope, context, w));
        // Lists whose engine types state one length (`vector<2>`, the type
        // of a matrix product `M·v` of a `matrix<2x2>`), which the host
        // supplies or the product gives.
        const width = (op: Expression) => {
          const t = op.type.type;
          return typeof t === 'object' &&
            t.kind === 'list' &&
            t.dimensions?.length === 1 &&
            t.dimensions[0] >= 0
            ? t.dimensions[0]
            : undefined;
        };
        const widths = lists.map(width);
        const stated =
          widths.every((n) => n !== undefined) && new Set(widths).size === 1;
        if (
          !stated &&
          (keys.some((k) => k === undefined) || new Set(keys).size > 1)
        )
          return w.refuse(
            node,
            'signature',
            `${head} of the lists ${lists.map((op) => nodeText(op)).join(' and ')}, whose ` +
              `lengths are not equal by construction, is not in the structured route ` +
              `(declare one width for them: \`list<real^3>\` or \`vector<3>\`): ` +
              `the existing compiler gives NaN for two lists of different lengths`
          );
      }
      const integer = facts.every(
        (f) =>
          f.type.kind === 'integer' ||
          (f.type.kind === 'list' && f.type.element.kind === 'integer')
      );
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: kindOf(integer) } },
        facts.map((f) => w.convert(f, f.type)!)
      );
    },
  };
}

/** Whether `node` is a library operator that the engine broadcasts over a
 *  list operand (`broadcastRule()`): a list value of such a node has the
 *  length of its list operands. */
function isBroadcastHead(node: Expression): boolean {
  return (
    isFunction(node) &&
    !ELEMENTWISE_HEADS.includes(node.operator) &&
    isLibraryOperator(node, node.operator) &&
    (node.operatorDefinition as { broadcastable?: boolean } | undefined)
      ?.broadcastable === true
  );
}

/** The heads of `broadcastRule()` whose element is an operation of the
 *  representation, with its number of operands. */
const BROADCAST_OPERATIONS: Readonly<
  Record<
    string,
    {
      readonly operation: Extract<
        BroadcastForm,
        { operation: unknown }
      >['operation'];
      readonly nops: number;
    }
  >
> = {
  Sqrt: { operation: 'sqrt', nops: 1 },
  Floor: { operation: 'floor', nops: 1 },
  Mod: { operation: 'mod', nops: 2 },
  // Slice 2: the comparisons of a list and the connectives of lists of
  // booleans, whose value is a list of booleans. A chain of comparisons
  // (`L < 1 < 2`) is one closure of the existing emitter, and declines.
  Less: { operation: 'less', nops: 2 },
  LessEqual: { operation: 'less-equal', nops: 2 },
  Equal: { operation: 'equal', nops: 2 },
  NotEqual: { operation: 'not-equal', nops: 2 },
  Not: { operation: 'not', nops: 1 },
};

/** The connectives of `broadcastRule()`, of two operands or more. */
const BROADCAST_CONNECTIVES: ReadonlySet<string> = new Set(['And', 'Or']);

/** The heads whose scalar code of a real operand is complex on the
 *  structured route (`ScalarFunctionLane` `inverse`), where the closure of
 *  `_SYS.bcast` applies the real function to each element (`Math.asin(e)`,
 *  `NaN` off the real domain). */
const COMPLEX_CELL_HEADS: ReadonlySet<string> = new Set([
  'Arcsin',
  'Arccos',
  'Arcosh',
  'Artanh',
  'Arccsc',
  'Arcsec',
  'Arcoth',
  'Arsech',
]);

/** The trigonometric heads whose operand or value an angular unit other
 *  than radians scales. */
const ANGULAR_HEADS: ReadonlySet<string> = new Set([
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Arctan',
  'Arctan2',
  'Arccot',
]);

/**
 * The element form (`BroadcastForm`) of the scalar head `head` applied to
 * each element of a list operand of `node`, as the existing emitter writes
 * the closure of `_SYS.bcast` (`tryCompileBroadcast()` in
 * `compile-broadcast.ts`): the scalar code of the head with each operand an
 * element parameter, which is the scalar code of the structured route for
 * operands that are not literals. Otherwise the cause of the refusal:
 *
 * - a head whose cell is not real (`COMPLEX_CELL_HEADS`): the closure is
 *   the real function, the scalar code of the route the complex one (the
 *   design note, open choice 6);
 * - a head of `REAL_CALL_HEADS` with a `domain` (`Beta`, `AGM`,
 *   `CosIntegral`, …): the route proves the domain of a scalar operand
 *   from its type, and has no such proof for the elements of a list;
 * - `Sin`, `Cos` and `Tan` of a multiple of `π`: the existing emitter
 *   writes the half-turn kernel of the list (`_SYS.sinpi`);
 * - a trigonometric head in another angular unit than radians;
 * - `Floor`, `Ceil` and `Round` of an exact constant that no double holds
 *   (`inexactJumpConstant()`), `Round` with ties other than away from
 *   zero, as for a scalar operand;
 * - every other head: `Sech`, `Csch` and `Fract` (whose scalar code the
 *   route refuses), a function whose closure is not the scalar code of a
 *   real call (`KroneckerDelta`, `Boole`), and the heads that are not
 *   functions of real numbers.
 */
function broadcastForm(
  head: string,
  node: Expression & { ops: readonly Expression[] },
  scope: FragmentScope<ScalarRepresentation>,
  inputs: ReadonlySet<string>
): BroadcastForm | { readonly refusal: string } {
  const nops = node.ops.length;
  const refuse = (refusal: string) => ({ refusal });
  if (COMPLEX_CELL_HEADS.has(head))
    return refuse(
      `the scalar code of ${head} of a real operand is complex, where the ` +
        `existing compiler applies the real function to each element`
    );
  if (ANGULAR_HEADS.has(head) && node.engine.angularUnit !== 'rad')
    return refuse(
      `the angular unit is ${node.engine.angularUnit}, not radians`
    );
  if (
    (head === 'Sin' || head === 'Cos' || head === 'Tan') &&
    readsAsPiMultiple(node.ops[0])
  )
    return refuse(
      'the operand is a multiple of Pi, for which the existing emitter ' +
        'writes the half-turn kernel of each element'
    );
  if (head === 'Floor' || head === 'Ceil' || head === 'Round') {
    const constant = inexactJumpConstant(node.ops, scope, inputs);
    if (constant !== undefined)
      return refuse(
        `the operand holds the exact constant ${nodeText(constant)}, which no ` +
          `double holds exactly, and the route declines it beside a jump, as for ` +
          `a scalar operand (inexact-jump-operand)`
      );
    if (head === 'Round' && node.engine.roundingTies !== 'away-from-zero')
      return refuse(
        `the rounding of ties is ${node.engine.roundingTies}, not away from zero`
      );
  }
  const operation = Object.hasOwn(BROADCAST_OPERATIONS, head)
    ? BROADCAST_OPERATIONS[head]
    : undefined;
  if (operation !== undefined)
    return operation.nops === nops
      ? { operation: operation.operation }
      : refuse(`${head} with ${nops} operands is not element-wise`);
  if (BROADCAST_CONNECTIVES.has(head))
    return { operation: head === 'And' ? 'and' : 'or' };
  if (head === 'Power' || head === 'Root') {
    if (nops !== 2)
      return refuse(`${head} with ${nops} operands is not element-wise`);
    // An exact rational exponent of odd denominator (`L^(2/3)`, `L^(8/5)`):
    // the existing compiler keeps the fraction in the closure
    // (`closureFrames()`, `realPowerExponent()`) and writes a real root of
    // each element (`_SYS.pow2(Math.cbrt(e))`, `Math.pow(Math.abs(e), 1.6)`),
    // not `_SYS.pow(e, 0.666…)`.
    if (head === 'Power' && realPowerExponent(node.ops) !== undefined)
      return refuse(
        `the exponent ${nodeText(node.ops[1])} is an exact fraction of odd ` +
          `denominator, which the existing compiler applies to each element as ` +
          `a real root`
      );
    return { call: head === 'Power' ? 'pow' : 'root' };
  }
  if (head === 'Log')
    return nops === 1
      ? { call: 'log10' }
      : nops === 2
        ? 'log-quotient'
        : refuse(`Log with ${nops} operands is not element-wise`);
  const entry =
    head === 'Gamma' && nops === 2
      ? UPPER_GAMMA
      : Object.hasOwn(REAL_CALL_HEADS, head)
        ? REAL_CALL_HEADS[head]
        : undefined;
  if (entry !== undefined) {
    if (entry.domain !== undefined)
      return refuse(
        `the structured route proves the domain of the operands of ${head} ` +
          `from their types, and has no such proof for the elements of a list ` +
          `(${entry.domain.why})`
      );
    const form = Object.hasOwn(entry.arities, nops)
      ? entry.arities[nops]
      : undefined;
    if (form === 'clamp') return 'clamp';
    if (typeof form === 'object' && 'call' in form && form.before === undefined)
      return head === 'Chop'
        ? { call: 'chop', after: node.engine.tolerance ?? 1e-10 }
        : { call: form.call };
    return refuse(
      `${head} with ${nops} operand${nops === 1 ? '' : 's'} is not element-wise`
    );
  }
  const fn = Object.hasOwn(FUNCTIONS, head) ? FUNCTIONS[head] : undefined;
  if (
    fn !== undefined &&
    head !== 'Sech' &&
    head !== 'Csch' &&
    head !== 'Fract' &&
    nops === (fn.kind === 'unary' ? 1 : 2)
  )
    return { call: fn.fn };
  return refuse(
    `${head} is not a head that the structured route applies to each element of a list`
  );
}

/** The kind of the elements of the list of an element-wise head of the
 *  form `form`: an integer for `Floor`, whose value is an integer; a
 *  boolean for a comparison and a connective; a real for every other form
 *  of real operands. */
function broadcastKind(form: BroadcastForm): 'real' | 'integer' | 'boolean' {
  if (typeof form !== 'object' || !('operation' in form)) return 'real';
  if (form.operation === 'floor') return 'integer';
  return form.operation === 'sqrt' || form.operation === 'mod'
    ? 'real'
    : 'boolean';
}

/** Whether the element form `form` reads booleans (`Not`, `And`, `Or`). */
function readsBooleans(form: BroadcastForm): boolean {
  return (
    typeof form === 'object' &&
    'operation' in form &&
    (form.operation === 'not' ||
      form.operation === 'and' ||
      form.operation === 'or')
  );
}

/**
 * The facts of `node`, a connective (`Not`, `And`, `Or`) of the head `head`
 * with a list operand (`broadcastRule()`): every operand a list of
 * booleans or a boolean, the lists of lengths equal by construction or of
 * one stated width (`listsOfOneLength()`); the value is a list of booleans. The existing emitter
 * writes `_SYS.bcast((_tv1, _tv2) => ((_tv1) && (_tv2)), B, C)`, which
 * evaluates every operand, then applies the connective to the elements: no
 * operand is skipped.
 */
function connectiveFacts(
  head: string,
  node: Expression & { ops: readonly Expression[] },
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const facts = operandFacts(node, scope, context, w);
  for (const [i, f] of facts.entries()) {
    const flatBooleans =
      f.type.kind === 'list' && f.type.element.kind === 'boolean';
    if (!flatBooleans && f.type.kind !== 'boolean')
      return w.refuse(
        node,
        'signature',
        `${head} of a list of booleans and the operand ${nodeText(node.ops[i])} of ` +
          `the type \`${fragmentTypeToString(f.type)}\` is not in the structured route, ` +
          `which applies a connective to lists of booleans and booleans`
      );
  }
  const lists = node.ops.filter((_, i) => facts[i].type.kind === 'list');
  if (!listsOfOneLength(lists, scope, context, w))
    return w.refuse(
      node,
      'signature',
      `${head} of the lists ${lists.map((op) => nodeText(op)).join(' and ')}, whose ` +
        `lengths are not equal by construction, is not in the structured route ` +
        `(declare one width for them: \`list<real^3>\` or \`vector<3>\`): ` +
        `the existing compiler gives NaN for two lists of different lengths`
    );
  return w.valueFacts(
    node,
    { kind: 'list', element: { kind: 'boolean' } },
    facts.map((f) => w.convert(f, f.type)!)
  );
}

/** Whether the lists `lists`, typed in `scope`, have lengths equal by
 *  construction (one `lengthKey()`), or engine types that state one width
 *  (`vector<3>`, `list<real^3>`), as `elementwiseRule()` reads them. */
function listsOfOneLength(
  lists: readonly Expression[],
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): boolean {
  if (lists.length < 2) return true;
  const keys = lists.map((op) => lengthKey(op, scope, context, w));
  if (keys.every((k) => k !== undefined) && new Set(keys).size === 1)
    return true;
  const widths = lists.map((op) => {
    const t = op.type.type;
    return typeof t === 'object' &&
      t.kind === 'list' &&
      t.dimensions?.length === 1 &&
      t.dimensions[0] >= 0
      ? t.dimensions[0]
      : undefined;
  });
  return widths.every((n) => n !== undefined) && new Set(widths).size === 1;
}

/** The library constants whose spelling the element-wise forms read
 *  (`Power(ExponentialE, L)` is `Math.E` in the element code, a last
 *  clause `True` of `Which` is the default). */
const LIBRARY_CONSTANTS: ReadonlySet<string> = new Set([
  'ExponentialE',
  'Pi',
  'ImaginaryUnit',
  'Infinity',
  'NegativeInfinity',
  'ComplexInfinity',
  'NaN',
  'True',
  'False',
]);

/** A name of `LIBRARY_CONSTANTS` that `node` reads and that a scope of the
 *  pass binds (`binds`: a parameter, a local, an index), or `undefined`:
 *  the element-wise forms do not read such a name as the constant. */
function shadowedConstant(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  binds: PassBinds
): string | undefined {
  if (!isFunction(node)) return undefined;
  return node.symbols.find(
    (name) => LIBRARY_CONSTANTS.has(name) && binds(name, scope)
  );
}

/**
 * The rule `rule` of `If` or `Which`, with the element-wise selection of a
 * condition that is a list of booleans (slice 2 of the design note
 * `docs/plans/2026-11-12-structured-broadcast-over-lists.md`, section 5):
 * `If(c, a, b)`, the restriction `If(c, a)` and `Which(c1, a1, …, cn, an)`
 * with an optional last clause `True`, as the existing emitter writes them,
 * `_SYS.select(() => (c1), () => (a1), …)` (`selectWith()` in
 * `javascript-runtime.ts`) and `_SYS.restrict(c, a, …, NaN)`: at each
 * position the value of the first clause whose condition holds there, the
 * element of a list arm or the value of a scalar arm, and `NaN` where no
 * clause holds. The lowering evaluates the conditions in clause order, then
 * the arms in clause order, then one `build` over the length of the first
 * condition (`selectionBuild()` in `javascript-structured-lower.ts`), and
 * records the form `elementwise-selection`.
 *
 * `selectWith()` evaluates an arm only when a position selects it, and the
 * route evaluates every arm: the two agree only for an arm that cannot
 * draw, call the host or throw, and the lowering refuses another arm
 * (`selectionBuild()`, with the throw and effect analysis of the lowering;
 * the design note, open choice 5).
 *
 * Refused also: the `complex` mode; a condition other than a final `True`
 * that is not a list of booleans (`Which` with a scalar condition among
 * list conditions: the existing code ends the walk at a scalar `true` at
 * run time); an arm that is not a real, an integer or a flat list of them;
 * a condition or a list arm whose length is not equal by construction to
 * the length of the first condition (`listsOfOneLength()`).
 */
function selectionBroadcastRule(
  head: 'If' | 'Which',
  rule: FragmentRule<ScalarRepresentation>,
  forms: Map<Expression, StructuredForm>,
  mode: 'strict' | 'complex',
  binds: PassBinds
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const fallback = () =>
        'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      if (!isFunction(node) || !isLibraryOperator(node, head))
        return fallback();
      const ops = node.ops;
      // The positions of the conditions; a last condition `True` of a
      // `Which` is the default clause.
      const conditions =
        head === 'If'
          ? [0]
          : ops
              .map((_, i) => i)
              .filter(
                (i) =>
                  i % 2 === 0 &&
                  i + 1 < ops.length &&
                  !(i === ops.length - 2 && isSymbol(ops[i], 'True'))
              );
      const listCondition = conditions.find((i) =>
        isBooleanList(w.value(ops[i], scope, context))
      );
      if (listCondition === undefined) return fallback();
      const what = `${head} with the list condition ${nodeText(ops[listCondition])}`;
      const refuse = (cause: string) =>
        w.refuse(
          node,
          'signature',
          `${what} is not in the structured route: ${cause}`
        );
      if (mode === 'complex')
        return refuse(
          'in the complex mode the existing compiler selects on the complex lane'
        );
      const shadowed = shadowedConstant(node, scope, binds);
      if (shadowed !== undefined)
        return refuse(
          `the program binds the name ${shadowed}, which the element-wise ` +
            `selection reads as a library constant`
        );
      if (
        head === 'If'
          ? ops.length !== 2 && ops.length !== 3
          : ops.length % 2 !== 0
      )
        return refuse(
          `${head} with ${ops.length} operands is not an element-wise selection`
        );
      for (const i of conditions)
        if (!isBooleanList(w.value(ops[i], scope, context)))
          return refuse(
            `the condition ${nodeText(ops[i])} is not a list of booleans, and the ` +
              `existing compiler decides a scalar condition at run time`
          );
      const arms = ops
        .map((_, i) => i)
        .filter((i) => !(head === 'If' ? i === 0 : i % 2 === 0));
      for (const i of arms) {
        const f = w.value(ops[i], scope, context);
        const scalar = f.type.kind === 'real' || f.type.kind === 'integer';
        if (
          !scalar &&
          (f.type.kind !== 'list' || collectionElement(f) === undefined)
        )
          return refuse(
            `the arm ${nodeText(ops[i])} has the type \`${fragmentTypeToString(f.type)}\`, ` +
              `and the element-wise selection reads arms that are reals, integers or ` +
              `lists of them`
          );
      }
      const lists = [
        ...conditions.map((i) => ops[i]),
        ...arms
          .filter((i) => w.value(ops[i], scope, context).type.kind === 'list')
          .map((i) => ops[i]),
      ];
      if (!listsOfOneLength(lists, scope, context, w))
        return refuse(
          `the lists ${lists.map((op) => nodeText(op)).join(' and ')} have lengths that ` +
            `are not equal by construction (declare one width for them: ` +
            `\`list<real^3>\` or \`vector<3>\`): the existing compiler gives NaN, or an ` +
            `arm whole, for lists of different lengths`
        );
      forms.set(node, 'elementwise-selection');
      return w.valueFacts(
        node,
        { kind: 'list', element: { kind: 'real' } },
        ops.map((op) => {
          const f = w.value(op, scope, context);
          return w.convert(f, f.type)!;
        })
      );
    },
  };
}

/**
 * The rule `rule` of `Max` or `Min` (`head`), with a list among several
 * operands (slice 5 of the design note
 * `docs/plans/2026-11-12-structured-broadcast-over-lists.md`): one number,
 * the extremum of every element of the lists and of every scalar operand,
 * as the existing emitter writes it (`((_p0, _p1) => { let _a = -Infinity;
 * for (const _x of _p0) { _a = Math.max(_a, _x); } _a = Math.max(_a, _p1);
 * return _a; })(L, x)`): the operands evaluated once, in order, then a fold
 * from `-Infinity` (`Infinity`) over the elements of each list and each
 * scalar, in the order of the operands; when every operand is a list, `NaN`
 * if they have no element (`_n === 0 ? NaN : _a`). The lowering is
 * `listExtremum()` in `javascript-structured-lower.ts`, and the form
 * `list-extremum`.
 *
 * Admitted: lists of reals or of integers (a list of lists is read row by
 * row, as `_p0.flat(Infinity)` reads it, beside a scalar operand), and
 * real or integer scalars. The value is a real: the accumulator starts at
 * `-Infinity`, and the fold of lists only can be `NaN`. Refused: another
 * operand (a tuple, a complex number, a list of booleans), with the
 * cause.
 */
function listExtremumRule(
  head: 'Max' | 'Min',
  rule: FragmentRule<ScalarRepresentation>,
  forms: Map<Expression, StructuredForm>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const fallback = () =>
        'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      if (!isFunction(node) || node.nops < 2 || isFoldNode(node))
        return fallback();
      const facts = operandFacts(node, scope, context, w);
      const list = facts.findIndex((f) => f.type.kind === 'list');
      if (list < 0) return fallback();
      const what = `${head} with the list operand ${nodeText(node.ops[list])}`;
      const scalars = facts.filter((f) => f.type.kind !== 'list').length;
      for (const [i, f] of facts.entries()) {
        const cells = numericCellsOf(f);
        const scalar = f.type.kind === 'real' || f.type.kind === 'integer';
        if (scalar) continue;
        if (
          cells === undefined ||
          cells.rank > 2 ||
          (cells.rank === 2 && scalars === 0)
        )
          return w.refuse(
            node,
            'signature',
            `${what} and the operand ${nodeText(node.ops[i])} of the type ` +
              `\`${fragmentTypeToString(f.type)}\` is not in the structured route, ` +
              `which takes the extremum of the elements of lists of reals or of ` +
              `integers and of real or integer operands` +
              (cells?.rank === 2
                ? ' (a list of lists beside another list declines)'
                : '')
          );
      }
      forms.set(node, 'list-extremum');
      return w.valueFacts(
        node,
        { kind: 'real' },
        facts.map((f) => w.convert(f, f.type)!)
      );
    },
  };
}

/**
 * The facts of `Equal(A, B)` or `NotEqual(A, B)` of two lists of reals or
 * of integers (`head`; slice 5 of the broadcast note): one boolean, as the
 * interpreter and the existing emitter give it (`_SYS.eq(A, B)`,
 * `eqTensor()` in `javascript-runtime.ts`): the lists have one length and
 * each pair of elements is `===` (`NaN` equals nothing, `0` and `-0` are
 * equal); `NotEqual` is its negation. No length need be equal by
 * construction: two lists of different lengths are not equal. The lowering
 * is `listEquality()` in `javascript-structured-lower.ts`, the form
 * `list-equality`. `undefined` when the operands are not two such lists.
 */
function listEqualityFacts(
  node: Expression & { ops: readonly Expression[] },
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>,
  forms: Map<Expression, StructuredForm>
): FragmentFacts<ScalarRepresentation> | undefined {
  if (node.ops.length !== 2) return undefined;
  const facts = operandFacts(node, scope, context, w);
  if (!facts.every((f) => numericCellsOf(f)?.rank === 1)) return undefined;
  forms.set(node, 'list-equality');
  return w.valueFacts(
    node,
    { kind: 'boolean' },
    facts.map((f) => w.convert(f, f.type)!)
  );
}

/**
 * The rule `rule` of the scalar head `head`, with the element-wise form of
 * a list operand (the design note
 * `docs/plans/2026-11-12-structured-broadcast-over-lists.md`, slice 1): the
 * interpreter applies the head to each element (`√L` is a list), and the
 * existing emitter writes `_SYS.bcast((_tv1) => Math.sqrt(_tv1), L)`, which
 * evaluates each operand once, in order, then applies the closure to the
 * elements and the scalar operands (`broadcastForm()`). The operands are
 * checked as for `elementwiseRule()`: lists of reals or of integers (of
 * one rank), real or integer scalar operands, two lists of lengths equal
 * by construction or of one stated width. The lowering writes one `build`
 * per head, over the length of the first list operand, whose body applies
 * the element form (`elementwise()` in `javascript-structured-lower.ts`),
 * and records the form (`{ broadcast }`).
 *
 * Refused: the causes of `broadcastForm()`, and the `complex` mode, where
 * the existing compiler applies the complex code of the head to each
 * element.
 */
function broadcastRule(
  head: string,
  rule: FragmentRule<ScalarRepresentation>,
  forms: Map<Expression, StructuredForm>,
  mode: 'strict' | 'complex',
  inputs: ReadonlySet<string>,
  binds: PassBinds
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      // A head that the engine does not broadcast keeps the refusal of
      // `rule` (`withoutListOperands()`).
      const aggregate =
        isFunction(node) &&
        isLibraryOperator(node, head) &&
        (node.operatorDefinition as { broadcastable?: boolean } | undefined)
          ?.broadcastable === true
          ? node.ops.find((op) => {
              const kind = w.value(op, scope, context).type.kind;
              return kind === 'list' || kind === 'point';
            })
          : undefined;
      if (aggregate === undefined || !isFunction(node))
        return 'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      const what = `${head} with the ${w.value(aggregate, scope, context).type.kind === 'point' ? 'tuple' : 'list'} operand ${nodeText(aggregate)}`;
      const form = broadcastForm(head, node, scope, inputs);
      if (typeof form === 'object' && 'refusal' in form)
        return w.refuse(
          node,
          'signature',
          `${what} is not in the structured route: ${form.refusal}`
        );
      if (mode === 'complex')
        return w.refuse(
          node,
          'signature',
          `${what} is not in the structured route in the complex mode: the ` +
            `existing compiler applies the complex code of the head to each element`
        );
      // The element code reads `ExponentialE` as `Math.E`: a parameter or a
      // local of that name is not the constant.
      const shadowed = shadowedConstant(node, scope, binds);
      if (shadowed !== undefined)
        return w.refuse(
          node,
          'signature',
          `${what} is not in the structured route: the program binds the name ` +
            `${shadowed}, which the element code reads as a library constant`
        );
      // A power whose base is a list of lists: the existing compiler takes a
      // matrix power of a square matrix (`_SYS.matrixPowerShape()` at run
      // time, `_SYS.matpow` for a `matrix` and an integer exponent), and
      // declines a `matrix` with an exponent that is not an integer.
      if (
        head === 'Power' &&
        (numericCellsOf(w.value(node.ops[0], scope, context))?.rank ?? 0) >= 2
      )
        return w.refuse(
          node,
          'signature',
          `${what} is not in the structured route: the base ` +
            `${nodeText(node.ops[0])} is a list of lists, and the existing ` +
            `compiler can take a matrix power of it`
        );
      // `Equal` and `NotEqual` of two lists compare the whole lists: one
      // boolean (slice 5 of the design note, `listEqualityFacts()`). Another
      // pair of lists or tuples declines.
      if (
        (head === 'Equal' || head === 'NotEqual') &&
        node.ops.filter((op) => {
          const kind = w.value(op, scope, context).type.kind;
          return kind === 'list' || kind === 'point';
        }).length > 1
      )
        return (
          listEqualityFacts(node, scope, context, w, forms) ??
          w.refuse(
            node,
            'signature',
            `${what} and another list or tuple is not in the structured route, ` +
              `which compares two lists of reals or of integers whole (one ` +
              `boolean, as the interpreter and the existing compiler give it)`
          )
        );
      const kind = broadcastKind(form);
      const facts = readsBooleans(form)
        ? connectiveFacts(head, node, scope, context, w)
        : elementwiseRule(head, rule, () => kind).walk(node, scope, context, w);
      forms.set(node, { broadcast: form });
      return facts;
    },
  };
}

/**
 * The element-wise form of `head` (`ELEMENTWISE_HEADS`) with a list of lists
 * among its operands
 * (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`, slice
 * 2): the operator applied to each number at every depth, with each scalar
 * operand, as the existing emitter writes it, `_SYS.bcast((_tv1, _tv2) =>
 * (_tv1 + _tv2), M, 1)`, which evaluates each operand once and recurses
 * into each array. The lowering writes a `build` per level
 * (`elementwise()` in `javascript-structured-lower.ts`). The result is a
 * list of lists of the rank of the list operands, of integers when every
 * number and every scalar operand is an integer (a quotient is a real).
 *
 * Refused: a list operand that is not a list of lists of numbers, list
 * operands of different ranks (`_SYS.bcast` pairs each number of the list of
 * lower rank with a row: `[[1, 2], [3, 4]] + [10, 20]` is
 * `[[11, 12], [23, 24]]`), two list operands whose lengths are not equal by
 * construction at every depth (`nestedLengthKeys()`: `_SYS.bcast` gives
 * `NaN` for two lists of different lengths and `[NaN, NaN]` for two rows of
 * different lengths), a product of two list operands (a matrix product,
 * which the existing compiler chooses at run time for a list of lists:
 * slice 4 reads a product by the types), and a scalar operand that is not a
 * real or an integer, or that reads a name with no declared type.
 */
function nestedElementwise(
  head: string,
  node: Expression & { ops: readonly Expression[] },
  facts: readonly FragmentValueFacts<ScalarRepresentation>[],
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>,
  kindOf: (integer: boolean) => 'real' | 'integer' | 'boolean'
): FragmentFacts<ScalarRepresentation> {
  const refuse = (message: string) =>
    w.refuse(node, 'signature', `${head} ${message}`);
  const lists = facts
    .map((f, i) => (f.type.kind === 'list' ? i : -1))
    .filter((i) => i >= 0);
  const cells = facts.map(numericCellsOf);
  for (const i of lists)
    if (cells[i] === undefined)
      return refuse(
        `with the list operand ${nodeText(node.ops[i])} of the type ` +
          `\`${fragmentTypeToString(facts[i].type)}\` is not in the structured route`
      );
  // A product of a list of lists and another list is a matrix product
  // (slice 4): of two operands, each a matrix by its engine type or a list
  // of numbers, `_SYS.mul(A, B)`, as the existing compiler writes it when
  // the types state the ranks (`compileMatrixProduct()`). A `list<list<…>>`
  // operand declines: the existing compiler chooses the product by the
  // shape of the value at run time (`_SYS.matrixProductShape`); the remedy
  // is a `matrix` declaration (a user decision of 2026-11-11).
  if (head === 'Multiply' && lists.length > 1) {
    const i = lists.find((k) => cells[k]!.rank >= 2)!;
    const unsettled = lists.find(
      (k) => cells[k]!.rank >= 2 && !isEngineMatrix(node.ops[k])
    );
    if (unsettled !== undefined)
      return refuse(
        `with the list operand ${nodeText(node.ops[unsettled])} of the type ` +
          `\`${fragmentTypeToString(facts[unsettled].type)}\` is not in the structured route, ` +
          `which reads a product of lists whose types state their ranks: declare ` +
          `${nodeText(node.ops[unsettled])} a matrix`
      );
    if (node.ops.length !== 2 || lists.some((k) => cells[k]!.rank > 2))
      return refuse(
        `with the list operand ${nodeText(node.ops[i])} of the type ` +
          `\`${fragmentTypeToString(facts[i].type)}\` is not in the structured route, ` +
          `which reads a product of two matrices, or of a matrix and a list, with no other factor`
      );
    const ranks = lists.map((k) => cells[k]!.rank);
    return w.valueFacts(
      node,
      numericListType('real', ranks[0] === 2 && ranks[1] === 2 ? 2 : 1),
      facts.map((f) => w.convert(f, f.type)!)
    );
  }
  const rank = cells[lists[0]]!.rank;
  if (lists.some((i) => cells[i]!.rank !== rank))
    return refuse(
      `of the lists ${lists.map((i) => nodeText(node.ops[i])).join(' and ')} of the ` +
        `ranks ${lists.map((i) => cells[i]!.rank).join(' and ')} is not in the ` +
        `structured route, which reads lists of one rank: the existing compiler ` +
        `pairs each element of the list of lower rank with a row`
    );
  for (const [i, f] of facts.entries()) {
    if (f.type.kind === 'list') continue;
    if (f.type.kind !== 'real' && f.type.kind !== 'integer')
      return refuse(
        `of a list of lists and the operand ${nodeText(node.ops[i])} of the type ` +
          `\`${fragmentTypeToString(f.type)}\` is not in the structured route, ` +
          `which applies an operator to the numbers of a list of lists and to real operands`
      );
    const undeclared = undeclaredNames(node.ops[i]).find((name) => {
      const role = w.binding(scope, name.symbol)?.role;
      if (role === 'local' || role === 'index') return false;
      const fact = scope.facts.get(name);
      return !(
        fact !== undefined &&
        'type' in fact &&
        (fact.type.kind === 'real' || fact.type.kind === 'integer')
      );
    });
    if (undeclared !== undefined)
      return refuse(
        `of a list of lists and the operand ${nodeText(node.ops[i])}, which reads ` +
          `the name ${nodeText(undeclared)} with no declared type, is not in the ` +
          `structured route: the existing compiler reads such a name as a possible list`
      );
  }
  if (lists.length > 1) {
    const keys = lists.map((i) =>
      nestedLengthKeys(node.ops[i], scope, context, w)
    );
    if (!keys[0].some((k) => keys.every((other) => other.includes(k))))
      return refuse(
        `of the lists ${lists.map((i) => nodeText(node.ops[i])).join(' and ')}, whose ` +
          `lengths are not equal by construction at every depth, is not in the ` +
          `structured route: the existing compiler gives NaN for two lists of different lengths`
      );
  }
  const integer = facts.every((f, i) =>
    f.type.kind === 'list'
      ? cells[i]!.kind === 'integer'
      : f.type.kind === 'integer'
  );
  const kind = kindOf(integer);
  // A list of lists of booleans is not a value of the structured route.
  if (kind === 'boolean')
    return refuse(
      `of the list of lists ${nodeText(node.ops[lists[0]])} is not in the structured ` +
        `route, which compares the elements of a list of numbers only`
    );
  return w.valueFacts(
    node,
    numericListType(kind, rank),
    facts.map((f) => w.convert(f, f.type)!)
  );
}

/**
 * The keys of the lengths of the list of lists `node` at every depth, typed
 * in `scope`: two lists of lists that share a key have equal lengths at
 * every depth by construction. A read of a name (two reads of one name in
 * one expression read one value, as for `lengthKey()`), an engine type that
 * states every dimension (`matrix<2x2>`, the type of a literal of rows of
 * one length), and an element-wise result (the keys of its list operands,
 * which its rule found equal), except a product of two lists. No other head
 * passes on the keys of an operand: `Transpose` swaps the dimensions, and a
 * `Map` over rows or a matrix function can change them; each has the keys
 * of its engine type only.
 */
function nestedLengthKeys(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): string[] {
  const keys: string[] = [];
  if (isSymbol(node)) keys.push(`name ${node.symbol}`);
  const type = node.type.type;
  if (
    typeof type === 'object' &&
    type.kind === 'list' &&
    type.dimensions !== undefined &&
    type.dimensions !== null &&
    type.dimensions.length >= 2 &&
    type.dimensions.every((d) => d >= 0) &&
    typeof type.elements === 'string'
  )
    keys.push(`dimensions ${type.dimensions.join('x')}`);
  if (
    isFunction(node) &&
    (ELEMENTWISE_HEADS.includes(node.operator) || isBroadcastHead(node)) &&
    isLibraryOperator(node, node.operator)
  ) {
    const lists = node.ops.filter(
      (op) => w.value(op, scope, context).type.kind === 'list'
    );
    // A product of two lists is a matrix product (`_SYS.mul`), whose shape
    // is not the shape of an operand: only the dimensions of its engine
    // type, above, are its keys. The other element-wise heads keep the
    // shape of their list operands, which their rule found equal.
    if (lists.length > 0 && !(node.operator === 'Multiply' && lists.length > 1))
      keys.push(...nestedLengthKeys(lists[0], scope, context, w));
  }
  return keys;
}

/**
 * The rule `rule` of `Sum` or `Product`, with the fold of the rows of a
 * matrix (`Sum(M)`, `Product(M)` of one list of lists): the list of the
 * sums (products) of the rows element by element, as the existing emitter
 * writes it, `(M).reduce((_a, _b) => _SYS.add(_a, _b), 0)`
 * (`foldRows()` in `javascript-structured-lower.ts`). A list of integers
 * when the numbers are integers.
 *
 * Refused: a list of lists that is not a matrix of rank 2 by its engine
 * type, or that can have no row (`hasRows()`): `_SYS.add` of two rows of
 * different lengths is `NaN`, and the sum of the empty list is the number
 * `0`, other shapes than a list
 * (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`, section
 * 7); the remedy is a `matrix` declaration.
 */
function withFoldOfRows(
  rule: FragmentRule<ScalarRepresentation>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      if (!isFoldNode(node) || !isFunction(node))
        return 'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      const [collection] = operandFacts(node, scope, context, w);
      const cells = numericCellsOf(collection);
      if (cells === undefined || cells.rank < 2)
        return 'walk' in rule
          ? rule.walk(node, scope, context, w)
          : w.signatures(node, scope, context, rule.signatures);
      if (cells.rank !== 2 || !isEngineMatrix(node.op1) || !hasRows(node.op1))
        return w.refuse(
          node,
          'signature',
          `${node.operator} of the rows of ${nodeText(node.op1)} of the type ` +
            `${node.op1.type.toString()} is not in the structured route, which folds the ` +
            `rows of a matrix of one row or more by its type (matrix, matrix<m×n>): ` +
            `the existing compiler gives NaN for rows of different lengths and the ` +
            `number 0 for no row`
        );
      return w.valueFacts(node, numericListType(cells.kind, 1), [
        w.convert(collection, collection.type)!,
      ]);
    },
  };
}

/** The symbols with no declared type that `node` reads
 *  (`hasNoDeclaredType()`). */
function undeclaredNames(
  node: Expression,
  seen = new Set<Expression>()
): (Expression & { symbol: string })[] {
  if (seen.has(node)) return [];
  seen.add(node);
  if (isSymbol(node)) return hasNoDeclaredType(node) ? [node] : [];
  if (!isFunction(node)) return [];
  return node.ops.flatMap((op) => undeclaredNames(op, seen));
}

/** `Not`: one boolean operand, a boolean result, written `!x` as the
 *  existing emitter writes it. */
const notRule = {
  walk: (node, scope, context, w) => {
    if (!isFunction(node) || node.nops !== 1)
      return w.refuse(
        node,
        'signature',
        'Not with other than one operand is not in the structured route'
      );
    return w.signatures(node, scope, context, [
      { operands: ['boolean'], result: 'boolean' },
    ]);
  },
} satisfies FragmentRule<ScalarRepresentation>;

/**
 * `Random()`, `Random(Interval(a, b))` and `Random(Range(…))` with literal
 * parameters (`randomDomainOf()`): a real result, an integer one for a
 * `Range`. The domain is not a value: it has no facts and no operation. The
 * lowering writes one draw and the arithmetic of the existing emitter
 * around it (`draw()` in `javascript-structured-lower.ts`). Refused: a
 * domain with a symbol or a list, which the existing emitter draws from at
 * run time (`_SYS.domainInterval`, `_SYS.domainRange`, `_SYS.domainList`),
 * and an empty or unbounded domain, which it refuses at compile time.
 */
const randomRule = {
  walk: (node, _scope, _context, w) => {
    const domain = randomDomainOf(node);
    if (domain === undefined)
      return w.refuse(
        node,
        'signature',
        `${nodeText(node)} is not in the structured route, which admits Random() and Random with a literal Interval or Range: ` +
          `another domain is drawn from at run time (a domain of the runtime, _SYS.domain*)`
      );
    return w.valueFacts(node, {
      kind: domain.kind === 'range' ? 'integer' : 'real',
    });
  },
} satisfies FragmentRule<ScalarRepresentation>;

/**
 * `WithRandomSeed(seed, body)` in the compile mode `mode`: the body
 * evaluated once with a new frame of the random stream, the structured
 * form `seeded` (`IRSeeded`). The seed is a string or a finite real number
 * literal (no facts, no operation: `literalSeedOf()`), or a value with a
 * real or an integer fact, or a complex one in the `complex` mode, which
 * the runtime helper reads as its real part when its imaginary part is 0.
 * The body is a scalar: its facts are the facts of the node, but for the
 * lane of the node. The existing compiler reads the node on the lane of
 * its type (`isComplexValued()`), and its handler writes the body on the
 * lane of the body. For a real body:
 *
 * - In the `strict` mode a type that, without its infinities and `NaN`, is
 *   one of numbers that are not real is the complex lane: the parent reads
 *   the parts of the number that the call gives, `NaN` where the
 *   interpreter has a finite value (`WithRandomSeed(3, ln(x)) + x`, of the
 *   type `complex | signed_infinity`), which the route does not copy:
 *   refused. Every other type is the real lane.
 * - In the `complex` mode a real type (`signed_infinity` too) is the real
 *   lane. A wide type (`number`, a type of numbers that are not real, a
 *   type that holds every complex number: `wideNumericType()`) is the
 *   complex lane, where the handler writes `_SYS.cplx()` around the call
 *   (`WithRandomSeed(42, x^1.6)` has the type `number`): the route converts
 *   the value of the body to complex in the region, the same
 *   `{re, im: 0}`. Another type (`integer | missing`) is refused, as is a
 *   seed that is not real, which the reader of the existing compiler can
 *   also read.
 *
 * Refused also: a seed of another fact (a boolean, a list, a complex one in
 * the `strict` mode), a string seed that is not a literal (the
 * representation has no string values), a body that is a list.
 */
function seededRule(mode: 'strict' | 'complex') {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 2)
        return w.refuse(
          node,
          'signature',
          'WithRandomSeed with other than a seed and a body is not in the structured route'
        );
      const literal = literalSeedOf(node.op1) !== undefined;
      const conversions: FragmentConversion<ScalarRepresentation>[] = [];
      let seedKind: string | undefined;
      if (!literal) {
        const seed = w.value(node.op1, scope, context);
        const kind = seed.type.kind;
        seedKind = kind;
        if (
          kind !== 'real' &&
          kind !== 'integer' &&
          !(kind === 'complex' && mode === 'complex')
        )
          return w.refuse(
            node,
            'signature',
            `WithRandomSeed with the seed ${nodeText(node.op1)} of the type ${kind} is not in the structured route, ` +
              `which admits a real seed, a complex one in the complex mode, and a literal number or string`
          );
        conversions.push(w.convert(seed, seed.type)!);
      }
      const body = w.value(node.op2, scope, context);
      if (body.type.kind === 'list')
        return w.refuse(
          node,
          'signature',
          'WithRandomSeed with a list body is not in the structured route, whose seeded region yields one scalar'
        );
      const type = node.type.type;
      // A body of a type that admits a collection (a name with no declared
      // type gives the type `value`): the existing compiler reads the node
      // element-wise, in `_SYS.bcast()`, with a rational factor of a
      // product as its double, where the route writes the product of the
      // existing infix code (`multiplyByRational()`).
      if (!isSubtype(type, 'number | boolean | missing'))
        return w.refuse(
          node,
          'signature',
          `WithRandomSeed of the type ${typeToString(type)} is not in the structured route: ` +
            `the existing compiler reads a value that is not a number element-wise`
        );
      if (body.type.kind !== 'complex' && mode === 'strict') {
        if (isNonRealNumber(finitePartOfType(type)))
          return w.refuse(
            node,
            'signature',
            `WithRandomSeed of the type ${node.type.toString()} with a real body is not in the structured route: ` +
              `the existing compiler reads the parts of a complex value from the number that the body gives`
          );
      } else if (
        body.type.kind !== 'complex' &&
        body.type.kind !== 'boolean' &&
        !isSubtype(type, 'real')
      ) {
        const wide = isNonRealNumber(type) || isSubtype('complex', type);
        if (!wide || seedKind === 'complex')
          return w.refuse(
            node,
            'signature',
            `WithRandomSeed of the type ${node.type.toString()} with a real body is not in the structured route ` +
              `in the complex mode: the structured route does not read the lane that the existing compiler gives it`
          );
        conversions.push(w.convert(body, { kind: 'complex' })!);
        return w.valueFacts(node, { kind: 'complex' }, conversions);
      }
      conversions.push(w.convert(body, body.type)!);
      return w.valueFacts(node, body.type, conversions);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/**
 * `Typed(value, T)` on the structured route, which the admission admits
 * only around the value of a function body (`executeEpsil()` writes the
 * body of a function `f(…) -> T` as `Block(Typed(value, T))`): the fact of
 * `T`, when the fact of `value` is `T`, or an integer where `T` is `real`,
 * or a list of integers where `T` is a list of reals (the same number, the
 * same array). Any other pair is refused.
 */
function typedRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>,
  mode: 'strict' | 'complex'
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node) || node.nops !== 2)
    return w.refuse(
      node,
      'signature',
      'Typed is in the structured route only as Typed(value, T)'
    );
  const value = w.value(node.op1, scope, context);
  const ascribed = node.type.type;
  // A numeric ascription that `declaredNumberKind()` maps. `number`: the
  // fact of a number value, as the result of a helper declared `number` is
  // the fact of its body; in the `complex` mode the existing emitter makes a
  // real value complex there (`_SYS.cplx({ re: v, im: 0 })`), and the
  // lowering writes no conversion for `Typed`: refused. A union of a real
  // type with `nan` or `signed_infinity` is real.
  const numberKind =
    scalarType(ascribed) === undefined
      ? declaredNumberKind(ascribed, mode)
      : undefined;
  if (
    numberKind !== undefined &&
    !isSubtype(ascribed, REAL_WITH_NON_FINITE_TYPE) &&
    (value.type.kind === 'real' ||
      value.type.kind === 'integer' ||
      value.type.kind === 'complex')
  ) {
    if (mode === 'complex' && value.type.kind !== 'complex')
      return w.refuse(
        node,
        'signature',
        `Typed with the ascribed type \`${typeToString(ascribed)}\` and a ` +
          `value of the type \`${fragmentTypeToString(value.type)}\` is not in ` +
          `the structured route in the \`complex\` mode: the existing compiler ` +
          `makes the value complex`
      );
    return w.valueFacts(node, value.type, [w.convert(value, value.type)!]);
  }
  const type =
    numberKind !== undefined
      ? ({ kind: 'real' } as const)
      : (scalarType(ascribed) ??
        structuredTupleType(ascribed, mode) ??
        structuredListType(ascribed, mode));
  const conversion =
    type === undefined || 'refusal' in type
      ? undefined
      : w.convert(value, type);
  if (
    type === undefined ||
    'refusal' in type ||
    conversion === undefined ||
    conversion.kind !== 'none'
  )
    return w.refuse(
      node,
      'signature',
      `Typed with the ascribed type \`${typeToString(ascribed)}\` and a value of ` +
        `the type \`${fragmentTypeToString(value.type)}\` is not in the structured route`
    );
  return w.valueFacts(node, type, [conversion]);
}

/**
 * The rule `rule` of `operator`, after a refusal of a list operand: the
 * interpreter applies an arithmetic operator or a function of a number to
 * each element of a list (`L + 1` is a list), and compares two lists as
 * values (`Equal(L, M)`); the structured route has neither. Every rule of
 * the structured route but those of `LIST_OPERAND_HEADS` is wrapped.
 */
function withoutListOperands(
  operator: string,
  rule: FragmentRule<ScalarRepresentation>
): Extract<FragmentRule<ScalarRepresentation>, { walk: unknown }> {
  return {
    walk: (node, scope, context, w) => {
      const list = admittedOperands(node).find((operand) => {
        const kind = w.value(operand, scope, context).type.kind;
        return kind === 'list' || kind === 'point';
      });
      if (list !== undefined)
        return w.refuse(
          node,
          'signature',
          `${operator} with the ${w.value(list, scope, context).type.kind === 'point' ? 'tuple' : 'list'} ` +
            `operand ${nodeText(list)} is not in the ` +
            `structured route, which reads a list only with At and Length and ` +
            `passes it whole to a helper`
        );
      return 'walk' in rule
        ? rule.walk(node, scope, context, w)
        : w.signatures(node, scope, context, rule.signatures);
    },
  };
}

/**
 * The message of the refusal of `node` on the structured route, for a
 * `Comprehension` that is not over one `Element(j, Range(a, b))`
 * (`comprehensionRefusal()`), and for an `At` with other than one index, a
 * `Range` index (a slice) or a string index; otherwise `undefined`. The
 * admission checks this before it reads the operands, so that the message
 * names the list operation, and not an operand that the route does not
 * have (`Range`, `Element`, a string).
 */
function structuredListRefusal(node: Expression): string | undefined {
  if (!isFunction(node) || !isLibraryOperator(node, node.operator))
    return undefined;
  const message = comprehensionRefusal(node);
  if (message !== undefined) return message;
  if (node.operator !== 'At') return undefined;
  // Several indexes read a list of lists, one level per index (`atRule()`).
  if (node.nops < 2)
    return 'At with no index is not in the structured route, which reads one index';
  if (node.nops > 2 && !isNestedEngineList(node.op1.type.type))
    return `At with ${node.nops - 1} indexes is not in the structured route, which reads one index of a list that is not a list of lists`;
  for (const index of node.ops.slice(1)) {
    // A `Range` index of a list that is not a list of lists is a gather
    // (`atRule()`).
    if (isFunction(index, 'Range') && node.nops > 2)
      return 'At with a Range index (a slice) is not in the structured route, which reads one integer index';
    if (isString(index))
      return 'At with a string index is not in the structured route, which reads one integer index';
  }
  return undefined;
}

/** Whether the engine type `type` can be a list of lists: a list whose
 *  elements are lists, or a matrix or a tensor of two dimensions or more
 *  (the rule of `At` reads the facts: `atRule()`). */
function isNestedEngineList(type: Type): boolean {
  return (
    typeof type === 'object' &&
    type.kind === 'list' &&
    ((type.dimensions?.length ?? 0) >= 2 || isSubtype(type, 'list<list<any>>'))
  );
}

/**
 * Throw, on the structured route, for a number literal that is an
 * undirected infinity (`ComplexInfinity`) with a real part other than
 * `+Infinity`: the existing compiler writes every such literal `Infinity`
 * (`compileExpr()` in `compiler-core.ts`, the pole-encoding ruling), and the
 * route writes its real part. `Negate(Power(0, -1))` canonicalizes to the
 * literal `-oo - oo·i`, which the route wrote `-Infinity`.
 */
function refuseUndirectedInfinity(
  node: Expression,
  admission: Admission
): void {
  if (
    admission.structured &&
    isNumber(node) &&
    node.isInfinity === true &&
    node.isComplex === true &&
    node.re !== Infinity
  )
    throw new Error(
      `JS scalar fragment: the undirected infinity ${nodeText(node)} with ` +
        `the real part ${node.re} is not in the structured route: the ` +
        `existing compiler writes Infinity`
    );
}

/**
 * Throw, on the structured route, for a function node whose engine type is
 * the value `true` or `false` (`booleanClaim()` in `compile-conditions.ts`):
 * the existing compiler writes that literal in place of the node before any
 * handler (`compileExprBooleanClaim()` in `compiler-core.ts`), and the
 * structured route would write the test. `LessEqual(0, p·q·r)` with `p`,
 * `q`, `r` of the type `real<0..>` has the type `true`. The refusal is
 * wider than that rule, which also asks for a pure node and exempts the
 * heads of control flow.
 */
function refuseBooleanClaim(node: Expression, admission: Admission): void {
  if (!admission.structured || !isFunction(node)) return;
  const t = node.type.type;
  if (
    typeof t === 'object' &&
    t.kind === 'value' &&
    typeof t.value === 'boolean'
  )
    throw new Error(
      `JS scalar fragment: ${nodeText(node)} has the type ${String(t.value)}, ` +
        `and the existing compiler writes the literal ${String(t.value)} in its ` +
        `place: the structured route does not`
    );
}

/**
 * Throw, on the structured route, for a `Haversine` operand of `node` that
 * the existing emitter can write in `node` with another grouping: a factor
 * after the first of a `Multiply`, the divisor of a `Divide`, the operand
 * of a `Negate`. The handler of `Haversine` writes `(1 - Math.cos(t)) / 2`
 * in its parent with no parentheses when the code `t` of its operand is a
 * name or digits (`inlineExpression()`), so that `2 / Haversine(x)` with a
 * parameter `x` is `2 / (1 - Math.cos(x)) / 2`, a quarter of the value
 * (CE-1196). An operand for which `input` is true is a free symbol that both
 * emitters write `_.x`, which the handler binds; every other operand is
 * refused, which is wider than the rule of the handler. The emitter checks
 * the same case (`Source.bare` in `javascript-structured-emit.ts`).
 *
 * The lowering also writes a haversine where the tree does not have it as
 * a direct operand, and these are refused too:
 *
 * - the numerator of a quotient factor after the first of a `Multiply`,
 *   which the lowering reads as a factor of the product
 *   (`realProduct()`): the existing emitter writes `h * (1 - Math.cos(t))
 *   / 2 / x` for `Multiply(h, Divide(Haversine(t), x))`. A numerator that
 *   is a quotient or a product with a haversine is refused in the same
 *   way;
 * - the term of a `Product`, a factor of the product of the terms, and
 *   the term of a `Sum` (a sum of one term is the term);
 * - the value of a `Block` that is an operand, which the lowering writes in
 *   the parent of the block;
 * - the value of a local (`refuseHaversineLocal()`).
 *
 * A read of the host (a `vars` entry that does not read the inputs object)
 * is not an input: the emitter writes its source, not `_.x`.
 */
function refuseHaversineGrouping(
  node: Expression,
  admission: Admission,
  input: (operand: Expression) => boolean
): void {
  if (!admission.structured || !isFunction(node)) return;
  /** A haversine that the existing emitter writes with no parentheses, also
   *  as the value of a block, and as the operand of a `Conjugate` or of a
   *  `Real`, which the lowering writes as its real operand (the form
   *  `identity`; `identityPassthrough()` in the existing emitter): the
   *  emission of `x · Conjugate(Haversine(2y))` failed on the grouping. */
  const value = (op: Expression): Expression =>
    isFunction(op, 'Block') && op.nops > 0
      ? value(op.ops[op.nops - 1])
      : (isFunction(op, 'Conjugate') || isFunction(op, 'Real')) && op.nops === 1
        ? value(op.op1)
        : op;
  const bare = (op: Expression): boolean => {
    const v = value(op);
    return isFunction(v, 'Haversine') && v.nops === 1 && !input(v.op1);
  };
  /** A haversine that the lowering writes as a factor of the product. */
  const numerator = (op: Expression): Expression | undefined => {
    if (bare(op)) return op;
    if (isFunction(op, 'Divide') && op.nops === 2) return numerator(op.op1);
    if (isFunction(op, 'Multiply')) return op.ops.find(bare);
    return undefined;
  };
  const grouped =
    node.operator === 'Multiply'
      ? node.ops.slice(1).filter(bare)
      : node.operator === 'Divide'
        ? node.ops.slice(1).filter(bare)
        : node.operator === 'Negate'
          ? node.ops.filter(bare)
          : [];
  // The terms of a product are the factors of one product (`aggregate()`
  // in `javascript-structured-lower.ts`); a sum of one term is the term,
  // written in the parent of the sum. An index of the aggregate is not an
  // input, also where `input` does not know it yet.
  if (
    (node.operator === 'Product' || node.operator === 'Sum') &&
    isFunction(node.op1, 'Haversine')
  ) {
    const term = node.op1;
    const indexes = node.ops
      .slice(1)
      .flatMap((l) =>
        isFunction(l, 'Limits') && isSymbol(l.op1) ? [l.op1.symbol] : []
      );
    if (bare(term) || (isSymbol(term.op1) && indexes.includes(term.op1.symbol)))
      grouped.push(term);
  }
  const first = grouped[0] && value(grouped[0]);
  if (first !== undefined)
    throw new Error(
      `JS scalar fragment: Haversine of ` +
        `${isFunction(first) ? nodeText(first.op1) : ''} as an operand ` +
        `of ${node.operator} is not in the structured route: the existing ` +
        `emitter writes it in ${node.operator} with no parentheses`
    );
  if (node.operator !== 'Multiply') return;
  for (const op of node.ops.slice(1)) {
    const haversine =
      isFunction(op, 'Divide') && op.nops === 2 ? numerator(op.op1) : undefined;
    if (haversine !== undefined)
      throw new Error(
        `JS scalar fragment: ${nodeText(haversine)} in the numerator of the ` +
          `factor ${nodeText(op)} of a product is not in the structured ` +
          `route: the existing emitter writes it in the product with no ` +
          `parentheses`
      );
  }
}

/**
 * Throw, on the structured route, for a `Haversine` that is the value
 * written to the local `name`: the lowering writes the value of a local
 * where the local is read, where a parent can need parentheses around it
 * (`refuseHaversineGrouping()`), and the existing emitter writes a read of
 * the variable. Refused whatever its operand: wider than the cases where
 * the code differs.
 */
function refuseHaversineLocal(
  value: Expression,
  name: string,
  admission: Admission
): void {
  if (admission.structured && isFunction(value, 'Haversine'))
    throw new Error(
      `JS scalar fragment: the value ${nodeText(value)} of the local ` +
        `${name} is not in the structured route: the existing emitter ` +
        `writes a haversine with no parentheses where its parent needs them`
    );
}

/**
 * Throw, on the structured route in the `complex` mode, for an `At` node
 * whose type is not real (the element of a list that a `Comprehension` of
 * values of the type `number` makes): the existing compiler wraps the read
 * in `_SYS.cplx()` there (`liftWideResult()` in `compile-inner.ts`), and
 * the route reads a number. The refusal is wider than that rule, which
 * also asks whether the node is complex-valued (`isComplexValued()`). The
 * `strict` mode has its own pass, after the admission
 * (`refuseStrictWideReads()`).
 */
function refuseWideRead(
  node: Expression,
  admission: Admission,
  mode: 'strict' | 'complex' | undefined
): void {
  if (
    admission.structured &&
    mode === 'complex' &&
    isFunction(node, 'At') &&
    !isSubtype(finitePartOfType(node.type.type), 'real')
  )
    throw new Error(
      `JS scalar fragment: ${nodeText(node)} has the type ` +
        `${node.type.toString()}, which is not real, in the complex mode: the ` +
        `existing compiler wraps the read in _SYS.cplx`
    );
}

/**
 * Throw, on the structured route in the `strict` mode, for an admitted `At`
 * node of a numeric type that is not real (`At(Comprehension(√y, …), 2)`
 * has the type `complex`): the existing compiler reads the element with the
 * type tag of the node (`_SYS.atNumeric(l, i, "complex")`, which gives a
 * number) and its parent as a complex value, so `x · At(…)` is
 * `{re: NaN, im: NaN}` also where `y = 4`, and `Arcsch` of such a read calls
 * `_SYS.cacsch` of a number. A pass over the admitted program, so that the
 * refusal of a list that the route does not have (a comprehension of complex
 * numbers, `ReplaceAt` with a complex value) keeps its message. A read of
 * a tuple whose element types are `number` (`tuple<number, number>`, the
 * element of a declared `list<tuple<number, number>>`) is real in the
 * `strict` mode (`structuredTupleType()`), and is not refused; nor is a
 * read of the type `number` whose type is wide only because it reads
 * values of the type `number` (`isWideRealInStrict()`: `At(L, i)` with
 * `L: list<number>`, which the existing compiler reads as a number).
 */
/**
 * Throw, on the structured route in the `complex` mode, for an element-wise
 * `Divide` with a list operand whose engine element type is not real
 * (`1.5 / [cn for j in 3..2]` with `cn: number` assigned `1.5`, of the type
 * `list<number>`): the existing compiler divides each element with the
 * complex quotient (`_SYS.cplx(_tv2)`), whose result is `{re, im}`, where the
 * route divides the real numbers of its facts. A sum, a product and a
 * negation of such a list keep the numbers on both, and so does a quotient
 * by a list literal.
 */
function refuseComplexListQuotients(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  mode: 'strict' | 'complex' | undefined
): void {
  if (mode !== 'complex') return;
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const [node, facts] of scope.facts)
      if (
        isFunction(node, 'Divide') &&
        facts.type.kind === 'list' &&
        node.ops.some((op) => {
          // A list literal: the existing emitter divides by its elements
          // one by one, on the lane of each.
          if (isFunction(op, 'List')) return false;
          const element = indexElementType(op.type.type);
          return (
            op.type.type !== undefined &&
            isSubtype(op.type.type, 'list') &&
            element !== undefined &&
            !isSubtype(element, 'real')
          );
        })
      )
        throw new Error(
          `JS scalar fragment: the quotient ${nodeText(node)} of a list of the type ` +
            `${node.type.toString()} is not in the structured route in the complex mode: ` +
            `the existing compiler divides each element on the complex lane`
        );
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * On the structured route, refuse an element-wise node whose list operand
 * the existing compiler reads on the complex lane: an operand whose element
 * lane (`operandElementLane()` of the existing compiler, `compile-lanes.ts`)
 * is complex or mixed, so that `_SYS.bcast` applies the complex code of the
 * head to each element (`Arctan(C)` with `C = [√k for k in 1..n]`, of the
 * engine type `list<complex>`, is `_SYS.catan` of each element; `1 / C`
 * divides on the complex lane). The element-wise nodes are those of
 * `elementwiseRule()` (arithmetic of a list), of `broadcastRule()` and of
 * `selectionBroadcastRule()` (`forms`). The lane is that of the existing
 * compiler's own test, asked of the prepared target `target`.
 */
function refuseComplexElementLanes(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  forms: ReadonlyMap<Expression, StructuredForm>,
  target: CompileTarget<Expression>
): void {
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const [node, facts] of scope.facts) {
      if (!isFunction(node)) continue;
      const form = forms.get(node);
      const elementwise =
        (typeof form === 'object' && 'broadcast' in form) ||
        form === 'elementwise-selection' ||
        (ELEMENTWISE_HEADS.includes(node.operator) &&
          facts.type.kind === 'list') ||
        isElementCall(node, scope, annotation);
      if (!elementwise) continue;
      for (const op of node.ops) {
        if (scope.facts.get(op)?.type.kind !== 'list') continue;
        let lane: boolean | 'mixed' | undefined;
        try {
          lane = core.operandElementLane(op, op.engine, target);
        } catch {
          lane = undefined;
        }
        if (lane !== false)
          throw new Error(
            `JS scalar fragment: ${node.operator} of the list ${nodeText(op)} is not ` +
              `in the structured route: its type ${op.type.toString()} is not real, ` +
              `and the existing compiler applies the complex code of the head to ` +
              `each element`
          );
      }
    }
    for (const inner of scope.inner.values()) visit(inner);
  };
  withAnalysisMemo(() => {
    visit(annotation.scope);
    for (const fn of annotation.functions.values()) visit(fn.scope);
  });
}

/**
 * Run `analyze`, which asks the analyses of the existing compiler
 * (`operandElementLane()`, `isComplexValued()`), with the memo that these
 * analyses keep in a compilation: they remember the answer of each function
 * node only when `CompilerState._compileDepth` is above 0, and the route
 * asks them at depth 0, where a subtree reached on several paths is
 * analyzed once per path (exponential in the depth of the sharing). The
 * memo is a fresh layer of each stack, dropped after `analyze`: the engine
 * values that the answers read do not change while it runs, and no answer
 * outlives it. The depth is read by the entries of a compilation
 * (`compileExpression()`), which these analyses do not call.
 */
function withAnalysisMemo<T>(analyze: () => T): T {
  const complex = CompilerState._complexMemoStack;
  const complexDepth = complex.length;
  const lanes = CompilerState._elementLaneMemoStack;
  const lanesDepth = lanes.length;
  complex.push(new WeakMap());
  lanes.push(new WeakMap());
  CompilerState._compileDepth += 1;
  try {
    return analyze();
  } finally {
    CompilerState._compileDepth -= 1;
    CompilerState._complexMemoStack = complex;
    complex.length = complexDepth;
    CompilerState._elementLaneMemoStack = lanes;
    lanes.length = lanesDepth;
  }
}

/** Whether `node`, typed in `scope`, is a call of a helper applied to each
 *  element of a list argument (`mapsListArguments` of the structured
 *  definition): an argument whose fact is a list at a parameter whose type
 *  is not a list. */
function isElementCall(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  annotation: FragmentAnnotation<ScalarRepresentation>
): boolean {
  if (!isFunction(node)) return false;
  const type = annotation.functions.get(node.operator)?.type;
  if (type?.kind !== 'function') return false;
  return node.ops.some(
    (op, i) =>
      type.parameters[i] !== undefined &&
      type.parameters[i].type.kind !== 'list' &&
      scope.facts.get(op)?.type.kind === 'list'
  );
}

/** The names of the free symbols that are reads of the host (a `vars`
 *  entry): each read of such a name can give another value. */
function hostReadNames(registry: StructuredRegistry): ReadonlySet<string> {
  return new Set(
    [...(registry.hosts?.bindings.values() ?? [])]
      .filter((binding) => binding.form === 'read')
      .map((binding) => binding.name)
  );
}

/**
 * On the structured route, refuse an element-wise node of two lists or more
 * whose length key (`lengthKey()`, `nestedLengthKeys()`) reads a name that
 * is a read of the host (`hostReads`, a `vars` entry): each read can give
 * another value, so two lists of one key text can have different lengths
 * (`Hypot([k for k in 1..n], [2k for k in 1..n])` with `n` read from the
 * host: the existing compiler gives `NaN` where the lengths differ). A key
 * reads a name of a list operand at any depth; a scalar operand evaluated
 * once does not matter, but the rule refuses any read of the host in a list
 * operand: a simple rule that declines more than it needs to. A `Sum` or a
 * `Product` whose body is a list and reads the host is refused too: each
 * term reads it again.
 */
function refuseUnstableLengthKeys(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  forms: ReadonlyMap<Expression, StructuredForm>,
  hostReads: ReadonlySet<string>
): void {
  if (hostReads.size === 0) return;
  const readsHost = (e: Expression, seen = new Set<Expression>()): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e)) return hostReads.has(e.symbol);
    return isFunction(e) && e.ops.some((op) => readsHost(op, seen));
  };
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const [node, facts] of scope.facts) {
      if (!isFunction(node)) continue;
      // A `Sum` or a `Product` of a list body (`listAggregateFacts()`)
      // evaluates the body once per term: each term reads the host again.
      if (
        (node.operator === 'Sum' || node.operator === 'Product') &&
        node.nops >= 2 &&
        facts.type.kind === 'list' &&
        readsHost(node.ops[0])
      )
        throw new Error(
          `JS scalar fragment: ${node.operator} whose body ${nodeText(node.ops[0])} ` +
            `is a list is not in the structured route: the body reads a value of ` +
            `the host, which can change between two terms, so the terms do not ` +
            `have one length by construction`
        );
      const form = forms.get(node);
      const elementwise =
        (typeof form === 'object' && 'broadcast' in form) ||
        form === 'elementwise-selection' ||
        (ELEMENTWISE_HEADS.includes(node.operator) &&
          facts.type.kind === 'list') ||
        isElementCall(node, scope, annotation);
      if (!elementwise) continue;
      const lists = node.ops.filter(
        (op) => scope.facts.get(op)?.type.kind === 'list'
      );
      if (lists.length < 2) continue;
      const host = lists.find((op) => readsHost(op));
      if (host !== undefined)
        throw new Error(
          `JS scalar fragment: ${node.operator} of the lists ` +
            `${lists.map((op) => nodeText(op)).join(' and ')} is not in the ` +
            `structured route: the list ${nodeText(host)} reads a value of the ` +
            `host, which can change between two reads, so the lengths are not ` +
            `equal by construction`
        );
    }
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * Whether the node `node` of the engine type `number` (or a union of it with
 * `NaN` and infinities) is real in the `strict` mode as the existing compiler
 * reads it: its type is wide only because it reads names, elements or
 * values of the type `number`, which are real there ("In `strict`, a value
 * of type `number` must be real"), as in `L + 1` or `At(L, i)` with
 * `L: list<number>`, whose fold the existing compiler writes with `+`
 * (`(L).reduce((_a, _b) => _a + _b, 0)`) and whose element it reads as a
 * number (`_SYS.atNumeric(L, i, "number")`).
 *
 * `false` when a node of the subtree has a type of numbers that are not
 * real (`Sqrt(x)` with `x: real` has the type `complex`), or makes a
 * type that is not real from operands that are real or lists of reals
 * (`Arcsin(p)` with `p: real<0..>`, `I / 2.5` with `I: list<real>`): the
 * existing compiler can read such a node on the complex lane
 * (`isComplexValued()`: `Sum(L + Arcsin(p))` is
 * `_SYS.cplx((…).reduce(_SYS.sadd, 0))`), and the structured route does not
 * copy that analysis. A simple rule that declines more than it needs to.
 */
function isWideRealInStrict(node: Expression): boolean {
  const seen = new Set<Expression>();
  const isRealValued = (e: Expression): boolean => {
    const t = e.type.type;
    if (isSubtype(t, 'boolean')) return true;
    if (isSubtype(finitePartOfType(t), 'real')) return true;
    const element = indexElementType(t);
    return (
      isSubtype(t, 'collection<any>') &&
      element !== undefined &&
      isSubtype(finitePartOfType(element), 'real')
    );
  };
  const visit = (e: Expression): boolean => {
    if (seen.has(e)) return true;
    seen.add(e);
    const t = e.type.type;
    const element = isSubtype(t, 'collection<any>')
      ? indexElementType(t)
      : undefined;
    if (
      isNonRealNumber(finitePartOfType(t)) ||
      (element !== undefined && isNonRealNumber(finitePartOfType(element)))
    )
      return false;
    if (!isFunction(e)) return true;
    const numeric =
      isSubtype(t, 'number') ||
      (element !== undefined && isSubtype(element, 'number'));
    if (numeric && !isRealValued(e) && e.nops > 0 && e.ops.every(isRealValued))
      return false;
    return e.ops.every(visit);
  };
  return visit(node);
}

function refuseStrictWideReads(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  mode: 'strict' | 'complex' | undefined
): void {
  if (mode === 'complex') return;
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys())
      if (
        isFunction(node, 'At') &&
        isSubtype(node.type.type, 'number') &&
        !isSubtype(finitePartOfType(node.type.type), 'real') &&
        structuredTupleType(node.op1.type.type, 'strict') === undefined &&
        !isWideRealInStrict(node)
      )
        throw new Error(
          `JS scalar fragment: ${nodeText(node)} has the type ` +
            `${node.type.toString()}, which is not real: the existing ` +
            `compiler reads it as a complex value`
        );
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * On the structured route, refuse every use of a list of booleans (the value
 * of an element-wise comparison or connective, `broadcastRule()`) but the
 * uses that slice 2 of the broadcast note admits: the list operand of `At`
 * and of `Length`, an operand of an element-wise `Not`, `And` or `Or`, a
 * condition of an element-wise `If` or `Which` (`selectionBroadcastRule()`),
 * and the value of the program (the root, through a `Block` and a
 * `Typed`). The default refuses, as `withoutNestedOperands()` does for a
 * list of lists, so that no rule written for a list of numbers admits a
 * list of booleans by accident: a local, a parameter or an argument of a
 * helper, the value of a helper, an arm of a selection, an operand of
 * another head. An input, a parameter and a local of the type
 * `list<boolean>` are refused where the route types them
 * (`structuredListType()`).
 */
function refuseBooleanListUses(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  forms: ReadonlyMap<Expression, StructuredForm>
): void {
  const booleanLists = new Set<Expression>();
  const collect = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const [node, facts] of scope.facts)
      if ('representation' in facts && isBooleanList(facts))
        booleanLists.add(node);
    for (const inner of scope.inner.values()) collect(inner);
  };
  collect(annotation.scope);
  for (const fn of annotation.functions.values()) collect(fn.scope);
  if (booleanLists.size === 0) return;
  /** Whether `parent` reads its operand at `index`, a list of booleans,
   *  as the slice admits. */
  const admits = (parent: Expression, index: number): boolean => {
    if (!isFunction(parent)) return false;
    const form = forms.get(parent);
    switch (parent.operator) {
      case 'At':
      case 'Length':
        return index === 0;
      case 'Not':
      case 'And':
      case 'Or':
        return typeof form === 'object' && 'broadcast' in form;
      case 'If':
        return form === 'elementwise-selection' && index === 0;
      case 'Which':
        return form === 'elementwise-selection' && index % 2 === 0;
      default:
        return false;
    }
  };
  const seen = new Set<Expression>();
  const visit = (node: Expression, value: boolean): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    node.ops.forEach((op, i) => {
      // The value of a `Block` is its last statement, of a `Typed` its
      // operand.
      const passes =
        value &&
        ((node.operator === 'Block' && i === node.ops.length - 1) ||
          (node.operator === 'Typed' && i === 0));
      if (booleanLists.has(op) && !passes && !admits(node, i))
        throw new Error(
          `JS scalar fragment: the list of booleans ${nodeText(op)} is an operand of ` +
            `${node.operator}, which is not in the structured route: a list of booleans ` +
            `is read by At, Length, an element-wise Not, And or Or and the condition of an ` +
            `element-wise If or Which, and is the value of the program`
        );
      visit(op, passes);
    });
  };
  visit(annotation.root, true);
  for (const fn of annotation.functions.values()) {
    if (booleanLists.has(fn.body))
      throw new Error(
        `JS scalar fragment: the list of booleans ${nodeText(fn.body)} is the value of a ` +
          `helper, which is not in the structured route`
      );
    visit(fn.body, false);
  }
}

/**
 * On the structured route, refuse two uses of a call of a local function
 * (`LocalFunction`, declared `function`, `unknown` or with a `let`), which
 * the existing compiler writes in another form:
 *
 * - A `Multiply`, a `Divide` or a `Power` with an operand that is an
 *   arithmetic expression of such a call: the type of the call is
 *   `unknown`, which the existing compiler reads as a possible list
 *   (`mayBeCollectionValued()`), and it writes each operation of the call by
 *   its shape at run time (`_SYS.bcast`), the operand as one value. The
 *   route writes a product or a quotient of products and quotients as one
 *   chain of `*` and `/`, so `x · (-1/3) / lf(1)` is
 *   `x * -1 / (3 * lf(1))` there and `x * (-1 / (3 * lf(1)))` on the
 *   existing compiler, another double. An operation whose operands are the
 *   call itself and other values (`2 · lf(x)`, `lf(x)^2`) is the same
 *   operation in the closure of `_SYS.bcast`, and so are a sum and a
 *   negation.
 * - In the `strict` mode, a call whose value is complex (a local function
 *   whose body is complex, `lf(v) ≔ 0.5 − i`): the existing compiler reads
 *   the value of the call as a real number, and gives `NaN` (`Math.tanh` of
 *   the object, `-lf(1)`) or a string (`x + lf(1)`).
 */
function refuseLocalFunctionArithmetic(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  localFunctions: ReadonlySet<string>,
  mode: 'strict' | 'complex' | undefined
): void {
  if (localFunctions.size === 0) return;
  const isCall = (node: Expression): boolean =>
    isFunction(node) && localFunctions.has(node.operator);
  // The answer of each node object, so a shared subtree is walked once.
  const callReads = new Map<Expression, boolean>();
  const readsCall = (node: Expression): boolean => {
    if (isCall(node)) return true;
    if (!isFunction(node)) return false;
    let found = callReads.get(node);
    if (found === undefined) {
      found = node.ops.some(readsCall);
      callReads.set(node, found);
    }
    return found;
  };
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const [node, facts] of scope.facts) {
      if (
        mode !== 'complex' &&
        isCall(node) &&
        'representation' in facts &&
        facts.representation === 'complex'
      )
        throw new Error(
          `JS scalar fragment: the call ${nodeText(node)} of a local function has a ` +
            `complex value, which is not in the structured route in the strict mode: the ` +
            `existing compiler reads the value of the call as a real number`
        );
      if (
        !isFunction(node, 'Multiply') &&
        !isFunction(node, 'Divide') &&
        !isFunction(node, 'Power')
      )
        continue;
      const operand = node.ops.find(
        (op) => !isCall(op) && isFunction(op) && readsCall(op)
      );
      if (operand !== undefined)
        throw new Error(
          `JS scalar fragment: ${node.operator} of the operand ${nodeText(operand)}, which ` +
            `reads a call of a local function, is not in the structured route: the ` +
            `existing compiler reads the call as a possible list and writes the ` +
            `operand as one value (_SYS.bcast)`
        );
    }
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * On the structured route, refuse a fold (`isFoldNode()`) that the existing
 * compiler writes in another form:
 *
 * - In the `complex` mode, the fold of a local (`isLocal`): the existing
 *   compiler reads the local with `_SYS.cplx` and wraps the fold in it.
 * - The fold of another operand than a name whose type is not real
 *   (`Sum(I/2.5)` has the type `number`): the existing compiler wraps the
 *   fold in `_SYS.cplx` in the `complex` mode, and in both modes when an
 *   element is complex valued (`Product(I·√x)`). In the `complex` mode, a
 *   `Sum` or a `Product` of such an operand is also refused when its type
 *   has `NaN` or an infinity (`Sum(L + ex)` with `ex` of the type
 *   `nan | real | signed_infinity`) or when the operand reads a local.
 *   In the `strict` mode an operand whose type is wide only because it
 *   reads values of the type `number` (`isWideRealInStrict()`: `Sum(L + 1)`
 *   with `L: list<number>`) is folded with `+` on both, and is admitted.
 */
function refuseUnsettledFold(
  node: Expression,
  admission: Admission,
  mode: 'strict' | 'complex' | undefined,
  isLocal: (name: string) => boolean
): void {
  if (!admission.structured || !isFoldNode(node) || !isFunction(node)) return;
  const operand = node.op1;
  const refuse = (cause: string) => {
    throw new Error(
      `JS scalar fragment: ${node.operator} of ${nodeText(operand)} is not in the ` +
        `structured route: ${cause}`
    );
  };
  if (isSymbol(operand)) {
    if (mode === 'complex' && isLocal(operand.symbol))
      refuse(
        'in the complex mode the existing compiler reads a local list with _SYS.cplx'
      );
    return;
  }
  if (
    mode === 'complex' &&
    (node.operator === 'Sum' || node.operator === 'Product')
  ) {
    if (!isSubtype(node.type.type, 'real'))
      refuse(
        `its type ${node.type.toString()} is not real in the complex mode, and the ` +
          `existing compiler wraps the fold in _SYS.cplx`
      );
    const seen = new Set<Expression>();
    const reads = (e: Expression): boolean => {
      if (seen.has(e)) return false;
      seen.add(e);
      return isSymbol(e)
        ? isLocal(e.symbol)
        : isFunction(e) && e.ops.some(reads);
    };
    if (reads(operand))
      refuse(
        'in the complex mode the existing compiler reads a local list with _SYS.cplx'
      );
  }
  if (
    !isSubtype(finitePartOfType(node.type.type), 'real') &&
    !(mode === 'strict' && isWideRealInStrict(operand))
  )
    refuse(
      `its type ${node.type.toString()} is not real, and the existing compiler ` +
        `wraps the fold in _SYS.cplx`
    );
}

/**
 * On the structured route, refuse a function of lists or a head with a
 * function operand (slices 2 and 3) whose list operand the existing
 * compiler reads on the complex lane, or whose inner product it writes in
 * another form:
 *
 * - An element of a type of numbers that are not real (both modes).
 * - In the `complex` mode, a list operand that reads a local (the existing
 *   compiler reads it with `_SYS.cplx(R)`: `First(R)` is `{ re, im }`,
 *   `Mean(R)` is `_SYS.cmean`, `Dot(R, R)` is `_SYS.complexMatmul`), and a
 *   list operand other than a name whose element type is not a subtype of
 *   `real` (`Last(L·g)` is `_SYS.cplx(_SYS.at(…))` for a `g` of no declared
 *   type, `Scan([ex, 1, 2], Add)` adds complex values when `ex` can be
 *   `NaN`).
 * - `Dot` of a list whose width its type states (`staticCollectionWidth()`:
 *   the existing compiler writes the sum of the products of two such
 *   lists, which differs from `_SYS.matmul` in the sign of a zero), or of
 *   operands on the complex lane (`linearAlgebraLane()`).
 */
function refuseUnsettledCollection(
  node: Expression,
  admission: Admission,
  mode: 'strict' | 'complex' | undefined,
  isLocal: (name: string) => boolean
): void {
  if (!admission.structured || !isFunction(node)) return;
  const head = node.operator;
  if (admission.testOperations.has(head)) return;
  let operands: readonly Expression[];
  if (
    Object.hasOwn(FUNCTION_OPERAND_HEADS, head) &&
    !(head === 'Count' && node.nops === 1)
  ) {
    if (head === 'Apply' || head === 'Tabulate') return;
    operands = head === 'Map' ? node.ops.slice(1) : [node.op1];
  } else if (Object.hasOwn(COLLECTION_HEADS, head) && head !== 'Range')
    operands =
      head === 'Take' ||
      head === 'Drop' ||
      head === 'RotateLeft' ||
      head === 'RotateRight'
        ? [node.op1]
        : node.ops;
  else return;
  const refuse = (operand: Expression, cause: string): never => {
    throw new Error(
      `JS scalar fragment: ${head} of ${nodeText(operand)} is not in the structured route: ${cause}`
    );
  };
  const seen = new Set<Expression>();
  const readsLocal = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    return isSymbol(e)
      ? isLocal(e.symbol)
      : isFunction(e) && e.ops.some(readsLocal);
  };
  for (const operand of operands) {
    const t = operand.type.type;
    const elements: readonly Type[] =
      typeof t !== 'string' && t.kind === 'tuple'
        ? t.elements.map((el) => el.type)
        : [indexElementType(t) ?? t];
    if (elements.some((el) => isNonRealNumber(finitePartOfType(el))))
      refuse(operand, 'its elements are numbers that are not real');
    if (mode === 'complex') {
      seen.clear();
      if (readsLocal(operand))
        refuse(
          operand,
          'in the complex mode the existing compiler reads a local list with _SYS.cplx'
        );
      if (!isSymbol(operand) && elements.some((el) => !isSubtype(el, 'real')))
        refuse(
          operand,
          `in the complex mode the existing compiler reads elements of the type ` +
            `${operand.type.toString()} on the complex lane`
        );
    }
  }
  if (head === 'Dot') {
    const isTupleType = (a: Expression) => {
      const t = a.type.type;
      return typeof t !== 'string' && t.kind === 'tuple';
    };
    // With a list of lists (a matrix) as an operand, the existing compiler
    // calls `_SYS.matmul` whatever the widths (`compileStaticInnerProduct()`
    // reads two lists of one stated width only).
    if (
      !node.ops.some((a) => isNestedEngineList(a.type.type)) &&
      node.ops.some(
        (a) => !isTupleType(a) && staticCollectionWidth(a) !== undefined
      )
    )
      refuse(
        node.op1,
        'the existing compiler writes the inner product of lists of a width ' +
          'that their type states as the sum of the products'
      );
    if (linearAlgebraLane(node.ops) === 'complex')
      refuse(
        node.op1,
        'the existing compiler computes the inner product on the complex lane'
      );
  }
}

/**
 * On the structured route, refuse a `Sum` of a list literal with an element
 * that is a sum, and a `Product` or a `Reduce` by `Multiply` of a list literal
 * with an element that is a product (`Reduce([y, u·x], Multiply, 1)` is
 * `y * _.u * _.x` there), in the expression before its preparation: the preparation
 * of the existing compiler writes `Sum([2, x - 0.1])` as the sum
 * `Add(2, Add(x, -0.1))`, whose terms the existing emitter writes as one sum
 * from left to right (`2 + _.x + -0.1`); the route would add the nested sum
 * first. A sum of a list literal of other elements is a sum of its elements
 * on both.
 *
 * In an angular unit other than radians, an inverse trigonometric function
 * is a product too: the existing compiler writes `Arcsin(0.5)` as
 * `57.29577951308232 * Math.asin(0.5)`, so that `Product([p, Arcsin(0.5)])`
 * is `_.p * 57.29577951308232 * Math.asin(0.5)` there, a product in
 * another order.
 *
 * In the body of a helper (`helperBody`), the existing compiler also writes
 * the element of an element-wise sum of a list literal and other operands
 * as one sum, in an order of its own: `([1, 2] + (x - 0.1))[2]` is
 * `2 + x + -0.1` there, and `([1, 2] + x + 0.1)[2]` differs in the last
 * bit at `x = -0.7`. Every `At` of an element-wise sum or product of a list
 * literal is refused there.
 */
function refuseSumOfNestedSums(expr: Expression, helperBody = false): void {
  // A node reached on several paths is visited once.
  const seen = new Set<Expression>();
  /** Whether the existing emitter writes `element` as a chain of
   *  `operation` (an inverse trigonometric function in degrees is a
   *  product). */
  const chains = (element: Expression, operation: string): boolean =>
    isFunction(element, operation) ||
    (operation === 'Multiply' &&
      isFunction(element) &&
      INVERSE_TRIG_OPERATORS.has(element.operator) &&
      element.engine.angularUnit !== 'rad');
  /** The head of the first element of a list operand of `node` that
   *  `chains()` finds. */
  const elementHead = (node: Expression): string => {
    for (const list of isFunction(node) ? node.ops : [])
      for (const op of isFunction(list, 'List') ? list.ops : [])
        if (chains(op, node.operator)) return op.operator;
    return node.operator;
  };
  const visit = (node: Expression): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    // The operation of the fold: `Sum` and `Product` of one list, and
    // `Reduce` of a list by `Add` or `Multiply` (the canonical form of
    // `Product` of a list literal).
    const operation =
      node.nops === 1 && isLibraryOperator(node, node.operator)
        ? { Sum: 'Add', Product: 'Multiply' }[node.operator]
        : isFunction(node, 'Reduce') && isSymbol(node.op2)
          ? { Add: 'Add', Multiply: 'Multiply' }[node.op2.symbol]
          : undefined;
    // `At(y·[1, 7x], 2)`: the preparation reads the element of the
    // element-wise product, `Multiply(y, Multiply(7, x))`, which the existing
    // emitter writes `_.y * 7 * _.x`.
    if (
      isFunction(node, 'At') &&
      isFunction(node.op1) &&
      (node.op1.operator === 'Add' || node.op1.operator === 'Multiply') &&
      node.op1.ops.some(
        (list) =>
          isFunction(list, 'List') &&
          (helperBody || list.ops.some((op) => chains(op, node.op1.operator)))
      )
    )
      throw new Error(
        helperBody
          ? `JS scalar fragment: At of ${nodeText(node.op1)}, an element-wise ` +
              `${node.op1.operator} of a list literal in the body of a helper, ` +
              `is not in the structured route: the existing compiler writes the ` +
              `element as one ${node.op1.operator === 'Add' ? 'sum' : 'product'} ` +
              `in an order of its own`
          : `JS scalar fragment: At of ${nodeText(node.op1)}, an element-wise ` +
              `${node.op1.operator} of a list literal with an element of the head ` +
              `${elementHead(node.op1)}, is not in the structured route: the existing emitter ` +
              `writes the operations of the element as one chain from left to right`
      );
    if (
      operation !== undefined &&
      isFunction(node.op1, 'List') &&
      node.op1.ops.some((op) => chains(op, operation))
    )
      throw new Error(
        `JS scalar fragment: ${node.operator} of the list literal ${nodeText(node.op1)} with ` +
          `an element of the head ${node.op1.ops.find((op) => chains(op, operation))!.operator} ` +
          `is not in the structured route: the ` +
          `existing emitter writes the operations of the elements as one chain from ` +
          `left to right`
      );
    node.ops.forEach(visit);
  };
  visit(expr);
}

/**
 * On the structured route, refuse a broadcastable operation (not a
 * comparison or a connective) with an operand whose
 * type admits a list and a number (`mayHoldList()`): a call of a user
 * function with a list argument (`fm(L)` with the signature
 * `(list<real>) -> real` has the type `list<any> | real`, since a call can
 * be applied to each element of a list), or an expression of one. The
 * existing compiler reads the operand as a possible list and writes the
 * operation by its shape at run time (`_SYS.bcast`): a product or a
 * quotient is then not one chain of `*` and `/` (`10 * (2 / f(L))`), and in
 * the `complex` mode each operation is complex. A comparison of such an
 * operand is scalar code (`flips(B, k, p) > 0`).
 */
function refuseMixedOperand(
  node: Expression,
  admission: Admission,
  mode: 'strict' | 'complex' | undefined
): void {
  if (
    !admission.structured ||
    !isFunction(node) ||
    !isLibraryOperator(node, node.operator) ||
    (node.operatorDefinition as { broadcastable?: boolean } | undefined)
      ?.broadcastable !== true ||
    MIXED_SCALAR_HEADS.has(node.operator)
  )
    return;
  // In the `strict` mode a sum or a negation of real operands is the same
  // `+` or `-` in the closure of `_SYS.bcast`; a complex one is not (the
  // closure adds the real part of a complex literal that the route drops).
  if (
    mode !== 'complex' &&
    ['Add', 'Subtract', 'Negate'].includes(node.operator) &&
    node.ops.every(
      (op) =>
        !isSubtype(op.type.type, 'number') ||
        isSubtype(finitePartOfType(op.type.type), 'real')
    )
  )
    return;
  // An expression of such an operand can have the type `any`
  // (`-f(L)/x`), which the existing compiler reads as a possible list too.
  // The type comes from a list or a tuple that the operand reads (a list
  // argument of a call); a call of a local function of scalar arguments,
  // whose type the engine leaves `unknown`, is scalar code on both.
  const mixed = node.ops.find(
    (op) =>
      (mayHoldList(op.type) ||
        (isFunction(op) &&
          (op.type.type === 'any' || op.type.type === 'unknown'))) &&
      readsCollection(op)
  );
  if (mixed === undefined) return;
  throw new Error(
    `JS scalar fragment: ${node.operator} of the operand ${nodeText(mixed)} of the ` +
      `type ${mixed.type.toString()}, which admits a list and a number, is not in ` +
      `the structured route: the existing compiler reads the operand as a possible list`
  );
}

/** The broadcastable heads whose operation of a possible list is scalar
 *  code on the existing compiler: the comparisons and the connectives
 *  (`flips(B, k, p) > 0`). */
const MIXED_SCALAR_HEADS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'And',
  'Or',
  'Not',
]);

/** Whether `node` has an operand, at any depth, whose type is a list or a
 *  tuple. */
function readsCollection(node: Expression): boolean {
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (!isFunction(e) || seen.has(e)) return false;
    seen.add(e);
    return e.ops.some((op) => op.type.matches('collection<any>') || visit(op));
  };
  return visit(node);
}

/** Whether the type `type` admits a list and a number: it is not numeric,
 *  boolean or a collection, and it names a collection type
 *  (`list<any> | real`). */
function mayHoldList(type: Expression['type']): boolean {
  return (
    !isSubtype(type.type, 'number') &&
    !isSubtype(type.type, 'boolean') &&
    !isSubtype(type.type, 'collection<any>') &&
    /\b(list|tuple|vector|matrix|tensor|collection)\b/.test(type.toString())
  );
}

/** Throw the refusal of `node` (`structuredListRefusal()`) on the
 *  structured route. */
function refuseListHead(node: Expression, admission: Admission): void {
  if (!admission.structured) return;
  const message = structuredListRefusal(node);
  if (message !== undefined) throw new Error(`JS scalar fragment: ${message}`);
}

/**
 * What a route admits. The existing route keeps the definition, the heads
 * and the messages that it had before the structured route existed.
 */
type Admission = {
  readonly structured: boolean;
  readonly definition: FragmentDefinition<ScalarRepresentation>;
  /** The heads that a bound body or a helper body admits as operators. */
  readonly heads: ReadonlySet<string>;
  /** The heads of the operation that exists only for tests, with the trace
   *  id of each (structured route only). */
  readonly testOperations: ReadonlyMap<string, string>;
};

const EXISTING_ADMISSION: Admission = {
  structured: false,
  definition,
  heads: new Set(['Add', 'Negate', 'If']),
  testOperations: new Map(),
};

function structuredAdmission(
  testOperations: ReadonlyMap<string, string>
): Admission {
  // A test head reads real operands and has a real value. Its effect fact
  // comes from its declaration, as for any other head.
  const rules = { ...structuredRules };
  for (const name of testOperations.keys())
    rules[name] = {
      signatures: [{ operands: [], rest: 'real', result: 'real' }],
    };
  // A list is an operand of `At`, `Length`, `ReplaceAt`, `Typed`, a
  // helper call and the branches of an `If` only. The rules of `Loop` and
  // `Comprehension` read no list operand: a body that reads one is typed by
  // the rule of its own head.
  // A list of lists is an operand of the heads of `NESTED_OPERAND_HEADS`
  // only (`withoutNestedOperands()`); the element-wise heads read one
  // themselves (`nestedElementwise()`).
  for (const [name, rule] of Object.entries(rules))
    if (testOperations.has(name)) rules[name] = withoutListOperands(name, rule);
    else if (ELEMENTWISE_HEADS.includes(name))
      rules[name] = elementwiseRule(name, rule);
    else if (!LIST_OPERAND_HEADS.includes(name))
      rules[name] = withoutListOperands(name, rule);
    else if (name === 'Sum' || name === 'Product')
      rules[name] = withFoldOfRows(withoutNestedOperands(name, rule));
    else if (!NESTED_OPERAND_HEADS.has(name) || name === 'Count')
      rules[name] = withoutNestedOperands(name, rule);
  return {
    structured: true,
    definition: {
      ...definition,
      ...structuredDefinition,
      rules,
      localType: structuredLocalType,
    },
    heads: new Set(Object.keys(rules)),
    testOperations,
  };
}

/** Whether `node` is a library operator of `admission`, or a head of the
 *  test operation. */
function isAdmittedOperator(node: Expression, admission: Admission): boolean {
  return (
    isFunction(node) &&
    (admission.testOperations.has(node.operator) ||
      isLibraryOperator(node, node.operator))
  );
}

/**
 * The effect fact of the prepared node `node`, from its resolved definition
 * (`shallowApplicationEffects()`: the effects of the operator, or of the
 * function that the head names, and the effects of the operands that it
 * invokes). Unknown effects (`any`, for a function that states no purity
 * and is declared impure, or a head with no definition) give `unknown`; a
 * set with an impurity label gives `effectful`. A literal and a read of an
 * input are pure. The fragment target refuses the `functions` and
 * `operators` options, so no host override changes these facts.
 */
function effectFact(node: Expression): EffectFact {
  if (!isFunction(node)) return 'pure';
  if (isReturnNode(node)) return 'pure';
  const effects = shallowApplicationEffects(node);
  if (effects === 'any') return 'unknown';
  return isPureComputedEffects(effects) ? 'pure' : 'effectful';
}

/** The effect fact of every node that `annotation` types, in every scope
 *  and in the body of each function. A call of a local function
 *  (`localCalls`) is `pure` itself: the engine knows no effects of a
 *  closure of the block, and the lowering joins the effects of the body
 *  of its helper to the call. */
function effectFacts(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  localCalls: ReadonlySet<Expression>
): Map<Expression, EffectFact> {
  const result = new Map<Expression, EffectFact>();
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys())
      if (!result.has(node))
        result.set(node, localCalls.has(node) ? 'pure' : effectFact(node));
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
  return result;
}

/**
 * The states that each node of `annotation` whose effect fact is not `pure`
 * touches itself (`StructuredPreparation.states`): the impurity labels of
 * its effects (`shallowApplicationEffects()`). On the structured route a
 * node whose effects name a label other than `random`, or are unknown
 * (`any`, or a set that is not finite), is refused, so every effect that
 * the program has is a draw from the random stream. A head of the test
 * operation (`testOperations`) keeps the effects of its declaration, and a
 * call of a helper (`helpers`) the effects of its body, whose nodes have
 * this rule, and the `random` that its signature can state
 * (`resolveHelper()`). A call of a function of the host (`hosts`) has the
 * effect of its binding (`IRHostCall`), which names no state.
 */
function stateFacts(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  testOperations: ReadonlyMap<string, string>,
  helpers: ReadonlyMap<string, ResolvedHelper>,
  hosts?: StructuredHosts
): Map<Expression, IRState[]> {
  const result = new Map<Expression, IRState[]>();
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys()) {
      if (result.has(node) || !isFunction(node)) continue;
      if (hosts?.bindings.has(`call:${node.operator}`)) continue;
      // `Return(v)` in tail position is its value (`isReturnNode()`).
      if (isReturnNode(node)) continue;
      const effects = shallowApplicationEffects(node);
      if (isPureComputedEffects(effects)) continue;
      const test =
        testOperations.has(node.operator) || helpers.has(node.operator);
      if (effects === 'any' || isCoFiniteEffects(effects)) {
        if (test) continue;
        throw new Error(
          `JS scalar fragment: ${nodeText(node)} has effects that its definition does not state, which the structured route does not have`
        );
      }
      const labels = (effects ?? []).filter(isImpurityLabel);
      const other = labels.filter((label) => label !== 'random');
      if (other.length > 0 && !test)
        throw new Error(
          `JS scalar fragment: ${nodeText(node)} has the effect ${other.join(', ')}, which the structured route does not have: it has draws from the random stream only`
        );
      result.set(node, [...labels].sort());
    }
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
  return result;
}

/**
 * Throw for a draw in an operand of a `Comprehension` of `annotation` (its
 * body, or a domain and its bounds), outside a `WithRandomSeed` there: the
 * interpreter's comprehension is a lazy view that evaluates its body and
 * its domain when the list is read (`docs/RANDOMNESS-MODEL.md` §6), and
 * the structured route makes the list at once (`build`), so the count and
 * the order of the draws would differ: `Comprehension(j, Element(j,
 * Range(1, 2 + Random(Range(1, 3)))))` followed by `r := Random()` draws
 * `r` first in the interpreter. A draw is a `Random` node, or a call of a
 * helper whose body draws or whose signature states `random` (`helpers`).
 * The other constructs that the route admits evaluate their operands when
 * the existing code does (the bounds and the body of a `Loop`, `ReplaceAt`,
 * `At`, the arguments of a helper, which are evaluated once before the
 * call, an initializer that is not read, the branches of `If`).
 */
function refuseLazyDraws(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  helpers: ReadonlyMap<string, ResolvedHelper>
): void {
  const { draws } = drawReaders(helpers);
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys())
      if (isFunction(node, 'Comprehension') && node.ops.some(draws))
        throw new Error(
          `JS scalar fragment: the comprehension ${nodeText(node)} draws from the random stream: ` +
            `the interpreter's comprehension is a lazy view that draws when an element is read, ` +
            `and the structured route makes the list at once`
        );
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * Throw for a head with a function operand of `annotation`
 * (`functionOperandRule()`), other than `Apply`, whose function literal
 * has a body that is not pure (`impureNodes()`), draws (a `Random` node or
 * a call of a helper that draws, also in a `WithRandomSeed`), runs code of
 * the host (a call or a read of the host, also one declared pure, or a call
 * of a helper that does), or can abort (a call of a helper whose body has a
 * `Loop`, which an iteration budget can stop; a `WithRandomSeed`, whose
 * seed can be invalid). The interpreter's `Map`, `Filter` and `Scan` are
 * lazy views that compute an element when it is read, and the route
 * computes every element at once, in index order, as the existing emitter
 * does: the count and the order of the evaluations of the body would differ
 * from the interpreter's (`At(Map(f, L), 2)` computes one element there).
 * `Reduce` and `Count` are refused in the same way: the simple, sound
 * version. `Apply` evaluates its body once, where it is, on both.
 */
function refuseLazyFunctionOperands(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  helpers: ReadonlyMap<string, ResolvedHelper>,
  hosts: StructuredHosts | undefined,
  integrals?: ReadonlyMap<Expression, StructuredIntegral>,
  routines?: ReadonlyMap<Expression, StructuredNumericRoutine>
): void {
  const { isDraw } = drawReaders(helpers);
  const isHost = (node: Expression): boolean =>
    hosts !== undefined &&
    ((isFunction(node) && hosts.bindings.has(`call:${node.operator}`)) ||
      (isSymbol(node) && hosts.bindings.has(`read:${node.symbol}`)));
  /** The first node of `node`, or of the body of a helper that it calls,
   *  that draws, runs code of the host or can abort. The calls of the
   *  helpers have no cycle (`collectStructuredHelper()`). */
  const memo = new Map<Expression, Expression | null>();
  const blocker = (node: Expression): Expression | null => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    memo.set(node, null);
    let found: Expression | null = null;
    if (
      isHost(node) ||
      isDraw(node) ||
      isFunction(node, 'Loop') ||
      isFunction(node, 'WithRandomSeed')
    )
      found = node;
    else if (isFunction(node)) {
      const helper = helpers.get(node.operator);
      if (helper !== undefined && blocker(helper.body) !== null) found = node;
      for (const op of node.ops) {
        if (found !== null) break;
        found = blocker(op);
      }
    }
    memo.set(node, found);
    return found;
  };
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys()) {
      // The integrand, and the bounds of each clause after the first, of a
      // definite integral that the route integrates numerically
      // (`quadratureIntegral()`): the routine evaluates them at points that
      // it chooses, and the interpreter at other points.
      const integral = integrals?.get(node);
      if (integral !== undefined) {
        const found = [
          integral.body,
          ...(integral.alternative === undefined ? [] : [integral.alternative]),
          ...integral.clauses.slice(1).flatMap((c) => [c.lower, c.upper]),
        ]
          .map((e) => impureNodes(e).at(0) ?? blocker(e))
          .find((e) => e !== null && e !== undefined);
        if (found !== undefined && found !== null)
          throw new Error(
            `JS scalar fragment: the integral ${nodeText(node)} has the node ` +
              `${nodeText(found)}, which is not pure, draws, runs code of the ` +
              `host or can abort, is not in the structured route: the ` +
              `compiled code evaluates the integrand at the points of its ` +
              `quadrature, and the interpreter at the points of its own`
          );
        continue;
      }
      // The body of a derivative or a limit that the route computes
      // numerically (`numericDerivative()`, `numericLimit()`): the routine
      // evaluates it at points that it chooses.
      const routine = routines?.get(node);
      if (routine !== undefined) {
        const found = impureNodes(routine.body).at(0) ?? blocker(routine.body);
        if (found !== undefined && found !== null)
          throw new Error(
            `JS scalar fragment: ${nodeText(node)} has the node ` +
              `${nodeText(found)}, which is not pure, draws, runs code of the ` +
              `host or can abort, is not in the structured route: the ` +
              `compiled code evaluates the body at the points of its ` +
              `numerical ${routine.fn}, and the interpreter at the points of ` +
              `its own`
          );
        continue;
      }
      if (
        !isFunction(node) ||
        node.operator === 'Apply' ||
        !Object.hasOwn(FUNCTION_OPERAND_HEADS, node.operator)
      )
        continue;
      const position = FUNCTION_OPERAND_HEADS[node.operator];
      const fn = functionOperandOf(node);
      const lambda =
        fn === undefined
          ? undefined
          : functionOperandParts(fn, position.arity ?? node.nops - 1);
      if (lambda === undefined) continue;
      const found = impureNodes(lambda.body).at(0) ?? blocker(lambda.body);
      if (found !== null && found !== undefined)
        throw new Error(
          `JS scalar fragment: ${node.operator} whose function has the node ${nodeText(found)}, ` +
            `which is not pure, draws, runs code of the host or can abort, is not in the structured route: ` +
            `the compiled code evaluates the function once per element, in index order, and the interpreter's ` +
            `Map, Filter and Scan compute an element when it is read`
        );
    }
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * Throw for a program of `annotation` that draws two or more times (a
 * count of the tree: a node object reached twice draws twice) when one of
 * the draws is a node on the complex lane (its facts are complex) or is in
 * one. The existing emitter binds the value of a complex operand to a local
 * ahead of the code that it writes inline for the other operands of the
 * expression: `Random() + Sqrt(Random(Range(-2, 8, 2)))` in the `complex`
 * mode draws for the square root first, and the structured route draws in
 * the order of the operands. A body of a helper is checked on its own, and
 * a call of a helper whose body draws is a draw of its caller. A draw in a
 * `WithRandomSeed` counts with the others. This is the simple, sound form
 * of the rule: a program whose second draw is in another statement, which
 * the existing emitter does not reorder, is refused too.
 *
 * A host operation (a call or a read of the host, `hosts`), and a call of a
 * helper whose body has one, counts as a draw: the host can count its calls
 * and their order. When one of them is not pure, it can change the vars
 * object, and a read of a name of the root scope counts as a draw too.
 */
function refuseHoistedDraws(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  helpers: ReadonlyMap<string, ResolvedHelper>,
  captures: ReadonlyMap<object, CaptureEntry>,
  hosts?: StructuredHosts
): void {
  const readers = drawReaders(helpers);
  const isHost = (node: Expression): boolean =>
    hosts !== undefined &&
    ((isFunction(node) && hosts.bindings.has(`call:${node.operator}`)) ||
      (isSymbol(node) && hosts.bindings.has(`read:${node.symbol}`)));
  // A host operation that is not pure can change the vars object: then a
  // read of a name of the root scope (an input, conservatively also a
  // local of a root `Block`) counts as a draw too, since the existing
  // emitter can move it after the complex operand that holds the call
  // (`x + hm(1)·Arcosh(x)` reads `_.x` after `hm`).
  const mutates =
    hosts !== undefined &&
    [...hosts.bindings.values()].some((binding) => !binding.pure);
  // A captured alias (`sv := y`) is a read of the name at the end of its
  // chain, where the alias is read (`aliasChainEnd()`).
  const readsRoot = (node: Expression): boolean =>
    mutates &&
    isSymbol(node) &&
    annotation.scope.bindings.has(aliasChainEnd(captures, node).node.symbol);
  /** Whether each node object, or the body of a helper that it calls, has a
   *  host operation. The calls of the helpers have no cycle
   *  (`collectStructuredHelper()` refuses recursion before this pass), so
   *  each answer is final when it is remembered. */
  const hostMemo = new Map<Expression, boolean>();
  const hasHost = (node: Expression): boolean => {
    const known = hostMemo.get(node);
    if (known !== undefined) return known;
    const result =
      isHost(node) ||
      (isFunction(node) &&
        ((helpers.has(node.operator) &&
          hasHost(helpers.get(node.operator)!.body)) ||
          node.ops.some(hasHost)));
    hostMemo.set(node, result);
    return result;
  };
  /** Whether each node object, or the body of a helper that it calls,
   *  reads a name of the root scope (`readsRoot()`): the body of a helper
   *  reads an input where it runs (`admitHelperInput()`). A name of the
   *  body that a parameter binds counts too, which is conservative. */
  const rootMemo = new Map<Expression, boolean>();
  const hasRootRead = (node: Expression): boolean => {
    const known = rootMemo.get(node);
    if (known !== undefined) return known;
    const result =
      readsRoot(node) ||
      (isFunction(node) &&
        ((helpers.has(node.operator) &&
          hasRootRead(helpers.get(node.operator)!.body)) ||
          node.ops.some(hasRootRead)));
    rootMemo.set(node, result);
    return result;
  };
  const isDraw = (node: Expression): boolean =>
    readers.isDraw(node) ||
    isHost(node) ||
    (isFunction(node) &&
      helpers.has(node.operator) &&
      (hasHost(helpers.get(node.operator)!.body) ||
        (mutates && hasRootRead(helpers.get(node.operator)!.body))));
  const complex = new Set<Expression>();
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const [node, facts] of scope.facts)
      if ('representation' in facts && facts.representation === 'complex')
        complex.add(node);
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
  /** For each node object: its draws (at most 2) and whether one of them is
   *  on the complex lane. A memo by node keeps the walk linear. */
  const memo = new Map<Expression, { count: number; complex: boolean }>();
  const summary = (node: Expression): { count: number; complex: boolean } => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    let count = 0;
    let lane = false;
    if (isSymbol(node) && (isDraw(node) || readsRoot(node))) count = 1;
    if (isFunction(node)) {
      if (isDraw(node)) count = 1;
      for (const op of node.ops) {
        const s = summary(op);
        count = Math.min(2, count + s.count);
        lane ||= s.complex;
      }
      if (count > 0 && complex.has(node)) lane = true;
    }
    const result = { count, complex: lane };
    memo.set(node, result);
    return result;
  };
  const check = (body: Expression) => {
    const s = summary(body);
    if (s.count >= 2 && s.complex)
      throw new Error(
        `JS scalar fragment: ${nodeText(body)} draws more than once, and a draw is in a complex value: ` +
          `the existing emitter evaluates a complex operand before the operands that it writes inline, ` +
          `so the order of the draws would differ`
      );
  };
  check(annotation.root);
  for (const helper of helpers.values()) check(helper.body);
}

/**
 * Throw for a `Sum` or a `Product` of `annotation` whose operands (the body
 * and the bounds) call a function of the host declared pure, directly or in
 * the body of a helper that they call. The existing emitter skips the terms
 * after an accumulator of `NaN` when they have no effect
 * (`isEmissionSkippable()`), and a pure call has none: it calls the
 * function fewer times than the structured route, which evaluates every
 * term. A call that is not pure has an effect, and every term runs on both
 * routes. The simple, sound form of the rule: an aggregate with such a call
 * is refused also when no term can be `NaN`.
 */
function refusePureHostInAggregates(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  helpers: ReadonlyMap<string, ResolvedHelper>,
  hosts: StructuredHosts | undefined
): void {
  if (hosts === undefined) return;
  const pure = new Set<string>();
  for (const binding of hosts.bindings.values())
    if (binding.form === 'call' && binding.pure) pure.add(binding.name);
  if (pure.size === 0) return;
  /** Whether each node object, or the body of a helper that it calls, has a
   *  call of a pure function of the host. A memo keeps the walk linear. The
   *  calls of the helpers have no cycle (`collectStructuredHelper()` refuses
   *  recursion before this pass), so each answer is final when it is
   *  remembered. */
  const memo = new Map<Expression, boolean>();
  const hasPure = (node: Expression): boolean => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    const result =
      isFunction(node) &&
      (pure.has(node.operator) ||
        (helpers.has(node.operator) &&
          hasPure(helpers.get(node.operator)!.body)) ||
        node.ops.some(hasPure));
    memo.set(node, result);
    return result;
  };
  const seen = new Set<Expression>();
  const check = (node: Expression) => {
    if (seen.has(node) || !isFunction(node)) return;
    seen.add(node);
    if (
      (node.operator === 'Sum' || node.operator === 'Product') &&
      node.ops.some(hasPure)
    )
      throw new Error(
        `JS scalar fragment: ${node.operator} calls a function of the host that the options declare pure ` +
          `(${nodeText(node)}): the existing emitter skips such a call after a term of NaN, ` +
          `and so calls the function fewer times`
      );
    for (const op of node.ops) check(op);
  };
  check(annotation.root);
  for (const helper of helpers.values()) check(helper.body);
}

/**
 * The order of evaluation of each comparison chain of `annotation` (a
 * `Less`, `LessEqual`, `Equal` or `NotEqual` of three operands or more),
 * recorded in `forms`, or a refusal. The lowering evaluates the first two
 * operands, compares them, and evaluates each later operand only when the
 * pairs before it hold (`chain()` in `javascript-structured-lower.ts`).
 * The existing emitter evaluates each operand once too, in the same order,
 * except in the cases below. An operand "has an effect" here when it
 * draws, or reads or calls the host, also in the body of a helper that it
 * calls (`drawReaders()`, `hosts`).
 *
 * - `Less`, `LessEqual` (`compileExprOperator()` in `compile-operators.ts`):
 *   the first two operands are bound to temporaries of a function around
 *   the whole chain, called with them in order, or written in the first
 *   pair. The second one is bound when it is not a name or a number
 *   literal; both are bound, in order, when a middle operand is impure
 *   (`isPure` is false, or it reads or calls a binding of the host that is
 *   not declared pure: caller code) and the operand is impure too, or is
 *   not a literal or a constant and comes before the last caller code. So
 *   when the second operand is bound and the first is not, the second one
 *   is evaluated first (the form `chain-swap`): `Less(hm(1), x + 1, w)`
 *   reads `x` before the host call `hm` can change it, and
 *   `Less(Random(), x + 1, w)` evaluates `x + 1` before it draws. The rule
 *   reads the same predicates. A chain with an effect and a call of a
 *   helper is refused: a helper can be caller code of the existing compiler
 *   (a local function) where the rule does not see it.
 * - `Equal`, `NotEqual` (`compileJSEquality()`): when no middle operand has
 *   an effect of the existing compiler (`isTransitivelyPure()`, caller
 *   code), each operand is written in both pairs that read it, and a middle
 *   operand is evaluated twice. A middle operand that reads or calls the
 *   host, or calls a helper, is refused: a host counts its calls, and a
 *   helper that draws is evaluated twice there. When a middle operand is
 *   impure, the operands are bound as for `Less` (with
 *   `isTransitivelyPure()` in place of `isPure`), each bound operand from
 *   the second on at the pair that reads it: so when the second operand is
 *   bound and the first is not, the second one is evaluated first
 *   (`chain-swap`). `Equal(hp(x), Random(), 1)` with `hp` a function of the
 *   user that the options map to a host function declared pure draws
 *   before it calls `hp`, as on the existing compiler.
 */
function chainForms(
  annotation: FragmentAnnotation<ScalarRepresentation>,
  helpers: ReadonlyMap<string, ResolvedHelper>,
  hosts: StructuredHosts | undefined,
  forms: Map<Expression, StructuredForm>
): void {
  const { draws } = drawReaders(helpers);
  const memo = new Map<Expression, boolean>();
  /** Whether `node`, or the body of a helper that it calls, reads or calls
   *  the host (`withHelpers`), or calls a helper. */
  const reaches = (node: Expression, withHelpers: boolean): boolean => {
    if (isSymbol(node))
      return hosts?.bindings.has(`read:${node.symbol}`) === true;
    if (!isFunction(node)) return false;
    const key = withHelpers ? node : undefined;
    const known = key === undefined ? undefined : memo.get(key);
    if (known !== undefined) return known;
    const result =
      hosts?.bindings.has(`call:${node.operator}`) === true ||
      (helpers.has(node.operator) &&
        (withHelpers || reaches(helpers.get(node.operator)!.body, false))) ||
      node.ops.some((op) => reaches(op, withHelpers));
    if (key !== undefined) memo.set(key, result);
    return result;
  };
  const hasEffect = (node: Expression): boolean =>
    draws(node) || reaches(node, false);
  /** Whether `node` reads a binding of the host or calls one that is not
   *  declared pure: caller code of the existing compiler. */
  const readsImpureHost = (node: Expression): boolean =>
    isSymbol(node)
      ? hosts?.bindings.has(`read:${node.symbol}`) === true
      : isFunction(node) &&
        (hosts?.bindings.get(`call:${node.operator}`)?.pure === false ||
          node.ops.some(readsImpureHost));
  const callsHelper = (node: Expression): boolean =>
    isFunction(node) &&
    (helpers.has(node.operator) || node.ops.some(callsHelper));
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys()) {
      if (
        !isFunction(node) ||
        node.nops < 3 ||
        !['Less', 'LessEqual', 'Equal', 'NotEqual'].includes(node.operator)
      )
        continue;
      const middles = node.ops.slice(1, -1);
      if (node.operator === 'Equal' || node.operator === 'NotEqual') {
        const middle = middles.find((op) => reaches(op, true));
        if (middle !== undefined)
          throw new Error(
            `JS scalar fragment: the middle operand ${nodeText(middle)} of the chain ${nodeText(node)} ` +
              `reads or calls the host or calls a helper: the existing emitter evaluates a middle ` +
              `operand of an equality chain once per pair that reads it`
          );
        // The predicates of `compileJSEquality()`: when a middle operand
        // is impure, every impure operand, and every operand before the
        // last caller code that is not a literal or a constant, is bound;
        // a bound operand from the second on is evaluated before the pair
        // that reads it, and so before an unbound first operand.
        const [first, second] = node.ops;
        if (!hasEffect(first)) continue;
        if (node.ops.some((op) => callsHelper(op)))
          throw new Error(
            `JS scalar fragment: the chain ${nodeText(node)} has an effect and a call of a ` +
              `helper: the order in which the existing emitter evaluates its operands is not ` +
              `in the structured route`
          );
        const callerCode = node.ops.map(readsImpureHost);
        const impure = (op: Expression, i: number) =>
          !isTransitivelyPure(op) || callerCode[i];
        if (!middles.some((op, i) => impure(op, i + 1))) continue;
        const lastCallerCode = callerCode.lastIndexOf(true);
        const bound = (op: Expression, i: number) =>
          impure(op, i) ||
          (i < lastCallerCode &&
            !isNumber(op) &&
            !isString(op) &&
            !(isSymbol(op) && op.isConstant));
        if (bound(second, 1) && !bound(first, 0)) forms.set(node, 'chain-swap');
        continue;
      }
      const [first, second] = node.ops;
      if (!hasEffect(first) || isSymbol(second) || isNumber(second)) continue;
      if (node.ops.some((op) => callsHelper(op)))
        throw new Error(
          `JS scalar fragment: the chain ${nodeText(node)} has an effect and a call of a ` +
            `helper: the order in which the existing emitter evaluates its operands is not ` +
            `in the structured route`
        );
      // The predicates of `compileExprOperator()`, for the first two
      // operands.
      const callerCode = node.ops.map(readsImpureHost);
      const impure = (op: Expression, i: number) =>
        op.isPure === false || callerCode[i];
      const impureMiddle = middles.some((op, i) => impure(op, i + 1));
      const lastCallerCode = impureMiddle ? callerCode.lastIndexOf(true) : -1;
      const captured = (op: Expression, i: number) =>
        i < lastCallerCode &&
        !isNumber(op) &&
        !isString(op) &&
        !(isSymbol(op) && op.isConstant);
      const firstBound =
        impureMiddle && (impure(first, 0) || captured(first, 0));
      if (!firstBound) forms.set(node, 'chain-swap');
    }
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
}

/**
 * The readers of draws for the helpers `helpers`: `isDraw(node)`, for a
 * `Random` node or a call of a helper whose body draws or whose signature
 * states `random`, and `draws(node)`, for a node that has such a node
 * outside the body of a `WithRandomSeed`.
 */
function drawReaders(helpers: ReadonlyMap<string, ResolvedHelper>): {
  isDraw: (node: Expression) => boolean;
  draws: (node: Expression) => boolean;
} {
  const memo = new Map<string, boolean>();
  /** The answer of `draws()` for each node object: a shared node is
   *  visited once, so the walk is linear in the number of nodes. */
  const drawsMemo = new Map<Expression, boolean>();
  const helperDraws = (name: string): boolean => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    memo.set(name, false);
    const helper = helpers.get(name)!;
    const signature = isFunction(helper.literal)
      ? userFunctionSignature(helper.literal.engine, name)
      : undefined;
    const declared =
      Array.isArray(signature?.effects) && signature.effects.includes('random');
    const result = declared || draws(helper.body);
    memo.set(name, result);
    return result;
  };
  const isDraw = (node: Expression): boolean =>
    isFunction(node) &&
    (node.operator === 'Random' ||
      (helpers.has(node.operator) && helperDraws(node.operator)));
  const draws = (node: Expression): boolean => {
    if (!isFunction(node)) return false;
    const known = drawsMemo.get(node);
    if (known !== undefined) return known;
    const result =
      isDraw(node) ||
      (node.operator === 'WithRandomSeed' && node.nops === 2
        ? draws(node.op1)
        : node.ops.some(draws));
    drawsMemo.set(node, result);
    return result;
  };
  return { isDraw, draws };
}

/** The node that a refusal of the admission or of the annotation is about,
 *  with the head or the name that the diagnostic reports. */
type RefusedNode = {
  readonly node: Expression;
  readonly operator?: string;
  readonly binding?: string;
};

/**
 * The node of each error that the admission or the annotation threw. The
 * walkers of the admission check a node before its operands, so the
 * innermost walker that sees an error is the one of the refused node: it
 * records the node, and the walkers around it keep that record
 * (`noteRefusedNode()`). The diagnostic of the `numeric-kernel` profile
 * reads it (`profileDecline()`).
 */
const refusedNodes = new WeakMap<object, RefusedNode>();

/** Record `node` as the node of the error `e`, unless an inner walker has
 *  recorded one. */
function noteRefusedNode(e: unknown, refused: RefusedNode): void {
  if (typeof e !== 'object' || e === null || refusedNodes.has(e)) return;
  refusedNodes.set(e, refused);
}

/** Run `check(node)` and record `node` as the node of an error that it
 *  throws (`noteRefusedNode()`). */
function atNode<T>(node: Expression, check: () => T): T {
  try {
    return check();
  } catch (e) {
    noteRefusedNode(e, { node });
    throw e;
  }
}

/** The prefix of the message of an admission refusal of this file. */
const FRAGMENT_PREFIX = 'JS scalar fragment: ';

/** The prefix of the message of a broken invariant of this file: an
 *  internal error, not a refusal. */
const INVARIANT_PREFIX = 'JS scalar fragment invariant: ';

/** Whether `e` is a cancellation (a timeout, an abort, an iteration limit),
 *  which belongs to the caller and is thrown again as it is. */
function isCancellation(e: unknown): boolean {
  return (
    e instanceof CancellationError ||
    (e as { name?: unknown } | undefined)?.name === 'CancellationError'
  );
}

/** The error of an internal failure of the `numeric-kernel` profile in
 *  `phase`, with the code `'compile-error'`. */
function profileInternalError(phase: string, e: unknown): CompileDeclineError {
  const message = e instanceof Error ? e.message : String(e);
  return new CompileDeclineError({
    code: 'compile-error',
    kind: 'capability',
    message:
      `Could not compile with the profile 'numeric-kernel': an internal ` +
      `error in the ${phase} phase: ${message}`,
  });
}

/**
 * The reason of a refusal of this file, `reason`, as the diagnostic of the
 * `numeric-kernel` profile gives it to a host. The messages of this file
 * name the structured route and compare it with the existing compiler,
 * which the internal tests read; a host knows only the profile. "The
 * structured route" and "the JS scalar fragment" become "the profile", and
 * a clause that gives the reason in terms of the existing compiler is
 * removed.
 */
function publicReason(reason: string): string {
  return (
    reason
      // `X has the type true, and the existing compiler writes the literal
      // true in its place: the structured route does not`.
      .replace(
        /, and the existing compiler writes the literal \w+ in its place: the structured route does not$/,
        ': the profile does not admit a node whose value its type fixes'
      )
      // A trailing clause about what the existing emitter or compiler does.
      .replace(/: the existing (emitter|compiler)\b[\s\S]*$/, '')
      .replace(/the structured route/g, 'the profile')
      .replace(/the JS scalar fragment/g, 'the profile')
  );
}

/**
 * The error that a compilation with the `numeric-kernel` profile throws for
 * the error `e` of the preparation, the admission or the annotation. A
 * cancellation and a decline with its own code (a `CompileDeclineError`
 * of the preparation of the existing compiler) are thrown as they are. A
 * refusal of this file is an `Error` whose message starts with
 * `FRAGMENT_PREFIX` (a refusal of the annotation has it too): it is the
 * decline `'outside-profile'`, with the reason as a host reads it
 * (`publicReason()`) and the node that the admission refused
 * (`refusedNodes`): its head in `operator` when it is a function
 * expression, or its name in `binding`, and the node in `value`. Every
 * other error (a broken invariant, a `TypeError` of a defect, an error of
 * the existing preparation with no code) is an internal error
 * (`profileInternalError()`).
 */
function profileDecline(e: unknown): unknown {
  if (isCancellation(e) || isCompileDeclineError(e)) return e;
  const raw = e instanceof Error ? e.message : String(e);
  if (
    !(e instanceof Error) ||
    e.constructor !== Error ||
    !raw.startsWith(FRAGMENT_PREFIX) ||
    raw.startsWith(INVARIANT_PREFIX)
  )
    return profileInternalError('preparation', e);
  const reason = publicReason(raw.slice(FRAGMENT_PREFIX.length));
  const refused = refusedNodes.get(e);
  const node = refused?.node;
  // A record with a head or a name keeps them; otherwise the node gives
  // its head when it is a function expression, or its name when it is a
  // symbol.
  const named =
    refused?.operator !== undefined || refused?.binding !== undefined;
  const operator = named
    ? refused?.operator
    : node !== undefined && isFunction(node)
      ? node.operator
      : undefined;
  const binding = named
    ? refused?.binding
    : node !== undefined && isSymbol(node)
      ? node.symbol
      : undefined;
  return new CompileDeclineError({
    code: 'outside-profile',
    kind: 'capability',
    message: `Could not compile with the profile 'numeric-kernel': ${reason}`,
    ...(operator !== undefined ? { operator } : {}),
    ...(binding !== undefined ? { binding } : {}),
    ...(node !== undefined && hasShortText(node)
      ? { value: node.toString() }
      : {}),
  });
}

/**
 * The options that the `numeric-kernel` profile does not have, by name, in
 * `options`: the decline `'outside-profile'` that names the first one, or
 * `undefined`. `cse` and `constantFold` are not in this list: the profile
 * ignores them. `vars`, `functions`, the record form of `operators`,
 * `imports` and `preamble` are admitted (`structuredHosts()`), except in the
 * mode `bigint` (`bigintOptionRefusal()`), and `broadcast` is ignored: the
 * route makes no batch body, so `broadcast()` runs the ordinary body for
 * each cell, as with `broadcast: false`.
 */
function profileOptionDecline(
  options: CompilationOptions<Expression>
): CompileDeclineError | undefined {
  const option =
    typeof options.operators === 'function'
      ? 'the function form of the option `operators`'
      : undefined;
  if (option === undefined) return undefined;
  return new CompileDeclineError({
    code: 'outside-profile',
    kind: 'capability',
    message:
      `Could not compile with the profile 'numeric-kernel': ${option} ` +
      `is not in the profile.`,
  });
}

/**
 * The first option of `options` that the profile does not admit in the mode
 * `bigint`, or `undefined`: `vars`, `functions`, the record form of
 * `operators`, `preamble` and `imports`. The lane analysis of the existing
 * compiler reads a `vars` entry, a `functions` entry or an `operators` entry
 * as code that computes with doubles, and the structured route reads none
 * of them in the mode.
 */
function bigintOptionRefusal(
  options: CompilationOptions<Expression>
): string | undefined {
  if (isGivenOption(options.vars)) return 'vars';
  if (isGivenOption(options.functions)) return 'functions';
  if (isGivenOption(options.operators)) return 'operators';
  if (options.preamble) return 'preamble';
  if (options.imports?.length) return 'imports';
  return undefined;
}

/**
 * The decline `'outside-profile'` of the `bigint-lane` decline `e` of the
 * lane analysis of the mode `bigint` (`requireBigintLane()`): the reason of
 * the lane analysis, and the node it names.
 */
function bigintLaneProfileDecline(e: CompileDeclineError): CompileDeclineError {
  const diagnostic = e.diagnostic;
  const reason = diagnostic.message.replace(
    /^Could not compile in mode 'bigint': /,
    ''
  );
  return new CompileDeclineError({
    code: 'outside-profile',
    kind: 'capability',
    message: `Could not compile with the profile 'numeric-kernel' in the mode 'bigint': ${reason}`,
    ...(diagnostic.value !== undefined ? { value: diagnostic.value } : {}),
  });
}

/** The program of the mode `bigint` that the preparation of a compilation
 *  with the profile lowered (`prepareBigint()`), by the target of the
 *  compilation, with the nodes of its lane analysis. */
const BIGINT_PROGRAMS = new WeakMap<
  CompileTarget<Expression>,
  {
    readonly program: IRProgram;
    readonly preparedNodes: ReadonlySet<Expression>;
  }
>();

//
// The options of the host on the structured route: `vars`, `functions` and
// `operators`
//

/**
 * A `vars` entry on the structured route (`structuredHosts()`):
 *
 * - `input`: a read of an entry of the vars object, `_.<id>` or
 *   `_["<id>"]` (the form of the series walk of the engine,
 *   `compiledSeriesTerm()`): the mapped name is an input, typed as an input
 *   (its declared type, or the default kind of the mode), whose reads the
 *   emitter writes as the source. `recorded`: the source is the spelling of
 *   the name itself (`_.u` for `u`), which the existing compiler records as
 *   a read of the vars object (`CompileTarget.varsObjectRefs`) and checks at
 *   the entry; another source is not recorded, as on the existing route
 *   (`isOpaqueVarsSource()`).
 * - `read`: another source that is one operand (`isOperandSource()`): a read
 *   of the host at each occurrence (`IRHostCall` with no operand), whose
 *   effect is `unknown`.
 * - `refusal`: another source, with the reason.
 */
type VarsEntry =
  | {
      readonly form: 'input';
      readonly source: string;
      readonly recorded: boolean;
    }
  | { readonly form: 'read'; readonly source: string }
  | { readonly refusal: string };

/** No `vars` entry, or one whose source reads the inputs object. */
const isInputEntry = (entry: VarsEntry | undefined): boolean =>
  entry === undefined || ('form' in entry && entry.form === 'input');

/** A head that a `functions` or `operators` entry maps
 *  (`structuredHosts()`): the code that the existing emitter writes in
 *  place of the head (`text`, called with the operands), and whether the
 *  host declared it pure (`entryIsPure()`; an `operators` entry is never
 *  pure). Or a refusal, with the reason. */
type HostHead =
  | { readonly text: string; readonly pure: boolean }
  | { readonly refusal: string };

/**
 * The options of the host of a compilation on the structured route, and the
 * host bindings that the admission finds (`IRHostBinding`).
 */
type StructuredHosts = {
  /** The `vars` entries, by the name that they map. */
  readonly vars: ReadonlyMap<string, VarsEntry>;
  /** The heads of the `functions` and `operators` entries. An `operators`
   *  entry outranks a `functions` entry of the same head, as at the
   *  emission of the existing compiler. */
  readonly heads: ReadonlyMap<string, HostHead>;
  /** The bindings that the program reads or calls, by `<form>:<name>`, in
   *  the order of their first node. */
  readonly bindings: Map<string, IRHostBinding>;
  /** The names of the host reads with no declared type, which took the
   *  default kind of the mode (`CompilationResult.defaultedSymbols`). */
  readonly defaulted: Set<string>;
};

/** A name or a dotted path of names (`f`, `_.f`, `Math.hypot`): a source
 *  whose evaluation has no effect. */
const PLAIN_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/**
 * The refusal of a source of the option `option` that holds a line
 * terminator or a comment, or `undefined`. The existing emitter writes the
 * source as it is, where a line terminator after `return` ends the
 * statement (`return\n next()` returns `undefined` and reads nothing) and a
 * `//` comment hides the code after it on its line; the profile reads the
 * source as one operand.
 */
function sourceLayoutRefusal(
  option: string,
  name: string,
  source: string
): string | undefined {
  const terminator = [...source].some((c) => {
    const code = c.charCodeAt(0);
    return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
  });
  if (!terminator && !source.includes('//') && !source.includes('/*'))
    return undefined;
  return (
    `the option \`${option}\` maps ${name} to a source with a ` +
    `${terminator ? 'line terminator' : 'comment'}: the existing emitter ` +
    `writes the source as it is, where a line terminator after \`return\` ` +
    `or a comment changes what the code evaluates`
  );
}

/** A `vars` source that reads an entry of the vars object: `_.<id>`, or
 *  `_["<id>"]` with a string literal. */
const VARS_INPUT_SOURCE =
  /^_(?:\.([A-Za-z_$][\w$]*)|\[\s*("(?:[^"\\]|\\.)*"|'[^'\\]*')\s*\])$/;

/** The words of JavaScript that cannot start an operand of
 *  `isOperandSource()`: an operator (`typeof x`, `new F()`) or a statement. */
const SOURCE_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'return',
  'super',
  'switch',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * Whether the JavaScript source `source` is one operand: a name, a number
 * literal or an expression in parentheses, followed by member accesses
 * (`.name`, `[…]`), calls (`(…)`) and at most one `++` or `--` (`next()`,
 * `_.state.a`, `globalThis.__c`, `(2 * _.h)`, `_.x++`). The existing emitter
 * writes a `vars` source and the source of a `functions` entry as they are,
 * in the place of the symbol or of the head, and the value of such a source
 * is the same there and alone: no operator of the code around it binds to a
 * part of it. `Math.PI/4` is not one: in `6 * Math.PI/4` the product is
 * computed first. A group is read with its string literals; a template
 * literal is not read.
 */
function isOperandSource(source: string): boolean {
  const text = source.trim();
  /** The index after the group that opens at `start`, or -1. */
  const group = (start: number): number => {
    const closing: string[] = [];
    for (let k = start; k < text.length; k++) {
      const c = text[k];
      if (c === '`') return -1;
      if (c === '"' || c === "'") {
        k++;
        while (k < text.length && text[k] !== c) k += text[k] === '\\' ? 2 : 1;
        if (k >= text.length) return -1;
        continue;
      }
      if (c === '(') closing.push(')');
      else if (c === '[') closing.push(']');
      else if (c === '{') closing.push('}');
      else if (c === ')' || c === ']' || c === '}') {
        if (closing.pop() !== c) return -1;
        if (closing.length === 0) return k + 1;
      }
    }
    return -1;
  };
  const name = /^[A-Za-z_$][\w$]*/.exec(text);
  let i: number;
  if (name !== null) {
    if (SOURCE_KEYWORDS.has(name[0])) return false;
    i = name[0].length;
  } else if (text.startsWith('(')) {
    i = group(0);
    if (i < 0) return false;
  } else return /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
  while (i < text.length) {
    if (text[i] === '.') {
      const member = /^[A-Za-z_$][\w$]*/.exec(text.slice(i + 1));
      if (member === null) return false;
      i += 1 + member[0].length;
    } else if (text[i] === '(' || text[i] === '[') {
      i = group(i);
      if (i < 0) return false;
    } else return text.slice(i) === '++' || text.slice(i) === '--';
  }
  return true;
}

/** Whether the system scope of the engine binds `name`: an operator or a
 *  constant of the library (`systemScopeBinding()`), or an operator of a
 *  custom library. */
function isLibraryName(engine: Expression['engine'], name: string): boolean {
  const ce = engine as unknown as Parameters<typeof systemScopeBinding>[0];
  return (
    ce._customLibraryOperators.has(name) ||
    systemScopeBinding(ce, name) !== undefined
  );
}

/**
 * The options of the host of a compilation of `expr` on the structured
 * route (`StructuredHosts`): the `vars` entries, and the heads of the
 * `functions` and `operators` entries, with the code that the existing
 * emitter writes for each, read from the prepared `target`
 * (`CompileTarget.functions`, `CompileTarget.operators`). `options` are the
 * options of the prepared compilation: `JavaScriptTarget.compile()` has made
 * a `functions` entry of each `vars` entry that names a user function.
 *
 * Throws the refusal of the structured route for an entry of `functions` or
 * of `operators` whose name is an operator or a constant of the library
 * (`Sin`, `Add`, `Pi`): the existing compiler applies the rewrites of the
 * library operator (a peephole, the lowering of `Subtract` as `Add` of a
 * negation) before or instead of the entry, and also writes the operator
 * for a node that the program does not hold (a quotient), so the route
 * could not give its code. An `operators` entry whose operator is not a
 * name (`'|'`, `'+'`) is written infix at its precedence, which JavaScript
 * may read with another grouping: such a head is refused where it is
 * called.
 */
function structuredHosts(
  expr: Expression,
  options: CompilationOptions<Expression>,
  target: CompileTarget<Expression>
): StructuredHosts {
  const engine = expr.engine;
  const vars = new Map<string, VarsEntry>();
  for (const [name, source] of Object.entries(options.vars ?? {})) {
    if (typeof source !== 'string') continue;
    const layout = sourceLayoutRefusal('vars', name, source);
    if (layout !== undefined) {
      vars.set(name, { refusal: layout });
      continue;
    }
    // A read of an entry of the vars object: the name is an input whose
    // reads are the source.
    if (VARS_INPUT_SOURCE.test(source.trim())) {
      vars.set(name, {
        form: 'input',
        source: source.trim(),
        recorded: !isOpaqueVarsSource(source, varsObjectSpelling(name)),
      });
      continue;
    }
    vars.set(
      name,
      isOperandSource(source)
        ? { form: 'read', source: source.trim() }
        : {
            refusal:
              `the option \`vars\` maps ${name} to the source ${JSON.stringify(source)}, ` +
              `which is not one operand (a name, a call, a member access or an ` +
              `expression in parentheses): the existing emitter writes it in ` +
              `place of the symbol, where an operator around it can bind to a part of it`,
          }
    );
  }
  const heads = new Map<string, HostHead>();
  const refuseLibrary = (option: string, name: string) => {
    if (isLibraryName(engine, name))
      throw new Error(
        `JS scalar fragment: the option \`${option}\` maps ${name}, an ` +
          `operator or a constant of the library: the existing compiler ` +
          `applies the rewrites of the library operator before or instead of the entry`
      );
  };
  for (const [name, entry] of Object.entries(options.functions ?? {})) {
    refuseLibrary('functions', name);
    // The code that the existing emitter writes in place of the head: the
    // name of a function given as a function (its definition is in the
    // preamble), or the source of a string.
    const text = target.functions?.(name);
    if (typeof text !== 'string') continue;
    const layout = sourceLayoutRefusal('functions', name, text);
    // The existing emitter evaluates the source of the callee before the
    // arguments, and the route after them: a source whose evaluation can
    // have an effect (a call, an index, `new`, an operator) is refused. A
    // name, a dotted path of names and a function expression with a pure
    // arithmetic body (`inferSourcePurity()`) have none; the source is also
    // one operand, or the arguments that the existing emitter writes after
    // it bind to a part of it (`t => t` followed by `(x)`).
    heads.set(
      name,
      layout !== undefined
        ? { refusal: layout }
        : !isOperandSource(text)
          ? {
              refusal:
                `the source ${JSON.stringify(text)} of the \`functions\` entry ${name} ` +
                `is not one operand (a name, a call, a member access or an ` +
                `expression in parentheses): the existing emitter writes the call ` +
                `as the source followed by the arguments`,
            }
          : PLAIN_REFERENCE.test(text) || inferSourcePurity(text)
            ? { text, pure: entryIsPure(entry) }
            : {
                refusal:
                  `the source ${JSON.stringify(text)} of the \`functions\` entry ${name} ` +
                  `is not a name, a dotted path of names or a function expression ` +
                  `with a pure arithmetic body: the existing emitter evaluates it ` +
                  `before the arguments of the call, and the profile after them`,
              }
    );
  }
  const operators = options.operators;
  if (operators !== undefined && typeof operators !== 'function')
    for (const name of Object.keys(operators)) {
      refuseLibrary('operators', name);
      const op = target.operators?.(name)?.[0];
      if (typeof op !== 'string') continue;
      heads.set(
        name,
        PLAIN_REFERENCE.test(op)
          ? { text: op, pure: false }
          : {
              refusal:
                `the \`operators\` entry of ${name} is the infix operator ` +
                `${JSON.stringify(op)}, which the existing emitter writes at its ` +
                `declared precedence: the profile admits an operator that is a ` +
                `name, which the existing emitter writes as a call`,
            }
      );
    }
  return { vars, heads, bindings: new Map(), defaulted: new Set() };
}

/**
 * The `vars` entry of the free symbol `node` on the structured route, or
 * `undefined` when no entry maps it. Throws the refusal of an entry that the
 * route does not admit (`VarsEntry`), and of an entry that maps a constant of
 * the library (`Pi`: the existing emitter writes the source in place of the
 * constant, which the rules of the route read as the constant) or a name
 * that holds a value and has no declared type (the engine keeps the value,
 * `withVarsValuesHidden()`, and the existing compiler types the name by it:
 * declare its type). A `read` entry is refused in the `complex` mode: the
 * existing emitter converts a wide read to a complex value where it is read,
 * once per part (`_SYS.cplx(next())`), and binds a complex operand ahead of
 * the code that it writes inline for the other operands.
 */
function varsEntryOf(
  node: Expression & { symbol: string },
  registry: StructuredRegistry | undefined
): Exclude<VarsEntry, { readonly refusal: string }> | undefined {
  const entry = registry?.hosts?.vars.get(node.symbol);
  if (entry === undefined) return undefined;
  if ('refusal' in entry)
    throw new Error(`JS scalar fragment: ${entry.refusal}`);
  // The symbol reads the binding of the library (`Pi`), not a binding of
  // the program of the same name (the index `i` of a sum).
  const library = systemScopeBinding(
    node.engine as unknown as Parameters<typeof systemScopeBinding>[0],
    node.symbol
  );
  if (
    library !== undefined &&
    ('value' in library
      ? node.valueDefinition === library.value
      : node.operatorDefinition === library.operator)
  )
    throw new Error(
      `JS scalar fragment: the option \`vars\` maps ${node.symbol}, a constant ` +
        `or an operator of the library, which the rules of the structured route read as the library defines it`
    );
  if (resolvedValueDefinition(node)?.value !== undefined)
    throw new Error(
      `JS scalar fragment: the option \`vars\` maps ${node.symbol}, which ` +
        `holds a value that the compilation does not hide (a constant, or a ` +
        `name with no declared type): the existing compiler types the name by ` +
        `its value; declare its type`
    );
  if (entry.form === 'read' && registry!.mode === 'complex')
    throw new Error(
      `JS scalar fragment: the option \`vars\` maps ${node.symbol} to a source ` +
        `that is not a read of the vars object, and the structured route admits ` +
        `such a read of the host in the \`strict\` mode only: the existing ` +
        `emitter converts it to a complex value once per part`
    );
  return entry;
}

/**
 * Admit the read `node` of the free symbol that a `read` entry of `vars`
 * maps (`varsEntryOf()`): the kind of its value is its declared type (an
 * integer or a real, or `number` and a union of a real type with `nan` or
 * `signed_infinity`, which are real in the `strict` mode), or the default
 * kind of the mode when it has no declared type, as for an input. Records
 * the binding of the host (`StructuredHosts.bindings`); its result type is
 * read from the annotation (`recordStructured()`).
 */
function admitHostRead(
  node: Expression & { symbol: string },
  registry: StructuredRegistry
): void {
  const hosts = registry.hosts!;
  const key = `read:${node.symbol}`;
  if (hasNoDeclaredType(node)) hosts.defaulted.add(node.symbol);
  else {
    const type = node.type.type;
    if (
      !isSubtype(type, 'real') &&
      declaredNumberKind(type, registry.mode)?.kind !== 'real'
    )
      throw new Error(
        `JS scalar fragment: the option \`vars\` maps ${node.symbol}, which has ` +
          `the type ${typeToString(type)}: the structured route reads a value of ` +
          `the host as a real number or an integer`
      );
  }
  if (!hosts.bindings.has(key))
    hosts.bindings.set(key, {
      name: node.symbol,
      form: 'read',
      result: isSubtype(node.type.type, 'integer') ? 'integer' : 'real',
      pure: false,
    });
}

/**
 * The head of a `functions` or `operators` entry that `node` calls, on the
 * structured route, or `undefined` when `node` is not such a call. Throws
 * the refusal of the head (`HostHead`), in the `complex` mode (the existing
 * emitter binds a complex operand ahead of the code that it writes inline
 * for the other operands), and for a result type that is not a real number
 * or an integer: the existing compiler reads the result type of the head
 * from its signature, declared or derived from its function literal
 * (`(real) -> real`, `(t) -> number`), and a head with no signature
 * (`unknown`) is a value of any shape there (`_SYS.bcast`). `number` and a
 * union of a real type with `nan` or `signed_infinity` are real, as the
 * existing compiler reads them in the `strict` mode. Records the binding of
 * the host (`StructuredHosts.bindings`).
 */
function hostHeadOf(
  node: Expression,
  registry: StructuredRegistry | undefined
): { readonly text: string; readonly pure: boolean } | undefined {
  if (!isFunction(node)) return undefined;
  const head = registry?.hosts?.heads.get(node.operator);
  if (head === undefined) return undefined;
  if ('refusal' in head) throw new Error(`JS scalar fragment: ${head.refusal}`);
  if (registry!.mode === 'complex')
    throw new Error(
      `JS scalar fragment: the call ${nodeText(node)} of a function of the ` +
        `host is in the structured route in the \`strict\` mode only`
    );
  const type = node.type.type;
  const result = isSubtype(type, 'integer')
    ? 'integer'
    : isSubtype(type, 'real') ||
        declaredNumberKind(type, 'strict')?.kind === 'real'
      ? 'real'
      : undefined;
  if (result === undefined)
    throw new Error(
      `JS scalar fragment: the function ${node.operator} of the host has the ` +
        `result type ${typeToString(type)}: the structured route calls a ` +
        `function of the host whose signature has a real or an integer ` +
        `result; declare its signature`
    );
  const key = `call:${node.operator}`;
  const known = registry!.hosts!.bindings.get(key);
  if (known === undefined)
    registry!.hosts!.bindings.set(key, {
      name: node.operator,
      form: 'call',
      result,
      pure: head.pure,
    });
  else if (known.result !== result)
    throw new Error(
      `JS scalar fragment: two calls of the function ${node.operator} of the ` +
        `host have the result types ${known.result} and ${result}`
    );
  return head;
}

/**
 * Whether the option `value` (`functions`, `operators` or `vars`) is given:
 * a function, or an object with at least one entry. An empty object gives
 * the same result as an absent option on the existing route (the same
 * `calling`, `code` and `run`), so it is treated as absent.
 */
function isGivenOption(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'function') return true;
  return typeof value !== 'object' || Object.keys(value).length > 0;
}

/** Record the facts of the structured route on the prepared `target`. */
function recordStructured(
  target: CompileTarget<Expression>,
  admission: Admission,
  prepared: {
    root: Expression;
    functionRoot?: Expression;
    annotation: FragmentAnnotation<ScalarRepresentation>;
    named: NamedCalls;
    /** Called on the structured route only. */
    inputs: () => readonly StructuredInput[];
    /** The names of the inputs with no declared type
     *  (`hasNoDeclaredType()`), which took the default kind. */
    defaulted: ReadonlySet<string>;
  }
): void {
  const registry = prepared.named.structured;
  if (!admission.structured || registry === undefined) return;
  const hosts = registry.hosts;
  const states = stateFacts(
    prepared.annotation,
    admission.testOperations,
    registry.helpers,
    hosts
  );
  refuseLazyDraws(prepared.annotation, registry.helpers);
  refuseLazyFunctionOperands(
    prepared.annotation,
    registry.helpers,
    hosts,
    registry.integrals,
    registry.routines
  );
  refuseHoistedDraws(
    prepared.annotation,
    registry.helpers,
    registry.captures,
    hosts
  );
  refusePureHostInAggregates(prepared.annotation, registry.helpers, hosts);
  chainForms(prepared.annotation, registry.helpers, hosts, registry.forms);
  refuseStrictWideReads(prepared.annotation, registry.mode);
  refuseBooleanListUses(prepared.annotation, registry.forms);
  refuseComplexElementLanes(
    prepared.annotation,
    registry.forms,
    registry.target
  );
  refuseUnstableLengthKeys(
    prepared.annotation,
    registry.forms,
    hostReadNames(registry)
  );
  refuseComplexListQuotients(prepared.annotation, registry.mode);
  refuseLocalFunctionArithmetic(
    prepared.annotation,
    registry.localFunctionNames,
    registry.mode
  );
  /** The names of the free symbols that are reads of the host: not
   *  inputs. */
  const reads = new Set(
    [...(hosts?.bindings.values() ?? [])]
      .filter((binding) => binding.form === 'read')
      .map((binding) => binding.name)
  );
  const inputs = prepared.inputs().filter((input) => !reads.has(input.name));
  const preparation: StructuredPreparation = {
    root: prepared.root,
    functionRoot: prepared.functionRoot,
    annotation: prepared.annotation,
    helpers: new Map(
      [...registry.helpers].map(([name, helper]) => [
        name,
        {
          name,
          body: helper.body,
          parameterElementLabels: helper.parameterElementLabels,
          ...(helper.captureArguments === undefined
            ? {}
            : { captureArguments: helper.captureArguments }),
        },
      ])
    ),
    captures: [...registry.captures.values()],
    folds: registry.folds,
    inputs,
    // A helper is listed by its name when a parameter took the default
    // kind: the host declares its signature.
    defaulted: [
      ...inputs
        .filter((input) => prepared.defaulted.has(input.name))
        .map((input) => input.name),
      ...[...reads].filter((name) => hosts!.defaulted.has(name)),
      // A local function has no declaration that the host could give.
      ...[...registry.helpers.values()]
        .filter(
          (helper) =>
            helper.defaulted.some((d) => d) &&
            !registry.localFunctions.has(helper.name)
        )
        .map((helper) => helper.name),
    ],
    effects: effectFacts(prepared.annotation, registry.localCalls),
    states,
    testOperations: admission.testOperations,
    forms: registry.forms,
    ...(registry.closedForms.size === 0
      ? {}
      : { closedForms: registry.closedForms }),
    ...(registry.integrals.size === 0 ? {} : { integrals: registry.integrals }),
    ...(registry.routines.size === 0 ? {} : { routines: registry.routines }),
    numericPolicy: registry.mode,
    iterationBudget: target.iterationBudget,
    ...(hosts === undefined || hosts.bindings.size === 0
      ? {}
      : { hosts: hostBindings(hosts, prepared.annotation) }),
  };
  recordStructuredPreparation(target, preparation);
  STRUCTURED_SOURCES.set(target, {
    hosts: new Map(
      [...(hosts?.bindings.values() ?? [])].map((binding) => {
        const head = hosts!.heads.get(binding.name);
        const entry = hosts!.vars.get(binding.name);
        const text =
          binding.form === 'call'
            ? head !== undefined && 'text' in head
              ? head.text
              : undefined
            : entry !== undefined && 'source' in entry
              ? entry.source
              : undefined;
        if (text === undefined)
          throw new Error(
            `JS scalar fragment invariant: no source for the host binding ${binding.name}`
          );
        return [`${binding.form}:${binding.name}`, text];
      })
    ),
    // The parameters of a root `Function` are its inputs: a `vars` entry
    // does not map them (the existing compiler reads a parameter first).
    inputs: new Map(
      prepared.functionRoot !== undefined
        ? []
        : inputs.flatMap((input) => {
            const entry = hosts?.vars.get(input.name);
            return entry !== undefined &&
              'form' in entry &&
              entry.form === 'input'
              ? [[input.name, entry] as const]
              : [];
          })
    ),
  });
}

/**
 * The code that the JavaScript emitter writes for the options of the host
 * of a compilation on the structured route, recorded with its preparation
 * (`recordStructured()`): the source of each host binding, by
 * `<form>:<name>` (`StructuredEmitOptions.host`), and each input whose
 * reads are the source of a `vars` entry, with whether the existing compiler
 * records it as a read of the vars object. The lowering does not read them.
 */
const STRUCTURED_SOURCES = new WeakMap<
  CompileTarget<Expression>,
  {
    readonly hosts: ReadonlyMap<string, string>;
    readonly inputs: ReadonlyMap<
      string,
      { readonly source: string; readonly recorded: boolean }
    >;
  }
>();

/**
 * The host bindings of `hosts`, in the order of their first node, as the
 * program has them (`IRProgram.hosts`). The result type of a read is the
 * type that the annotation gives to its name in the root scope, which must
 * be a real or an integer.
 */
function hostBindings(
  hosts: StructuredHosts,
  annotation: FragmentAnnotation<ScalarRepresentation>
): IRHostBinding[] {
  return [...hosts.bindings.values()].map((binding) => {
    if (binding.form === 'call') return binding;
    const facts = annotation.scope.bindings.get(binding.name);
    const kind = facts !== undefined && 'type' in facts ? facts.type.kind : '';
    if (kind !== 'real' && kind !== 'integer')
      throw new Error(
        `JS scalar fragment: the option \`vars\` maps ${binding.name}, which ` +
          `the program reads as a value of the type ${kind}: the structured ` +
          `route reads a value of the host as a real number or an integer`
      );
    return { ...binding, result: kind };
  });
}

/**
 * The route of the fragment target. `existing`: the existing emitter of the
 * fragment writes the code. `structured`: the program is lowered to the
 * structured representation (`javascript-structured-lower.ts`), verified,
 * and written by the structured emitter (`javascript-structured-emit.ts`);
 * the existing assembly of `JavaScriptTarget` builds the result from that
 * body. This route admits more operators and requires `cse: false` and
 * `constantFold: false`. A failure of a phase throws: nothing falls back to
 * the existing emitter.
 */
export type ScalarFragmentRoute = 'existing' | 'structured';

/** The phases of a compilation on the structured route, in order. */
export type StructuredPhase =
  | 'preparation'
  | 'annotation'
  | 'lowering'
  | 'verification'
  | 'emission'
  | 'assembly';

/** What a test or a benchmark can observe of the structured route. */
export type StructuredRouteHooks = {
  /**
   * Called at the end of each phase, with its duration in milliseconds.
   * `preparation` is `JavaScriptTarget.prepareCompilation()` and the checks
   * of the options; `annotation` is the admission, the annotation and the
   * facts of the route; `assembly`, reported last by `compile()`, is the
   * rest of the compilation (the wrappers of `compile()`, the code of
   * `compileToTarget()` around the emission, and the references of the
   * result). Without this hook, no time is read.
   */
  readonly onPhase?: (phase: StructuredPhase, milliseconds: number) => void;
  /** For tests only: the source of the operation that exists only for
   *  tests (`StructuredEmitOptions.trace`). */
  readonly trace?: (id: string, operands: readonly string[]) => string;
};

export class ScalarFragmentJavaScriptTarget extends JavaScriptTarget {
  private readonly admission: Admission;
  /** The sum of the phases reported in the current `compile()`. */
  private phaseSum = 0;

  /**
   * @param route The route of this target (`ScalarFragmentRoute`).
   * @param testOperations For tests only, on the structured route: the
   * heads that lower to the operation of the representation that exists
   * only for tests, with the trace id of each. Such a head takes real
   * operands and has a real value; its effect fact comes from its
   * declaration.
   * @param hooks On the structured route: the observer of the phases and
   * the source of the test operation (`StructuredRouteHooks`).
   */
  constructor(
    readonly route: ScalarFragmentRoute = 'existing',
    testOperations: ReadonlyMap<string, string> = new Map(),
    private readonly hooks: StructuredRouteHooks = {}
  ) {
    super();
    if (route === 'existing' && testOperations.size > 0)
      throw new Error(
        'JS scalar fragment: test operations exist only on the structured route'
      );
    this.admission =
      route === 'structured'
        ? structuredAdmission(testOperations)
        : EXISTING_ADMISSION;
  }

  /** The time now, when a hook observes the phases; otherwise 0. */
  private clock(): number {
    return this.hooks.onPhase ? globalThis.performance.now() : 0;
  }

  /** Report the end of `phase`, which started at `since` (`clock()`), and
   *  return the time now. Does nothing without an observer. */
  private endPhase(phase: StructuredPhase, since: number): number {
    const onPhase = this.hooks.onPhase;
    if (!onPhase) return 0;
    const now = globalThis.performance.now();
    this.phaseSum += now - since;
    onPhase(phase, now - since);
    return now;
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'javascript'> {
    // Called directly, this method is an operation (rule 8 of
    // `docs/plans/2026-11-09-binding-units-slice-1-spec.md`, see
    // `ce._opensOperation()`).
    if (expr.engine._opensOperation(false))
      return expr.engine._withOperation(expr, () =>
        this.compile(expr, options)
      );
    if (options.profile === 'numeric-kernel')
      return this.compileInProfile(expr, options);
    return this.compileOnRoute(expr, options);
  }

  /**
   * Whether the current compilation has the `numeric-kernel` profile
   * (`compileInProfile()`): the preparation then declines with
   * `'outside-profile'`, and an internal error names its phase.
   */
  private inProfile = false;

  /** The analysis of the program of the current compilation with the
   *  profile, set by the emitter of the body (`bodyEmitter()`). */
  private analysis: ExecutionAnalysis | undefined;

  /** The names that took the default kind in the current compilation with
   *  the profile (`StructuredPreparation.defaulted`), set by the emitter of
   *  the body. */
  private defaulted: readonly string[] | undefined;

  /** The decline of an option that the profile does not have, found in the
   *  options of the caller (`compileInProfile()`) and thrown by
   *  `prepareCompilation()`, inside the catch of `compile()` that applies
   *  `fallback`. */
  private optionDecline: CompileDeclineError | undefined;

  /**
   * A compilation with the `numeric-kernel` profile
   * (`CompilationOptions.profile`), on the structured route. The options
   * are checked as the caller gave them: `JavaScriptTarget.compile()` adds
   * a `functions` entry for each `vars` entry that names a user function,
   * and a decline must name the option of the caller. The option `profile`
   * is removed before `JavaScriptTarget.compile()`, which refuses it (a
   * direct call of a target). The options
   * `cse` and `constantFold` are ignored: the route does neither. A
   * successful result reports `profile`, `pure` (the calls are independent,
   * `analyzeExecution()`) and `shippable` (the code can run on a worker:
   * the analysis says so, and the checks of the existing assembly, which
   * look for a random draw in the code, say so too).
   */
  private compileInProfile(
    expr: Expression,
    options: CompilationOptions<Expression>
  ): CompilationResult<'javascript'> {
    if (this.route !== 'structured')
      throw new Error(
        "JS scalar fragment: the profile 'numeric-kernel' needs the structured route"
      );
    const previous = {
      inProfile: this.inProfile,
      analysis: this.analysis,
      defaulted: this.defaulted,
      optionDecline: this.optionDecline,
    };
    this.inProfile = true;
    this.analysis = undefined;
    this.defaulted = undefined;
    this.optionDecline = profileOptionDecline(options);
    try {
      const { profile: _profile, ...rest } = options;
      const result = this.compileOnRoute(expr, {
        ...rest,
        cse: false,
        constantFold: false,
      });
      const analysis = this.analysis as ExecutionAnalysis | undefined;
      if (!result.success || analysis === undefined) return result;
      const code = [
        result.preamble,
        result.preambleOnce,
        result.preamblePerCall,
        result.callCode,
        result.code,
      ].join('\n');
      result.profile = 'numeric-kernel';
      // The caller's `preamble` runs on every call, and the profile does not
      // read its text: a preamble that is not blank makes the result not
      // pure. An import is a function definition, which runs only when the
      // code calls it (through `functions`, a call of the host).
      result.pure =
        analysis.independentCalls.holds &&
        (options.preamble === undefined || options.preamble.trim() === '');
      // On a result called with a vars object, the existing assembly has
      // already combined the analysis with its own checks (the emission
      // gives it `shippable`), and `broadcastAsync()` reads the same value.
      result.shippable =
        analysis.workerPortable.holds &&
        (result.shippable ?? isShippableCode(code));
      const defaulted = this.defaulted as readonly string[] | undefined;
      if (defaulted !== undefined && defaulted.length > 0)
        result.defaultedSymbols = [...defaulted];
      return result;
    } finally {
      this.inProfile = previous.inProfile;
      this.analysis = previous.analysis;
      this.defaulted = previous.defaulted;
      this.optionDecline = previous.optionDecline;
    }
  }

  private compileOnRoute(
    expr: Expression,
    options: CompilationOptions<Expression>
  ): CompilationResult<'javascript'> {
    const onPhase = this.hooks.onPhase;
    if (this.route !== 'structured') return super.compile(expr, options);
    return withStructuredCompilation(() => {
      if (!onPhase) return super.compile(expr, options);
      this.phaseSum = 0;
      const start = globalThis.performance.now();
      const result = super.compile(expr, options);
      onPhase('assembly', globalThis.performance.now() - start - this.phaseSum);
      return result;
    });
  }

  /**
   * On the structured route, the emitter of the body: lower the program of
   * the preparation recorded on `target`, verify it and emit it.
   */
  protected bodyEmitter(
    target: CompileTarget<Expression>
  ): JavaScriptBodyEmitter | undefined {
    if (this.route !== 'structured') return undefined;
    const bigint = BIGINT_PROGRAMS.get(target);
    if (bigint !== undefined) return (names) => this.bigintBody(bigint, names);
    const preparation = structuredPreparationOf(target);
    return (names) => {
      let time = this.clock();
      // A captured binding that changed after the preparation fails here:
      // the annotation typed its snapshot. The compiled code holds the
      // snapshot, so the result depends on each captured binding and on
      // each helper definition, as on the existing route
      // (`CompileTarget.symbolDeps`).
      for (const capture of preparation.captures) {
        capture.assertCurrent();
        target.symbolDeps?.add(capture.name);
      }
      for (const name of preparation.helpers.keys())
        target.symbolDeps?.add(name);
      const program = this.inPhase('lowering', () =>
        lowerStructuredProgram(preparation)
      );
      time = this.endPhase('lowering', time);
      this.inPhase('verification', () =>
        verifyJavaScriptProgram(program, preparedNodesOf(preparation))
      );
      time = this.endPhase('verification', time);
      // With the profile, the facts of the result (`compileInProfile()`).
      const analysis = this.inProfile
        ? this.inPhase('analysis', () => analyzeExecution(program))
        : undefined;
      this.analysis = analysis;
      this.defaulted = preparation.defaulted;
      // The options of the host: an input that a `vars` entry maps is read
      // with the source of the entry, and a host operation is the code that
      // the existing emitter writes for its entry (`STRUCTURED_SOURCES`).
      const sources = STRUCTURED_SOURCES.get(target);
      const emission = this.inPhase('emission', () =>
        emitStructuredProgram(
          program,
          {
            ...names,
            input: (name) =>
              sources?.inputs.get(name)?.source ?? names.input(name),
          },
          {
            trace: this.hooks.trace,
            host: (binding, operands) => {
              const text = sources?.hosts.get(
                `${binding.form}:${binding.name}`
              );
              if (text === undefined)
                throw new Error(
                  `JS scalar fragment invariant: no source for the host binding ${binding.name}`
                );
              return binding.form === 'read'
                ? text
                : `${text}(${operands.join(', ')})`;
            },
          }
        )
      );
      this.endPhase('emission', time);
      // An input read with a source that is not its own spelling (`_.z` or
      // `_["u"]` for `u`) is not a read of the vars object that the existing
      // compiler records (`CompileTarget.varsObjectRefs`), so it has no entry
      // check either.
      const inputs = new Set(
        [...emission.inputs].filter(
          (name) => sources?.inputs.get(name)?.recorded !== false
        )
      );
      return {
        ...emission,
        inputs,
        mode: program.numericPolicy,
        ...(analysis !== undefined
          ? { shippable: analysis.workerPortable.holds }
          : {}),
      };
    };
  }

  /**
   * The body of a program of the mode `bigint` (`prepareBigint()`): the
   * program verified with the policy `JS-bigint`, its analysis, and its code
   * in the wrapper of the entry (`emitStructuredProgram()`). The result
   * reports the mode `bigint`.
   */
  private bigintBody(
    lowered: {
      readonly program: IRProgram;
      readonly preparedNodes: ReadonlySet<Expression>;
    },
    names: JavaScriptBodyNames
  ): JavaScriptBody {
    const { program, preparedNodes } = lowered;
    let time = this.clock();
    this.inPhase('verification', () =>
      verifyJavaScriptProgram(program, preparedNodes)
    );
    time = this.endPhase('verification', time);
    const analysis = this.inProfile
      ? this.inPhase('analysis', () => analyzeExecution(program))
      : undefined;
    this.analysis = analysis;
    this.defaulted = undefined;
    const emission = this.inPhase('emission', () =>
      emitStructuredProgram(program, names)
    );
    this.endPhase('emission', time);
    return {
      ...emission,
      mode: 'bigint',
      ...(analysis !== undefined
        ? { shippable: analysis.workerPortable.holds }
        : {}),
    };
  }

  /**
   * Run `step`, a phase of the structured route after the admission. With
   * the profile, an error of the phase is an internal error that names the
   * phase (`profileInternalError()`), never a refusal: the admission has
   * accepted the program. A cancellation is thrown as it is. A program
   * over the limit of the lowering (`StructuredLimitError`) declines with
   * `'outside-profile'`.
   */
  private inPhase<T>(phase: string, step: () => T): T {
    if (!this.inProfile) return step();
    try {
      return step();
    } catch (e) {
      if (isCancellation(e)) throw e;
      if (e instanceof StructuredLimitError)
        throw new CompileDeclineError({
          code: 'outside-profile',
          kind: 'capability',
          message:
            `Could not compile with the profile 'numeric-kernel': the ` +
            `program has more than ${STRUCTURED_OPERATION_LIMIT} operations, ` +
            `the limit of the profile`,
        });
      if (e instanceof StructuredDeclineError)
        throw new CompileDeclineError({
          code: 'outside-profile',
          kind: 'capability',
          message: `Could not compile with the profile 'numeric-kernel': ${e.message}`,
        });
      throw profileInternalError(phase, e);
    }
  }

  /**
   * Prepare `expr` on the structured route and return the facts that the
   * lowering reads (`lowerStructuredFragment()`). Admission and the
   * annotation run here, as in `compile()`; nothing is emitted.
   */
  prepareStructured(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): StructuredPreparation {
    if (this.route !== 'structured')
      throw new Error('JS scalar fragment: not the structured route');
    return withStructuredCompilation(() =>
      structuredPreparationOf(this.prepareCompilation(expr, options).target)
    );
  }

  /**
   * With the profile, an option that the profile does not have, and every
   * refusal of the preparation, decline with `'outside-profile'`
   * (`profileOptionDecline()`, `profileDecline()`).
   */
  protected prepareCompilation(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch?: unknown
  ): { expr: Expression; target: CompileTarget<Expression> } {
    if (!this.inProfile) return this.prepareFragment(expr, options, batch);
    if (this.optionDecline !== undefined) throw this.optionDecline;
    // An import that is not a function throws the error of the existing
    // route (`JavaScriptTarget.prepareCompilation()`), not an internal error.
    for (const x of options.imports ?? [])
      if (typeof x !== 'function')
        throw new Error(`Unsupported import \`${x}\``);
    try {
      if (options.mode === 'bigint' && this.admission.structured)
        return this.prepareBigint(expr, options, batch);
      return this.prepareFragment(expr, options, batch);
    } catch (e) {
      throw profileDecline(e);
    }
  }

  /**
   * The preparation of a compilation with the profile in the mode `bigint`
   * (`docs/plans/2026-11-11-structured-bigint-mode.md`). The preparation of
   * the JavaScript target runs the lane analysis of the mode
   * (`requireBigintLane()`), which is the admission: a `bigint-lane` decline
   * is the decline `'outside-profile'` with its reason. The program is
   * lowered here (`lowerBigintProgram()`), so that a node that the route
   * does not lower yet declines too, and is verified and emitted by the
   * emitter of the body (`bodyEmitter()`). The admission of `fragment.ts`
   * does not run: it types the double and the complex modes only.
   */
  private prepareBigint(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch: unknown
  ): { expr: Expression; target: CompileTarget<Expression> } {
    if (batch !== undefined)
      throw new Error('JS scalar fragment: unsupported compile options');
    const option = bigintOptionRefusal(options);
    if (option !== undefined)
      throw new Error(
        `JS scalar fragment: the option \`${option}\` is not in the profile in the mode bigint`
      );
    let prepared: { expr: Expression; target: CompileTarget<Expression> };
    try {
      prepared = super.prepareCompilation(expr, options);
    } catch (e) {
      if (isCompileDeclineError(e) && e.diagnostic.code === 'bigint-lane')
        throw bigintLaneProfileDecline(e);
      throw e;
    }
    const analysis = bigintLaneAnalysisFor(prepared.expr, prepared.target);
    const time = this.clock();
    const lowered = this.inPhase('lowering', () => {
      try {
        return lowerBigintProgram(prepared.expr, analysis);
      } catch (e) {
        if (e instanceof StructuredBigintRefusal) return e;
        throw e;
      }
    });
    this.endPhase('lowering', time);
    if (lowered instanceof StructuredBigintRefusal) {
      const refusal = new Error(`${FRAGMENT_PREFIX}${lowered.reason}`);
      noteRefusedNode(refusal, { node: lowered.node });
      throw refusal;
    }
    // The compiled code holds the code of each user function that it calls
    // and the value of each symbol that a constant folds, so the result
    // depends on each such definition, as on the other routes
    // (`CompileTarget.symbolDeps`).
    for (const name of lowered.dependencies)
      prepared.target.symbolDeps?.add(name);
    BIGINT_PROGRAMS.set(prepared.target, lowered);
    return prepared;
  }

  private prepareFragment(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch?: unknown
  ): { expr: Expression; target: CompileTarget<Expression> } {
    const structured = this.admission.structured;
    const start = structured ? this.clock() : 0;
    // The structured route admits the options of the host (`vars`,
    // `functions`, the record form of `operators`, `imports`, `preamble`;
    // `structuredHosts()`) and makes no batch body for `broadcast`.
    if (
      batch !== undefined ||
      (!structured &&
        (options.broadcast ||
          isGivenOption(options.functions) ||
          isGivenOption(options.operators) ||
          isGivenOption(options.vars) ||
          options.preamble ||
          options.imports?.length)) ||
      typeof options.operators === 'function' ||
      (options.mode !== undefined &&
        options.mode !== 'strict' &&
        options.mode !== 'complex')
    )
      throw new Error('JS scalar fragment: unsupported compile options');
    const admission = this.admission;
    // The structured route has no common-subexpression pass and no constant
    // folding. An option that asks for one is refused, not ignored.
    if (admission.structured && options.cse !== false)
      throw new Error(
        'JS scalar fragment: the structured route requires cse: false'
      );
    if (admission.structured && options.constantFold !== false)
      throw new Error(
        'JS scalar fragment: the structured route requires constantFold: false'
      );
    if (admission.structured) refuseSumOfNestedSums(expr);
    const definition = admission.definition;
    const prepared = super.prepareCompilation(expr, options);
    // The admission searches for the closed forms of the integrals
    // (`closedFormReplacement()`) with the full pool of steps of a
    // compilation, as the existing compiler does: its outermost compilation
    // resets the pool after the preparation (`resetOutermostCompilation()`
    // in `compiler-core.ts`), which the structured route does not run.
    // The memos of the compilation are emptied there too
    // (`resetCompilationState()`): an answer of `nameHasAngularDefinition()`
    // made with the definitions of another compilation would be read by the
    // search for a closed form.
    if (structured && isOutermostStructuredCompilation()) {
      resetCompilationState();
      BaseCompiler.resetSharedCompilationBudgets();
    }
    const annotationStart = structured
      ? this.endPhase('preparation', start)
      : 0;
    // The annotation, with the facts of the body of a root function and of
    // the helper definitions, is built here, before any emission.
    const registry = structuredRegistry(admission, prepared.target);
    if (registry !== undefined) {
      registry.hosts = structuredHosts(prepared.expr, options, prepared.target);
      // A root symbol that an `operators` entry maps compiles to a function
      // of the operator on the existing route (`(a, b) => a op b`).
      if (
        isSymbol(prepared.expr) &&
        registry.hosts.heads.has(prepared.expr.symbol) &&
        options.operators !== undefined &&
        Object.hasOwn(options.operators, prepared.expr.symbol)
      )
        throw new Error(
          `JS scalar fragment: the root is the symbol ${prepared.expr.symbol}, ` +
            `which an \`operators\` entry maps: the existing compiler compiles ` +
            `it to a function of the operator`
        );
    }
    if (isFunction(prepared.expr, 'Function')) {
      // A refusal that no inner check records names the function itself.
      atNode(prepared.expr, () =>
        attachBoundFunction(prepared.expr, prepared.target, admission, registry)
      );
      if (structured) this.endPhase('annotation', annotationStart);
      return prepared;
    }
    // A root `Block` with statements, on the structured route: the
    // admission of the body of a root function, with the free symbols as
    // the inputs (`attachRootBlock()`).
    if (
      registry !== undefined &&
      isFunction(prepared.expr, 'Block') &&
      isLibraryOperator(prepared.expr, 'Block') &&
      prepared.expr.nops > 1
    ) {
      atNode(prepared.expr, () =>
        attachRootBlock(prepared.expr, prepared.target, admission, registry)
      );
      this.endPhase('annotation', annotationStart);
      return prepared;
    }
    // An expression that holds a block with statements as a value (`{ a ≔
    // 3.7x; a − ⌊a⌋ } + 1`, `Block(Block(…))`): the admission of a root
    // block, with the free symbols as the inputs and the statements of each
    // such block checked where it is (`checkValueBlock()`).
    if (registry !== undefined && holdsValueBlock(prepared.expr)) {
      atNode(prepared.expr, () =>
        attachRootBlock(
          prepared.expr,
          prepared.target,
          admission,
          registry,
          !isFunction(prepared.expr, 'Block')
        )
      );
      this.endPhase('annotation', annotationStart);
      return prepared;
    }
    const named: NamedCalls = { calls: new Set(), structured: registry };
    const seen = new Set<Expression>();
    /** The declared type of each free symbol, for the label of a list
     *  input (`elementLabel()`). */
    const symbolTypes = new Map<string, Type>();
    /** The free symbols with no declared type, which take the default
     *  kind of the mode (`hasNoDeclaredType()`). */
    const defaulted = new Set<string>();
    /** The free symbols declared `number` in the `complex` mode
     *  (`declaredNumberKind()`). */
    const lifted = new Set<string>();
    let readsSqrt = false;
    /** The indexes of the comprehensions around the node being checked. */
    const indexes = new Set<string>();
    const check = (node: Expression): void =>
      atNode(node, () => checkNode(node));
    // The names that a form of the expression binds (`decidedBranch()`),
    // or of the captured expression being checked (`checkStored()`).
    let rootBound: ReadonlySet<string> | undefined;
    let storedBound: ReadonlySet<string> | undefined;
    const boundInRoot = (name: string): boolean =>
      (storedBound ?? (rootBound ??= namesBoundIn(prepared.expr))).has(name);
    // A captured expression (`recordCapture()`) is checked where its names
    // are read: in the root, with no index of the read around it.
    const checkStored = (stored: Expression): void => {
      const outerIndexes = [...indexes];
      const outerBound = storedBound;
      indexes.clear();
      storedBound = namesBoundIn(stored);
      try {
        check(stored);
      } finally {
        indexes.clear();
        for (const index of outerIndexes) indexes.add(index);
        storedBound = outerBound;
      }
    };
    /** The `Return` nodes of the expression out of tail position
     *  (`nonTailReturns()`), computed at the first `Return`. */
    let rootNotTail: Set<Expression> | undefined;
    const checkNode = (node: Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);
      // `Return(v)` in tail position of the expression (the root, the value
      // of a block of one value there, a branch of an `If` there) is its
      // value `v`, as the existing emitter writes it (`_.y + 1` for
      // `Return(y + 1)`).
      if (structured && isReturnNode(node)) {
        const ops = (node as Expression & { ops: readonly Expression[] }).ops;
        if (
          ops.length !== 1 ||
          !isTailOf(prepared.expr, node) ||
          (rootNotTail ??= nonTailReturns(prepared.expr)).has(node)
        )
          throw new Error(
            `JS scalar fragment: the structured route admits a Return only in ` +
              `tail position, where it is the value of the expression, and not ` +
              `${nodeText(node)}`
          );
        return check(ops[0]);
      }
      // A calculus node is the expression that replaces it
      // (`closedFormReplacement()`); a definite integral with no closed
      // form is checked as itself, its variables bound as indexes
      // (`structuredValueParts()`).
      if (registry !== undefined && isCalculusNode(node)) {
        const replacement = closedFormReplacement(
          node,
          registry,
          prepared.target,
          node !== prepared.expr
        );
        if (replacement !== node) return check(replacement);
      }
      // An `If` or a `Which` whose constant conditions select a branch is
      // that branch: the existing emitter writes no code for the conditions
      // and the other branches (`decidedBranch()`).
      if (structured)
        refuseSelections(node, boundInRoot, node === prepared.expr);
      const decided = structured ? decidedBranch(node, boundInRoot) : undefined;
      if (decided !== undefined) return check(decided);
      refuseListHead(node, admission);
      refuseBooleanClaim(node, admission);
      refuseUndirectedInfinity(node, admission);
      refuseHaversineGrouping(
        node,
        admission,
        (op) =>
          isSymbol(op) &&
          !indexes.has(op.symbol) &&
          resolvedValueDefinition(op)?.value === undefined &&
          isInputEntry(registry?.hosts?.vars.get(op.symbol))
      );
      refuseWideRead(node, admission, registry?.mode);
      refuseUnsettledFold(node, admission, registry?.mode, () => false);
      refuseUnsettledCollection(node, admission, registry?.mode, () => false);
      refuseMixedOperand(node, admission, registry?.mode);
      if (!node.isValid || node.type.type === 'error')
        throw new Error('JS scalar fragment: invalid expression');
      if (isNumber(node)) return;
      // A call of a function of the host (`hostHeadOf()`).
      if (hostHeadOf(node, registry) !== undefined) {
        for (const operand of (node as Expression & { ops: Expression[] }).ops)
          check(operand);
        return;
      }
      // A block of one value and a comprehension, on the structured route
      // (`structuredValueParts()`); `Typed` is not the value of a body here.
      const parts = structured
        ? structuredValueParts(node, false, registry)
        : undefined;
      if (parts !== undefined) {
        for (const operand of parts.outer) check(operand);
        const added: string[] = [];
        try {
          for (const { index, bounds } of parts.indexes ?? []) {
            for (const bound of bounds)
              checkAggregateBound(node, bound, registry, check);
            // The variable of a derivative or a limit computed numerically
            // shadows a name around it: the body is a closure of its own
            // parameter, and the point is read where the node is.
            if (registry?.routines.has(node) === true) {
              if (!indexes.has(index)) {
                indexes.add(index);
                added.push(index);
              }
              continue;
            }
            if (indexes.has(index))
              throw new Error(
                `JS scalar fragment: the ${indexLabel(node)} index ${index} has the name of another index`
              );
            indexes.add(index);
            added.push(index);
          }
          for (const operand of parts.inner) check(operand);
        } finally {
          for (const index of added) indexes.delete(index);
        }
        return;
      }
      if (isSymbol(node)) {
        if (node.symbol === 'True' || node.symbol === 'False') return;
        if (indexes.has(node.symbol)) return;
        symbolTypes.set(node.symbol, node.type.type);
        // A `vars` entry: a read of the host, or an input whose reads are
        // the source of the entry (`varsEntryOf()`).
        const mapped = varsEntryOf(node, registry);
        if (mapped?.form === 'read') return admitHostRead(node, registry!);
        // The structured route reads a captured binding as its snapshot,
        // also a value of the frame of a call (`frameValue()`).
        const held =
          resolvedValueDefinition(node)?.value !== undefined ||
          (registry !== undefined && frameValue(node) !== undefined);
        if (
          registry &&
          mapped === undefined &&
          held &&
          recordCapture(registry, node, checkStored)
        )
          return;
        if (held)
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}${
              registry === undefined ? '' : heldValueCause(node)
            }`
          );
        // A free symbol with no declared type is an input of the default
        // kind of the mode (`defaultKind()`); its inferred type is not
        // read.
        if (registry && hasNoDeclaredType(node)) {
          defaulted.add(node.symbol);
          return;
        }
        // A free symbol declared `number` has the kind of `number` in the
        // mode (`declaredNumberKind()`).
        const numberKind = registry
          ? declaredNumberKind(node.type.type, registry.mode)
          : undefined;
        if (numberKind !== undefined) {
          if (numberKind.lifted) lifted.add(node.symbol);
          return;
        }
        const list = structured
          ? structuredListType(node.type.type, registry?.mode)
          : undefined;
        if (list !== undefined && 'refusal' in list)
          throw new Error(
            `JS scalar fragment: the input ${node.symbol} has ${list.refusal}`
          );
        if (
          definition.typeOfSymbol(node) === undefined &&
          !(
            structured &&
            (list !== undefined ||
              structuredTupleType(node.type.type, registry?.mode) !== undefined)
          )
        )
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}${
              structured
                ? unionCause(node.type.type) || scopedNameCause(node)
                : ''
            }`
          );
        return;
      }
      // A `Loop` is a statement of the body of a root `Function`.
      if (structured && isFunction(node, 'Loop'))
        throw new Error(
          'JS scalar fragment: the structured route admits a Loop only as a ' +
            'statement of the body of a root Function'
        );
      // A block of one value is a value (`structuredValueParts()`, above).
      if (
        structured &&
        isFunction(node, 'Block') &&
        isLibraryOperator(node, 'Block') &&
        node.nops === 0
      )
        throw new Error(
          'JS scalar fragment: an empty Block is not in the structured route: ' +
            'it has no value'
        );
      if (
        structured &&
        isFunction(node, 'Block') &&
        isLibraryOperator(node, 'Block')
      )
        throw new Error(
          'JS scalar fragment: the structured route admits a Block with ' +
            'statements only as the root of the compiled expression or as the ' +
            'body of a Function, and not as an operand'
        );
      if (isFunction(node) && !Object.hasOwn(definition.rules, node.operator)) {
        collectHelper(node, prepared.target, named, admission);
        for (const operand of node.ops) check(operand);
        return;
      }
      if (
        !isFunction(node) ||
        !Object.hasOwn(definition.rules, node.operator) ||
        !isAdmittedOperator(node, admission)
      )
        throw new Error(
          `JS scalar fragment: unsupported head ${node.operator}`
        );
      // The structured route also admits `If(c, v)` used as a value, as a
      // `Which` of one clause (`selectionRule()`).
      if (
        (node.operator === 'If' &&
          node.nops !== 3 &&
          !(structured && node.nops === 2)) ||
        ((node.operator === 'Sqrt' || node.operator === 'Negate') &&
          node.nops !== 1)
      )
        throw new Error(
          `JS scalar fragment: unsupported arity: ${node.operator} with ` +
            `${node.nops} operands`
        );
      if (structured) refuseSelection(node);
      checkCondition(node);
      if (node.operator === 'Sqrt') readsSqrt = true;
      for (const operand of admittedOperands(node)) check(operand);
    };
    if (registry !== undefined) {
      registry.helperInputs = [];
      // A captured expression that the body of a helper reads is checked
      // where the root computes it, as one that the root reads.
      registry.rootStored = (stored) => checkStored(stored);
    }
    check(prepared.expr);
    // The inputs that the body of a helper reads (`admitHelperInput()`),
    // each with the rule of a free symbol of the expression, read with no
    // index around it (a node object that the root reached under an index
    // of the same name is checked again).
    for (const node of registry?.helperInputs ?? []) {
      seen.delete(node);
      check(node);
    }
    if (registry !== undefined) refuseBoundStoredNames(registry, boundInRoot);
    const annotate = () => annotateCalls(prepared.expr, definition, named);
    // The rule of `Sqrt` of the structured route reads no compiler state.
    const annotation =
      readsSqrt && !structured
        ? withOutermostCompilerState(prepared.target, annotate)
        : annotate();
    attachScalarFragment(prepared.target, {
      root: prepared.expr,
      helper: named.helper,
      annotation,
    });
    // The inputs of an expression are its free symbols, in the order of
    // their first read: the pass binds each one in the root scope there.
    recordStructured(prepared.target, admission, {
      root: prepared.expr,
      annotation,
      named,
      inputs: () =>
        [...annotation.scope.bindings].map(([name, facts]) =>
          structuredInput(
            name,
            facts.type,
            symbolTypes.get(name),
            (defaulted.has(name) && registry?.mode === 'complex') ||
              lifted.has(name)
          )
        ),
      defaulted,
    });
    if (structured) this.endPhase('annotation', annotationStart);
    return prepared;
  }
}

/**
 * Refuse an `If` whose condition the fragment does not lower as a test of a
 * boolean at run time. A condition whose type is the value `true` or `false`
 * is decided by the existing emitter at compile time, which writes one
 * branch only and no test; the annotation has facts for the test and both
 * branches. A condition whose type is not `boolean` would need a guard.
 */
function checkCondition(
  node: Expression,
  helper?: {
    readonly name: string;
    readonly defaulted?: ReadonlySet<string>;
    readonly mode?: 'strict' | 'complex';
  }
): void {
  // The conditions of a `Which` (the structured route), but a last `True`,
  // have the rule of the condition of an `If`.
  if (isFunction(node, 'Which') && isLibraryOperator(node, 'Which')) {
    node.ops.forEach((op, i) => {
      if (i % 2 === 0 && !isSymbol(op, 'True'))
        checkConditionOf('Which', op, helper);
    });
    return;
  }
  if (!isFunction(node, 'If') || node.nops < 2 || node.nops > 3) return;
  checkConditionOf('If', node.op1, helper);
}

/** The rule of `checkCondition()` for the condition `condition` of an `If`
 *  or of a `Which`. */
function checkConditionOf(
  head: 'If' | 'Which',
  condition: Expression,
  helper?: {
    readonly name: string;
    readonly defaulted?: ReadonlySet<string>;
    readonly mode?: 'strict' | 'complex';
  }
): void {
  const type = condition.type.type;
  // In the body of a helper, the refusal names the helper, as a refusal of
  // the pass does, and a parameter that took the default kind of the mode.
  const defaulted =
    helper?.mode !== undefined &&
    isSymbol(condition) &&
    helper.defaulted?.has(condition.symbol) === true
      ? `: the parameter ${condition.symbol} has no declared type, and it is ` +
        `${defaultKind(helper.mode).kind} in the \`${helper.mode}\` mode`
      : '';
  const suffix =
    helper === undefined
      ? ''
      : ` (in the body of the user function \`${helper.name}\`)`;
  if (
    typeof type === 'object' &&
    type.kind === 'value' &&
    typeof type.value === 'boolean'
  )
    throw new Error(
      `JS scalar fragment: the condition of ${head} has the constant type ${type.value}${suffix}`
    );
  // A flat list of booleans is the condition of an element-wise selection,
  // whose rule reads it (`selectionBroadcastRule()`).
  if (!isSubtype(type, 'boolean') && !isSubtype(type, 'list<boolean>'))
    throw new Error(
      `JS scalar fragment: the condition of ${head} does not have the type boolean${defaulted}${suffix}`
    );
}

/** Throw the refusal of a `Which` or of an `If(c, v)` used as a value
 *  (`selectionRefusal()`) on the structured route, before its operands are
 *  checked: a value `Nothing` would otherwise be read as a name. */
function refuseSelection(node: Expression): void {
  const message =
    isFunction(node) && isLibraryOperator(node, node.operator)
      ? selectionRefusal(node)
      : undefined;
  if (message !== undefined) throw new Error(`JS scalar fragment: ${message}`);
}

/**
 * The number of compilations of the structured route in progress
 * (`withStructuredCompilation()`). The route does not enter
 * `compileExpressionInFrame()`, so `CompilerState._compileDepth` does not
 * count it: a compilation of the route started while another one runs must
 * not empty the memos of the outer one.
 */
let structuredCompilations = 0;

/** Whether the compilation of the structured route in progress is the
 *  outermost one: no compilation of the existing compiler runs around it,
 *  and no other compilation of the route. */
function isOutermostStructuredCompilation(): boolean {
  return CompilerState._compileDepth === 0 && structuredCompilations <= 1;
}

/**
 * Run a compilation of the structured route (`compileOnRoute()`,
 * `prepareStructured()`). When it is the outermost compilation, the memos
 * are emptied when it ends, also after a decline or an error, as the
 * existing compiler empties them (`compileExpressionInFrame()` in
 * `compiler-core.ts`); `prepareFragment()` empties them when it starts.
 */
function withStructuredCompilation<T>(run: () => T): T {
  structuredCompilations += 1;
  try {
    return run();
  } finally {
    const outermost = isOutermostStructuredCompilation();
    structuredCompilations -= 1;
    if (outermost) resetCompilationState();
  }
}

/**
 * Empty the module-wide memos of a compilation, as the existing compiler
 * does when its outermost compilation starts and ends
 * (`resetOutermostCompilation()` and `compileExpressionInFrame()` in
 * `compiler-core.ts`): those of `resetCompilationMemos()` (among them
 * `_angularDefinitionMemo`, which `closedFormIntegral()` reads, keyed by a
 * name only), and `_variantResultTypeMemo`. The memos depend on the
 * definitions of the engine, which can change between two compilations.
 */
function resetCompilationState(): void {
  BaseCompiler.resetCompilationMemos();
  CompilerState._variantResultTypeMemo = new WeakMap();
}

/** The heads of the nodes that the existing compiler replaces by a closed
 *  form before it writes code (`closedFormReplacement()`). */
const CALCULUS_HEADS = ['Integrate', 'D', 'ND', 'Derivative', 'Limit'];

/**
 * The most steps of the shared pool of the compilation
 * (`ANTIDERIVATIVE_COMPILATION_STEPS`) that the searches for the closed
 * forms of the integrals of a program spend on the structured route. The
 * route searches once for each node, and the existing compiler searches
 * again at each place where it writes the node: each occurrence, each term
 * of an unrolled `Sum` or `Product`. When its searches spend the pool, a
 * later search gets fewer steps, or none, and can end with no closed form
 * where the route found one. The cap lowers the chance of that, and does
 * not exclude it: the existing compiler can repeat a search more than 30
 * times (an unrolled `Sum` of up to 100 terms, `UNROLL_LIMIT` in
 * `javascript-target.ts`), and 30 searches of this many steps fill the pool
 * minus one attempt. A search of an elementary integral spends fewer than
 * 50 steps. The case is a known limitation (`docs/COMPILATION-MODEL.md`,
 * "Known limitations").
 */
const CLOSED_FORM_SEARCH_STEPS = 10_000;

/** The replacements of the applications of a derivative
 *  (`closedFormReplacement()`): `Apply` of the function literal of the
 *  closed form to the arguments. */
const DERIVATIVE_APPLICATIONS = new WeakSet<Expression>();

/** Whether `node` is a node of a head of `CALCULUS_HEADS`, or the
 *  application of a `Derivative`, of the library. */
function isCalculusNode(node: Expression): boolean {
  if (!isFunction(node)) return false;
  if (CALCULUS_HEADS.includes(node.operator))
    return isLibraryOperator(node, node.operator);
  return (
    node.operator === 'Apply' &&
    isLibraryOperator(node, 'Apply') &&
    isFunction(node.ops[0], 'Derivative') &&
    isLibraryOperator(node.ops[0], 'Derivative')
  );
}

/**
 * The expression that the structured route lowers in place of `node`, a
 * calculus node (`isCalculusNode()`), or a refusal. It is the expression
 * from which the existing compiler writes the code of the node, found by
 * the same function, at the admission of the node:
 *
 * - `Integrate`: the closed form of `closedFormIntegral()`
 *   (`compileIntegrate()` in `javascript-target.ts`), which the existing
 *   compiler writes in parentheses. With no closed form, it integrates
 *   numerically (`_SYS.integrate`), which the route does not have.
 * - `D`, `ND`, `Derivative`: the closed form of `derivativeClosedForm()`
 *   (`compileDerivative()` in `library/calculus.ts`), which the existing
 *   compiler writes in parentheses too.
 * - `Apply(Derivative(f, n…), x…)`: the application of the function
 *   literal of `derivativeClosedForm()` to the arguments, which the
 *   existing compiler writes as the call of the literal (the rule of
 *   `Apply` in `javascript-target.ts`). A derivative that it writes with
 *   Taylor jets (`jetDerivativeTarget()`) is refused.
 *
 * The replacement of a node is found once, and kept in
 * `registry.closedForms`. Each name of the node, and each user function
 * that it calls, at any depth, is a dependency of the compiled code
 * (`CompileTarget.symbolDeps`): a closed form can hold the value of a
 * name or the body of a function. The `complex` mode is refused: the
 * existing compiler reads the node there in the lane of its type.
 */
function closedFormReplacement(
  node: Expression,
  registry: StructuredRegistry,
  target: CompileTarget<Expression>,
  operand: boolean
): Expression {
  if (!isFunction(node))
    throw new Error('JS scalar fragment invariant: expected a calculus node');
  const head =
    node.operator === 'Apply' ? `Apply of ${node.op1.operator}` : node.operator;
  if (registry.mode === 'complex')
    throw new Error(
      `JS scalar fragment: ${head} in the complex mode is not in the ` +
        `structured route: the existing compiler reads its closed form in ` +
        `the lane of the type of the node`
    );
  // A definite integral with no closed form is the node itself
  // (`quadratureIntegral()`).
  let replacement =
    registry.closedForms.get(node) ??
    (registry.integrals.has(node) || registry.routines.has(node)
      ? node
      : undefined);
  if (replacement === undefined) {
    replacement = findClosedForm(node, registry, target);
    if (replacement !== node) {
      registry.closedForms.set(node, replacement);
      for (const name of calculusDependencies(node))
        target.symbolDeps?.add(name);
    }
  }
  // A complex number in the node or in its replacement: the existing
  // compiler can read the node on the complex lane around a real closed
  // form (`(∫ᵢ⁰ t dt)²` gives `{re: NaN, im: NaN}` there).
  const complex = complexPartOf(node) ?? complexPartOf(replacement);
  if (complex !== undefined)
    throw new Error(
      `JS scalar fragment: ${nodeText(node)} reads the complex value ` +
        `${nodeText(complex)}: the existing compiler can read the node on ` +
        `the complex lane`
    );
  // A closed form `0` as an operand: the existing compiler writes `(0)`, a
  // term that a complex sum keeps, where the route drops a literal `0`
  // (`0` and `-0` differ there).
  if (
    operand &&
    isNumber(replacement) &&
    replacement.re === 0 &&
    replacement.im === 0
  )
    throw new Error(
      `JS scalar fragment: ${nodeText(node)} is an operand, and its closed ` +
        `form is 0: the existing compiler writes it as a term \`(0)\``
    );
  return replacement;
}

/**
 * A number of `expr` that is not real, or a free symbol whose declared type
 * is one of numbers that are not real, or `undefined`. A name that `expr`
 * binds (the variable of a `Limits` clause, a parameter of a function
 * literal) is not read: the engine can give it a type that is not real
 * (`complex | infinity` in `Abs(s)`), and the existing compiler reads it as
 * a real scalar. A free symbol with no declared type has the default kind
 * of the mode, real in the `strict` mode (`hasNoDeclaredType()`).
 */
function complexPartOf(
  expr: Expression,
  bound: ReadonlySet<string> = new Set(),
  // The answer of each function node object under each set of bound names
  // (`null`: none), so a shared subtree is walked once.
  memo = new Map<Expression, Map<ReadonlySet<string>, Expression | null>>()
): Expression | undefined {
  if (isNumber(expr)) return expr.im !== 0 ? expr : undefined;
  if (isSymbol(expr))
    return expr.symbol === 'ImaginaryUnit' ||
      (!bound.has(expr.symbol) &&
        !hasNoDeclaredType(expr) &&
        isNonRealNumber(finitePartOfType(expr.type.type)))
      ? expr
      : undefined;
  if (!isFunction(expr)) return undefined;
  let byBound = memo.get(expr);
  const known = byBound?.get(bound);
  if (known !== undefined) return known ?? undefined;
  if (byBound === undefined) memo.set(expr, (byBound = new Map()));
  let inner = bound;
  const binds = (names: readonly string[]) => {
    if (names.length > 0) inner = new Set([...inner, ...names]);
  };
  if (expr.operator === 'Function')
    binds(
      expr.ops
        .slice(1)
        .map((p) => functionLiteralParameterName(p))
        .filter((n) => n !== '')
    );
  if (expr.operator === 'Integrate')
    binds(
      expr.ops
        .slice(1)
        .flatMap((l) =>
          isFunction(l, 'Limits') && isSymbol(l.op1) ? [l.op1.symbol] : []
        )
    );
  for (const op of expr.ops) {
    const found = complexPartOf(op, inner, memo);
    if (found !== undefined) {
      byBound.set(bound, found);
      return found;
    }
  }
  byBound.set(bound, null);
  return undefined;
}

/** The replacement of the calculus node `node` (`closedFormReplacement()`),
 *  or a refusal. */
function findClosedForm(
  node: Expression & { ops: readonly Expression[] },
  registry: StructuredRegistry,
  target: CompileTarget<Expression>
): Expression {
  const text = nodeText(node);
  // A limit has no symbolic attempt with `constantFold: false` (the
  // `Limit` handler of `javascript-target.ts`): the routine `limit`.
  if (node.operator === 'Limit') return numericLimit(node, registry);
  // A variable whose binding around the node can hold a list: the existing
  // compiler declines an `Integrate`, and a `D` whose closed form reads
  // the variable from a binding other than the global of its name
  // (`compileExprCustomHandler()` in `compiler-core.ts`), and the closed
  // form read as a number gives `NaN` for a list.
  const risky =
    node.operator === 'Integrate' || node.operator === 'D'
      ? nonScalarEnclosingBindings(node)
      : [];
  if (node.operator === 'Integrate' && risky.length > 0)
    throw new Error(
      `JS scalar fragment: the variable ${risky[0].name} of the integral ` +
        `${text} can hold a list: the existing compiler declines it`
    );
  if (node.operator === 'Integrate') {
    // The engine evaluates the integral to find its closed form: a draw in
    // the integrand would be made once, at compile time.
    if (!isTransitivelyPure(node))
      throw new Error(
        `JS scalar fragment: the integral ${text} is not pure: its closed ` +
          `form is found by an evaluation at compile time`
      );
    const before = CompilerState.antiderivativeStepsLeft;
    const closed = BaseCompiler.closedFormIntegral(node.ops, target);
    registry.closedFormSearch.spent +=
      before - CompilerState.antiderivativeStepsLeft;
    if (registry.closedFormSearch.spent > CLOSED_FORM_SEARCH_STEPS)
      throw new Error(
        `JS scalar fragment: the searches for the closed forms of the ` +
          `integrals of the program spend more than ` +
          `${CLOSED_FORM_SEARCH_STEPS} steps: the existing compiler searches ` +
          `again where it writes an integral, and its searches can spend the ` +
          `shared pool of the compilation`
      );
    if (closed === undefined) {
      const indefinite =
        node.ops.length < 2 ||
        node.ops
          .slice(1)
          .some(
            (limit) =>
              !isFunction(limit, 'Limits') ||
              limit.ops.slice(1).some((bound) => isSymbol(bound, 'Nothing'))
          );
      if (indefinite)
        throw new Error(
          `JS scalar fragment: the indefinite integral ${text} has no ` +
            `closed form that the engine finds at compile time, and no value ` +
            `at a point`
        );
      return quadratureIntegral(node, registry, target);
    }
    return closed;
  }
  if (node.operator === 'Apply') {
    const callee = node.ops[0] as Expression & { ops: readonly Expression[] };
    if (
      jetDerivativeTarget(
        node.ops,
        (id) => BaseCompiler.userFunctionLiteral(node.engine, id),
        false
      ) !== undefined
    )
      throw new Error(
        `JS scalar fragment: the derivative ${text} is computed with Taylor ` +
          `jets by the existing compiler (\`jetDerivativeTarget()\`), which ` +
          `the structured route does not have`
      );
    const multivariate = callee.ops.length > 2 || node.ops.length > 2;
    const literal =
      multivariate && BaseCompiler.appliedDerivativeTooLarge(node.ops)
        ? undefined
        : derivativeClosedForm('Derivative', callee.ops);
    // No closed form: the existing compiler writes the call of the
    // numerical derivative `_SYS.nd(f, n)` of a function of one argument.
    if (literal === undefined && !multivariate)
      return numericDerivative(node, registry);
    if (!isFunction(literal, 'Function'))
      throw new Error(
        `JS scalar fragment: ${text}: ` +
          `${BaseCompiler.appliedDerivativeDeclineReason(node.ops)} that the ` +
          `engine finds at compile time: the existing compiler writes the ` +
          `numerical derivative \`_SYS.nd\` or declines, and the structured ` +
          `route has no numerical derivative`
      );
    const application = node.engine._fn('Apply', [
      literal,
      ...node.ops.slice(1),
    ]);
    DERIVATIVE_APPLICATIONS.add(application);
    return application;
  }
  // A variable of `D` that holds a value: the existing compiler reads it as
  // an input in the closed form (`3 * (_.x * _.x)` for `D(x³, x)` with `x
  // := 4`), where the interpreter reads its value (`48`).
  const valued =
    node.operator === 'D'
      ? node.ops
          .slice(1)
          .find(
            (v) =>
              isSymbol(v) && node.engine._getSymbolValue(v.symbol) !== undefined
          )
      : undefined;
  if (valued !== undefined)
    throw new Error(
      `JS scalar fragment: the variable ${nodeText(valued)} of the ` +
        `derivative ${text} holds a value: the existing compiler reads it as ` +
        `an input in the closed form`
    );
  const closed = derivativeClosedForm(
    node.operator as 'D' | 'ND' | 'Derivative',
    node.ops
  );
  for (const { name, binding } of risky)
    if (
      closed === undefined ||
      (node.engine.lookupDefinition(name) !== binding &&
        closed.symbols.includes(name))
    )
      throw new Error(
        `JS scalar fragment: the variable ${name} of the derivative ${text} ` +
          `can hold a list: the existing compiler declines it`
      );
  if (closed === undefined) return numericDerivative(node, registry);
  if (isFunction(closed, 'Function'))
    throw new Error(
      `JS scalar fragment: the derivative ${text} is the function ` +
        `${nodeText(closed)}, which the structured route does not have as a ` +
        `value`
    );
  return closed;
}

/** Record `routine` for `node` in `registry`: the node is computed
 *  numerically, and is its own replacement. */
function recordRoutine(
  node: Expression,
  routine: StructuredNumericRoutine,
  registry: StructuredRegistry
): Expression {
  registry.routines.set(node, routine);
  return node;
}

/**
 * The derivative `node` (`D`, `ND`, or `Apply` of a `Derivative` of one
 * argument), which has no closed form that the engine finds, as the route
 * computes it numerically: the node itself, recorded with its parts in
 * `registry.routines` (`recordRoutine()`), or a refusal. The existing
 * compiler writes the stencil `_SYS.nd(f, order, 'scalar')(x)` with `f` the
 * body as a function of the variable
 * (`compileNumericDerivativeFallback()` in `library/calculus.ts`), and the
 * route writes the same call (`numericRoutine()` in
 * `javascript-structured-lower.ts`):
 *
 * - `D(body, v)` of one symbol `v`: the body as a function of `v`, at the
 *   value of `v` where the node is;
 * - `ND(f, x)`: the literal of `f` (`resolveDerivativeFunctionLiteral()`) at `x`,
 *   order 1;
 * - `Apply(Derivative(f, n), x)`: the literal of `f` at `x`, of the order
 *   `⌊N(n)⌋` (1 when `n` is absent).
 *
 * The literal is rewritten for the angular unit of the engine
 * (`rewriteAngularUnit()`), as the existing compiler rewrites it. Refused,
 * each with its own message: a node that is not pure (the existing compiler
 * declines it, `compileDerivative()`); a `D` of several variables, of a
 * variable that is not a symbol, an `ND` or a `Derivative` of other
 * operands, an operand that is not a literal of one parameter (or names a
 * local function), a parameter that is not a plain name, and an order
 * below 1; a function whose result type is not a number (the existing
 * compiler writes the vector stencil, or probes the function once at the
 * point, `derivativeValueShape()`).
 */
function numericDerivative(
  node: Expression & { ops: readonly Expression[] },
  registry: StructuredRegistry
): Expression {
  const text = nodeText(node);
  const prefix = `JS scalar fragment: the derivative ${text} has no closed form that the engine finds at compile time`;
  const ce = node.engine;
  const applied = node.operator === 'Apply';
  const operator = applied ? 'Derivative' : node.operator;
  const args = applied
    ? (node.ops[0] as Expression & { ops: readonly Expression[] }).ops
    : node.ops;
  // The existing compiler evaluates the node in a scope of its own, and
  // declines an impure node before the numerical derivative
  // (`compileDerivative()`).
  ce.pushScope();
  let pure: boolean;
  try {
    pure = ce.function(operator, args as Expression[]).isPure;
  } finally {
    ce.popScope();
  }
  if (!pure)
    throw new Error(
      `${prefix}, and it is not pure: the existing compiler declines it`
    );
  let literal: (Expression & { ops: readonly Expression[] }) | undefined;
  let order = 1;
  let point: Expression;
  if (operator === 'D') {
    if (args.length !== 2 || !isSymbol(args[1]))
      throw new Error(
        `${prefix}, and it is not a derivative in one symbol: the existing ` +
          `compiler differentiates numerically a function of one variable only`
      );
    const fn = ce.function('Function', [args[0], args[1]]);
    literal = isFunction(fn, 'Function') ? fn : undefined;
    point = args[1];
  } else {
    if (isSymbol(args[0]) && registry.localFunctionNames.has(args[0].symbol))
      throw new Error(
        `${prefix}, and its function is the local function ` +
          `${args[0].symbol}: the structured route differentiates ` +
          `numerically a function literal or a user function of the engine`
      );
    // The same function as the numeric derivative of the library.
    literal = resolveDerivativeFunctionLiteral(args[0]) as
      (Expression & { ops: readonly Expression[] }) | undefined;
    if (operator === 'Derivative') {
      if (args.length > 2 || node.ops.length !== 2)
        throw new Error(
          `${prefix}, and it is a derivative of several arguments: the ` +
            `existing compiler has no numerical derivative of such a function`
        );
      order = args[1] === undefined ? 1 : Math.floor(args[1].N().re);
      point = node.ops[1];
    } else {
      if (args.length !== 2)
        throw new Error(
          `${prefix}, and ND has ${args.length} operands: the existing ` +
            `compiler differentiates numerically ND(f, x) only`
        );
      point = args[1];
    }
  }
  if (literal === undefined)
    throw new Error(
      `${prefix}, and its function is not a pure literal of one parameter: ` +
        `the existing compiler has no numerical derivative of it`
    );
  if (!Number.isFinite(order) || order < 1)
    throw new Error(
      `${prefix}, and its order is not an integer of at least 1: the ` +
        `existing compiler has no numerical derivative of it`
    );
  // `_SYS.nd` runs the scalar stencil when the result type of the literal
  // is a number (`derivativeValueShape()` in `library/calculus.ts`): the
  // vector stencil of a point or a list, and the probe of the function at
  // the point for a type that says nothing, are not on the route.
  const result = functionResult(literal.type.type);
  const scalar =
    result !== undefined &&
    result !== 'any' &&
    result !== 'unknown' &&
    !isPointElementType(result) &&
    !isSubtype(result, 'list<number>') &&
    isSubtype(result, 'number');
  if (!scalar)
    throw new Error(
      `${prefix}, and the result of its function has the type ` +
        `${result === undefined ? 'unknown' : typeToString(result)}: the ` +
        `existing compiler differentiates it with the vector stencil of ` +
        `\`_SYS.nd\`, or probes the function at the point, which the ` +
        `structured route does not have`
    );
  const rewritten = rewriteAngularUnit(literal);
  const parameter = isFunction(rewritten, 'Function')
    ? rewritten.ops[1]
    : undefined;
  if (parameter === undefined || !isSymbol(parameter))
    throw new Error(
      `${prefix}, and the parameter of its function is not a plain name: ` +
        `the structured route binds the variable of a derivative as a real`
    );
  return recordRoutine(
    node,
    {
      fn: 'derivative',
      name: parameter.symbol,
      variable: parameter,
      body: (rewritten as Expression & { ops: readonly Expression[] }).ops[0],
      operands: [point],
      order,
    },
    registry
  );
}

/**
 * The limit `node`, `Limit(f, x)` or `Limit(f, x, d)`, as the route
 * computes it: the node itself, recorded with its parts in
 * `registry.routines` (`recordRoutine()`), or a refusal. The existing
 * compiler with `constantFold: false` makes no symbolic attempt and writes
 * `_SYS.limit(f, x[, d])` (the `Limit` handler of `javascript-target.ts`),
 * and the route writes the same call (`numericRoutine()` in
 * `javascript-structured-lower.ts`). Refused: a function that is not a
 * `Function` literal of one parameter that is a plain name; a point `±∞`
 * whose sign is not the sign of the direction (1 when there is none),
 * where `_SYS.limit` gives the limit at the other infinity.
 */
function numericLimit(
  node: Expression & { ops: readonly Expression[] },
  registry: StructuredRegistry
): Expression {
  const [f, x, direction] = node.ops;
  const literal =
    f !== undefined &&
    isFunction(f, 'Function') &&
    f.ops.length === 2 &&
    isSymbol(f.ops[1])
      ? f
      : undefined;
  if (
    literal === undefined ||
    x === undefined ||
    node.ops.length > 3 ||
    !isSymbol(literal.ops[1])
  )
    throw new Error(
      `JS scalar fragment: the limit ${nodeText(node)} is not the limit of ` +
        `a function literal of one parameter at a point: the structured ` +
        `route computes such a limit only`
    );
  // `_SYS.limit` reads an infinite point as the infinity of the sign of the
  // direction (1 when there is none), and the interpreter as the infinity
  // of the point: `Limit(arctan, -∞)` is π/2 on the existing compiler and
  // -π/2 on the interpreter. Only the two cases where they agree are on
  // the route.
  const sign = isSymbol(x, 'PositiveInfinity')
    ? 1
    : isSymbol(x, 'NegativeInfinity')
      ? -1
      : isNumber(x) &&
          x.im === 0 &&
          !Number.isFinite(x.re) &&
          !Number.isNaN(x.re)
        ? Math.sign(x.re)
        : 0;
  if (sign !== 0) {
    const agrees =
      direction === undefined
        ? sign === 1
        : isNumber(direction) && direction.im === 0 && direction.re === sign;
    if (!agrees)
      throw new Error(
        `JS scalar fragment: the limit ${nodeText(node)} is at an infinity ` +
          `with ${direction === undefined ? 'no direction' : `the direction ${nodeText(direction)}`}: ` +
          `the existing compiler computes the limit at the infinity of the ` +
          `sign of the direction (\`_SYS.limit\`), and the interpreter at ` +
          `the infinity of the point`
      );
  } else if (isNumber(x) && !(x.im === 0 && Number.isFinite(x.re)))
    throw new Error(
      `JS scalar fragment: the limit ${nodeText(node)} is at the point ` +
        `${nodeText(x)}, which is not a finite real number`
    );
  // A point that is not a number literal is checked where its scope is
  // known (`limitPointRefusal()`, from `routineRule()`).
  return recordRoutine(
    node,
    {
      fn: 'limit',
      name: literal.ops[1].symbol,
      variable: literal.ops[1],
      body: literal.ops[0],
      operands: direction === undefined ? [x] : [x, direction],
    },
    registry
  );
}

/**
 * Why the point `x` of the limit `node`, which is not a number literal,
 * is refused in `scope`, or `undefined`. `_SYS.limit` can take the other
 * infinity at a point that is infinite at run time (`a: real |
 * signed_infinity` at `-∞`), so the point must be finite by its static
 * type (`real` and `integer` have no infinity; `2a` with `a: real`, a
 * local `p := 2a`), or be a free input of the program with no declared
 * type and no value (the default kind of the mode, a real). A name that
 * the pass binds (a local, a parameter, an index) has no such default: a
 * local `p := -1/a` has the type `infinity | nan | real`, and a parameter
 * with no declared type has the type `unknown`.
 */
function limitPointRefusal<R>(
  node: Expression,
  x: Expression,
  scope: FragmentScope<R>
): string | undefined {
  if (isSubtype(x.type.type, 'real')) return undefined;
  if (
    isSymbol(x) &&
    !fragmentScopeBinds(scope, x.symbol) &&
    hasNoDeclaredType(x) &&
    x.engine._getSymbolValue(x.symbol) === undefined
  )
    return undefined;
  return (
    `the limit ${nodeText(node)} is at the point ${nodeText(x)} of the ` +
    `type ${x.type.toString()}, which can be infinite or not a number: ` +
    `the existing compiler computes the limit at an infinite point at the ` +
    `infinity of the sign of the direction (\`_SYS.limit\`), and the ` +
    `interpreter at the infinity of the point`
  );
}

/**
 * A derivative or a limit with no closed form (`numericDerivative()`,
 * `numericLimit()`) on the structured route, in the scope of the node:
 * each operand (the point, then the direction of a limit) with a real or
 * an integer fact, typed where the node is; then the variable, a real,
 * bound in the scope of the node; then the body, with a real or an
 * integer fact. The result is a real. The conversions are those of the
 * operands, then of the body. The lowering writes the code of the existing
 * emitter (`numericRoutine()` in `javascript-structured-lower.ts`).
 */
function routineRule(
  node: Expression,
  routine: StructuredNumericRoutine,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const conversions: FragmentConversion<ScalarRepresentation>[] = [];
  const what = routine.fn === 'limit' ? 'the limit' : 'the derivative';
  const point = routine.operands[0];
  if (
    routine.fn === 'limit' &&
    !isNumber(point) &&
    !isSymbol(point, 'PositiveInfinity') &&
    !isSymbol(point, 'NegativeInfinity')
  ) {
    const refusal = limitPointRefusal(node, point, scope);
    if (refusal !== undefined) w.refuse(node, 'signature', refusal);
  }
  const number = (
    value: Expression,
    role: string,
    facts: FragmentValueFacts<ScalarRepresentation>
  ) => {
    const kind = facts.type.kind;
    if (kind !== 'real' && kind !== 'integer')
      w.refuse(
        node,
        'signature',
        `${what} ${nodeText(node)} has ${role} ${nodeText(value)} of the ` +
          `type \`${fragmentTypeToString(facts.type)}\`: the structured ` +
          `route computes ${what} of a real function at a real point`
      );
    conversions.push(w.convert(facts, facts.type)!);
  };
  routine.operands.forEach((operand, i) =>
    number(
      operand,
      i === 0 ? 'the point' : 'the direction',
      w.value(operand, scope, context)
    )
  );
  const inner = w.open(node, scope);
  w.bind(routine.variable, inner, routine.name, { kind: 'real' }, 'index');
  // The body is an expression, not a loop: a `Break` in it has no loop to
  // leave.
  number(
    routine.body,
    'the body',
    w.value(routine.body, inner, { ...context, loop: undefined })
  );
  return w.valueFacts(node, { kind: 'real' }, conversions);
}

/** The parts of a definite integral (`integralParts()`), once per node. */
const INTEGRAL_PARTS = new WeakMap<
  Expression,
  Omit<StructuredIntegral, 'panels'>
>();

/**
 * The parts of `node`, an `Integrate` of the library with one or more
 * clauses `Limits(t, a, b)` of a variable name and two bounds that are not
 * `Nothing`: each clause, and the integrand as a body in the variables (a
 * `Function` integrand unwrapped, its parameters matched to the variables
 * by name, as `integrandLambda()` does for the existing compiler). Another
 * node gives `undefined`. A `Function` integrand whose parameters do not
 * match the variables is refused.
 */
function integralParts(
  node: Expression
): Omit<StructuredIntegral, 'panels'> | undefined {
  if (
    !isFunction(node, 'Integrate') ||
    !isLibraryOperator(node, 'Integrate') ||
    node.nops < 2
  )
    return undefined;
  const known = INTEGRAL_PARTS.get(node);
  if (known !== undefined) return known;
  const clauses: StructuredIntegral['clauses'][number][] = [];
  for (const limit of node.ops.slice(1)) {
    if (
      !isFunction(limit, 'Limits') ||
      limit.nops !== 3 ||
      !isSymbol(limit.op1) ||
      [limit.op1, limit.op2, limit.op3].some((e) => isSymbol(e, 'Nothing'))
    )
      return undefined;
    clauses.push({
      name: limit.op1.symbol,
      variable: limit.op1,
      lower: limit.op2,
      upper: limit.op3,
    });
  }
  let body: Expression;
  try {
    body = BaseCompiler.integrandLambda(
      node.op1,
      clauses.map((c) => c.name),
      node.ops.slice(1)
    ).bodyExpr;
  } catch (e) {
    throw new Error(
      `JS scalar fragment: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const parts = { clauses, body };
  INTEGRAL_PARTS.set(node, parts);
  return parts;
}

/**
 * The definite integral `node`, which has no closed form, as the route
 * integrates it numerically: the node itself, recorded with its parts and
 * its panel count in `registry.integrals`, or a refusal. The existing
 * compiler writes `_SYS.integrate` of the integrand as a function of the
 * variable (`compileIntegrate()` in `javascript-target.ts`), and the route
 * writes the same call (`integral()` in `javascript-structured-lower.ts`).
 * Refused, each with its own message:
 *
 * - the option `quadrature: 'monte-carlo'`: the existing compiler writes
 *   `_SYS.integrateMC`;
 * - an integrand that the existing compiler computes again in log space
 *   where its value is not finite (`logSpaceProduct()`: a product of a
 *   power and an exponential, `x¹⁰⁰·e⁻ˣ`): it writes a second function of
 *   the variable and `_SYS.finiteOr`;
 * - a clause that is not `Limits(t, a, b)` of a variable name, two clauses
 *   of one variable, and a bound that reads the variable of its own clause
 *   or of a later one (`∫₀ˣ f(x) dx`): the route evaluates every bound in
 *   the scope of the variables of the clauses before it.
 *
 * The integrand is checked with the other values of the program, and a body
 * that draws, runs code of the host or can abort is refused after the
 * annotation (`refuseLazyFunctionOperands()`).
 */
function quadratureIntegral(
  node: Expression & { ops: readonly Expression[] },
  registry: StructuredRegistry,
  target: CompileTarget<Expression>
): Expression {
  const text = nodeText(node);
  const prefix = `JS scalar fragment: the integral ${text} has no closed form that the engine finds at compile time`;
  const parts = integralParts(node);
  if (parts === undefined)
    throw new Error(
      `${prefix}, and a clause of it is not Limits(t, a, b) of a variable ` +
        `name: the structured route integrates numerically over such clauses only`
    );
  const names = parts.clauses.map((c) => c.name);
  if (new Set(names).size !== names.length)
    throw new Error(
      `${prefix}, and two of its clauses have one variable: the structured ` +
        `route integrates over variables of distinct names`
    );
  parts.clauses.forEach((clause, d) => {
    const read = names
      .slice(d)
      .find(
        (name) =>
          clause.lower.symbols.includes(name) ||
          clause.upper.symbols.includes(name)
      );
    if (read !== undefined)
      throw new Error(
        `${prefix}, and a bound of the clause of ${clause.name} reads the ` +
          `name ${read} of a variable of that clause or of a later one: the ` +
          `structured route evaluates a bound in the scope of the variables ` +
          `of the clauses before it`
      );
  });
  // The integrand in log space, where the existing compiler writes it
  // (`compileIntegrate()`): a pure integrand, and no node of it or of its
  // log-space form mapped by the caller (`logSpaceOpaque()`). The route has
  // no other host in an integrand (`refuseLazyFunctionOperands()`).
  const logSpace = logSpaceProduct(parts.body, names);
  let alternative: Expression | undefined;
  if (logSpace !== undefined && isTransitivelyPure(parts.body)) {
    if (target.cse?.harvestOptions === undefined)
      throw new Error(
        `${prefix}, and its integrand has a form in log space, which the ` +
          `existing compiler writes only when it knows the names that the ` +
          `caller maps`
      );
    if (
      !logSpaceOpaque(parts.body, target) &&
      !logSpaceOpaque(logSpace, target)
    )
      alternative = logSpace;
  }
  registry.integrals.set(node, {
    ...parts,
    panels: initialPanelsForDimensions(
      parts.clauses.length + Math.max(0, ...node.ops.map(integrateDepth))
    ),
    ...(alternative === undefined ? {} : { alternative }),
    ...(target.quadrature === 'monte-carlo' ? { sampled: true } : {}),
  });
  return node;
}

/** The rule of a head of `CALCULUS_HEADS` or of `Apply` on the structured
 *  route: a node that the admission replaced (`closedFormReplacement()`)
 *  has the facts of its replacement, typed in its place; another node has
 *  the rule `rule` of its head, or is refused. */
function closedFormRule(
  registry: StructuredRegistry,
  rule: FragmentRule<ScalarRepresentation> | undefined
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const replacement = registry.closedForms.get(node);
      if (replacement !== undefined) return w.type(replacement, scope, context);
      const integral = registry.integrals.get(node);
      if (integral !== undefined)
        return integralRule(node, integral, scope, context, w);
      const routine = registry.routines.get(node);
      if (routine !== undefined)
        return routineRule(node, routine, scope, context, w);
      if (rule === undefined)
        return w.refuse(
          node,
          'head',
          `${nodeText(node)} is not in the structured route`
        );
      return 'walk' in rule
        ? rule.walk(node, scope, context, w)
        : w.signatures(node, scope, context, rule.signatures);
    },
  };
}

/**
 * A definite integral with no closed form (`quadratureIntegral()`) on the
 * structured route, in the scope of the node: for each clause in order, its
 * bounds, each with a real or an integer fact, typed with the variables of
 * the clauses before it, then its variable, a real; then the integrand,
 * with a real or an integer fact. The integral is a real. The conversions
 * are those of the bounds, two per clause, then of the integrand. The
 * lowering writes the code of the existing emitter (`integral()` in
 * `javascript-structured-lower.ts`).
 */
function integralRule(
  node: Expression,
  integral: StructuredIntegral,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const inner = w.open(node, scope);
  const conversions: FragmentConversion<ScalarRepresentation>[] = [];
  const number = (
    value: Expression,
    what: string,
    facts: FragmentValueFacts<ScalarRepresentation>
  ) => {
    const kind = facts.type.kind;
    if (kind !== 'real' && kind !== 'integer')
      w.refuse(
        node,
        'signature',
        `${nodeText(node)} has ${what} ${nodeText(value)} of the type ` +
          `\`${fragmentTypeToString(facts.type)}\`: the structured route ` +
          `integrates a real integrand between real bounds`
      );
    conversions.push(w.convert(facts, facts.type)!);
  };
  for (const clause of integral.clauses) {
    for (const bound of [clause.lower, clause.upper])
      number(bound, 'the bound', w.value(bound, inner, context));
    w.bind(clause.variable, inner, clause.name, { kind: 'real' }, 'index');
  }
  // The integrand is an expression, not a loop: a `Break` in it has no loop
  // to leave.
  number(
    integral.body,
    'the integrand',
    w.value(integral.body, inner, { ...context, loop: undefined })
  );
  // The integrand in log space, with the same variables bound.
  if (integral.alternative !== undefined)
    number(
      integral.alternative,
      'the integrand in log space',
      w.value(integral.alternative, inner, { ...context, loop: undefined })
    );
  return w.valueFacts(node, { kind: 'real' }, conversions);
}

/**
 * The names whose definitions the closed form of the calculus node `node`
 * can hold (`closedFormReplacement()`): each symbol of the node that has a
 * value and is not a constant of the engine, each user function that the
 * node calls or names (`Derivative(g)`), and the names of their stored
 * definitions (`storedDefinitions()`), at any depth, as the bigint lowering
 * records a folded name (`recordFolded()` in
 * `javascript-structured-bigint.ts`). An input, a variable of the node and
 * a parameter of a function body have no stored definition, and are not
 * recorded.
 */
function calculusDependencies(node: Expression): Set<string> {
  const engine = node.engine;
  const names = new Set<string>();
  const visited = new Set<string>();
  const reach = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const definitions = storedDefinitions(engine, name);
    if (definitions.length === 0) return;
    names.add(name);
    for (const definition of definitions) visit(definition);
  };
  // Each node object once: a shared subtree is not walked once per path.
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if (isSymbol(e)) {
      if (!e.isConstant) reach(e.symbol);
      return;
    }
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    if (isUserDefinedFunction(engine, e.operator)) reach(e.operator);
    for (const op of e.ops) visit(op);
  };
  visit(node);
  return names;
}

/**
 * Run `analyze` with the compiler state that the outermost compilation of
 * `target` installs before it emits (`compileExpressionInFrame()` in
 * `compiler-core.ts`): the mode, the integer lane, the real-only lowerings,
 * the target whose constant folds decide a representation, the names that
 * the target binds, the target of the call site (which tells whether the
 * complex continuation lowerings of JavaScript apply), and an empty list of
 * unrolled index values. `isComplexValued()`, which the `Sqrt` rule calls,
 * reads this state, and the annotation is built in `prepareCompilation()`,
 * before the compilation installs it. The state is restored after.
 *
 * Inside another compilation the state belongs to that compilation, and its
 * memo of `isComplexValued()` answers would keep answers made under this
 * state: the fragment is refused there.
 */
function withOutermostCompilerState<T>(
  target: CompileTarget<Expression>,
  analyze: () => T
): T {
  if (CompilerState._compileDepth !== 0)
    throw new Error(
      'JS scalar fragment: a square root inside another compilation is not supported'
    );
  const mode = BaseCompiler.resolveCompileMode(target);
  const saved = {
    mode: CompilerState._mode,
    integerLane: CompilerState._integerLane,
    realOnlyLowering: CompilerState._realOnlyLowering,
    oracleFoldTarget: CompilerState._oracleFoldTarget,
    boundVarsCtx: CompilerState._boundVarsCtx,
    callSiteTarget: CompilerState._callSiteTarget,
    unrolledIndexValues: CompilerState._unrolledIndexValues,
  };
  CompilerState._mode = mode === 'bigint' ? 'strict' : mode;
  CompilerState._integerLane = mode === 'bigint' ? 'bigint' : 'double';
  CompilerState._realOnlyLowering = realOnlyLoweringOf(target);
  CompilerState._callSiteTarget = target;
  CompilerState._unrolledIndexValues = [];
  CompilerState._oracleFoldTarget =
    target.language === 'javascript' &&
    target.constantFold !== false &&
    target.symbolDeps === undefined
      ? target
      : undefined;
  CompilerState._boundVarsCtx = target.boundVars ?? saved.boundVarsCtx;
  try {
    return analyze();
  } finally {
    CompilerState._mode = saved.mode;
    CompilerState._integerLane = saved.integerLane;
    CompilerState._realOnlyLowering = saved.realOnlyLowering;
    CompilerState._oracleFoldTarget = saved.oracleFoldTarget;
    CompilerState._boundVarsCtx = saved.boundVarsCtx;
    CompilerState._callSiteTarget = saved.callSiteTarget;
    CompilerState._unrolledIndexValues = saved.unrolledIndexValues;
  }
}

/** Map a declared scalar type to the fragment type. */
function scalarType(type: Type) {
  if (isSubtype(type, 'boolean')) return { kind: 'boolean' } as const;
  if (isSubtype(type, 'integer')) return { kind: 'integer' } as const;
  if (isSubtype(type, 'real')) return { kind: 'real' } as const;
  if (isSubtype(type, 'complex')) return { kind: 'complex' } as const;
  return undefined;
}

/**
 * The refusal of the parameter `parameter` of a `Function` literal, named
 * `name`, that the route has no scalar or list input for, with its cause;
 * `type` is its kind (`undefined` when it has none), `undeclared` whether
 * it took the default kind of the mode, and `seen` the names of the
 * parameters before it. `owner` names the function in the message: the root
 * function, or a helper (`helper`). `undefined` when the parameter is
 * admitted.
 */
function parameterRefusal(
  parameter: Expression,
  name: string,
  type: unknown,
  undeclared: boolean,
  seen: readonly string[],
  owner: string,
  helper = false
): string | undefined {
  const which = name ? `the parameter ${name} of ${owner}` : '';
  if (!name)
    return (
      `the parameter ${nodeText(parameter)} of ${owner} is not a name: ` +
      `a destructuring pattern is not in the structured route`
    );
  if (isFunction(parameter, 'Optional'))
    return `${which} has a default value, which is not in the structured route`;
  if (isFunction(parameter, 'Spread'))
    return `${which} is variadic, which is not in the structured route`;
  if (!undeclared && (!isFunction(parameter, 'Typed') || parameter.nops !== 2))
    return (
      `${which} has no type annotation` +
      (helper
        ? `, and the helper has a declared signature: the structured route ` +
          `reads the type of a parameter from the annotation of the literal`
        : `, and its binding has the declared type ` +
          `${parameter.type.toString()}: the structured route reads the type ` +
          `of a parameter from its annotation`)
    );
  if (name === 'True' || name === 'False')
    return `${which} has the name of a boolean constant`;
  if (seen.includes(name)) return `${which} has the name of another parameter`;
  const declared = functionLiteralParameterType(parameter);
  if (!type)
    return (
      `${which} has the type ` +
      `${declared === undefined ? parameter.type.toString() : typeToString(declared)}, which is not in ` +
      `the structured route: a parameter is a number, a boolean, a list ` +
      `of reals or of integers, or a tuple of reals`
    );
  return undefined;
}

function attachBoundFunction(
  fn: Expression,
  target: CompileTarget<Expression>,
  admission: Admission,
  registry: StructuredRegistry | undefined
): void {
  if (!isFunction(fn, 'Function')) return;
  if (!isLibraryOperator(fn, 'Function'))
    throw new Error('JS scalar fragment: shadowed function constructor');
  const inputs: FragmentDeclaredInput[] = [];
  /** The declared type of each parameter, for the label of a list
   *  (`elementLabel()`). */
  const declaredTypes = new Map<string, Type>();
  /** The parameters with no declared type, which take the default kind of
   *  the mode on the structured route (`hasNoDeclaredType()`). */
  const defaulted = new Set<string>();
  /** The parameters declared `number` in the `complex` mode, which the host
   *  can give as a number or a complex value (`declaredNumberKind()`). */
  const lifted = new Set<string>();
  /** The parameters that the body never names, on the structured route: a
   *  parameter of any type, which keeps its position in the signature and
   *  has no value in the program (`IRInput.unread`). */
  const unread = new Set<string>();
  const body = fn.op1.canonical;
  for (const parameter of fn.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    // A refusal of a parameter names the parameter.
    try {
      // A parameter that the body never names has no representation: its
      // type is not read, as the existing compiler does not read it
      // (`(p, q) => p + 1` for `(p: real, q: any) ↦ p + 1`). A name of the
      // body is a read, also as the parameter of a nested literal.
      if (
        registry !== undefined &&
        admission.structured &&
        name !== '' &&
        name !== 'True' &&
        name !== 'False' &&
        (isSymbol(parameter) || isFunction(parameter, 'Typed')) &&
        !inputs.some((input) => input.name === name) &&
        !body.symbols.includes(name)
      ) {
        unread.add(name);
        inputs.push({ name, type: { kind: 'real' }, declared: 'real' });
        continue;
      }
      const declared = functionLiteralParameterType(parameter);
      // On the structured route a parameter with no declared type has the
      // default kind of the mode; its inferred type is not read.
      const defaultType = defaultedParameterKind(parameter, registry);
      const undeclared = defaultType !== undefined;
      // The structured route also admits a list parameter
      // (`structuredListType()`), and a numeric parameter that
      // `declaredNumberKind()` maps (`number`).
      const numberKind =
        registry === undefined ||
        declared === undefined ||
        undeclared ||
        structuredParameterType(declared, name, registry.mode) !== undefined
          ? undefined
          : declaredNumberKind(declared, registry.mode);
      const type = undeclared
        ? defaultType
        : declared === undefined
          ? undefined
          : numberKind !== undefined
            ? { kind: numberKind.kind }
            : admission.structured
              ? structuredParameterType(declared, name, registry?.mode)
              : scalarType(declared);
      if (numberKind?.lifted) lifted.add(name);
      const refusal = parameterRefusal(
        parameter,
        name,
        type,
        undeclared,
        inputs.map((input) => input.name),
        'the function'
      );
      // `parameterRefusal()` refuses a parameter with no type. The existing
      // route keeps its message.
      if (refusal !== undefined || !type)
        throw new Error(
          `JS scalar fragment: ${
            admission.structured
              ? refusal
              : 'explicit distinct scalar parameters required'
          }`
        );
      inputs.push({ name, type, declared: type.kind });
      if (declared !== undefined) declaredTypes.set(name, declared);
      if (undeclared) defaulted.add(name);
    } catch (e) {
      if (name) noteRefusedNode(e, { node: parameter, binding: name });
      throw e;
    }
  }
  const named: NamedCalls = { calls: new Set(), structured: registry };
  admitFunctionBody(
    body,
    inputs.map((input) => input.name),
    target,
    admission,
    named
  );
  const boundDefinition: FragmentDefinition<ScalarRepresentation> = {
    ...admission.definition,
    rules: {
      ...(admission.structured
        ? admission.definition.rules
        : { Add: addRule, Negate: negateRule, If: { walk: walkIf } }),
      Block: { walk: walkBlock },
      Assign: { walk: walkAssign },
    },
  };
  const annotation = annotateCalls(body, boundDefinition, named, inputs, body);
  checkLocalWrites(body, annotation.scope);
  attachScalarFragment(target, {
    root: body,
    functionRoot: fn,
    helper: named.helper,
    annotation,
  });
  // The inputs of a root function are its parameters, in their order.
  recordStructured(target, admission, {
    root: body,
    functionRoot: fn,
    annotation,
    named,
    inputs: () =>
      inputs.map((input) =>
        structuredInput(
          input.name,
          input.type!,
          declaredTypes.get(input.name),
          (defaulted.has(input.name) && registry?.mode === 'complex') ||
            lifted.has(input.name),
          unread.has(input.name)
        )
      ),
    defaulted,
  });
}

/**
 * A root `Block` with statements, `body`, on the structured route: the
 * existing compiler writes it as a function that it calls at once, with the
 * free symbols read as the inputs `_.x` (`(() => { let a = …; return a + 1
 * })()`). The route admits it as the body of a root function
 * (`admitFunctionBody()`), whose parameters are the free symbols: the names
 * that the block does not bind (`boundNames()`) and that hold no value (a
 * symbol with a value is a captured binding). Each free symbol is then an
 * input, typed as a free symbol of an expression (a name with no declared
 * type has the default kind of the mode), in the order of its first read.
 *
 * A local is declared by a `Declare`, or by a first write to a name that
 * the block binds (`implicitLocal()`). A write to another name (an input, a
 * name of the engine) is refused, as the existing compiler refuses it.
 *
 * `expression`: `body` is an expression that is not a block, and that holds
 * a block with statements as a value (`holdsValueBlock()`); its free
 * symbols are the inputs too.
 */
function attachRootBlock(
  body: Expression,
  target: CompileTarget<Expression>,
  admission: Admission,
  registry: StructuredRegistry,
  expression = false
): void {
  const bound = new Set(boundNames(body));
  /** The free symbols, the first read of each name. */
  const free: (Expression & { symbol: string })[] = [];
  /** The indexes of the aggregates and comprehensions around the node. */
  const indexes = new Set<string>();
  /** The stored values whose names `collect()` read. */
  const values = new Set<Expression>();
  /** The function nodes that `collect()` read, with the indexes around each
   *  read: a node object reached again with the same indexes reads the same
   *  names, so a shared subtree is read once, not once per path. */
  const collected = new Map<Expression, Set<string>>();
  const collect = (node: Expression): void => {
    if (isFunction(node)) {
      const around = [...indexes].join('\u0001');
      let seen = collected.get(node);
      if (seen?.has(around)) return;
      if (seen === undefined) collected.set(node, (seen = new Set()));
      seen.add(around);
    }
    if (isSymbol(node)) {
      const name = node.symbol;
      // The names of a captured expression (`storedSnapshot()`) are free
      // symbols where the value is read, with no index around them.
      const value =
        bound.has(name) || indexes.has(name) || registry.hosts?.vars.has(name)
          ? undefined
          : resolvedValueDefinition(node)?.value;
      if (value !== undefined && !isNumber(value) && !values.has(value)) {
        values.add(value);
        const outer = [...indexes];
        indexes.clear();
        try {
          collect(foldedValueInRadians(value, target));
        } finally {
          for (const index of outer) indexes.add(index);
        }
      }
      if (
        name === 'True' ||
        name === 'False' ||
        bound.has(name) ||
        indexes.has(name) ||
        // A name that a `vars` entry maps is a free symbol, also with a
        // value: `varsEntryOf()` refuses that value. A value of the frame
        // of a call is a captured binding too (`frameValue()`).
        ((resolvedValueDefinition(node)?.value !== undefined ||
          frameValue(node) !== undefined) &&
          !registry.hosts?.vars.has(name)) ||
        free.some((s) => s.symbol === name)
      )
        return;
      free.push(node);
      return;
    }
    if (!isFunction(node)) return;
    if (
      node.operator === 'Assign' &&
      isSymbol(node.op1) &&
      !bound.has(node.op1.symbol)
    )
      throw new Error(
        `JS scalar fragment: the structured route admits a write in a root ` +
          `Block only to a local of the block, and ${node.op1.symbol} is not ` +
          `a local of the block: it is a name of the engine or an input, ` +
          `and the existing compiler writes only the locals that it declares`
      );
    // The name and the type of a declaration are not reads.
    if (node.operator === 'Declare') {
      const value = declareValueOperand(node.ops);
      if (value !== undefined) collect(value);
      return;
    }
    // The name of a local function is not a read (`DefineFunction(g, …)`),
    // and neither is a parameter of a `Function` literal in its body.
    if (node.operator === 'DefineFunction') {
      for (const op of node.ops.slice(1)) collect(op);
      return;
    }
    if (node.operator === 'Function') {
      const added = node.ops
        .slice(1)
        .map((p) => functionLiteralParameterName(p))
        .filter((p) => p !== '' && !indexes.has(p));
      for (const p of added) indexes.add(p);
      collect(node.ops[0]);
      for (const p of added) indexes.delete(p);
      return;
    }
    // The index of a `Sum`, a `Product` or a comprehension is not a free
    // symbol where the form binds it (`structuredValueParts()`). A form
    // that the admission refuses is read as any other node here: the
    // admission gives its refusal.
    let parts: ReturnType<typeof structuredValueParts>;
    try {
      parts = structuredValueParts(node, false, registry);
    } catch {
      parts = undefined;
    }
    if (parts?.indexes !== undefined) {
      for (const op of parts.outer) collect(op);
      const added: string[] = [];
      for (const { index, bounds } of parts.indexes) {
        for (const b of bounds) collect(b);
        if (!indexes.has(index)) {
          indexes.add(index);
          added.push(index);
        }
      }
      for (const op of parts.inner) collect(op);
      for (const index of added) indexes.delete(index);
      return;
    }
    for (const op of node.ops) collect(op);
  };
  collect(body);
  const named: NamedCalls = { calls: new Set(), structured: registry };
  registry.helperInputs = [];
  admitFunctionBody(
    body,
    free.map((s) => s.symbol),
    target,
    admission,
    named,
    undefined,
    expression,
    free.map((s) => s.symbol)
  );
  /** The declared type of each free symbol, for the label of a list
   *  input (`elementLabel()`). */
  const symbolTypes = new Map<string, Type>();
  /** The free symbols with no declared type (`hasNoDeclaredType()`). */
  const defaulted = new Set<string>();
  /** The free symbols declared `number` in the `complex` mode
   *  (`declaredNumberKind()`). */
  const lifted = new Set<string>();
  // The inputs that the body of a helper reads (`admitHelperInput()`) are
  // free symbols too, also one whose name the block binds: the body of the
  // helper reads the input.
  refuseBoundStoredNames(registry, (name) => bound.has(name));
  const helperOnly = (registry.helperInputs ?? []).filter(
    (node) => !free.some((s) => s.symbol === node.symbol)
  );
  for (const node of [...free, ...helperOnly])
    atNode(node, () => {
      symbolTypes.set(node.symbol, node.type.type);
      // A `vars` entry: a read of the host, or an input whose reads are the
      // source of the entry (`varsEntryOf()`).
      if (varsEntryOf(node, registry)?.form === 'read')
        return admitHostRead(node, registry);
      if (hasNoDeclaredType(node)) {
        defaulted.add(node.symbol);
        return;
      }
      const numberKind = declaredNumberKind(node.type.type, registry.mode);
      if (numberKind !== undefined) {
        if (numberKind.lifted) lifted.add(node.symbol);
        return;
      }
      const list = structuredListType(node.type.type, registry.mode);
      if (list !== undefined && 'refusal' in list)
        throw new Error(
          `JS scalar fragment: the input ${node.symbol} has ${list.refusal}`
        );
      if (
        admission.definition.typeOfSymbol(node) === undefined &&
        structuredTupleType(node.type.type, registry.mode) === undefined &&
        list === undefined
      )
        throw new Error(
          `JS scalar fragment: unsupported binding ${node.symbol}${unionCause(
            node.type.type
          )}`
        );
    });
  const annotation = annotateCalls(body, admission.definition, named);
  checkLocalWrites(body, annotation.scope);
  attachScalarFragment(target, {
    root: body,
    helper: named.helper,
    annotation,
  });
  // The inputs are the free symbols, in the order of their first read: the
  // pass binds each one in the root scope there.
  recordStructured(target, admission, {
    root: body,
    annotation,
    named,
    inputs: () =>
      [...annotation.scope.bindings].map(([name, facts]) =>
        structuredInput(
          name,
          facts.type,
          symbolTypes.get(name),
          (defaulted.has(name) && registry.mode === 'complex') ||
            lifted.has(name)
        )
      ),
    defaulted,
  });
}

/**
 * Check that each write of a local of the function body `body`, typed in
 * `scope` (the scope of the function), preserves the representation of the
 * local: a statement of the block, of a branch of an `If` statement, or of
 * the body of a `Loop`, which is typed in the scope of the loop. The root
 * function and each helper of the structured route are checked so.
 */
function checkLocalWrites(
  body: Expression,
  functionScope: FragmentScope<ScalarRepresentation>
): void {
  const checkWrites = (
    statement: Expression,
    scope: FragmentScope<ScalarRepresentation>
  ): void => {
    if (!isFunction(statement)) return;
    if (statement.operator === 'If') {
      for (const branch of statement.ops.slice(1)) checkWrites(branch, scope);
      return;
    }
    if (statement.operator === 'Loop') {
      const inner = scope.inner.get(statement);
      if (!inner)
        throw new Error('JS scalar fragment invariant: missing loop scope');
      checkWrites(statement.op1, inner);
      return;
    }
    if (statement.operator === 'Block') {
      const inner = scope.inner.get(statement);
      if (!inner)
        throw new Error('JS scalar fragment invariant: missing block scope');
      for (const s of statement.ops) checkWrites(s, inner);
      return;
    }
    // A `Break` writes no local, and neither does the definition of a local
    // function (`LocalFunction`).
    if (statement.operator === 'Break' || statement.operator === 'Continue')
      return;
    if (localFunctionStatement(statement) !== undefined) return;
    if (!isSymbol(statement.op1)) return;
    const name = statement.op1.symbol;
    let binding: FragmentFacts<ScalarRepresentation> | undefined;
    for (
      let s: FragmentScope<ScalarRepresentation> | undefined = scope;
      s && !binding;
      s = s.parent
    )
      binding = s.bindings.get(name);
    if (!binding || !('representation' in binding))
      throw new Error('JS scalar fragment invariant: missing local binding');
    const value =
      statement.operator === 'Declare'
        ? declareValueOperand(statement.ops)
        : statement.op2;
    const valueFacts = value === undefined ? undefined : scope.facts.get(value);
    if (
      !valueFacts ||
      !('representation' in valueFacts) ||
      valueFacts.representation !== binding.representation
    )
      throw new Error(
        `JS scalar fragment: local writes must preserve representation: ` +
          `the local ${name} is held as ${binding.representation}` +
          (valueFacts !== undefined && 'representation' in valueFacts
            ? `, and the value written to it as ${valueFacts.representation}`
            : '')
      );
  };
  // A block used as a value, at any depth (`checkValueBlock()`): each of its
  // statements, in the scope of the block.
  const visitBlocks = (outer: FragmentScope<ScalarRepresentation>): void => {
    for (const [node, inner] of outer.inner) {
      if (isFunction(node, 'Block') && node !== body)
        for (const s of node.ops.slice(0, -1)) checkWrites(s, inner);
      visitBlocks(inner);
    }
  };
  visitBlocks(functionScope);
  if (!isFunction(body, 'Block')) return;
  const scope = functionScope.inner.get(body);
  if (!scope)
    throw new Error('JS scalar fragment invariant: missing local binding');
  for (const statement of body.ops.slice(0, -1)) checkWrites(statement, scope);
}

/** The number of checks of a value node by the admission of a function
 *  body (`checkValueNode()` of `admitFunctionBody()`), for the tests of the
 *  work on a shared subtree: it is linear in the number of distinct nodes,
 *  not in the number of paths. Exported for tests only. */
export const ADMISSION_WORK = { values: 0 };

/**
 * The admission of the body `body` of a function whose parameters are
 * `parameters`: the root `Function` of a compilation
 * (`attachBoundFunction()`), or, on the structured route, a helper
 * (`resolveHelper()`), which `helper` names with its declared result. The
 * root and every helper of the structured route have one admission: the
 * statements of `checkStructuredStatement()` and the values of
 * `checkValueNode()`. The body of the root is a block; the body of a helper
 * is a block (its statements, then its value) or one value.
 *
 * What differs for a helper: the collisions of the names of the helpers and
 * the captured bindings with the names that the body binds are checked for
 * the root only (the scope of a helper is a child of the root scope, so a
 * captured name equal to a parameter of the root would read that
 * parameter); `Typed` around the value of the body must ascribe the
 * declared result of the helper; a library head that the route does not
 * admit is refused, not resolved as a helper; and the refusals of a value
 * name the helper body.
 *
 * Records the declarations of the length locals of the body in the
 * registry (`StructuredRegistry.lengthDeclarations`).
 */
function admitFunctionBody(
  body: Expression,
  parameters: readonly string[],
  target: CompileTarget<Expression>,
  admission: Admission,
  named: NamedCalls,
  helper?: {
    readonly name: string;
    /** `undefined` when the signature of the helper is inferred. */
    readonly result: ReturnType<typeof structuredParameterType>;
    /** The parameters that took the default kind of the mode. */
    readonly defaulted?: ReadonlySet<string>;
  },
  /** On the structured route, `body` is the root of an expression that is
   *  not a block, and that holds a block with statements as a value
   *  (`attachRootBlock()`): it is the value of the body, with no
   *  statements. */
  expressionRoot = false,
  /** The names that a captured expression of the root can read as inputs
   *  (`recordCapture()`): the free symbols of a root `Block`
   *  (`attachRootBlock()`); none for a root `Function`, whose parameters
   *  are not the names of a value written against the engine. */
  storedInputs: readonly string[] = []
): void {
  const conditionContext =
    helper === undefined
      ? undefined
      : {
          name: helper.name,
          defaulted: helper.defaulted,
          mode: named.structured?.mode,
        };
  const registry = named.structured;
  const isRoot = helper === undefined;
  // The parameters, and the names that a form of the body binds
  // (`decidedBranch()`).
  let bodyBound: ReadonlySet<string> | undefined;
  const boundInBody = (name: string): boolean =>
    parameters.includes(name) || (bodyBound ??= namesBoundIn(body)).has(name);
  // The body of a helper is not in the tree of the root, which
  // `prepareFragment()` walks.
  if (admission.structured) refuseSumOfNestedSums(body, !isRoot);
  // The structured route also admits a block of one value, the form of the
  // body of a function of one expression that `executeEpsil()` defines.
  if (
    isRoot &&
    !(expressionRoot && admission.structured) &&
    (!isFunction(body, 'Block') ||
      body.nops < (admission.structured ? 1 : 2) ||
      !isLibraryOperator(body, 'Block'))
  )
    throw new Error(
      'JS scalar fragment: a bound body requires one straight-line block'
    );
  /** The statements of the body and its value. */
  const block =
    !expressionRoot &&
    isFunction(body, 'Block') &&
    isLibraryOperator(body, 'Block') &&
    body.nops >= 1
      ? body
      : undefined;
  const statements = block?.ops.slice(0, -1) ?? [];
  const bodyValue = block?.ops[block.nops - 1] ?? body;
  /** The nodes in tail position of the body, whose value is the value of
   *  the function: the value of the body, the branches of an `If` and the
   *  value of a `Block` in tail position, and the operand of a `Return`
   *  there. */
  const tails = new Set<Expression>();
  const addTail = (n: Expression): void => {
    if (tails.has(n)) return;
    tails.add(n);
    if (isFunction(n, 'If') && n.nops === 3) {
      addTail(n.op2);
      addTail(n.op3);
    } else if (isFunction(n, 'Block') && n.nops > 0) addTail(n.ops[n.nops - 1]);
    else if (isFunction(n, 'Return') && n.nops === 1) addTail(n.op1);
  };
  if (!expressionRoot) addTail(bodyValue);
  /** The `Return` nodes that the body reaches on a path that is not in
   *  tail position: one node object can be in both places. */
  const notTail = nonTailReturns(body);
  // The declared type of each local, by its name: `let` for a local of the
  // form `Declare(t, {value: …})`, which has the type of its value.
  const locals = new Map<string, string>();
  /** The local that `declaration` declares, with its declared type. The
   *  structured route also admits the form of a `let`,
   *  `Declare(t, {value: …})`, and of a `let` with a type,
   *  `Declare(t, 'integer', {value: …})`, which `parseEpsil()` gives. A
   *  `let` with a type and no value, `Declare(t, 'integer')`, is refused. */
  const declareLocal = (declaration: Expression) => {
    const letForm =
      admission.structured &&
      isFunction(declaration, 'Declare') &&
      declaration.nops === 2 &&
      declareTypeOperand(declaration.ops) === undefined &&
      declareValueOperand(declaration.ops) !== undefined;
    const typedLetForm =
      admission.structured &&
      isFunction(declaration, 'Declare') &&
      declaration.nops === 3 &&
      isDictionary(declaration.op3) &&
      declareValueOperand(declaration.ops) !== undefined;
    if (
      !isFunction(declaration, 'Declare') ||
      !isLibraryOperator(declaration, 'Declare') ||
      (declaration.nops !== 3 && !letForm) ||
      !isSymbol(declaration.op1)
    )
      throw new Error(
        'JS scalar fragment: one explicit initialized local required'
      );
    const local = declaration.op1.symbol;
    // On the structured route a local declared `unknown` with a value
    // (`Declare(t, 'unknown', v)`, which `m \coloneq x + 1` gives) is a
    // `let`: the existing compiler writes `let t = …`, and the local has the
    // type of its value (`structuredLocalType()`).
    const source = declaredTypeSource(declaration.op2);
    const declared =
      letForm || (admission.structured && source === 'unknown')
        ? 'let'
        : source;
    // A local of a nested block with the name of a parameter or of a local
    // around it: the structured route has one name per local.
    if (
      admission.structured &&
      (parameters.includes(local) || locals.has(local) || names.has(local))
    )
      throw new Error(
        `JS scalar fragment: the local ${local} has the name of a parameter, ` +
          `an input, an index or a local declared before it: the structured ` +
          `route admits no redeclaration and no shadowing of a name`
      );
    // `rewriteAngularUnit()` does not rewrite the value in the dictionary of
    // a `let` (`Declare(a, {value: sin(x)})`): in another angular unit than
    // radians both compilers read `sin(x)` in radians (CE-1207).
    if ((letForm || typedLetForm) && declaration.engine.angularUnit !== 'rad')
      throw new Error(
        `JS scalar fragment: the local ${local} is declared with its value in ` +
          `a dictionary, and the angular unit is ` +
          `${declaration.engine.angularUnit}: the rewrite for the angular unit ` +
          `does not reach such a value`
      );
    // The structured route also admits a local declared as a list
    // (`structuredListLocalType()`).
    // A local declared `number` in the `strict` mode is a real local
    // (`declaredLocalType()`): the existing compiler writes `let a = v` and
    // reads `a`, as for a local declared `real`. In the `complex` mode it
    // reads each read as `_SYS.cplx(a)`, whatever the shape of the value.
    if (
      !declared ||
      !['real', 'integer', 'complex', 'boolean', 'let']
        .concat(admission.structured ? ['list<real>', 'list<integer>'] : [])
        .concat(
          admission.structured &&
            (tupleListLocalType(
              declared,
              named.structured?.mode ?? 'strict'
            ) !== undefined ||
              nestedListLocalType(
                declared,
                named.structured?.mode ?? 'strict'
              ) !== undefined)
            ? [declared]
            : []
        )
        .concat(
          admission.structured && named.structured?.mode === 'strict'
            ? ['number', 'list<number>']
            : []
        )
        .includes(declared) ||
      parameters.includes(local) ||
      locals.has(local) ||
      names.has(local) ||
      local === 'True' ||
      local === 'False'
    ) {
      // A list of lists of another rank or cell type than the local types
      // of `nestedListLocalType()` names its cause.
      if (
        admission.structured &&
        declared !== undefined &&
        /^(list<list<|tensor\b|matrix\b)/.test(declared) &&
        nestedListLocalType(declared, named.structured?.mode ?? 'strict') ===
          undefined
      )
        throw new Error(
          `JS scalar fragment: the local ${local} declared ${declared} is not ` +
            `in the structured route, which admits a local of a list of lists ` +
            `only of rows of reals or of integers (rank 2: list<list<real>>, ` +
            `list<list<integer>>, matrix)`
        );
      // A list of booleans is a value of the route, never a local.
      if (admission.structured && declared?.startsWith('list<boolean>'))
        throw new Error(
          `JS scalar fragment: the local ${local} declared ${declared} is not ` +
            `in the structured route, which holds a list of booleans only as ` +
            `a value (a condition, an operand of At or Length), not in a local`
        );
      throw new Error(
        `JS scalar fragment: unsupported local declaration${
          admission.structured && declared !== undefined
            ? ` of ${local} with the type ${declared}, which is not a type ` +
              `of a local of the structured route`
            : ''
        }`
      );
    }
    return {
      local,
      declared,
      value:
        letForm || typedLetForm
          ? declareValueOperand(declaration.ops)!
          : declaration.op3,
    };
  };
  const names = new Set(parameters);
  // The existing route requires one first declaration. The structured route
  // checks every statement of the block (`checkStructuredStatement()`) and
  // admits more than one local: every declaration of the block, of a nested
  // block, of a branch and of a loop body, the index of each loop and of
  // each comprehension.
  const first =
    admission.structured || block === undefined
      ? undefined
      : declareLocal(block.op1);
  const local = first?.local ?? '';
  const bindings = new Set([
    ...names,
    ...(first ? [first.local] : []),
    ...(admission.structured ? boundNames(body) : []),
  ]);
  // The heads that are not helper calls. The existing route also keeps
  // `Sqrt` here, so that it reaches the refusal below and not the helper
  // resolution.
  const operatorHeads: ReadonlySet<string> = admission.structured
    ? admission.heads
    : new Set(['Add', 'Negate', 'If', 'Sqrt']);
  /** Refuse a helper or a captured binding whose name is a parameter or a
   *  local of the root function. */
  const checkCollisions = (): void => {
    if (!isRoot) return;
    // A local function is named by its own statement of the body.
    const collides = registry
      ? [
          ...[...registry.helpers.keys()].filter(
            (name) => !registry.localFunctions.has(name)
          ),
          ...[...registry.captures.values()].map((c) => c.name),
        ].some((name) => bindings.has(name))
      : bindings.has(named.helper!.name) ||
        [...(named.helper!.capture?.symbols ?? [])].some(
          (symbol) => isSymbol(symbol) && bindings.has(symbol.symbol)
        );
    if (collides)
      throw new Error(
        'JS scalar fragment: helper bindings collide with the root function'
      );
  };
  /** The bounds of the loops, sums, products and comprehensions, and the
   *  indexes of `At` and `ReplaceAt`, of the body. */
  const indexPositions = new Set<Expression>();
  /** The index of each loop around the current statement. */
  const indices = new Set<string>();
  /** The number of loops around the current statement, also of a loop with
   *  no index set, where a `Break` is admitted. */
  let loopDepth = 0;
  /** The function nodes that `checkValue()` reached, with the contexts
   *  (`valueContext()`) in which each was admitted: a node object reached
   *  again on another path, in a context in which it was admitted, is not
   *  checked again, so a shared subtree is checked once per context, not
   *  once per path. `null`: reached once, with no context recorded (the
   *  context is written only for a node reached again). */
  const admittedValues = new Map<Expression, Set<string> | null>();
  /** The context of a check: everything of the body that the check of a
   *  value reads and that changes during the admission. */
  const valueContext = (bodyValue: boolean): string =>
    [
      bodyValue ? '1' : '0',
      [...names].join('\u0001'),
      [...locals].map(([n, t]) => `${n}\u0003${t}`).join('\u0001'),
      [...indices].join('\u0001'),
    ].join('\u0002');
  /** `bodyValue`: `node` is the value of the body, where the structured
   *  route admits `Typed(value, T)` (`typedRule()`). */
  /** Whether `node` holds, at any depth, a block of the library with
   *  statements: its check reads and writes the facts of the writes
   *  (`checkWrite()`: `lengthWritten`, `notLength`, `writtenClasses`) and
   *  the declarations, which the context of `valueContext()` does not hold,
   *  so `checkValue()` checks such a node at each path; and a node that
   *  holds a `Return`, whose admission depends on its place. Each node
   *  object is visited once. */
  const statementBlocks = new Map<Expression, boolean>();
  const holdsStatementBlock = (node: Expression): boolean => {
    if (!isFunction(node)) return false;
    let holds = statementBlocks.get(node);
    if (holds === undefined) {
      // A `Return` too: the check reads its place (`tails`), which the
      // context does not hold.
      holds =
        (isFunction(node, 'Block') && node.nops > 1) ||
        isReturnNode(node) ||
        node.ops.some(holdsStatementBlock);
      statementBlocks.set(node, holds);
    }
    return holds;
  };
  const checkValue = (node: Expression, bodyValue = false): void => {
    if (!isFunction(node) || holdsStatementBlock(node))
      return atNode(node, () => checkValueNode(node, bodyValue));
    const seen = admittedValues.get(node);
    if (seen === undefined) {
      admittedValues.set(node, null);
      return atNode(node, () => checkValueNode(node, bodyValue));
    }
    const context = valueContext(bodyValue);
    if (seen?.has(context)) return;
    atNode(node, () => checkValueNode(node, bodyValue));
    if (seen === null) admittedValues.set(node, new Set([context]));
    else seen.add(context);
  };
  /** The check of the captured expression `stored` of the name `name`,
   *  where the root computes it: the inputs of the program
   *  (`storedInputs`) are its only names, and no parameter, local or index
   *  of the body is. For a value that the body of a helper reads
   *  (`forHelper`), a name of the value that is not a free symbol of the
   *  root is an input that a helper reads (`admitHelperInput()`). */
  const rootStoredCheck = (
    stored: Expression,
    name: string,
    forHelper = false
  ): void => {
    // A name of the value that the body binds would read the binder; the
    // existing compiler refuses it too (`foldCapturedName()`). A value
    // that a helper reads is computed alone, at the start of the root,
    // outside every binder, as the existing compiler computes `_val_lv`
    // before the body: its names are the inputs.
    const captured = forHelper
      ? undefined
      : stored.symbols.find(
          (n) => bindings.has(n) && !storedInputs.includes(n)
        );
    if (captured !== undefined)
      throw new Error(
        `JS scalar fragment: ${foldCaptureRefusal(name, captured)}`
      );
    const outer = [...names];
    const outerReader = storedReader;
    names.clear();
    for (const n of storedInputs) names.add(n);
    if (forHelper) storedReader = `the value of ${name}`;
    try {
      checkValue(stored);
    } finally {
      names.clear();
      for (const n of outer) names.add(n);
      storedReader = outerReader;
    }
  };
  /** The reader of the captured expression that the root checks for the
   *  body of a helper (`rootStoredCheck()`), for a message. */
  let storedReader: string | undefined;
  // The root of a block (not of a `Function`, `helperInputs`) checks the
  // captured expressions that the body of a helper reads.
  if (isRoot && registry?.helperInputs !== undefined)
    registry.rootStored = (stored, name) => rootStoredCheck(stored, name, true);
  const checkValueNode = (node: Expression, bodyValue: boolean): void => {
    ADMISSION_WORK.values += 1;
    // A calculus node is the expression that replaces it
    // (`closedFormReplacement()`); a definite integral with no closed form
    // is checked as itself (`structuredValueParts()`).
    if (registry !== undefined && isCalculusNode(node)) {
      const replacement = closedFormReplacement(
        node,
        registry,
        target,
        !bodyValue
      );
      if (replacement !== node) return checkValue(replacement, bodyValue);
    }
    // The branch that the constant conditions of an `If` or a `Which`
    // select (`decidedBranch()`).
    if (admission.structured)
      refuseSelections(
        node,
        boundInBody,
        node === body ||
          (isFunction(body, 'Block') &&
            body.nops > 0 &&
            node === body.ops[body.nops - 1])
      );
    const decided = admission.structured
      ? decidedBranch(node, boundInBody)
      : undefined;
    if (decided !== undefined) return checkValue(decided, bodyValue);
    // `Return(v)` in tail position of the body (`tails`) is its value `v`,
    // as the existing emitter writes it (`(x) => x + 1` for `Return(x +
    // 1)`, a `return` in each branch of a tail `If`). Elsewhere it ends the
    // function before its end, which the structured route does not write.
    if (admission.structured && isReturnNode(node)) {
      const ops = (node as Expression & { ops: readonly Expression[] }).ops;
      if (ops.length !== 1 || !tails.has(node) || notTail.has(node))
        throw new Error(
          `JS scalar fragment: the structured route admits a Return only in ` +
            `tail position of a function body (its value, or a branch of an ` +
            `If there), where it is the value of the function, and not ` +
            `${nodeText(node)}`
        );
      return checkValue(ops[0], bodyValue);
    }
    refuseListHead(node, admission);
    refuseBooleanClaim(node, admission);
    refuseUndirectedInfinity(node, admission);
    refuseHaversineGrouping(node, admission, () => false);
    refuseWideRead(node, admission, registry?.mode);
    refuseUnsettledFold(
      node,
      admission,
      registry?.mode,
      (name) => bindings.has(name) && !parameters.includes(name)
    );
    refuseUnsettledCollection(
      node,
      admission,
      registry?.mode,
      (name) => bindings.has(name) && !parameters.includes(name)
    );
    refuseMixedOperand(node, admission, registry?.mode);
    if (!node.isValid || node.type.type === 'error')
      throw new Error(
        `JS scalar fragment: invalid ${isRoot ? 'bound expression' : 'helper body'}`
      );
    if (isNumber(node)) return;
    // A block used as a value, on the structured route
    // (`checkValueBlock()`). A block of one value at the place of the value
    // of the body is still that value.
    if (
      admission.structured &&
      isFunction(node, 'Block') &&
      isLibraryOperator(node, 'Block')
    ) {
      if (node.nops > 1) return checkValueBlock(node, bodyValue);
      if (node.nops === 1) return checkValue(node.op1, bodyValue);
    }
    if (admission.structured && isFunction(node)) {
      const nested = structuredValueParts(node, bodyValue, registry);
      // The value of the body of a helper `f(…) -> T` is `Typed(value, T)`:
      // `T` must be the declared result of the helper.
      if (
        nested !== undefined &&
        helper?.result !== undefined &&
        node.operator === 'Typed'
      ) {
        const ascribed =
          structuredParameterType(
            node.type.type,
            helper.name,
            registry?.mode
          ) ??
          (isSubtype(node.type.type, REAL_WITH_NON_FINITE_TYPE)
            ? ({ kind: 'real' } as const)
            : undefined);
        if (
          ascribed === undefined ||
          fragmentTypeToString(ascribed) !== fragmentTypeToString(helper.result)
        )
          throw new Error(
            `JS scalar fragment: the body of the helper ${helper.name} has the ` +
              `ascribed type ${node.type.toString()}, which is not its declared result type`
          );
      }
      if (nested !== undefined) {
        for (const operand of nested.outer) checkValue(operand);
        const added: string[] = [];
        try {
          for (const { index, bounds } of nested.indexes ?? []) {
            for (const bound of bounds) {
              indexPositions.add(bound);
              checkAggregateBound(node, bound, registry, checkValue);
            }
            // The variable of a derivative or a limit computed numerically
            // shadows a name around it (the check of the root, above).
            if (registry?.routines.has(node) === true) {
              if (!names.has(index)) {
                names.add(index);
                added.push(index);
              }
              continue;
            }
            if (names.has(index) || locals.has(index))
              throw new Error(
                `JS scalar fragment: the ${indexLabel(node)} index ${index} has the name of a parameter, a local or another index`
              );
            names.add(index);
            added.push(index);
          }
          for (const operand of nested.inner) checkValue(operand);
        } finally {
          for (const index of added) names.delete(index);
        }
        return;
      }
    }
    if (admission.structured && isFunction(node, 'Loop'))
      throw new Error(
        'JS scalar fragment: a Loop used as a value is not in the structured ' +
          'route: the interpreter gives a Loop the value Nothing'
      );
    if (isSymbol(node)) {
      // In the `complex` mode, the existing compiler reads a local whose
      // type is not real as a complex value (`_SYS.cplx(t)`): the type of
      // a `let` local is the type that the engine infers from its values
      // (`let t = 1/b` has the type `infinity | nan | real`, `let n =
      // Length(L)` the type `integer | signed_infinity`), where the route
      // reads its real fact. A read that is a bound of a loop or an index
      // (`indexPositions`) is not lifted, and neither is a list local. A
      // type that is not numeric and not boolean, `missing | real` (the
      // value of a `Which` with no default) or `unknown`, is read so too.
      if (
        admission.structured &&
        registry?.mode === 'complex' &&
        locals.get(node.symbol) === 'let' &&
        names.has(node.symbol) &&
        !indexPositions.has(node) &&
        !isSubtype(node.type.type, 'real') &&
        !isSubtype(node.type.type, 'boolean') &&
        structuredListType(node.type.type, registry.mode) === undefined
      )
        throw new Error(
          `JS scalar fragment: the local ${node.symbol} has the type ` +
            `${node.type.toString()}, which is not real, in the complex ` +
            `mode: the existing compiler reads it as a complex value`
        );
      if (
        names.has(node.symbol) ||
        node.symbol === 'True' ||
        node.symbol === 'False'
      )
        return;
      // A free symbol that a `vars` entry maps, read in the body of the root
      // `Function` or of a helper: the parameters are the only inputs there.
      if (registry?.hosts?.vars.has(node.symbol))
        throw new Error(
          `JS scalar fragment: the option \`vars\` maps ${node.symbol}, which ` +
            `the ${isRoot ? 'body of the root Function' : 'body of a helper'} ` +
            `reads: the structured route maps a free symbol of an expression ` +
            `or of a root Block only`
        );
      // The structured route reads a captured binding as its snapshot. A
      // captured expression, in the root only, is checked where its names
      // are read: the inputs of the program (`storedInputs`) are its only
      // names there, and no parameter, local or index of the body is.
      // In the body of a helper (not of a local function), a captured
      // expression is checked where the root computes it
      // (`StructuredRegistry.rootStored`), and passed to the helper
      // (`storedParameters()`).
      const helperStored =
        !isRoot &&
        registry?.rootStored !== undefined &&
        !registry.localFunctions.has(helper.name)
          ? registry.rootStored
          : undefined;
      if (
        registry &&
        recordCapture(
          registry,
          node,
          isRoot
            ? (stored) => rootStoredCheck(stored, node.symbol)
            : helperStored === undefined
              ? undefined
              : (stored) => helperStored(stored, node.symbol)
        )
      ) {
        if (helperStored !== undefined) recordStoredRead(registry, node);
        return checkCollisions();
      }
      // A free name with no value in the body of a helper (not of a local
      // function, whose free names are its captures), or in a captured
      // expression that the body of a helper reads: an input of the
      // program, read where the body reads it (`admitHelperInput()`).
      const inputReader = isRoot
        ? storedReader
        : registry?.localFunctions.has(helper.name) === false
          ? `the helper ${helper.name}`
          : undefined;
      if (
        registry !== undefined &&
        inputReader !== undefined &&
        resolvedValueDefinition(node)?.value === undefined &&
        frameValue(node) === undefined
      )
        return admitHelperInput(registry, node, inputReader);
      throw new Error(
        `JS scalar fragment: unsupported ${isRoot ? '' : 'helper '}capture ${node.symbol}${
          registry === undefined
            ? ''
            : !isRoot && storedSnapshot(node, registry)?.kind === 'expression'
              ? `: its value ${nodeText(resolvedValueDefinition(node)!.value!)} ` +
                `is an expression, which the structured route computes in the ` +
                `root only`
              : heldValueCause(node)
        }`
      );
    }
    // A call of a function of the host (`hostHeadOf()`).
    if (hostHeadOf(node, registry) !== undefined) {
      for (const operand of (node as Expression & { ops: Expression[] }).ops)
        checkValue(operand);
      return;
    }
    // In the body of a helper, a library head that the route does not admit
    // reaches the refusal below.
    if (
      isFunction(node) &&
      !operatorHeads.has(node.operator) &&
      (isRoot || !isLibraryOperator(node, node.operator))
    ) {
      collectHelper(node, target, named, admission);
      checkCollisions();
      for (const operand of node.ops) checkValue(operand);
      return;
    }
    // On the existing route, Sqrt is excluded here: a write can change the
    // sign of a local, so its initializer cannot determine whether a later
    // square root is complex. The rule of the structured route reads the
    // declared type of a local, not its initializer.
    if (
      !isFunction(node) ||
      !admission.heads.has(node.operator) ||
      !isAdmittedOperator(node, admission) ||
      (node.operator === 'Negate' && node.nops !== 1) ||
      // The structured route also admits `If(c, v)` used as a value, as a
      // `Which` of one clause (`selectionRule()`).
      (node.operator === 'If' &&
        node.nops !== 3 &&
        !(admission.structured && node.nops === 2))
    )
      throw new Error(
        `JS scalar fragment: unsupported ${isRoot ? 'bound head' : 'helper body'} ${node.operator}`
      );
    if (admission.structured) refuseSelection(node);
    checkCondition(node, conditionContext);
    if (
      (node.operator === 'At' || node.operator === 'ReplaceAt') &&
      node.nops >= 2
    )
      indexPositions.add(node.ops[1]);
    for (const operand of admittedOperands(node)) checkValue(operand);
  };
  // The representation of a local declared `integer` is `number`, as for a
  // `real`, so the check of the representation of a write does not refuse a
  // real value. The interpreter refuses it, so the type of each value that
  // is written must prove `integer`.
  // On the structured route, a value computed from the length of a list
  // (`integerFromListLength()`) is an integer too. A `let` or `integer`
  // local each of whose values is such an integer or has the type `integer`
  // is a length local: `isLengthLocal()`.
  const lengthWritten = new Set<string>();
  const notLength = new Set<string>();
  /** The `Declare` statements of the body, with their locals. */
  const declarations: { node: Expression; name: string }[] = [];
  const isLengthLocal = (name: string): boolean =>
    lengthWritten.has(name) && !notLength.has(name);
  // A call of a helper whose declared result is `integer`, and a `let` or
  // `integer` local that no value so far makes another number, are integers
  // too: the rules of the pass check each of them again with the facts.
  const fromLength = (value: Expression): boolean =>
    admission.structured &&
    integerFromListLength(
      value,
      (symbol) => isLengthLocal(symbol.symbol),
      (call) =>
        isFunction(call) &&
        registry?.helpers.get(call.operator)?.declaredResult === true &&
        isSubtype(
          userFunctionSignature(call.engine, call.operator)?.result ??
            'unknown',
          'integer'
        ),
      (symbol) =>
        (locals.get(symbol.symbol) === 'let' ||
          locals.get(symbol.symbol) === 'integer') &&
        names.has(symbol.symbol) &&
        !notLength.has(symbol.symbol)
    );
  /** The classes of the types of the values written to each local, in the
   *  `strict` mode on the structured route. */
  const writtenClasses = new Map<string, Set<'real' | 'complex'>>();
  const checkWrite = (value: Expression, name = local): void => {
    refuseHaversineLocal(value, name, admission);
    // In the `strict` mode, the existing compiler declines a local that is
    // written a real (or boolean) value and a value that is complex and not
    // real (`assignedTypesConflict()` in `compile-admission.ts`): `a ≔ 1`
    // then `a ≔ √(−x)` in a branch. A local declared `real` or `integer` is
    // refused for the complex value alone (below), so the rule reads the
    // `let` locals (a `let`, a local declared `unknown`, a local that its
    // first write declares).
    if (
      admission.structured &&
      registry?.mode === 'strict' &&
      locals.get(name) === 'let'
    ) {
      const t = value.type.type;
      const kind =
        isSubtype(t, 'real') || isSubtype(t, 'boolean')
          ? 'real'
          : isSubtype(t, 'complex')
            ? 'complex'
            : undefined;
      let classes = writtenClasses.get(name);
      if (classes === undefined)
        writtenClasses.set(name, (classes = new Set()));
      if (kind !== undefined) classes.add(kind);
      if (classes.size > 1)
        throw new Error(
          `JS scalar fragment: the local ${name} is written a real value and ` +
            `a complex value (${nodeText(value)} has the type ` +
            `${value.type.toString()}): the existing compiler declines a ` +
            `local whose values have two shapes in the strict mode`
        );
    }
    const length = fromLength(value);
    const declaredType = locals.get(name);
    if (length && (declaredType === 'let' || declaredType === 'integer'))
      lengthWritten.add(name);
    else if (!isSubtype(value.type.type, 'integer')) notLength.add(name);
    if (
      declaredType === 'integer' &&
      !length &&
      !isSubtype(value.type.type, 'integer')
    )
      throw new Error(
        `JS scalar fragment: a value written to the integer local ${name} ` +
          `does not have the type integer`
      );
    // In the `strict` mode, the existing compiler declines a write of a
    // value whose type is complex and not real to a local declared `real`
    // or `integer` (`assignedTypesConflict()` in `compile-admission.ts`):
    // the local would hold values of two shapes. The pass of the route
    // reads such a value on the real lane (`Sqrt(x)` is `Math.sqrt(x)`), so
    // the admission refuses it here.
    if (
      admission.structured &&
      registry?.mode === 'strict' &&
      (declaredType === 'real' || declaredType === 'integer') &&
      isSubtype(value.type.type, 'complex') &&
      !isSubtype(value.type.type, 'real')
    )
      throw new Error(
        `JS scalar fragment: the local ${name} is declared ${declaredType}, ` +
          `and the value ${nodeText(value)} written to it has the type ` +
          `${value.type.toString()}, which is not real`
      );
  };
  if (first !== undefined) {
    locals.set(first.local, first.declared);
    checkValue(first.value);
    checkWrite(first.value);
    names.add(first.local);
  }
  // The structured route: more declarations, writes to the declared locals,
  // `If` statements and counted loops (`checkStructuredStatement()`). Each
  // write makes a new value in the lowering.
  /** The block of the body and the blocks at the place of its value
   *  (`checkValueBlock()`), where a local function is admitted. */
  const bodyBlocks = new Set<Expression>();
  /** Run `check` on the statements of a nested block or loop body: the
   *  locals that it declares are not visible after it. */
  const nested = (check: () => void): void => {
    const outerNames = new Set(names);
    const outerLocals = new Map(locals);
    const outerIndices = new Set(indices);
    try {
      check();
    } finally {
      names.clear();
      for (const n of outerNames) names.add(n);
      locals.clear();
      for (const [n, t] of outerLocals) locals.set(n, t);
      indices.clear();
      for (const n of outerIndices) indices.add(n);
    }
  };
  /**
   * Whether `statement` always ends in a `Break`: a `Break`, an `If` whose
   * two branches do, or a `Block` whose last statement does.
   */
  const exits = (statement: Expression): boolean => {
    if (isFunction(statement, 'Break')) return true;
    if (isFunction(statement, 'If'))
      return (
        statement.nops === 3 && exits(statement.op2) && exits(statement.op3)
      );
    if (isFunction(statement, 'Block'))
      return statement.nops > 0 && exits(statement.ops[statement.nops - 1]);
    return false;
  };
  /**
   * A statement of the body of the structured route. `place`: the
   * statement is in the block of the body (`top`), in a branch of an `If`
   * (`branch`), or in the body of a `Loop` (`loop`), the innermost one.
   * `inBlock`: the statement is a statement of a block, where a `Declare`
   * is admitted, and not a whole branch or a whole loop body.
   *
   * A `Break` with no value is admitted as the last statement of a branch of
   * an `If` statement, or of a block that is such a branch, in the body of a
   * `Loop`: it leaves the innermost loop. Refused: a `Break` that is a
   * statement of the loop body itself, a statement after a `Break` or after
   * an `If` whose two branches end in `Break`, and a loop body that always
   * ends in `Break`. A `Break` in a value is not a statement, and the value
   * check refuses it.
   *
   * `slot`: the position of this occurrence of the statement, passed down
   * the walk (a node object can be in several positions): the body of a
   * `Loop` (`loop-body`), a statement of that body when it is a `Block`
   * (`loop-statement`), a branch of an `If` in one of these two positions
   * (`branch`), the last statement of such a branch when it is a `Block`
   * (`branch-end`). A `Continue` is admitted only as a `branch` or a
   * `branch-end`, the positions that the lowering rewrites
   * (`Lowering.ifStatement()`).
   */
  const checkStructuredStatement = (
    statement: Expression,
    place: 'top' | 'branch' | 'loop',
    inBlock: boolean,
    owner?: Expression,
    slot?: StatementSlot
  ): void =>
    atNode(statement, () =>
      checkStructuredStatementNode(statement, place, inBlock, owner, slot)
    );
  /** `owner`: the block of which `statement` is a statement, where a first
   *  write to a name that the block binds declares the name
   *  (`implicitLocal()`). */
  const checkStructuredStatementNode = (
    statement: Expression,
    place: 'top' | 'branch' | 'loop',
    inBlock: boolean,
    owner?: Expression,
    slot?: StatementSlot
  ): void => {
    const head = isFunction(statement)
      ? statement.operator
      : statement.toString();
    const localFunction = admission.structured
      ? localFunctionStatement(statement)
      : undefined;
    if (localFunction !== undefined)
      return checkLocalFunction(statement, localFunction, place, owner);
    // A destructuring declaration or write (`Declare((a, b), {value: v})`,
    // `(a, b) ≔ v`), on the structured route.
    const pattern =
      admission.structured &&
      (isFunction(statement, 'Declare') || isFunction(statement, 'Assign')) &&
      isLibraryOperator(statement, statement.operator)
        ? tuplePatternNames(statement.op1)
        : undefined;
    if (pattern !== undefined && (inBlock || statement.operator === 'Assign'))
      return checkDestructuring(
        statement as Expression & { ops: readonly Expression[] },
        pattern
      );
    if (isFunction(statement, 'Declare') && inBlock) {
      const declared = declareLocal(statement);
      declarations.push({ node: statement, name: declared.local });
      locals.set(declared.local, declared.declared);
      writtenClasses.delete(declared.local);
      checkValue(declared.value);
      checkWrite(declared.value, declared.local);
      names.add(declared.local);
      return;
    }
    if (
      isFunction(statement, 'Assign') &&
      isLibraryOperator(statement, 'Assign') &&
      statement.nops === 2 &&
      isSymbol(statement.op1)
    ) {
      const name = statement.op1.symbol;
      // The interpreter gives the index the next element of the range at
      // the next iteration, whatever the body writes to it.
      if (indices.has(name))
        throw new Error(
          `JS scalar fragment: the structured route admits no write to the loop index ${name}`
        );
      if (registry?.localFunctions.has(name))
        throw new Error(
          `JS scalar fragment: the structured route admits no write to the ` +
            `local function ${name}`
        );
      // The first write to a local of the block that no `Declare` declares
      // declares it, as in the interpreter and the existing compiler
      // (`let s; s = …`): a `let` of the type of the value.
      if (
        owner !== undefined &&
        !names.has(name) &&
        !locals.has(name) &&
        implicitLocal(owner, name)
      ) {
        if (namesIn(statement.op2).has(name))
          throw new Error(
            `JS scalar fragment: the first write to the local ${name} of the ` +
              `block reads ${name}, which has no value yet`
          );
        // In another angular unit, `rewriteAngularUnit()` builds the block
        // again, and the existing compiler then reads such a local with no
        // type: in the `complex` mode as a complex value
        // (`_SYS.catan(_SYS.cplx(t))`, then a real product: `NaN` for
        // `t ≔ 1; arctan(t)` in degrees, where the interpreter gives 45).
        if (
          registry?.mode === 'complex' &&
          statement.engine.angularUnit !== 'rad'
        )
          throw new Error(
            `JS scalar fragment: the first write to ${name} declares a local ` +
              `of the block, and in the complex mode with the angular unit ` +
              `${statement.engine.angularUnit} the existing compiler reads ` +
              `such a local as a complex value`
          );
        checkValue(statement.op2);
        locals.set(name, 'let');
        checkWrite(statement.op2, name);
        names.add(name);
        return;
      }
      if (!locals.has(name) || !names.has(name))
        throw new Error(
          `JS scalar fragment: only writes to a declared local are supported, ` +
            `and ${name} is ` +
            (parameters.includes(name)
              ? 'a parameter'
              : 'not a local declared before the write')
        );
      checkValue(statement.op2);
      checkWrite(statement.op2, name);
      return;
    }
    if (
      isFunction(statement, 'If') &&
      isLibraryOperator(statement, 'If') &&
      (statement.nops === 2 || statement.nops === 3)
    ) {
      checkValue(statement.op1);
      checkCondition(statement, conditionContext);
      const branchSlot =
        slot === 'loop-body' || slot === 'loop-statement'
          ? 'branch'
          : undefined;
      for (const branch of statement.ops.slice(1))
        nested(() =>
          checkStructuredStatement(
            branch,
            'branch',
            false,
            undefined,
            branchSlot
          )
        );
      return;
    }
    // A block statement: also a statement of the body (`Block(Block(…))`,
    // the form of an Epsil program), whose locals are not visible after it.
    if (
      isFunction(statement, 'Block') &&
      isLibraryOperator(statement, 'Block')
    ) {
      nested(() => {
        statement.ops.forEach((inner, i) => {
          if (i < statement.nops - 1 && exits(inner))
            throw new Error(
              'JS scalar fragment: the structured route admits no statement after a Break, ' +
                'or after an If whose two branches end in Break'
            );
          checkStructuredStatement(
            inner,
            place,
            true,
            statement,
            slot === 'loop-body'
              ? 'loop-statement'
              : slot === 'branch' && i === statement.nops - 1
                ? 'branch-end'
                : undefined
          );
        });
      });
      return;
    }
    if (isFunction(statement, 'Loop') && isLibraryOperator(statement, 'Loop'))
      return checkLoop(statement);
    if (
      isFunction(statement, 'Break') &&
      isLibraryOperator(statement, 'Break') &&
      statement.nops === 0 &&
      place === 'branch' &&
      loopDepth > 0
    )
      return;
    // A `Continue` that ends a branch of an `If` of the body of a loop: the
    // statements of the body after the `If` run in the other branch, as the
    // existing emitter's `continue` skips them.
    if (
      isFunction(statement, 'Continue') &&
      isLibraryOperator(statement, 'Continue') &&
      statement.nops === 0 &&
      (slot === 'branch' || slot === 'branch-end')
    )
      return;
    if (
      admission.structured &&
      isFunction(statement, 'Continue') &&
      isLibraryOperator(statement, 'Continue')
    )
      throw new Error(
        'JS scalar fragment: the structured route admits a Continue only as the ' +
          'last statement of a branch of an If that is a statement of the body ' +
          'of a Loop, where the statements of the body after the If run in the ' +
          'other branch'
      );
    if (isFunction(statement, 'Break') && place === 'loop')
      throw new Error(
        'JS scalar fragment: the structured route admits a Break only as the last ' +
          'statement of a branch of an If, not as a statement of the body of a Loop'
      );
    throw new Error(
      `JS scalar fragment: the structured route admits no statement ${head}` +
        (place === 'top'
          ? ''
          : place === 'branch'
            ? ' in a branch of an If'
            : ' in the body of a Loop')
    );
  };
  /**
   * A destructuring declaration `Declare((a, b), {value: v})` (or with the
   * type `unknown`), or a destructuring write `(a, b) ≔ v`, of the names
   * `names`: the value is a literal tuple, or the call of a user function
   * whose value is a tuple of reals (the rule of the pass,
   * `isDestructurableValue()`). The existing emitter evaluates every
   * component, in order, before it writes a name (`_tv1 = b; _tv2 = a + b;
   * a = _tv1; b = _tv2`), and reads the components of a call with
   * `_SYS.at` (`destructureViaTemp()`). A declaration declares each name as
   * a `let` local of the type of its component; a write writes declared
   * locals only (the existing compiler declines a write to another name).
   */
  const checkDestructuring = (
    statement: Expression & { ops: readonly Expression[] },
    pattern: readonly string[]
  ): void => {
    const declaration = statement.operator === 'Declare';
    const value = declaration
      ? declareValueOperand(statement.ops)
      : statement.ops[1];
    const type = declaration ? declareTypeOperand(statement.ops) : undefined;
    if (
      value === undefined ||
      (declaration &&
        type !== undefined &&
        declaredTypeSource(type) !== 'unknown') ||
      (declaration && statement.ops.length > 3)
    )
      throw new Error(
        `JS scalar fragment: the destructuring declaration ${nodeText(statement)} ` +
          `is not in the structured route, which admits a declaration with a ` +
          `value and no type, or the type unknown`
      );
    if (new Set(pattern).size !== pattern.length)
      throw new Error(
        `JS scalar fragment: the destructuring ${declaration ? 'declaration' : 'write'} ` +
          `has a name at more than one position`
      );
    // The check of the writes to a local of the `complex` mode
    // (`checkLocalWrites()`) reads a write of one name.
    if (named.structured?.mode === 'complex')
      throw new Error(
        `JS scalar fragment: the destructuring ${declaration ? 'declaration' : 'write'} ` +
          `${nodeText(statement)} is not in the structured route in the complex mode`
      );
    checkValue(value);
    const components = isFunction(value, 'Tuple') ? value.ops : undefined;
    for (const [i, name] of pattern.entries()) {
      if (declaration) {
        if (
          parameters.includes(name) ||
          locals.has(name) ||
          names.has(name) ||
          name === 'True' ||
          name === 'False'
        )
          throw new Error(
            `JS scalar fragment: the local ${name} has the name of a parameter, ` +
              `an input, an index or a local declared before it: the structured ` +
              `route admits no redeclaration and no shadowing of a name`
          );
        declarations.push({ node: statement, name });
        locals.set(name, 'let');
        writtenClasses.delete(name);
      } else {
        if (indices.has(name))
          throw new Error(
            `JS scalar fragment: the structured route admits no write to the loop index ${name}`
          );
        if (!locals.has(name) || !names.has(name))
          throw new Error(
            `JS scalar fragment: only writes to a declared local are supported, ` +
              `and ${name} is ` +
              (parameters.includes(name)
                ? 'a parameter'
                : 'not a local declared before the write')
          );
      }
      if (components !== undefined && components.length === pattern.length)
        checkWrite(components[i], name);
      else notLength.add(name);
    }
    if (declaration) for (const name of pattern) names.add(name);
  };
  /**
   * A `Loop` statement over zero, one or more index sets
   * (`loopClauseKind()`). Each index set is `Element(k, Range(a, b))`, with
   * bounds of the type `integer`, or `Element(c, V)` over a list value `V`
   * (a name, a list literal, a `Range` with a step, a function of lists):
   * the interpreter evaluates the bounds or the list once, and visits each
   * integer from `a` to `b`, in steps of -1 when `b` is less than `a`, or
   * each element of `V`; the rule of the pass (`loopRule`) admits a list of
   * numbers or of tuples. Each index names no parameter, local or other
   * index. Several index sets are nested loops, the first outermost, and the
   * bounds or the list of an index set read the indexes before it, as the
   * existing emitter writes them (`compileElementLoops()`); a `Break` of the
   * body then declines, as there (`assertBreakLeavesWholeLoop()`): it leaves
   * the whole loop in the interpreter and the innermost loop in the code.
   * With no index set, `Loop(body)` runs until a `Break`, or until the
   * iteration budget stops it. A guard, or another collection, is refused.
   */
  const checkLoop = (
    loop: Expression & { ops: readonly Expression[] }
  ): void => {
    const clauses = loop.ops.slice(1);
    if (clauses.length > 1 && breaksLoop(loop.ops[0]))
      throw new Error(
        'JS scalar fragment: the structured route admits no Break inside a Loop ' +
          'over several index sets: it leaves the whole loop in the interpreter, ' +
          'and the existing compiler declines it'
      );
    nested(() => {
      for (const spec of clauses) {
        const kind = loopClauseKind(spec);
        if (kind === undefined)
          throw new Error(
            `JS scalar fragment: the structured route admits a Loop only over ` +
              `Element(k, Range(a, b)) or the elements of a list, with no ` +
              `guard, and not over ${nodeText(spec)}`
          );
        const source = (spec as Expression & { op2: Expression }).op2;
        if (kind === 'list') checkValue(source);
        else
          for (const bound of (
            source as Expression & { ops: readonly Expression[] }
          ).ops) {
            indexPositions.add(bound);
            checkValue(bound);
            // A bound computed from the length of a list with integer
            // arithmetic (`integerFromListLength()`), which the engine does
            // not type `integer`: the rule that `loopBoundFromFact` reads in
            // the pass, with the length locals as the integer names.
            if (!fromLength(bound) && !isSubtype(bound.type.type, 'integer'))
              throw new Error(
                `JS scalar fragment: the bound ${nodeText(bound)} of a Loop does not have the type integer`
              );
          }
        const index = (
          spec as Expression & { op1: Expression & { symbol: string } }
        ).op1.symbol;
        if (
          names.has(index) ||
          locals.has(index) ||
          index === 'True' ||
          index === 'False'
        )
          throw new Error(
            `JS scalar fragment: the loop index ${index} has the name of a parameter, a local or another index`
          );
        names.add(index);
        indices.add(index);
      }
      loopDepth += 1;
      try {
        checkStructuredStatement(
          loop.ops[0],
          'loop',
          false,
          undefined,
          'loop-body'
        );
      } finally {
        loopDepth -= 1;
      }
    });
    if (exits(loop.ops[0]))
      throw new Error(
        'JS scalar fragment: the structured route admits no Loop whose body always ends in Break'
      );
  };
  /**
   * A block with statements used as a value, on the structured route: its
   * statements, then its value, with its locals visible in the block only.
   * The lowering writes the statements in the region of the value, in order,
   * where the existing emitter calls a function at once (`(() => { let a =
   * …; return … })()`). At the place of the value of the body (`body`: the
   * root block of one block, `Block(Block(…))`, or the last statement of the
   * body) a statement is any statement of the body; elsewhere (an operand)
   * each statement is a `Declare` with a value, the only block that the
   * existing compiler admits as an operand (a `where` clause).
   */
  const checkValueBlock = (
    node: Expression & { ops: readonly Expression[] },
    body: boolean
  ): void =>
    nested(() => {
      if (body) bodyBlocks.add(node);
      // The existing compiler reads an operand of a type that is not
      // numeric and not boolean (a block whose value has no declared type)
      // as a value of any shape, with the generic operations of the runtime
      // (`_SYS.bcast`, `_SYS.smul`), whose doubles differ (`0 · ∞` in the
      // imaginary part of a real factor).
      if (
        !body &&
        !isSubtype(node.type.type, 'number') &&
        !isSubtype(node.type.type, 'boolean')
      )
        throw new Error(
          `JS scalar fragment: the Block ${nodeText(node)} used as an operand ` +
            `has the type ${node.type.toString()}: the existing compiler reads ` +
            `such an operand as a value of any shape`
        );
      const statements = node.ops.slice(0, -1);
      statements.forEach((statement, i) => {
        if (
          !body &&
          !(
            isFunction(statement, 'Declare') &&
            declareValueOperand(statement.ops) !== undefined
          )
        )
          throw new Error(
            `JS scalar fragment: the statement ${nodeText(statement)} of a ` +
              `Block used as an operand is not a declaration with a value: ` +
              `the existing compiler admits as an operand only a block that ` +
              `declares names with a value before its value`
          );
        if (i < statements.length - 1 && exits(statement))
          throw new Error(
            'JS scalar fragment: the structured route admits no statement after a Break, ' +
              'or after an If whose two branches end in Break'
          );
        checkStructuredStatement(statement, 'top', true, node);
      });
      checkValue(node.ops[node.ops.length - 1], body);
    });
  /**
   * A local function (`LocalFunction`), the statement `statement` of the
   * block `owner`: admitted as a statement of the body of the root (the
   * block of the body, or a block at the place of its value), not in a
   * branch, a loop, a nested block statement or an operand, and not in the
   * body of a helper. Its name is not the name of a parameter, a local, an
   * operator of the library or another helper, and it is defined once; a
   * parameter of its literal has no name of the body around it. Its body is
   * admitted here, as the body of a helper whose parameters are those of the
   * literal and the captured names, so a local function that no statement
   * calls is admitted as the existing compiler compiles it. A call of the
   * function in its own body is refused: the route has no recursion
   * (`collectStructuredHelper()`).
   */
  const checkLocalFunction = (
    statement: Expression,
    local: NonNullable<ReturnType<typeof localFunctionStatement>>,
    place: 'top' | 'branch' | 'loop',
    owner: Expression | undefined
  ): void => {
    const { name, literal, declared } = local;
    const what = `the local function ${name}`;
    if (!isRoot || registry === undefined)
      throw new Error(
        `JS scalar fragment: the structured route admits no local function in the body of a helper (${what})`
      );
    // The existing compiler reads the value of a call of a closure of the
    // block as a complex value in the `complex` mode (`_SYS.cplx(g(…))`),
    // whatever its body: the shape of a real result differs.
    if (registry.mode === 'complex')
      throw new Error(
        `JS scalar fragment: the structured route admits ${what} only in the ` +
          `strict mode: in the complex mode the existing compiler reads the ` +
          `value of its calls as a complex value`
      );
    if (place !== 'top' || owner === undefined || !bodyBlocks.has(owner))
      throw new Error(
        `JS scalar fragment: the structured route admits ${what} only as a ` +
          `statement of the body, not in a branch, a loop, a nested block ` +
          `or an operand`
      );
    // `rewriteAngularUnit()` does not reach a value in a dictionary
    // (CE-1207): the literal of `Declare(g, {value: F})` keeps `sin(t)` in
    // radians, and the literal is not rewritten again here.
    if (
      isFunction(statement, 'Declare') &&
      statement.ops.some((op) => isDictionary(op)) &&
      statement.engine.angularUnit !== 'rad'
    )
      throw new Error(
        `JS scalar fragment: ${what} is declared with its value in a ` +
          `dictionary, and the angular unit is ${statement.engine.angularUnit}: ` +
          `the rewrite for the angular unit does not reach such a value`
      );
    if (local.write === true && !implicitLocal(owner, name))
      throw new Error(
        `JS scalar fragment: the write of a function literal to ${name} ` +
          `defines a local function only as the first write to a new local ` +
          `of the block`
      );
    if (
      declared !== undefined &&
      declared !== 'function' &&
      declared !== 'unknown'
    )
      throw new Error(
        `JS scalar fragment: ${what} is declared ${declared}: the structured ` +
          `route admits a local function declared function or unknown, whose ` +
          `parameters have the types of its literal`
      );
    if (
      names.has(name) ||
      locals.has(name) ||
      parameters.includes(name) ||
      registry.localFunctions.has(name) ||
      registry.helpers.has(name) ||
      registry.hosts?.heads.has(name) ||
      admission.heads.has(name) ||
      isLibraryName(literal.engine, name)
    )
      throw new Error(
        `JS scalar fragment: ${what} has the name of a parameter, a local, ` +
          `another function or an operator of the library, or is defined ` +
          `more than once: the structured route has one function per name`
      );
    const bound = new Set<string>();
    for (const parameter of literal.ops.slice(1)) {
      const p = functionLiteralParameterName(parameter);
      if (p !== undefined && names.has(p))
        throw new Error(
          `JS scalar fragment: the parameter ${p} of ${what} has the name of ` +
            `a parameter, an input or a local of the body around it`
        );
      if (p !== undefined) bound.add(p);
    }
    /** True when a `vars` entry maps `n` to a read of the host. */
    const hostRead = (n: string): boolean => {
      const entry = registry.hosts?.vars.get(n);
      return entry !== undefined && 'form' in entry && entry.form === 'read';
    };
    /** True when the options give a read of the host, or a `functions` or
     *  `operators` entry that is not declared pure: an operation of the
     *  program that can write the inputs object. */
    const hostEffects = (): boolean => {
      const hosts = registry.hosts;
      if (hosts === undefined) return false;
      for (const entry of hosts.vars.values())
        if ('form' in entry && entry.form === 'read') return true;
      for (const head of hosts.heads.values())
        if ('pure' in head && !head.pure) return true;
      return false;
    };
    // The names of the body around it that the literal reads, and those
    // that a local function it calls captures, in the order of their first
    // read.
    const captures: string[] = [];
    const captureArguments: Expression[] = [];
    const capture = (n: string, symbol: Expression) => {
      if (captures.includes(n)) return;
      captures.push(n);
      captureArguments.push(symbol);
    };
    /** The function nodes that `visit()` read, with the names bound around
     *  each read: a node object reached again with the same bound names
     *  reads the same names, so a shared subtree is read once. */
    const visited = new Map<Expression, Set<string>>();
    const visit = (node: Expression): void => {
      if (isFunction(node)) {
        const around = [...bound].join('\u0001');
        let seen = visited.get(node);
        if (seen?.has(around)) return;
        if (seen === undefined) visited.set(node, (seen = new Set()));
        seen.add(around);
      }
      // A calculus node reads the names of the expression that replaces it
      // (`closedFormReplacement()`): the variable of an integral is not a
      // capture.
      // A definite integral with no closed form reads its operands, its
      // variables bound.
      if (isCalculusNode(node)) {
        const replacement = closedFormReplacement(
          node,
          registry,
          target,
          false
        );
        if (replacement !== node) return visit(replacement);
        // A derivative or a limit computed numerically reads its operands
        // where it is, and its body with its variable bound.
        const routine = registry.routines.get(node);
        if (routine !== undefined) {
          for (const op of routine.operands) visit(op);
          const added = !bound.has(routine.name);
          if (added) bound.add(routine.name);
          try {
            visit(routine.body);
          } finally {
            if (added) bound.delete(routine.name);
          }
          return;
        }
        const variables = (registry.integrals.get(node)?.clauses ?? [])
          .map((c) => c.name)
          .filter((n) => !bound.has(n));
        for (const n of variables) bound.add(n);
        try {
          if (isFunction(node)) for (const op of node.ops) visit(op);
        } finally {
          for (const n of variables) bound.delete(n);
        }
        return;
      }
      if (isSymbol(node)) {
        if (bound.has(node.symbol)) return;
        if (registry.localFunctions.has(node.symbol))
          throw new Error(
            `JS scalar fragment: ${what} reads the local function ` +
              `${node.symbol} as a value: the structured route admits a ` +
              `local function only as the head of a call`
          );
        // A name that a `vars` entry maps to a read of the host: the
        // existing closure reads it where its body reads it, and the route
        // would read it at the call, also when the body does not.
        if (hostRead(node.symbol))
          throw new Error(
            `JS scalar fragment: ${what} reads ${node.symbol}, a read of the ` +
              `host: the structured route passes a name to a local function ` +
              `at the call, and the existing compiler reads it in the body`
          );
        // An input (in a root `Block`, a parameter of the body) that the
        // route reads at the call: a host operation of the program can
        // change the inputs object before the body reads it, where the
        // existing closure reads the new value. A parameter of a root
        // `Function` literal cannot change, and is refused too: the rule
        // reads only whether the name is a local of the body.
        if (names.has(node.symbol) && !locals.has(node.symbol) && hostEffects())
          throw new Error(
            `JS scalar fragment: ${what} reads the input ${node.symbol}, and ` +
              `the program has a read or a call of the host that is not ` +
              `declared pure: the structured route passes an input to a ` +
              `local function at the call, and a host operation can change ` +
              `it before the body reads it`
          );
        if (names.has(node.symbol)) capture(node.symbol, node);
        else if (
          node.symbol !== name &&
          owner.localScope?.bindings.has(node.symbol) === true
        )
          throw new Error(
            `JS scalar fragment: ${what} reads ${node.symbol}, a local of the ` +
              `block declared after it: the structured route passes a name to ` +
              `a local function only when it has a value at the definition`
          );
        return;
      }
      if (!isFunction(node)) return;
      const called = registry.localFunctions.get(node.operator);
      if (called !== undefined)
        called.captures.forEach((c, i) => {
          if (bound.has(c))
            throw new Error(
              `JS scalar fragment: a parameter of ${what} has the name ${c}, ` +
                `which the local function ${called.name} that it calls reads`
            );
          capture(c, called.captureArguments[i]);
        });
      for (const op of node.ops) visit(op);
    };
    visit(literal.ops[0]);
    const definition = owner.localScope?.bindings.get(name);
    const binding =
      definition === undefined
        ? undefined
        : 'value' in definition
          ? definition.value
          : 'operator' in definition
            ? definition.operator
            : undefined;
    if (binding === undefined)
      throw new Error(
        `JS scalar fragment invariant: no binding of ${what} in its block`
      );
    // The definitions that the calls of the name after the statement hold.
    // In another angular unit than radians, `rewriteAngularUnit()` builds
    // the block again, with a new scope, and a call keeps the binding of
    // the block before the rewrite. The admission refuses a second local
    // of the name and a local function outside the body of the root, so a
    // call of the name in the block reaches this local function.
    const bindings = new Set<object>([binding]);
    // Each node object once: a shared subtree is not walked once per path.
    const callsSeen = new Set<Expression>();
    const collectCalls = (node: Expression): void => {
      if (!isFunction(node) || callsSeen.has(node)) return;
      callsSeen.add(node);
      if (node.operator === name) {
        const d = node.valueDefinition ?? node.operatorDefinition;
        if (d !== undefined) bindings.add(d);
      }
      for (const op of node.ops) collectCalls(op);
    };
    if (isFunction(owner))
      owner.ops.slice(owner.ops.indexOf(statement) + 1).forEach(collectCalls);
    const entry: LocalFunction = {
      name,
      literal,
      statement,
      binding,
      bindings,
      captures,
      captureArguments,
    };
    registry.localFunctions.set(name, entry);
    registry.resolving.push(name);
    try {
      registry.helpers.set(
        name,
        resolveLocalFunction(entry, target, admission, named)
      );
    } finally {
      registry.resolving.pop();
    }
  };
  // The names of the local functions of the body, before its statements
  // are checked: a call of one before its definition is refused
  // (`collectStructuredHelper()`), and the body of a helper has none.
  if (admission.structured && registry !== undefined) {
    const defined: string[] = [];
    // Each node object once: a shared subtree is not scanned once per path.
    const scanned = new Set<Expression>();
    const scan = (node: Expression): void => {
      if (!isFunction(node) || scanned.has(node)) return;
      scanned.add(node);
      const local = localFunctionStatement(node);
      if (local !== undefined) defined.push(local.name);
      for (const op of node.ops) scan(op);
    };
    scan(body);
    if (!isRoot && defined.length > 0)
      throw new Error(
        `JS scalar fragment: the structured route admits no local function ` +
          `in the body of a helper (the local function ${defined[0]})`
      );
    for (const n of defined) registry.localFunctionNames.add(n);
  }
  if (block !== undefined) bodyBlocks.add(block);
  if (admission.structured)
    for (const statement of statements)
      checkStructuredStatement(statement, 'top', true, block);
  for (const statement of admission.structured ? [] : statements.slice(1)) {
    if (
      !isFunction(statement, 'Assign') ||
      !isLibraryOperator(statement, 'Assign') ||
      statement.nops !== 2 ||
      !isSymbol(statement.op1) ||
      statement.op1.symbol !== local
    )
      throw new Error(
        'JS scalar fragment: only writes to the declared local are supported'
      );
    checkValue(statement.op2);
    checkWrite(statement.op2);
  }
  checkValue(bodyValue, !expressionRoot);
  // The length locals of this body, by their declarations: the pass reads
  // them (`annotateStructured()`), and a local of the same name in another
  // body is another local.
  if (registry)
    for (const { node, name } of declarations)
      if (isLengthLocal(name)) registry.lengthDeclarations.add(node);
}

/** The names that `statement` binds: the local of each `Declare`, the
 *  index of each `Loop`, and each local of a block that a first write
 *  declares (`implicitLocal()`), in a nested block, branch or loop body
 *  too, and in a block used as a value at any depth. */
function boundNames(
  statement: Expression,
  names: string[] = [],
  // Each node object once: a shared subtree is not walked once per path.
  seen = new Set<Expression>()
): string[] {
  if (!isFunction(statement) || seen.has(statement)) return names;
  seen.add(statement);
  if (statement.operator === 'Declare' && isSymbol(statement.op1))
    names.push(statement.op1.symbol);
  // A destructuring declaration declares each name of its pattern.
  if (statement.operator === 'Declare')
    names.push(...(tuplePatternNames(statement.op1) ?? []));
  if (statement.operator === 'Loop')
    for (const spec of statement.ops.slice(1))
      if (isFunction(spec, 'Element') && isSymbol(spec.op1))
        names.push(spec.op1.symbol);
  if (statement.operator === 'Block')
    for (const s of statement.ops)
      if (
        isFunction(s, 'Assign') &&
        isSymbol(s.op1) &&
        implicitLocal(statement, s.op1.symbol)
      )
        names.push(s.op1.symbol);
  for (const s of statement.ops) boundNames(s, names, seen);
  return names;
}

/** The position of an occurrence of a statement in the body of a `Loop`,
 *  where a `Continue` is admitted (`checkStructuredStatement()`). */
type StatementSlot = 'loop-body' | 'loop-statement' | 'branch' | 'branch-end';

/**
 * The `Return` nodes of `root` that a path from `root` reaches where it is
 * not in tail position (`isTailOf()`): an operand, a condition, a statement
 * of a block that is not its last. A node object can be reached on several
 * paths; each node is visited at most once in each of the two places.
 */
function nonTailReturns(root: Expression): Set<Expression> {
  const found = new Set<Expression>();
  const seen = [new Set<Expression>(), new Set<Expression>()];
  const visit = (n: Expression, tail: boolean): void => {
    if (!isFunction(n)) return;
    const s = seen[tail ? 1 : 0];
    if (s.has(n)) return;
    s.add(n);
    const ret = isReturnNode(n);
    if (ret && !tail) found.add(n);
    n.ops.forEach((op, i) => {
      const inTail =
        tail &&
        ((n.operator === 'If' && n.nops === 3 && i > 0) ||
          (n.operator === 'Block' && i === n.nops - 1) ||
          (ret && i === 0));
      visit(op, inTail);
    });
  };
  visit(root, true);
  return found;
}

/** The names of the symbols of `node`, each node visited once (a node can
 *  be an operand of several nodes). */
function symbolsOnce(node: Expression): Set<string> {
  const names = new Set<string>();
  const seen = new Set<Expression>();
  const visit = (n: Expression) => {
    if (seen.has(n)) return;
    seen.add(n);
    if (isSymbol(n)) names.add(n.symbol);
    else if (isFunction(n)) for (const op of n.ops) visit(op);
  };
  visit(node);
  return names;
}

/** Whether `node` is `Return(…)`: `Return` has no definition in the
 *  library, and a definition is a user function of the name. */
function isReturnNode(node: Expression): boolean {
  return (
    isFunction(node, 'Return') &&
    node.engine.lookupDefinition('Return') === undefined
  );
}

/** Whether `node` is in tail position of `root`: `root` itself, a branch
 *  of an `If` of three operands in tail position, the last operand of a
 *  `Block` or the operand of a `Return` in tail position. */
function isTailOf(
  root: Expression,
  node: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  if (root === node) return true;
  // Each node once: both branches of an `If` can be one node.
  if (seen.has(root)) return false;
  seen.add(root);
  if (isFunction(root, 'If') && root.nops === 3)
    return isTailOf(root.op2, node, seen) || isTailOf(root.op3, node, seen);
  if (isFunction(root, 'Block') && root.nops > 0)
    return isTailOf(root.ops[root.nops - 1], node, seen);
  if (isFunction(root) && isReturnNode(root) && root.nops === 1)
    return isTailOf(root.op1, node, seen);
  return false;
}

/** The names of the pattern `pattern` of a destructuring declaration or
 *  write, a `Tuple` of two or more names, or `undefined`. */
function tuplePatternNames(pattern: Expression): string[] | undefined {
  if (
    !isFunction(pattern, 'Tuple') ||
    pattern.nops < 2 ||
    !pattern.ops.every((p) => isSymbol(p))
  )
    return undefined;
  return pattern.ops.map((p) => (p as Expression & { symbol: string }).symbol);
}

/**
 * The kind of the index set `spec` of a `Loop` or of a `Comprehension` on
 * the structured route, or `undefined` for another form: `range` for
 * `Element(k, Range(a, b))`, a counted loop; `list` for `Element(c, V)`
 * over a value `V` of a list type that is not such a range (a name, a list
 * literal, a `Range` with a step, a function of lists), whose elements the
 * loop visits. With `guard`, also `Element(k, …, guard)`. `Element` and
 * `Range` are the operators of the library: a user function of one of
 * these names is not an index set.
 */
function loopClauseKind(
  spec: Expression,
  guard = false
): 'range' | 'list' | undefined {
  if (
    !isFunction(spec, 'Element') ||
    !isLibraryOperator(spec, 'Element') ||
    !(spec.nops === 2 || (guard && spec.nops === 3)) ||
    !isSymbol(spec.op1)
  )
    return undefined;
  if (
    isFunction(spec.op2, 'Range') &&
    isLibraryOperator(spec.op2, 'Range') &&
    spec.op2.nops === 2
  )
    return 'range';
  // A `ParallelDomain` is the domain of a parallel loop, not a list.
  if (isFunction(spec.op2, 'ParallelDomain')) return undefined;
  return isSubtype(spec.op2.type.type, 'list') ? 'list' : undefined;
}

/** Whether `body`, the body of a loop, holds a `Break` of that loop: one
 *  that no nested `Loop` and no `Function` literal owns. */
function breaksLoop(
  body: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  // Each node once: a node can be an operand of several nodes.
  if (!isFunction(body) || seen.has(body)) return false;
  seen.add(body);
  if (body.operator === 'Break') return true;
  if (body.operator === 'Loop' || body.operator === 'Function') return false;
  return body.ops.some((op) => breaksLoop(op, seen));
}

/**
 * Whether a write to `name` that is a statement of the block `block`
 * declares a local of the block: the scope of the block binds the name, and
 * no `Declare` of the block declares it. The canonical form makes such a
 * name a local of the block, the interpreter gives it its first value at
 * the first such write, and the existing compiler writes `let s; s = …`. A
 * read before that write, or a first write in a branch or a loop, is an
 * error of the canonical form. The fragment pass reads the same rule
 * (`walkBlock()`).
 */
function implicitLocal(block: Expression, name: string): boolean {
  if (!isFunction(block, 'Block') || !isLibraryOperator(block, 'Block'))
    return false;
  if (block.localScope?.bindings.has(name) !== true) return false;
  return !block.ops.some(
    (s) => isFunction(s, 'Declare') && isSymbol(s.op1) && s.op1.symbol === name
  );
}

/**
 * The name and the literal of the statement `statement` when it defines a
 * local function: `DefineFunction(g, literal)`, or `Declare(g, T, literal)`
 * with a `Function` literal as its value, whatever `T` (`function`,
 * `unknown`, a signature, or the form of a `let`). `declared`: the spelling
 * of `T`, `undefined` for a `let` and for `DefineFunction`.
 */
function localFunctionStatement(statement: Expression):
  | {
      readonly name: string;
      readonly literal: Expression & { ops: readonly Expression[] };
      readonly declared: string | undefined;
      /** True for a write of a function literal (`Assign(g, F)`), which
       *  defines a local function only as the first write to a local of
       *  its block. */
      readonly write?: boolean;
    }
  | undefined {
  if (!isFunction(statement) || !isSymbol(statement.op1)) return undefined;
  if (
    statement.operator === 'DefineFunction' ||
    statement.operator === 'Assign'
  ) {
    if (statement.nops !== 2 || !isFunction(statement.op2, 'Function'))
      return undefined;
    return {
      name: statement.op1.symbol,
      literal: statement.op2,
      declared: undefined,
      ...(statement.operator === 'Assign' ? { write: true } : {}),
    };
  }
  if (statement.operator !== 'Declare') return undefined;
  const value = declareValueOperand(statement.ops);
  if (!isFunction(value, 'Function')) return undefined;
  const type = declareTypeOperand(statement.ops);
  return {
    name: statement.op1.symbol,
    literal: value,
    declared: type === undefined ? undefined : declaredTypeSource(type),
  };
}

/** Whether `expr` holds a block of the library with more than one operand,
 *  at any depth outside a `Function` literal: each node object is visited
 *  once. */
function holdsValueBlock(expr: Expression): boolean {
  const seen = new Set<Expression>();
  const visit = (node: Expression): boolean => {
    if (!isFunction(node) || seen.has(node) || node.operator === 'Function')
      return false;
    seen.add(node);
    if (
      node.operator === 'Block' &&
      node.nops > 1 &&
      isLibraryOperator(node, 'Block')
    )
      return true;
    return node.ops.some(visit);
  };
  return visit(expr);
}

/** The names of the symbols that `node` reads or writes. Each node object
 *  is visited once. */
function namesIn(
  node: Expression,
  names = new Set<string>(),
  seen = new Set<Expression>()
): Set<string> {
  if (isSymbol(node)) names.add(node.symbol);
  else if (isFunction(node) && !seen.has(node)) {
    seen.add(node);
    for (const op of node.ops) namesIn(op, names, seen);
  }
  return names;
}

/**
 * The spelling of the element type of the declared list type `type`, as the
 * existing emitter writes it as the third argument of `_SYS.atNumeric`
 * (`typeToString()` of `indexElementType()`): `finite_real` for
 * `list<finite_real>`, `real` for `vector<real>`, `number` for
 * `list<number>` (a list of the `strict` mode). `undefined` for a type that
 * is not a list of the structured route.
 */
function elementLabel(type: Type | undefined): string | undefined {
  const list =
    type === undefined ? undefined : structuredListType(type, 'strict');
  if (list === undefined || 'refusal' in list) return undefined;
  const element = indexElementType(type!);
  return element === undefined ? undefined : typeToString(element);
}

/** The input `name` of the structured route, with the type `type`: a
 *  scalar, a list of reals or of integers, or a tuple of reals (a fragment
 *  point). `declared`: the engine type
 *  of the input, for the label of a list (`elementLabel()`). `lifted`: a
 *  complex input with no declared type in the `complex` mode, which the
 *  host can give as a number or a complex value (`IRInput.lifted`). */
function structuredInput(
  name: string,
  type: {
    readonly kind: string;
    readonly element?: { readonly kind: string };
    readonly size?: number;
  },
  declared?: Type,
  lifted = false,
  unread = false
): StructuredInput {
  const rep = structuredRepresentation(type);
  const kind = type.kind;
  if (
    rep === undefined ||
    !['real', 'integer', 'boolean', 'complex', 'list', 'point'].includes(kind)
  )
    throw new Error(
      `JS scalar fragment invariant: no scalar, list or tuple input ${name}`
    );
  const label = type.kind === 'list' ? elementLabel(declared) : undefined;
  if (lifted && kind !== 'complex')
    throw new Error(
      `JS scalar fragment invariant: the lifted input ${name} is not complex`
    );
  return {
    name,
    type: structuredValueType(type),
    representation: rep,
    ...(label === undefined ? {} : { elementLabel: label }),
    ...(lifted ? { lifted: true as const } : {}),
    ...(unread ? { unread: true as const } : {}),
  };
}

type ResolvedHelper = ScalarFragmentHelper & {
  readonly binding: object;
  /** `undefined` for a helper with an inferred signature on the structured
   *  route: its result is the fact of its body. */
  readonly resultRepresentation: ScalarRepresentation | undefined;
  /** Whether the result type of the helper is read from its signature:
   *  a declared signature, or one derived from a literal whose parameters
   *  all have an annotation. */
  readonly declaredResult: boolean;
  /** For each parameter of the helper, whether it has no declared type and
   *  took the default kind of the mode (`defaultedParameterKind()`). */
  readonly defaulted: readonly boolean[];
  /** For each parameter of the helper, whether it is declared `number` in
   *  the `complex` mode, where it is complex (`declaredNumberKind()`). */
  readonly wide: readonly boolean[];
  readonly fragment: Omit<FragmentFunction, 'arguments'>;
  /** The label of each list parameter (`elementLabel()`). */
  readonly parameterElementLabels?: readonly (string | undefined)[];
  /** A local function (`LocalFunction`): the arguments of a call after its
   *  operands, one per captured name. */
  readonly captureArguments?: readonly Expression[];
};

/** A captured binding of the structured route (`StructuredCapture`), with
 *  the stored value that the fragment pass types in place of each read. */
type CaptureEntry = StructuredCapture & {
  readonly symbols: Set<Expression>;
  readonly stored: Expression;
};

/**
 * The helpers and the captures of a compilation on the structured route.
 * Each helper is resolved once, at its first call, and can call another
 * helper. Each captured binding has one entry, whatever the number of its
 * reads, in the root or in a helper.
 */
type StructuredRegistry = {
  readonly mode: 'strict' | 'complex';
  /** The target of the compilation, for the fold of a closed jump
   *  (`closedJumpFold()`). */
  readonly target: CompileTarget<Expression>;
  /** The value of each node that the existing compiler writes as a literal
   *  with `constantFold: false` (`closedJumpFold()`), for the lowering. */
  readonly folds: Map<Expression, number | boolean>;
  /** The answer of `closedJumpFold()` for each node that it was asked
   *  about: the literal, or `null` for a node that keeps its code. */
  readonly foldResults: Map<Expression, Expression | null>;
  readonly helpers: Map<string, ResolvedHelper>;
  readonly captures: Map<object, CaptureEntry>;
  /** The helpers whose body is being checked, outermost first. */
  readonly resolving: string[];
  /** The form that the rule of each `Power` and `Abs` node chose
   *  (`StructuredForm`), for the lowering. */
  readonly forms: Map<Expression, StructuredForm>;
  /** The `Declare` statements, of the root and of each helper, of the
   *  length locals of their body (`admitFunctionBody()`, `isLengthLocal()`):
   *  each value written to the local in its body is computed from a length
   *  or has the type `integer`. The pass types such a `let` local as an
   *  integer (`structuredLocalType()`), and the rule of `Assign` checks
   *  the fact of each write again. A local whose declaration is not here is
   *  not a length local. */
  readonly lengthDeclarations: Set<Expression>;
  /** The options of the host (`structuredHosts()`), and the bindings of the
   *  host that the admission finds. */
  hosts?: StructuredHosts;
  /** The local functions of the body of the root (`LocalFunction`), by
   *  name, recorded at their definition. */
  readonly localFunctions: Map<string, LocalFunction>;
  /** The names of every local function that a statement of the body of the
   *  root defines, also in a place where it is refused: a call of such a
   *  name before its definition is refused. */
  readonly localFunctionNames: Set<string>;
  /** The calls of the local functions: their effect is the effect of the
   *  body, which the lowering joins (`effectFacts()`). */
  readonly localCalls: Set<Expression>;
  /** The expression that replaces each calculus node of the program
   *  (`closedFormReplacement()`), and the steps of the shared pool that the
   *  searches of integrals spent. */
  readonly closedForms: Map<Expression, Expression>;
  readonly closedFormSearch: { spent: number };
  /** Each definite `Integrate` node of the program with no closed form,
   *  which the route integrates numerically (`quadratureIntegral()`). */
  readonly integrals: Map<Expression, StructuredIntegral>;
  /** Each derivative and limit of the program with no closed form, which
   *  the route computes numerically (`numericDerivative()`,
   *  `numericLimit()`). */
  readonly routines: Map<Expression, StructuredNumericRoutine>;
  /** The free names with no value that the body of a helper reads, the
   *  first read of each name (`admitHelperInput()`): inputs of the program,
   *  which the root admits as its own free symbols after its check. Absent
   *  for a root `Function`, whose parameters are its only inputs. */
  helperInputs?: (Expression & { symbol: string })[];
  /** The admission of a captured expression where the root computes it
   *  (`recordCapture()`), for a read in the body of a helper. Absent for a
   *  root `Function`. */
  rootStored?: (stored: Expression, name: string) => void;
  /** For each helper, the names of the captured expressions that its body
   *  reads, directly or through a helper that it calls, in the order of
   *  their first read, with a symbol of each (`storedParameters()`). */
  /** The reads of a captured expression, or of an alias of one, that the
   *  root computes alone, at its start, and passes to a helper
   *  (`recordStoredRead()`): the read in the body of the helper and the
   *  symbol that each call passes. The pass does not check the names of
   *  such a value against the forms around the read
   *  (`FragmentDefinition.storedOutsideBinders`). */
  readonly storedOnce: Set<Expression>;
  readonly storedCaptures: Map<
    string,
    { readonly names: string[]; readonly symbols: Expression[] }
  >;
};

/**
 * A local function of the body of the root on the structured route: a
 * statement `Declare(g, 'function', literal)` (or the type `unknown`, or
 * the form of a `let`), or `DefineFunction(g, literal)`, of the block of the
 * body, which the interpreter and the existing compiler make a closure of
 * the block (`let g = ((t) => …)`). The route makes it a helper of the
 * program, compiled once: its parameters are the parameters of the literal,
 * then one parameter for each name of the body around it that the literal
 * reads (`captures`: an input, a parameter or a local of the root), passed
 * at each call with its value there. A closure reads such a name when it is
 * called, so the value passed is the value that the closure reads.
 */
type LocalFunction = {
  readonly name: string;
  readonly literal: Expression & { ops: readonly Expression[] };
  /** The statement that defines it. */
  readonly statement: Expression;
  /** The definition of the name in the scope of its block: a call reaches
   *  the local function when its definition is this one. */
  readonly binding: object;
  /** `binding`, and the definitions that the calls of the name after the
   *  statement in its block hold: a call reaches the local function when
   *  its definition is one of them. */
  readonly bindings: ReadonlySet<object>;
  /** The names of the body around it that the literal reads, directly or
   *  through a call of another local function, in order. */
  readonly captures: readonly string[];
  /** A symbol of each captured name: the argument of the call, typed and
   *  lowered where the call is. */
  readonly captureArguments: readonly Expression[];
};

/** The calls of helpers of a compilation. `helper` is the one helper of
 *  the existing route; `structured` holds the helpers and the captures of
 *  the structured route. */
type NamedCalls = {
  helper?: ResolvedHelper;
  calls: Set<Expression>;
  structured?: StructuredRegistry;
};

/** The registry of a compilation of `target` on the structured route, or
 *  `undefined` on the existing route. The options check refuses the
 *  `bigint` mode. */
function structuredRegistry(
  admission: Admission,
  target: CompileTarget<Expression>
): StructuredRegistry | undefined {
  if (!admission.structured) return undefined;
  const mode =
    BaseCompiler.resolveCompileMode(target) === 'complex'
      ? 'complex'
      : 'strict';
  return {
    mode,
    target,
    folds: new Map(),
    foldResults: new Map(),
    helpers: new Map(),
    captures: new Map(),
    resolving: [],
    forms: new Map(),
    lengthDeclarations: new Set(),
    localFunctions: new Map(),
    localFunctionNames: new Set(),
    localCalls: new Set(),
    closedForms: new Map(),
    closedFormSearch: { spent: 0 },
    integrals: new Map(),
    routines: new Map(),
    storedCaptures: new Map(),
    storedOnce: new Set(),
  };
}

/**
 * Whether the symbol `symbol` has no declared type: its definition has an
 * inferred type, or it has no definition (a free name). On the structured
 * route such a name takes the default kind of the compile mode
 * (`defaultKind()`) where it is a parameter of the root `Function` literal
 * or a free symbol with no value, and a captured snapshot takes the kind of
 * its value (`numericSnapshot()`). A symbol declared with a type, even
 * `number` or `any`, has a declared type
 * (docs/plans/2026-11-10-js-numeric-kernel-profile-spec.md, "Names with no
 * declared type").
 *
 * Boxing writes no
 * inferred type on a definition of the host's scopes: such a definition
 * holds an inferred type only because the host called `ce.infer()`,
 * `ce.assume()` or `ce.assign()`, or evaluated an assignment. A symbol whose
 * definition is the one that the engine finds for its name where the
 * program is compiled, with a type that is not `unknown` (an inferred type,
 * or the type `unknown` that an assumption narrowed), has a declared type:
 * the type of its occurrence, which the existing compiler reads too. The
 * definition of a parameter or of a local of the program is not that
 * definition, and boxing still narrows its type: such a name has no
 * declared type.
 *
 * The first test is `hasInferredType()` (`type-guards.ts`), which follows
 * the storage of bindings and of inferred types; every rule of the profile
 * that asks this question calls this function.
 */
export function hasNoDeclaredType(symbol: Expression): boolean {
  if (!isSymbol(symbol) || !hasInferredType(symbol)) return false;
  const definition = resolvedValueDefinition(symbol);
  if (definition === undefined || definition.type.isUnknown) return true;
  const ambient = symbol.engine.lookupDefinition(symbol.symbol);
  return (
    ambient === undefined ||
    !('value' in ambient) ||
    ambient.value !== definition
  );
}

/** The kind of a name with no declared type (`hasNoDeclaredType()`) in the
 *  compile mode `mode`: a real number in the `strict` mode, a complex
 *  number in the `complex` mode. */
function defaultKind(mode: 'strict' | 'complex') {
  return mode === 'complex'
    ? ({ kind: 'complex' } as const)
    : ({ kind: 'real' } as const);
}

/** The union of `real` with `nan` and `signed_infinity`: a declared type
 *  that is a subtype of it holds only doubles (`declaredNumberKind()`). */
const REAL_WITH_NON_FINITE_TYPE = parseType('real | nan | signed_infinity');

/**
 * The kind of a name declared with a numeric type that `scalarType()` has no
 * kind for (an input, a parameter of a `Function` literal or of a helper), on
 * the structured route in the compile mode `mode`. It is the lane that the
 * existing compiler gives such a binding (`wideNumericType()` in
 * `compiler-mode.ts`):
 *
 * - `number` (or a union of `number` with `nan`) has the default kind of the
 *   mode (`defaultKind()`): real in the `strict` mode, complex in the
 *   `complex` mode. `lifted`: in the `complex` mode the host can give a
 *   number or a complex value, and the existing compiler converts it at each
 *   read (`liftWideReference()`).
 * - A union of a real type with `nan` or `signed_infinity`
 *   (`nan | real | signed_infinity`) is real in both modes: a double holds
 *   each member, and the existing compiler keeps it on the real lane in the
 *   `complex` mode too.
 *
 * `undefined` for a type that `scalarType()` maps, and for another type
 * (`any`, `unknown`, `finite_number`, `complex | nan`, `imaginary | nan`, a
 * type that is not numeric): a name of such a type keeps its refusal. A name
 * of a type that this function maps has a declared type, so it is not
 * listed in `defaultedSymbols`.
 */
function declaredNumberKind(
  type: Type,
  mode: 'strict' | 'complex'
): { readonly kind: 'real' | 'complex'; readonly lifted: boolean } | undefined {
  if (scalarType(type) !== undefined) return undefined;
  if (isSubtype(type, 'number') && isSubtype('number', type))
    return { kind: defaultKind(mode).kind, lifted: mode === 'complex' };
  if (isSubtype(type, REAL_WITH_NON_FINITE_TYPE))
    return { kind: 'real', lifted: false };
  return undefined;
}

/** The kind of the parameter `parameter` of a `Function` literal on the
 *  structured route (`registry`) when it has no declared type: no
 *  annotation, and `hasNoDeclaredType()`. It is the default kind of the
 *  mode (`defaultKind()`). `undefined` for a parameter with a declared
 *  type, and on the existing route. The parameters of the root function
 *  (`attachBoundFunction()`) and of a helper with an inferred signature
 *  (`resolveHelper()`) take this kind. */
function defaultedParameterKind(
  parameter: Expression,
  registry: StructuredRegistry | undefined
) {
  if (
    registry === undefined ||
    functionLiteralParameterType(parameter) !== undefined ||
    !hasNoDeclaredType(parameter)
  )
    return undefined;
  return defaultKind(registry.mode);
}

/**
 * The snapshot of the captured binding that the symbol `node` reads, or
 * `undefined` when the binding is not one that the fragment captures: a
 * binding declared real or integer, or with no declared type
 * (`hasNoDeclaredType()`), that holds a finite real number literal, and
 * that is the binding the engine finds for the name where the program is
 * compiled (a binding of another scope with the same name is not
 * captured). A binding with no declared type, or declared with a numeric
 * type that `declaredNumberKind()` maps (`number`), is captured only when
 * `admitsUndeclared` (the structured route). The pass types the snapshot
 * in place of each read, so such a binding takes the kind of its value:
 * `integer` for an integer, `real` for another real number, as the existing
 * compiler writes the value.
 *
 * On the structured route (`admitsUndeclared`) two more bindings are
 * captured, as the existing compiler writes the value that it reads by the
 * name (`tryFoldKnownSymbol()` in `compile-folded-values.ts`):
 *
 * - A list: a binding declared a list of reals or of integers, or with no
 *   declared type, that holds a list literal of finite real number literals
 *   (`isCapturedList()`). `list` is true; the pass types the list literal in
 *   place of each read, and the lowering makes a new array of its elements
 *   for each call (`captureRead()` in `javascript-structured-lower.ts`).
 * - A frame value (`frameValue()`): the value of a parameter or a local of a
 *   call that the engine evaluates when the program is compiled (`d` of
 *   `f(d) := Sum(Map(x ↦ x + d, …))`). The binding of `node` holds no value,
 *   the engine reads the value of the name in the frame of the call, and
 *   the binding is not the one that the engine finds for the name in the
 *   current scope.
 *
 * `assertCurrent()` throws when the binding, whether its type is declared,
 * its declared type or its value changed after this call.
 */
function numericSnapshot(
  node: Expression & { symbol: string },
  admitsUndeclared: boolean
):
  | {
      binding: object;
      value: Expression;
      list: boolean;
      assertCurrent: () => void;
    }
  | undefined {
  const binding = resolvedValueDefinition(node);
  const frame = admitsUndeclared ? frameValue(node) : undefined;
  const value = frame ?? binding?.value;
  const ambient = node.engine.lookupDefinition(node.symbol);
  // The existing route captures only a binding that the host declared: a
  // type that `ce.assign()` or `ce.infer()` wrote is not a declaration
  // there, and keeps the refusal of a binding with no declared type.
  const isUndeclared = (n: Expression) =>
    admitsUndeclared ? hasNoDeclaredType(n) : hasInferredType(n);
  const undeclared = isUndeclared(node);
  const list = admitsUndeclared && value !== undefined && isCapturedList(value);
  if (
    !binding ||
    (undeclared && !admitsUndeclared) ||
    (!undeclared &&
      (list
        ? !isSubtype(binding.type.type, LIST_OF_REALS_TYPE) &&
          !isSubtype(binding.type.type, LIST_OF_LISTS_OF_REALS_TYPE)
        : !isSubtype(binding.type.type, 'real') &&
          !(
            admitsUndeclared &&
            declaredNumberKind(binding.type.type, 'strict') !== undefined
          ))) ||
    !value ||
    (!list &&
      (!isNumber(value) || !Number.isFinite(value.re) || value.im !== 0)) ||
    (frame === undefined &&
      (!ambient || !('value' in ambient) || ambient.value !== binding)) ||
    node.engine._getSymbolValue(node.symbol) !== value
  )
    return undefined;
  const declaredType = binding.type.type;
  return {
    binding,
    value,
    list,
    assertCurrent: () => {
      const current = node.engine.lookupDefinition(node.symbol);
      if (
        (frame === undefined &&
          (!current ||
            !('value' in current) ||
            current.value !== binding ||
            binding.value !== value)) ||
        (frame !== undefined && frameValue(node) !== value) ||
        resolvedValueDefinition(node) !== binding ||
        isUndeclared(node) !== undeclared ||
        (!undeclared && binding.type.type !== declaredType) ||
        node.engine._getSymbolValue(node.symbol) !== value
      )
        throw new Error(
          'JS scalar fragment invariant: different captured binding or value'
        );
    },
  };
}

/** The list types of reals and of integers: the type of a captured list
 *  (`isCapturedList()`). */
const LIST_OF_REALS_TYPE = parseType('list<real>');

/** The lists of lists of reals or of integers: the type of a captured list
 *  of rank 2 (`isCapturedList()`). */
const LIST_OF_LISTS_OF_REALS_TYPE = parseType('list<list<real>>');

/**
 * Whether `value`, the value of a binding, is a list that the structured
 * route captures: a `List` of one or more finite real number literals, a
 * list of reals or of integers that the route writes as an array of
 * numbers, or a `List` of one or more such lists (rank 2, rows of any
 * length, as the existing compiler writes `[[1, 2], [3]]`), which it
 * writes as an array of such arrays. A list of lists of lists, of tuples
 * or of other values, and an empty list or an empty row, keep their
 * refusal.
 */
function isCapturedList(value: Expression): boolean {
  const isFlat = (list: Expression): boolean =>
    isFunction(list, 'List') &&
    isLibraryOperator(list, 'List') &&
    list.nops > 0 &&
    isSubtype(list.type.type, LIST_OF_REALS_TYPE) &&
    list.ops.every(
      (op) => isNumber(op) && op.im === 0 && Number.isFinite(op.re)
    );
  if (isFlat(value)) return true;
  return (
    isFunction(value, 'List') &&
    isLibraryOperator(value, 'List') &&
    value.nops > 0 &&
    isSubtype(value.type.type, LIST_OF_LISTS_OF_REALS_TYPE) &&
    value.ops.every(isFlat)
  );
}

/**
 * The value of the captured binding that the symbol `node` reads, on the
 * structured route, when it is not a number or a list that
 * `numericSnapshot()` captures:
 *
 * - `complex`: a complex number literal with finite parts and an imaginary
 *   part that is not 0, of a binding with no declared type
 *   (`hasNoDeclaredType()`) or declared `complex` or `number`. The existing
 *   compiler writes it at each read as the object of its parts
 *   (`({ re: -0.524, im: -0.566 })`), in both modes. A real value of a
 *   binding declared `complex` keeps its refusal: the existing compiler
 *   reads it on the complex lane (`_SYS.cplx(5)`), where the pass would type
 *   the literal as a real number.
 * - `expression`: an application that is not a `Function` literal, or a
 *   symbol, that is pure through every stored value it reads
 *   (`foldValueImpure()`), rewritten for the angular unit of the engine
 *   (`foldedValueInRadians()`), as the existing compiler compiles it
 *   (`tryFoldKnownSymbol()`: `const _val_lv = _.x + 1;` for an application,
 *   the value written at the read for a symbol).
 *
 * As for `numericSnapshot()`, the binding is the one that the engine finds
 * for the name where the program is compiled, and holds the value that the
 * engine reads (no value of the frame of a call). `assertCurrent()` throws
 * when the binding or its value changed.
 */
function storedSnapshot(
  node: Expression & { symbol: string },
  registry: StructuredRegistry
):
  | {
      binding: object;
      value: Expression;
      stored: Expression;
      kind: 'complex' | 'expression';
      assertCurrent: () => void;
    }
  | undefined {
  const binding = resolvedValueDefinition(node);
  const value = binding?.value;
  if (binding === undefined || value === undefined) return undefined;
  const ambient = node.engine.lookupDefinition(node.symbol);
  if (
    !ambient ||
    !('value' in ambient) ||
    ambient.value !== binding ||
    node.engine._getSymbolValue(node.symbol) !== value
  )
    return undefined;
  let kind: 'complex' | 'expression';
  if (isNumber(value)) {
    const declared = binding.type.type;
    if (
      value.im === 0 ||
      !Number.isFinite(value.re) ||
      !Number.isFinite(value.im) ||
      !(
        hasNoDeclaredType(node) ||
        (isSubtype(declared, 'number') && isSubtype('complex', declared))
      )
    )
      return undefined;
    kind = 'complex';
  } else if (
    (isFunction(value) && !isFunction(value, 'Function')) ||
    isSymbol(value)
  ) {
    if (foldValueImpure(value) || liftedByDeclaration(node, value))
      return undefined;
    kind = 'expression';
  } else return undefined;
  const stored =
    kind === 'expression'
      ? foldedValueInRadians(value, registry.target)
      : value;
  const undeclared = hasNoDeclaredType(node);
  const declaredType = binding.type.type;
  return {
    binding,
    value,
    stored,
    kind,
    assertCurrent: () => {
      const current = node.engine.lookupDefinition(node.symbol);
      if (
        !current ||
        !('value' in current) ||
        current.value !== binding ||
        binding.value !== value ||
        resolvedValueDefinition(node) !== binding ||
        hasNoDeclaredType(node) !== undeclared ||
        (!undeclared && binding.type.type !== declaredType) ||
        node.engine._getSymbolValue(node.symbol) !== value
      )
        throw new Error(
          'JS scalar fragment invariant: different captured binding or value'
        );
    },
  };
}

/**
 * The value that the symbol `node` reads in the frame of a call, or
 * `undefined`: the binding of `node` (a parameter or a local of a function
 * that the engine is calling while the program is compiled) holds no value,
 * the engine reads the value of the name in the frame of the call
 * (`_getSymbolValue()`), and the occurrence is not an unknown of the
 * expression, so the existing compiler writes that value in place of the
 * name, as it writes an assigned value (`tryFoldKnownSymbol()`).
 */
function frameValue(
  node: Expression & { symbol: string }
): Expression | undefined {
  const binding = resolvedValueDefinition(node);
  if (binding === undefined || binding.value !== undefined) return undefined;
  const value = node.engine._getSymbolValue(node.symbol);
  if (value === undefined || node.unknowns.length > 0) return undefined;
  return value;
}

/**
 * Record the read `node` of a captured binding on the structured route.
 * Returns false when `node` does not read a binding that the fragment
 * captures (`numericSnapshot()`, `storedSnapshot()`).
 *
 * A binding whose value is an expression (`storedSnapshot()`) is captured
 * only with `checkStored`, where the program computes it in its root
 * region (the root of an expression, of a root `Block` or of a root
 * `Function`; not the body of a helper). `checkStored` admits the stored
 * value, once per binding, where the names of the value are read (the root,
 * with no index, parameter or local of the read around it), as any
 * expression of the program: its names, its helpers and its calculus
 * nodes. A value that reads a name of the host (a `vars` entry, a function
 * of the host) is refused, and so is a list value in a compilation with a
 * function of the host: the existing compiler then writes such a value at
 * each read (`bindsFoldedValue()`).
 */
function recordCapture(
  registry: StructuredRegistry,
  node: Expression & { symbol: string },
  checkStored?: (stored: Expression) => void
): boolean {
  const snapshot = numericSnapshot(node, true);
  const stored =
    snapshot === undefined ? storedSnapshot(node, registry) : undefined;
  if (snapshot === undefined && stored === undefined) return false;
  if (stored?.kind === 'expression' && checkStored === undefined) return false;
  const binding = (snapshot ?? stored)!.binding;
  const known = registry.captures.get(binding);
  if (known !== undefined) {
    known.symbols.add(node);
    return true;
  }
  if (stored?.kind === 'expression') {
    const host = hostNameOf(stored.value, registry);
    if (host !== undefined)
      throw new Error(
        `JS scalar fragment: the value of ${node.symbol} ` +
          `(${nodeText(stored.value)}) reads ${host}, a name of the host: ` +
          `the existing compiler computes the value once per call, before ` +
          `the body`
      );
    if (
      [...(registry.hosts?.bindings.values() ?? [])].some(
        (binding) => binding.form === 'call'
      ) &&
      !isSubtype(stored.value.type.type, 'number')
    )
      throw new Error(
        `JS scalar fragment: the value of ${node.symbol} ` +
          `(${nodeText(stored.value)}) is not a number, and the options ` +
          `have a function of the host: the existing compiler writes the ` +
          `value at each read`
      );
  }
  const entry: CaptureEntry = {
    binding,
    name: node.symbol,
    symbols: new Set([node]),
    ...(snapshot !== undefined
      ? {
          stored: snapshot.value,
          value: snapshot.list ? undefined : snapshot.value.re,
        }
      : stored!.kind === 'complex'
        ? {
            stored: stored!.stored,
            value: undefined,
            complex: { re: stored!.value.re, im: stored!.value.im },
          }
        : {
            stored: stored!.stored,
            value: undefined,
            expression: true as const,
          }),
    assertCurrent: (snapshot ?? stored)!.assertCurrent,
  };
  registry.captures.set(binding, entry);
  // The value is admitted after its entry is recorded: a value that reads
  // its own name, directly or through another value, reaches the entry and
  // stops; the pass refuses it (`symbolFacts()` in `fragment.ts`).
  if (entry.expression === true) checkStored!(entry.stored);
  return true;
}

/**
 * Admit the read `node`, in the body of a helper or in a captured
 * expression that it reads (`reader` names it), of a free name with no
 * value: an input of the program. The existing compiler writes the
 * helper once per compilation, in the code of each call, and reads the
 * input in its body where the body reads it (`const _fn_g = (t) => t +
 * _.x;`), so a function of the host that changes the inputs object before
 * the read changes the value, as on the route, whose function reads the
 * input (`IRFunction.inputs`). The name is the input of the program, also
 * where the call is under a binder of the same name (a local, an index, a
 * parameter of a lambda): the body is written outside every binder of the
 * root, as the existing compiler writes it (Tycho row 507). The root admits
 * it as one of its free symbols, after its own check (`helperInputs`), so
 * the input has the type, the kind and the label of a free symbol of the
 * root.
 *
 * A name that the root reads too is one input, with one type: the type of
 * a free symbol of the root (`hasNoDeclaredType()`, the default kind of the
 * mode for a name with no declared type, also one that a scope of the
 * definition of the helper binds). Refused: a root `Function`, whose
 * parameters are its only inputs (the existing compiler declines a helper
 * that reads another name there).
 */
function admitHelperInput(
  registry: StructuredRegistry,
  node: Expression & { symbol: string },
  reader: string
): void {
  const inputs = registry.helperInputs;
  if (inputs === undefined)
    throw new Error(
      `JS scalar fragment: unsupported helper capture ${node.symbol}: ` +
        `${reader} reads ${node.symbol}, which is not a parameter of the ` +
        `helper, and the root of the program is a Function literal, ` +
        `whose parameters are its only inputs`
    );
  if (!inputs.some((s) => s.symbol === node.symbol)) inputs.push(node);
}

/**
 * Record the read `node`, in the body of the helper whose body is being
 * checked (the last of `StructuredRegistry.resolving`), of a captured
 * expression (`recordCapture()`). The existing compiler computes such a
 * value once per call, before the body (`const _val_lv = _.x + 1;`), and
 * the helper reads it (`const _fn_h = (t) => _val_lv * t;`). The route
 * computes it once, at the start of the root region (`storedRead()` in
 * `javascript-structured-lower.ts`), and passes it to the helper as a
 * parameter (`storedParameters()`): the same value at every call. A value
 * that is a name (`sv := y`) is read at each read on both compilers: the
 * helper reads that name where its body reads the alias (the check of the
 * root admits an input `y` as one that a helper reads, `admitHelperInput()`).
 */
function recordStoredRead(
  registry: StructuredRegistry,
  node: Expression & { symbol: string }
): void {
  // An alias of a captured expression (`sa := lv`) reads that expression:
  // the helper receives `lv`, and reads it where its body reads `sa`.
  const { node: end, entry } = aliasChainEnd(registry.captures, node);
  if (entry?.expression !== true || isSymbol(entry.stored)) return;
  registry.storedOnce.add(node);
  registry.storedOnce.add(end);
  addStoredCapture(
    registry,
    registry.resolving[registry.resolving.length - 1],
    end.symbol,
    end
  );
}

/**
 * The end of the chain of captured aliases that starts at the read `node`
 * (`sv := y`, `sa := lv`, `sb := sa`): the symbol of the chain that is not
 * an alias, and its captured binding, or `undefined` when no binding is
 * captured for it (an input of the program, `y`). A chain that comes back
 * to one of its names ends there.
 */
function aliasChainEnd(
  captures: ReadonlyMap<object, CaptureEntry>,
  node: Expression & { symbol: string }
): {
  readonly node: Expression & { symbol: string };
  readonly entry: CaptureEntry | undefined;
} {
  const seen = new Set<string>();
  let current = node;
  for (;;) {
    const entry = [...captures.values()].find((c) => c.symbols.has(current));
    if (
      entry === undefined ||
      entry.expression !== true ||
      !isSymbol(entry.stored) ||
      seen.has(current.symbol)
    )
      return { node: current, entry };
    seen.add(current.symbol);
    current = entry.stored;
  }
}

/** Add the captured expression `name`, read by the symbol `symbol`, to the
 *  names that the helper `helper` receives as parameters
 *  (`StructuredRegistry.storedCaptures`). A local function receives none:
 *  its captured names are the names of the block (`LocalFunction`). */
function addStoredCapture(
  registry: StructuredRegistry,
  helper: string,
  name: string,
  symbol: Expression
): void {
  if (registry.localFunctions.has(helper))
    throw new Error(
      `JS scalar fragment: the local function ${helper} reads the value of ` +
        `${name}, a captured expression, through a helper that it calls: the ` +
        `structured route passes the value to a helper, and a local function ` +
        `receives only the names of its block`
    );
  let entry = registry.storedCaptures.get(helper);
  if (entry === undefined)
    registry.storedCaptures.set(helper, (entry = { names: [], symbols: [] }));
  if (entry.names.includes(name)) return;
  entry.names.push(name);
  entry.symbols.push(symbol);
}

/**
 * The cause, for the refusal of an input of the type `type`, when `type` is
 * a union of shapes (`list<real> | real`, `integer | vector<integer^2>`):
 * the existing compiler compiles one body per member, with one test of the
 * shape at the binding (`docs/COMPILATION-MODEL.md`, R4), which the
 * structured route does not do; `''` for another type.
 */
function unionCause(type: Type): string {
  if (typeof type !== 'object' || type.kind !== 'union') return '';
  return (
    `: the input has the union type ${typeToString(type)}, which the ` +
    `profile does not dispatch on: declare one member, or compile one ` +
    `function per member`
  );
}

/**
 * The cause, for the refusal of a read of the binding of `node` that holds
 * a value and that `recordCapture()` does not capture, of the classes that
 * the structured route could otherwise hold (`storedSnapshot()`); `''` for
 * another value, whose refusal names the binding only.
 */
function heldValueCause(node: Expression & { symbol: string }): string {
  const value = resolvedValueDefinition(node)?.value;
  if (value === undefined) return '';
  const text = nodeText(value);
  if (isFunction(value, 'Function')) return `: its value ${text} is a function`;
  if (isNumber(value) && value.im === 0 && Number.isFinite(value.re))
    return (
      `: its value ${text} is a real number, and the name is declared ` +
      `${resolvedValueDefinition(node)!.type.toString()}: the existing ` +
      `compiler reads it with that type`
    );
  if (isNumber(value)) return `: its value ${text} is not finite`;
  if (liftedByDeclaration(node, value))
    return (
      `: its value ${text} is not complex-valued, and the name is ` +
      `declared ${resolvedValueDefinition(node)!.type.toString()}: the ` +
      `existing compiler lifts the value to a complex number where it ` +
      `reads the name`
    );
  if ((isFunction(value) || isSymbol(value)) && foldValueImpure(value))
    return (
      `: its value ${text} is not pure: the existing compiler computes it ` +
      `at each read`
    );
  return '';
}

/**
 * The cause of the refusal of the free name `node` that a scope around it
 * binds with no value and no type (a bare integrand `k` of
 * `\int_0^x k\,dt`, which the `Integrate` scope binds), while the engine
 * holds a value of the name: the existing compiler reads that value
 * (`_val_k`). `''` for another name.
 */
function scopedNameCause(node: Expression & { symbol: string }): string {
  if (resolvedValueDefinition(node)?.value !== undefined) return '';
  const value = node.engine._getSymbolValue(node.symbol);
  if (value === undefined || node.type.type !== 'unknown') return '';
  return (
    `: the name is read where a scope around it binds it with no value and ` +
    `the type unknown, and the existing compiler reads the value ` +
    `${nodeText(value)} of the engine there`
  );
}

/**
 * Whether the existing compiler lifts the stored value `value` of the name
 * `node` to the complex lane where it reads the name: its own test
 * (`compileSymbol()` in `compile-inner.ts`), the name complex-valued
 * (`isComplexValued()`: declared `complex`) and the value a number that is
 * not (`z := x + 1`, `z := x / y` with `x`, `y` real). It then reads `Sqrt(z)`
 * as `2i` at `x = -5`, in the `strict` mode too; the route reads the value
 * on its own lane, so such a value declines. A name declared `number` is
 * complex-valued exactly when its value is, so it is never lifted. The
 * analysis runs with its memo (`withAnalysisMemo()`): a value that shares
 * its subtrees is analyzed once per node, not once per path.
 */
function liftedByDeclaration(
  node: Expression & { symbol: string },
  value: Expression
): boolean {
  return withAnalysisMemo(
    () =>
      BaseCompiler.isComplexValued(node) &&
      !BaseCompiler.isComplexValued(value) &&
      isSubtype(value.type.type, 'number')
  );
}

/**
 * The first name of the host that the stored value `value` reads, directly
 * or through the stored value of a symbol it reads: a name that a `vars`
 * entry maps, or the head of a function of the host (`structuredHosts()`).
 * `undefined` when there is none.
 */
function hostNameOf(
  value: Expression,
  registry: StructuredRegistry
): string | undefined {
  const hosts = registry.hosts;
  if (hosts === undefined) return undefined;
  const seen = new Set<Expression>();
  const visit = (node: Expression): string | undefined => {
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (isSymbol(node)) {
      if (hosts.vars.has(node.symbol) || hosts.heads.has(node.symbol))
        return node.symbol;
      const v = node.engine._getSymbolValue(node.symbol);
      return v === undefined ? undefined : visit(v);
    }
    if (!isFunction(node)) return undefined;
    if (hosts.heads.has(node.operator)) return node.operator;
    for (const op of node.ops) {
      const found = visit(op);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(value);
}

/** The snapshot read by the symbol `node`, for the sign of an operand
 *  (`signOf()`). */
function snapshotReader(registry: StructuredRegistry): SnapshotOf {
  return (node) => {
    for (const entry of registry.captures.values())
      if (entry.symbols.has(node)) return entry.value;
    return undefined;
  };
}

/**
 * Resolve the helper that `node` calls on the structured route, once per
 * helper, and record the call. A helper that calls itself, directly or
 * through other helpers, is refused here: the structured route has no
 * recursion. A second call of a helper must reach the binding of the first.
 */
function collectStructuredHelper(
  node: Expression,
  target: CompileTarget<Expression>,
  named: NamedCalls,
  admission: Admission
): void {
  const registry = named.structured!;
  if (!isFunction(node))
    throw new Error('JS scalar fragment: expected helper call');
  const name = node.operator;
  if (registry.resolving.includes(name))
    throw new Error(
      `JS scalar fragment: the helper ${name} calls itself, directly or ` +
        'through another helper: the structured route has no recursion'
    );
  // The call of a user function that is a function operand
  // (`userFunctionOperand()`): the binding of the operand symbol is the one
  // that the call must reach.
  const operand = userFunctionOperandSymbol(node);
  // A call of a local function (`LocalFunction`): its helper was resolved at
  // its definition. A call of a name that a statement of the body defines as
  // a local function, and that does not reach that definition (a call before
  // the definition, or of a function of the same name defined elsewhere), is
  // refused.
  if (registry.localFunctionNames.has(name)) {
    const local = registry.localFunctions.get(name);
    const reached = operand ?? node;
    if (
      local === undefined ||
      !(
        local.bindings.has(
          (reached.valueDefinition ?? reached.operatorDefinition) as object
        ) ||
        (operand !== undefined &&
          userFunctionLiteralOf(operand) === local.literal)
      )
    )
      throw new Error(
        `JS scalar fragment: the call ${nodeText(node)} does not reach a ` +
          `local function ${name} defined before it in the body`
      );
    refuseListWidthArgument(node, local.literal);
    named.calls.add(node);
    registry.localCalls.add(node);
    return;
  }
  if (
    operand !== undefined &&
    userFunctionLiteralOf(operand) !== userFunctionLiteral(node.engine, name)
  )
    throw new Error(
      `JS scalar fragment: the function operand ${nodeText(operand)} does not ` +
        `reach the definition of the helper ${name}`
    );
  const known = registry.helpers.get(name);
  if (known === undefined) {
    registry.resolving.push(name);
    try {
      registry.helpers.set(name, resolveHelper(node, target, admission, named));
    } finally {
      registry.resolving.pop();
    }
  } else {
    if (helperBinding(node).binding !== known.binding)
      throw new Error(
        `JS scalar fragment: two definitions of the helper ${name}`
      );
    // `resolveHelper()` checks this at the first call.
    BaseCompiler.assertCapturedCallableBindings(
      node,
      withLocalFunctions(target, registry)
    );
  }
  // A helper with a parameter with a default value is called with every
  // argument: the engine completes the call when it boxes it.
  const helper = registry.helpers.get(name)!;
  if (
    isFunction(helper.literal) &&
    helper.literal.ops.slice(1).some((p) => isFunction(p, 'Optional')) &&
    node.nops !== helper.fragment.parameters.length
  )
    throw new Error(
      `JS scalar fragment: the call ${nodeText(node)} leaves out a parameter ` +
        `with a default value of the helper ${name}, which the structured ` +
        `route does not fill`
    );
  if (registry.mode === 'complex') refuseRangeSpecialization(node);
  refuseListWidthArgument(node);
  // The captured expressions that the helper receives as parameters
  // (`storedParameters()`): a helper that calls it receives them too, to
  // pass them on; a function operand is called with its arguments only.
  const stored = registry.storedCaptures.get(name);
  if (stored !== undefined) {
    if (operand !== undefined)
      throw new Error(
        `JS scalar fragment: the function operand ${nodeText(operand)} reads ` +
          `the value of ${stored.names.join(', ')}, a captured expression, ` +
          `which the structured route passes to the helper ${name} at a call`
      );
    const caller = registry.resolving[registry.resolving.length - 1];
    if (caller !== undefined)
      stored.names.forEach((n, i) =>
        addStoredCapture(registry, caller, n, stored.symbols[i])
      );
  }
  named.calls.add(node);
}

/**
 * Refuse the call `call` of a helper whose parameter is declared a list
 * with a stated width (`list<real^3>`, `vector<3>`), when the type of the
 * argument does not state that width (`list<real>`): the existing compiler
 * reads such a parameter by its width (`Sum(t)` is
 * `(0 + t[0] + t[1] + t[2])`, `NaN` for a list of 1 element), and the
 * structured route by the length of the array. An argument whose list type
 * states the same width is admitted; its elements are left to the rules of
 * the arguments. `local` is the literal of a local function (a call of a
 * local function has no signature).
 */
function refuseListWidthArgument(call: Expression, local?: Expression): void {
  if (!isFunction(call)) return;
  const literal = local ?? userFunctionLiteral(call.engine, call.operator);
  const signature =
    local === undefined
      ? userFunctionSignature(call.engine, call.operator)
      : undefined;
  call.ops.forEach((argument, i) => {
    const argumentType = argument.type.type;
    const parameter = isFunction(literal) ? literal.ops[i + 1] : undefined;
    const declared =
      (parameter === undefined
        ? undefined
        : functionLiteralParameterType(parameter)) ??
      signature?.args?.[i]?.type;
    if (
      declared === undefined ||
      typeof declared !== 'object' ||
      declared.kind !== 'list' ||
      declared.dimensions?.length !== 1 ||
      declared.dimensions[0] < 0 ||
      isSubtype(argumentType, declared) ||
      (typeof argumentType === 'object' &&
        argumentType.kind === 'list' &&
        argumentType.dimensions?.length === 1 &&
        argumentType.dimensions[0] === declared.dimensions[0])
    )
      return;
    const e = new Error(
      `JS scalar fragment: the argument ${nodeText(argument)} of the type ` +
        `${typeToString(argument.type.type)} of the helper ${call.operator} is ` +
        `not in the structured route: the parameter has the type ` +
        `${typeToString(declared)}, whose width the existing compiler reads`
    );
    noteRefusedNode(e, { node: call });
    throw e;
  });
}

/**
 * Refuse, in the `complex` mode, the call `call` of a helper for which the
 * existing compiler compiles a copy of the helper typed by an argument (a
 * range specialization, `rangeSpecializedParameterTypes()`): an argument
 * typed by a real range (a number literal, `real<0..>`, `|x|`) at a wider
 * parameter, when that type proves the sign of a radical of the body
 * (`Sqrt(t)` of `h(2)` is `Math.sqrt`). The structured route compiles one
 * definition, in which that radical is complex, so the value of the call
 * would be complex where the existing code makes a number. The question is
 * asked with a registry of its own: it emits nothing.
 */
function refuseRangeSpecialization(call: Expression): void {
  if (!isFunction(call)) return;
  const literal = userFunctionLiteral(call.engine, call.operator);
  if (literal === undefined) return;
  const types = rangeSpecializedParameterTypes(
    call.engine,
    call.operator,
    literal,
    call.ops.map((a) => a.type.type),
    { defs: new Map(), compiling: new Set() }
  );
  const i = types?.findIndex((t) => t !== undefined) ?? -1;
  if (i < 0) return;
  const e = new Error(
    `JS scalar fragment: the call ${nodeText(call)} of the helper ` +
      `${call.operator} is not in the structured route in the \`complex\` ` +
      `mode: the type ${typeToString(call.ops[i].type.type)} of the ` +
      `argument ${nodeText(call.ops[i])} proves the sign of a radical of its ` +
      `body, which the structured route compiles for the type of the ` +
      `parameter`
  );
  noteRefusedNode(e, { node: call });
  throw e;
}

function collectHelper(
  node: Expression,
  target: CompileTarget<Expression>,
  named: NamedCalls,
  admission: Admission
): void {
  if (named.structured)
    return collectStructuredHelper(node, target, named, admission);
  const resolved = resolveHelper(node, target, admission);
  const helper = named.helper;
  if (
    helper &&
    (helper.name !== resolved.name ||
      helper.binding !== resolved.binding ||
      helper.literal !== resolved.literal ||
      helper.body !== resolved.body)
  )
    throw new Error(
      'JS scalar fragment: only one resolved helper is supported'
    );
  named.helper ??= resolved;
  named.calls.add(node);
}

/**
 * Type the root and check the helper's return representation against its
 * signature. Check each call's argument conversions in its root or block scope.
 */
function annotateCalls(
  root: Expression,
  base: FragmentDefinition<ScalarRepresentation>,
  named: NamedCalls,
  inputs?: FragmentDeclaredInput[],
  block?: Expression
) {
  if (named.structured)
    return annotateStructured(root, base, named, named.structured, inputs);
  const { helper, calls } = named;
  const definition =
    helper === undefined
      ? base
      : {
          ...base,
          rules: { ...base.rules, Block: { walk: walkBlock } },
          storedValue: (node: Expression) => {
            const capture = helper.capture;
            if (!capture?.symbols.has(node)) return undefined;
            capture.assertCurrent();
            return capture.value;
          },
          functionOf: (call: Expression) =>
            calls.has(call) && isFunction(call)
              ? { ...helper.fragment, arguments: call.ops }
              : undefined,
        };
  const annotation = typeFragment(root, definition, { inputs });
  if (annotation.refusal)
    throw new Error(`JS scalar fragment: ${annotation.refusal.message}`);
  refuseClosedComplex(annotation.scope);
  for (const fn of annotation.functions.values()) refuseClosedComplex(fn.scope);
  if (helper) {
    const entry = annotation.functions.get(helper.name);
    if (
      !entry ||
      entry.body !== helper.body ||
      entry.type.kind !== 'function' ||
      representation(entry.type.result) !== helper.resultRepresentation
    )
      throw new Error(
        'JS scalar fragment: helper return representation differs from its signature'
      );
    const scope: FragmentScope<ScalarRepresentation> | undefined =
      block === undefined
        ? annotation.scope
        : annotation.scope.inner.get(block);
    for (const call of calls) {
      const facts = scope?.facts.get(call);
      if (
        !facts ||
        !('representation' in facts) ||
        facts.conversions?.some((conversion) => conversion.kind !== 'none')
      )
        throw new Error(
          'JS scalar fragment: helper arguments must preserve representation'
        );
    }
  }
  return annotation;
}

/**
 * `annotateCalls()` on the structured route: the rules of `modeRules()`
 * (`Sqrt`, `Ln`, `Power` and the functions) for the mode and the captured
 * values of the compilation, every helper of the registry (a call in the body
 * of a helper reaches its helper too; the pass refuses recursion), and the
 * snapshot of every captured binding, typed in place of each of its reads.
 * Each helper returns the representation of its declared result, and each
 * call, in any scope, passes its arguments with no conversion.
 */
function annotateStructured(
  root: Expression,
  base: FragmentDefinition<ScalarRepresentation>,
  named: NamedCalls,
  registry: StructuredRegistry,
  inputs?: FragmentDeclaredInput[]
) {
  const { calls } = named;
  const captureOf = (node: Expression) => {
    for (const entry of registry.captures.values())
      if (entry.symbols.has(node)) return entry;
    return undefined;
  };
  const { lengthDeclarations } = registry;
  const inputNames = new Set((inputs ?? []).map((input) => input.name));
  const binds: PassBinds = (name, scope) =>
    inputNames.has(name) || fragmentScopeBinds(scope, name);
  const definition: FragmentDefinition<ScalarRepresentation> = {
    ...base,
    // A helper body, as the body of the root function, has locals and
    // writes (`admitFunctionBody()`).
    rules: {
      ...base.rules,
      Block: { walk: walkBlock },
      Assign: { walk: walkAssign },
      // `If` and `Which` with constant conditions record the branch that
      // they select (`decidedSelectionRule()`).
      // A condition that is a list of booleans selects element-wise
      // (`selectionBroadcastRule()`).
      If: selectionBroadcastRule(
        'If',
        decidedSelectionRule(ifRule, registry.forms, binds),
        registry.forms,
        registry.mode,
        binds
      ),
      Which: selectionBroadcastRule(
        'Which',
        decidedSelectionRule(whichRule, registry.forms, binds),
        registry.forms,
        registry.mode,
        binds
      ),
      // The parameters of the root function are bound in an operand of
      // `Floor` (`inexactJumpConstant()`). A list operand of `Floor` and of
      // a head of `modeRules()` is read element-wise (`broadcastRule()`).
      Floor: broadcastRule(
        'Floor',
        withoutListOperands('Floor', floorRuleOf(inputNames)),
        registry.forms,
        registry.mode,
        inputNames,
        binds
      ),
      ...Object.fromEntries(
        Object.entries(
          modeRules(
            registry.mode,
            snapshotReader(registry),
            registry.forms,
            binds,
            inputNames,
            registry.hosts?.vars
          )
        ).map(([head, rule]) => [
          head,
          broadcastRule(
            head,
            withoutListOperands(head, rule),
            registry.forms,
            registry.mode,
            inputNames,
            binds
          ),
        ])
      ),
      // The comparisons and the connectives of lists, whose value is a list
      // of booleans (slice 2 of the broadcast note).
      ...Object.fromEntries(
        ['Less', 'LessEqual', 'Equal', 'NotEqual', 'Not', 'And', 'Or']
          .filter((head) => Object.hasOwn(base.rules, head))
          .map((head) => [
            head,
            broadcastRule(
              head,
              base.rules[head],
              registry.forms,
              registry.mode,
              inputNames,
              binds
            ),
          ])
      ),
      // `Max` and `Min` of several operands with a list among them: one
      // fold over the elements and the scalars (`listExtremumRule()`).
      Max: listExtremumRule('Max', base.rules.Max, registry.forms),
      Min: listExtremumRule('Min', base.rules.Min, registry.forms),
      // The heads with a function operand read the mode, and their list
      // operands (`functionOperandRule()`); none reads a list of lists, but
      // `Count(M)` with no predicate (`withoutNestedOperands()`).
      ...Object.fromEntries(
        Object.keys(FUNCTION_OPERAND_HEADS).map((head) => [
          head,
          // `Map` of the rows of a list of lists reads them itself
          // (`functionOperandRule()`).
          head === 'Map'
            ? functionOperandRule(registry.mode, registry.hosts)
            : withoutNestedOperands(
                head,
                functionOperandRule(registry.mode, registry.hosts)
              ),
        ])
      ),
      // `Typed` reads the mode for a `number` ascription (`typedRule()`).
      Typed: {
        walk: (node, scope, context, w) =>
          typedRule(node, scope, context, w, registry.mode),
      },
      // A function of the host takes real operands, and its result has the
      // type of its binding (`hostHeadOf()`).
      ...Object.fromEntries(
        [...(registry.hosts?.bindings.values() ?? [])]
          .filter((binding) => binding.form === 'call')
          .map((binding) => [
            binding.name,
            {
              signatures: [
                { operands: [], rest: 'real', result: binding.result },
              ],
            } satisfies FragmentRule<ScalarRepresentation>,
          ])
      ),
    },
    localType: (local) =>
      structuredLocalType(
        local,
        () =>
          local.declaration !== undefined &&
          lengthDeclarations.has(local.declaration),
        registry.mode
      ),
    storedValue: (node: Expression) => {
      const capture = captureOf(node);
      if (capture === undefined) return undefined;
      capture.assertCurrent();
      return capture.stored;
    },
    storedOutsideBinders: (node: Expression) => registry.storedOnce.has(node),
    // A node of closed exact operands that the existing compiler folds has
    // the type of its literal (`closedJumpFold()`). A node that names a
    // parameter of the root function is not folded: the existing compiler
    // binds the parameters (`lambdaTarget()`), and `tryConstantFold()`
    // refuses a node that reads a bound name, where the prepared target of
    // the route does not bind them and the fold would read an engine value
    // of the same name (`Floor(t)` with `t := 1/3`). The pass checks the
    // names that a form binds below the root (`readsBoundName()`).
    constantValue: (node: Expression) =>
      inputNames.size > 0 && node.symbols.some((name) => inputNames.has(name))
        ? undefined
        : closedJumpFold(node, registry),
    // A free symbol with no declared type has the default kind of the mode
    // (`hasNoDeclaredType()`); its inferred type is not read.
    typeOfInput: (node: Expression) => {
      if (hasNoDeclaredType(node)) return defaultKind(registry.mode);
      // A name declared `number`: the kind of `number` in the mode.
      const numberKind = declaredNumberKind(node.type.type, registry.mode);
      if (numberKind !== undefined) return { kind: numberKind.kind };
      // A tuple or a list of tuples of elements of the type `number`, which
      // are real in the `strict` mode (`structuredTupleType()`).
      const tuple = structuredTupleType(node.type.type, registry.mode);
      const list = structuredListType(node.type.type, registry.mode);
      return (
        (base.typeOfInput ?? base.typeOfSymbol)(node) ??
        tuple ??
        (list === undefined || 'refusal' in list ? undefined : list)
      );
    },
    functionOf: (call: Expression) => {
      const helper =
        isFunction(call) && calls.has(call)
          ? registry.helpers.get(call.operator)
          : undefined;
      // A local function takes the captured names after the operands.
      return helper === undefined || !isFunction(call)
        ? undefined
        : {
            ...helper.fragment,
            arguments: [...call.ops, ...(helper.captureArguments ?? [])],
          };
    },
    // The statement that defines a local function is not typed: its body is
    // typed at its calls, as the body of a helper.
    localFunction: (statement) =>
      [...registry.localFunctions.values()].some(
        (local) => local.statement === statement
      ),
  };
  // A rule that throws, not refuses, records its node for the diagnostic
  // of the profile (`noteRefusedNode()`).
  const rules: Record<string, FragmentRule<ScalarRepresentation>> = {};
  for (const [head, rule] of Object.entries(definition.rules))
    rules[head] =
      'walk' in rule
        ? {
            walk: (node, scope, context, w) =>
              atNode(node, () => rule.walk(node, scope, context, w)),
          }
        : rule;
  // A calculus node has the facts of the expression that replaces it
  // (`closedFormReplacement()`), typed in its place.
  for (const head of [...CALCULUS_HEADS, 'Apply'])
    rules[head] = closedFormRule(registry, rules[head]);
  markEmptyTupleLists(root, registry.mode);
  for (const helper of registry.helpers.values())
    markEmptyTupleLists(helper.fragment.body, registry.mode);
  const annotation = typeFragment(root, { ...definition, rules }, { inputs });
  if (annotation.refusal) {
    const { refusal } = annotation;
    const e = new Error(`JS scalar fragment: ${refusal.message}`);
    noteRefusedNode(e, {
      node: refusal.node,
      operator: refusal.operator,
      binding: refusal.binding,
    });
    throw e;
  }
  // No `refuseClosedComplex()` here: the structured route refuses constant
  // folding, and its emitter writes each node in the representation of its
  // fact, so a closed node with a complex fact is written complex.
  for (const helper of registry.helpers.values()) {
    const entry = annotation.functions.get(helper.name);
    // A local function that no statement calls is not typed, so the rules
    // of its body are not checked; the existing compiler compiles the
    // closure and declines what its body declines (`Min` of a complex
    // operand).
    if (entry === undefined && registry.localFunctions.has(helper.name))
      throw new Error(
        `JS scalar fragment: the local function ${helper.name} is not ` +
          `called: the structured route types the body of a local function ` +
          `at its calls`
      );
    if (
      !entry ||
      entry.body !== helper.body ||
      entry.type.kind !== 'function' ||
      (helper.resultRepresentation !== undefined &&
        structuredRepresentation(entry.type.result) !==
          helper.resultRepresentation)
    )
      throw new Error(
        'JS scalar fragment: helper return representation differs from its signature'
      );
    // A helper with an inferred signature returns the fact of its body,
    // which must be a value that the route holds.
    if (
      helper.resultRepresentation === undefined &&
      structuredRepresentation(entry.type.result) === undefined
    )
      throw new Error(
        `JS scalar fragment: the body of the helper ${helper.name} has the ` +
          `type ${fragmentTypeToString(entry.type.result)}, which the structured route does not hold`
      );
    checkLocalWrites(helper.body, entry.scope);
  }
  // The facts of each call, in each scope that typed it.
  const scopes: FragmentScope<ScalarRepresentation>[] = [];
  const collect = (scope: FragmentScope<ScalarRepresentation>) => {
    scopes.push(scope);
    for (const inner of scope.inner.values()) collect(inner);
  };
  collect(annotation.scope);
  for (const fn of annotation.functions.values()) collect(fn.scope);
  refuseNestedListsInMode(scopes, registry.mode);
  refuseAbsentRowUses(
    annotation.root,
    [...registry.helpers.values()].map((helper) => helper.body),
    scopes
  );
  refuseAbsentMatrixUses(
    annotation.root,
    [...registry.helpers.values()].map((helper) => helper.body),
    scopes
  );
  for (const call of calls) {
    const all = scopes.flatMap((scope) => {
      const facts = scope.facts.get(call);
      return facts === undefined ? [] : [facts];
    });
    if (
      all.length === 0 ||
      all.some(
        (facts) =>
          !('representation' in facts) ||
          facts.conversions?.some((conversion) => conversion.kind !== 'none')
      )
    )
      throw argumentRefusal(call, registry, scopes);
  }
  return annotation;
}

/**
 * Refuse, in the `complex` mode, a node of one of `scopes` whose fact is a
 * list of lists: the existing compiler reads the cells of a matrix on the
 * complex lane there (`_SYS.cplx(_SYS.complexDet(M))`, `_SYS.cmul(M, N)`),
 * and a free symbol is typed with no mode (`typeOfSymbol`). The `strict`
 * mode reads them as numbers.
 */
function refuseNestedListsInMode(
  scopes: readonly FragmentScope<ScalarRepresentation>[],
  mode: 'strict' | 'complex'
): void {
  if (mode !== 'complex') return;
  for (const scope of scopes)
    for (const [node, facts] of scope.facts)
      if ('type' in facts && isNestedListType(facts.type)) {
        const e = new Error(
          `JS scalar fragment: ${nodeText(node)} has the type ` +
            `${fragmentTypeToString(facts.type)}, a list of lists, which is not in ` +
            `the structured route in the \`complex\` mode: the existing compiler ` +
            `reads its cells on the complex lane`
        );
        noteRefusedNode(e, { node });
        throw e;
      }
}

/**
 * Refuse, on the structured route, a use of a row read of a list of lists
 * that can be absent (`At(M, i)` with fewer indexes than the rank of `M`,
 * `First(M)`, `Last(M)`, `Second(M)`, `Third(M)`, and an `If`, a `Block`
 * or a `Typed` whose value can be one), except where the existing emitter gives the value of the route
 * for an absent row. The existing emitter writes a row read as
 * `((_v) => (typeof _v === 'number' && Number.isNaN(_v)) ? undefined :
 * _v)(_SYS.at(M, i))`, `undefined` for an index out of range, as the route
 * does (`at` in `javascript-structured-emit.ts`); its other reads of an
 * absent value differ by operator, or test the shape at run time
 * (`Sum(At(M, 2))` is `((_c) => Array.isArray(_c) ? … : _c)(R)`, and a
 * `map` of it throws). Admitted: the base of an `At` (an element of an
 * absent row is `NaN` on both, `_SYS.atNumeric` of a value that is not an
 * array), the operand of `Length` (the guard of the existing emitter,
 * `NaN` for an absent row), both for a row read itself and not for an
 * `If` of row reads, an element of a list literal and the body of a
 * comprehension (the row is placed as it is, `undefined` included), a
 * branch of an `If`, the value of a `Block` and of a `Typed` (whose own use
 * is checked), the list of `ReplaceAt(R, j, x)` (an absent row throws on
 * both), the row value of `ReplaceAt(M, i, r)` (placed as it is), and the
 * value of the program. Refused: every other operand, a
 * local, an argument and the value of a helper body. A row whose index is
 * in range by the type (a literal index within `m` of a `matrix<m×n>`) is
 * also refused: slice 2 of the design note admits it.
 */
function refuseAbsentRowUses(
  root: Expression,
  helperBodies: readonly Expression[],
  scopes: readonly FragmentScope<ScalarRepresentation>[]
): void {
  const typeOf = (node: Expression) => {
    for (const scope of scopes) {
      const facts = scope.facts.get(node);
      if (facts !== undefined && 'type' in facts) return facts.type;
    }
    return undefined;
  };
  const isNested = (node: Expression) => {
    const type = typeOf(node);
    return type !== undefined && isNestedListType(type);
  };
  const memo = new Map<Expression, boolean>();
  const absent = (node: Expression): boolean => {
    if (!isFunction(node)) return false;
    const known = memo.get(node);
    if (known !== undefined) return known;
    memo.set(node, false);
    let result = false;
    switch (node.operator) {
      case 'At':
        result = isNested(node.op1) && typeOf(node)?.kind === 'list';
        break;
      // `Second` and `Third` read a row as `First` and `Last` do.
      case 'First':
      case 'Last':
      case 'Second':
      case 'Third':
        result = node.nops === 1 && isNested(node.op1);
        break;
      case 'If':
        result = node.ops.slice(1).some(absent);
        break;
      case 'Block':
        result = node.nops > 0 && absent(node.ops[node.nops - 1]);
        break;
      case 'Typed':
        result = node.nops > 0 && absent(node.op1);
        break;
    }
    memo.set(node, result);
    return result;
  };
  /** A row read itself, not an `If`, a `Block` or a `Typed` of one: the
   *  existing emitter writes its guard of `Length` and of `At` for a row
   *  read only (`Length(If(c, At(M, 1), At(M, 2)))` is `(…).length`
   *  there, which throws for an absent row). */
  const isRead = (op: Expression) =>
    isFunction(op) &&
    ['At', 'First', 'Last', 'Second', 'Third'].includes(op.operator);
  const allowed = (
    parent: Expression & { ops: readonly Expression[] },
    i: number
  ) => {
    switch (parent.operator) {
      case 'At':
        return i === 0 && isRead(parent.ops[0]);
      case 'Length':
        return isRead(parent.ops[0]);
      case 'Typed':
      case 'Comprehension':
        return i === 0;
      // The list of `ReplaceAt(R, j, x)` (an absent row throws on both),
      // and a row written as a row (`ReplaceAt(M, 1, At(M, 2))`, a swap):
      // the row is placed as it is, `undefined` included, as an element of
      // a list literal is.
      case 'ReplaceAt':
        return (
          parent.ops.length === 3 &&
          (i === 0 || (i === 2 && isNested(parent.ops[0])))
        );
      case 'List':
        return true;
      case 'If':
        return i > 0;
      case 'Block':
        return i === parent.ops.length - 1;
    }
    return false;
  };
  // The row reads placed in a list (an element of a literal, the body of a
  // comprehension, the row of a `ReplaceAt`): the list can hold `undefined`
  // for a row.
  const placed: Expression[] = [];
  const seen = new Set<Expression>();
  const visit = (node: Expression): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    node.ops.forEach((op, i) => {
      if (
        absent(op) &&
        (node.operator === 'List' ||
          (node.operator === 'Comprehension' && i === 0) ||
          (node.operator === 'ReplaceAt' && i === 2))
      )
        placed.push(op);
      if (absent(op) && !allowed(node, i)) {
        const e = new Error(
          `JS scalar fragment: the row read ${nodeText(op)}, which is undefined ` +
            `for an index out of range, is not in the structured route as an operand ` +
            `of ${node.operator}: the route reads such a row with At and Length, ` +
            `places it in a list, or gives it as the value of the program`
        );
        noteRefusedNode(e, { node: op });
        throw e;
      }
      visit(op);
    });
  };
  visit(root);
  for (const body of helperBodies) {
    if (absent(body)) {
      const e = new Error(
        `JS scalar fragment: the value of the helper body ${nodeText(body)} is a ` +
          `row read, which is undefined for an index out of range, and is not in ` +
          `the structured route as the value of a helper`
      );
      noteRefusedNode(e, { node: body });
      throw e;
    }
    visit(body);
  }
  if (placed.length > 0)
    refuseRowsOfPlacedReads(root, helperBodies, isNested, placed[0]);
}

/** The heads whose code reads each row of a list of lists: the structured
 *  lowering (`elementwise()`, `foldRows()`, `Map` over rows) reads a row
 *  with its length, and an absent row (`undefined`) gives an empty row
 *  there, where the existing emitter gives `NaN` (`_SYS.bcast`,
 *  `_SYS.mapFn`, `_SYS.add`); the runtime helper of a matrix function
 *  (`MATRIX_HEADS`, `Dot`, `Multiply` of two lists) dereferences each row
 *  (`r.slice()` in `_SYS.rref`, `row[j]` in `_SYS.transpose`, `m[i][i]` in
 *  `_SYS.trace`), so an absent row throws there, and the lowering takes the
 *  operation as one that cannot throw (`canThrow()`). */
const ROW_READING_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Negate',
  'Divide',
  'Sum',
  'Product',
  'Map',
  ...Object.keys(MATRIX_HEADS),
  'Dot',
]);

/**
 * Refuse, in a program that places a row read in a list (`[At(M, k), r]`,
 * `ReplaceAt(R, 1, At(R, k))`), every node of `ROW_READING_HEADS` with an
 * operand of a nested type. Such a list can hold `undefined` for a row, and
 * which list holds it (a local, an argument, a join) is not followed: the
 * refusal is for the whole program, the simple, sound version.
 */
function refuseRowsOfPlacedReads(
  root: Expression,
  helperBodies: readonly Expression[],
  isNested: (node: Expression) => boolean,
  read: Expression
): void {
  const seen = new Set<Expression>();
  const visit = (node: Expression): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    if (ROW_READING_HEADS.has(node.operator) && node.ops.some(isNested)) {
      const e = new Error(
        `JS scalar fragment: ${node.operator} of a list of lists is not in the ` +
          `structured route in a program that places the row read ${nodeText(read)} ` +
          `in a list: that row is undefined for an index out of range, where the ` +
          `existing compiler gives NaN for the row or its matrix helper throws`
      );
      noteRefusedNode(e, { node });
      throw e;
    }
    node.ops.forEach(visit);
  };
  visit(root);
  helperBodies.forEach(visit);
}

/** The heads of the matrix functions that read an operand that can have no
 *  value (a number in place of a list), with the positions of the matrix
 *  operands: their runtime helper gives a number, or the absent value, for
 *  it, as on the existing emitter (`ABSENT_MATRIX_READERS` in
 *  `structured-verify.ts`). */
const ABSENT_MATRIX_READERS: Readonly<Record<string, readonly number[]>> = {
  Determinant: [0],
  Trace: [0],
  Norm: [0],
  Transpose: [0],
  RowReduce: [0],
  Inverse: [0],
  MatrixPower: [0],
  MatrixMultiply: [0, 1],
  Dot: [0, 1],
  Diagonal: [0],
};

/**
 * Refuse, on the structured route, a use of a matrix function whose list
 * result can have no value (`matrixResultCanBeAbsent()`: a singular
 * `Inverse(M)`, a product whose dimensions the types do not prove to agree;
 * its value is then a number in place of the list), and of a `Block` whose
 * value is one, except as the value of the program, as an operand of a
 * matrix function of `ABSENT_MATRIX_READERS` (`Trace(Inverse(M))`), and as
 * the list of an `At` (`At(Inverse(M), i, j)`, `NaN` or `undefined` for no
 * value on both compilers). The existing emitter gives other values there,
 * or throws (`Map(r ↦ Sum(r), Inverse(M))` throws `map is not a function`;
 * `Inverse(M) + 1` is `NaN`, where an element-wise build would give the
 * empty list). Refused: every other operand, an `If` of one, a local, an
 * argument and the value of a helper body.
 */
function refuseAbsentMatrixUses(
  root: Expression,
  helperBodies: readonly Expression[],
  scopes: readonly FragmentScope<ScalarRepresentation>[]
): void {
  const typeOf = (node: Expression) => {
    for (const scope of scopes) {
      const facts = scope.facts.get(node);
      if (facts !== undefined && 'type' in facts) return facts.type;
    }
    return undefined;
  };
  const rankOf = (node: Expression): number => {
    let type: { kind: string; element?: unknown } | undefined = typeOf(node);
    let rank = 0;
    while (type?.kind === 'list') {
      rank += 1;
      type = (type as FragmentListType).element;
    }
    return rank;
  };
  const absent = (node: Expression): boolean => {
    if (!isFunction(node)) return false;
    if (node.operator === 'Block')
      return node.nops > 0 && absent(node.ops[node.nops - 1]);
    return (
      (Object.hasOwn(MATRIX_HEADS, node.operator) ||
        node.operator === 'Dot' ||
        node.operator === 'Multiply') &&
      typeOf(node)?.kind === 'list' &&
      matrixResultCanBeAbsent(node, node.ops.map(rankOf))
    );
  };
  const allowed = (
    parent: Expression & { operator: string; ops: readonly Expression[] },
    i: number
  ) =>
    (parent.operator === 'At' && i === 0) ||
    (parent.operator === 'Block' && i === parent.ops.length - 1) ||
    (Object.hasOwn(ABSENT_MATRIX_READERS, parent.operator) &&
      ABSENT_MATRIX_READERS[parent.operator].includes(i));
  const seen = new Set<Expression>();
  const visit = (node: Expression): void => {
    if (!isFunction(node) || seen.has(node)) return;
    seen.add(node);
    node.ops.forEach((op, i) => {
      if (absent(op) && !allowed(node, i)) {
        const e = new Error(
          `JS scalar fragment: the value of ${nodeText(op)} can be a number in ` +
            `place of a list (a matrix with no inverse, dimensions that the types ` +
            `do not prove to agree), and is not in the structured route as an ` +
            `operand of ${node.operator}: the route admits it as the value of the ` +
            `program, an operand of a matrix function or the list of At`
        );
        noteRefusedNode(e, { node: op });
        throw e;
      }
      visit(op);
    });
  };
  visit(root);
  for (const body of helperBodies) {
    if (absent(body)) {
      const e = new Error(
        `JS scalar fragment: the value of the helper body ${nodeText(body)} can be ` +
          `a number in place of a list, and is not in the structured route as the ` +
          `value of a helper`
      );
      noteRefusedNode(e, { node: body });
      throw e;
    }
    visit(body);
  }
}

/**
 * The refusal of the call `call` of a helper whose arguments do not keep
 * their representation (`annotateStructured()`), recorded at the call. An
 * argument converted to a parameter that took the default kind of the mode
 * is named, with its type: in the `complex` mode such a parameter is
 * complex, and a real argument would need a conversion.
 */
function argumentRefusal(
  call: Expression,
  registry: StructuredRegistry,
  scopes: readonly FragmentScope<ScalarRepresentation>[]
): Error {
  const helper = isFunction(call)
    ? registry.helpers.get(call.operator)
    : undefined;
  let message = 'helper arguments must preserve representation';
  if (helper !== undefined && isFunction(call))
    for (const scope of scopes) {
      const facts = scope.facts.get(call);
      if (facts === undefined || !('representation' in facts)) continue;
      const i = (facts.conversions ?? []).findIndex(
        (conversion, j) =>
          conversion.kind !== 'none' && (helper.defaulted[j] || helper.wide[j])
      );
      const argument = i < 0 ? undefined : scope.facts.get(call.ops[i]);
      if (argument === undefined || !('type' in argument)) continue;
      const kind = defaultKind(registry.mode).kind;
      message =
        `The argument \`${nodeText(call.ops[i])}\` of \`${helper.name}\` has ` +
        `the type \`${fragmentTypeToString(argument.type)}\`, and the parameter ` +
        `\`${helper.fragment.parameters[i]}\` ` +
        (helper.wide[i]
          ? `has the type \`${typeToString(
              (isFunction(helper.literal)
                ? functionLiteralParameterType(helper.literal.ops[i + 1])
                : undefined) ?? 'number'
            )}\`, which is `
          : `has no declared type: it is `) +
        `${kind} in the \`${registry.mode}\` mode`;
      break;
    }
  const e = new Error(`JS scalar fragment: ${message}`);
  noteRefusedNode(e, { node: call });
  return e;
}

/**
 * Refuse a function node of `scope` (and of the scopes it opens) whose fact
 * is `complex` and that reads no free symbol: no input, no parameter and no
 * local (`unknowns` lists each of them, also in the body of a function).
 * With `constantFold` on, the compiler replaces such a node with a real
 * literal when its value is real (`tryConstantFold()` in
 * `compile-folding.ts`, through `_withFoldedRealOverride()` in
 * `compiler-mode.ts`), whatever its operator. The fact of the node does not
 * come from that value: the fact of an `If` comes from its branches, and
 * the fact of a helper call from the declared result. The emitted code
 * would then be a number where the fact is complex, and a complex parent
 * would read that number as `{re, im}`. For example, with
 * `p: (boolean) -> boolean`, the `If` of `x + If(p(True), 1, Sqrt(-2))` is
 * written `1`. `Sqrt` is not refused: its fact comes from
 * `isComplexValued()`, the reader that the fold also reads. Only the
 * existing route calls this: the structured route refuses constant folding.
 */
function refuseClosedComplex(scope: FragmentScope<ScalarRepresentation>) {
  for (const [node, facts] of scope.facts)
    if (
      isFunction(node) &&
      node.operator !== 'Sqrt' &&
      'representation' in facts &&
      facts.representation === 'complex' &&
      node.unknowns.length === 0
    )
      throw new Error(
        `JS scalar fragment: a closed ${node.operator} with a complex value is not supported`
      );
  for (const inner of scope.inner.values()) refuseClosedComplex(inner);
}

/**
 * The definition that the helper call `call` reads (`readBinding()`): its
 * own value or operator definition, or, for a call whose head was free when
 * it was boxed (`isFreeCallHead()`, a call boxed before the host assigned
 * the function), the definition that its name resolves to now, as the
 * existing compiler reads it.
 */
function helperBinding(call: Expression) {
  const read = readBinding(call);
  const valueDefinition =
    read !== undefined && 'value' in read ? read.value : undefined;
  const operatorDefinition =
    read !== undefined && 'operator' in read ? read.operator : undefined;
  return {
    binding: valueDefinition ?? operatorDefinition,
    valueDefinition,
    operatorDefinition,
  };
}

/**
 * `target` with the local functions of the body of the root
 * (`StructuredRegistry.localFunctions`) as its block local functions
 * (`CompileTarget.localFunctions`), for `assertCapturedCallableBindings()`:
 * a call of a local function in an argument of a helper call
 * (`fr(lf(1))` after `lf(v) := 1`) reaches the local function, which the
 * structured route checks at the call (`collectStructuredHelper()`), and
 * not a captured binding of the engine. The existing compiler fills these
 * names while it compiles the block.
 */
function withLocalFunctions(
  target: CompileTarget<Expression>,
  registry: StructuredRegistry | undefined
): CompileTarget<Expression> {
  if (registry === undefined || registry.localFunctions.size === 0)
    return target;
  const localFunctions = new Map<string, Expression>(target.localFunctions);
  for (const [name, local] of registry.localFunctions)
    localFunctions.set(name, local.literal);
  return { ...target, localFunctions };
}

/**
 * Resolve the helper that `call` calls and check its body. On the
 * structured route (`named.structured`), the body has the admission of the
 * body of the root function (`admitFunctionBody()`): locals, writes, `If`
 * statements, loops and `Break`, or one value; it can call another helper
 * (`collectStructuredHelper()`), and each read of a captured binding is
 * recorded in the registry. The existing route admits a body of one value,
 * one captured binding per helper and no call.
 */
function resolveHelper(
  call: Expression,
  target: CompileTarget<Expression>,
  admission: Admission,
  named?: NamedCalls
): ResolvedHelper {
  const registry = named?.structured;
  if (!isFunction(call))
    throw new Error('JS scalar fragment: expected helper call');
  const { binding, valueDefinition, operatorDefinition } = helperBinding(call);
  const held =
    valueDefinition?.value ??
    (operatorDefinition as { _lambdaLiteral?: Expression } | undefined)
      ?._lambdaLiteral;
  if (!binding || !held || !isFunction(held, 'Function'))
    throw new Error(`JS scalar fragment: unsupported head ${call.operator}`);
  BaseCompiler.assertCapturedCallableBindings(
    call,
    withLocalFunctions(target, registry)
  );
  const literal = userFunctionLiteral(call.engine, call.operator);
  if (literal !== held)
    throw new Error('JS scalar fragment: helper definition identity differs');
  const signature = userFunctionSignature(call.engine, call.operator);
  // On the structured route, a helper declared with the type `function`
  // (`ce.declare('f', 'function')`, then a `Function` literal as its value)
  // has no signature: it has the rule of a helper with an inferred
  // signature. Each parameter has the type of its annotation in the
  // literal, or the default kind of the mode, and the result is the fact of
  // the body. The existing compiler writes the literal as it is
  // (`const _fn_f = (t) => 3 * t;`).
  const functionTyped =
    registry !== undefined &&
    signature === undefined &&
    valueDefinition?.type.type === 'function';
  // On the structured route, a signature that the engine inferred from the
  // definition (`f(x) := …`, `ce.assign('f', …)`) declares no type, and a
  // signature derived from a literal with an annotated parameter
  // (`_derivedSignature`) declares only the annotated parameters: when a
  // parameter has no annotation, it takes the default kind of the mode, as
  // a parameter of the root does (`defaultedParameterKind()`), and the
  // result is the fact of the body, since the engine typed the body with
  // that parameter `unknown`.
  const inferred =
    functionTyped ||
    (registry !== undefined &&
      signature !== undefined &&
      (userFunctionSignatureIsInferred(call.engine, call.operator) ||
        (operatorDefinition?._derivedSignature === true &&
          literal.ops
            .slice(1)
            .some((p) => functionLiteralParameterType(p) === undefined))));
  // The structured route also admits a list result (`structuredListType()`),
  // and a numeric result that `declaredNumberKind()` maps: a union of a real
  // type with `nan` or `signed_infinity` is a real result, and a `number`
  // result is the fact of the body, as for an inferred signature. The
  // existing compiler writes such a result in the lane of the body in each
  // mode: `(real) -> number` with the body `t + 1` returns a number in the
  // `complex` mode, `(number) -> number` with `sin(t)` a complex value.
  const numberResult =
    registry === undefined || signature === undefined || inferred
      ? undefined
      : structuredParameterType(
            signature.result,
            call.operator,
            registry.mode
          ) === undefined
        ? declaredNumberKind(signature.result, registry.mode)
        : undefined;
  const bodyResult =
    numberResult !== undefined &&
    !isSubtype(signature!.result, REAL_WITH_NON_FINITE_TYPE);
  const result =
    signature === undefined || inferred || bodyResult
      ? undefined
      : numberResult !== undefined
        ? ({ kind: 'real' } as const)
        : registry
          ? structuredParameterType(
              signature.result,
              call.operator,
              registry.mode
            )
          : scalarType(signature.result);
  // In the `complex` mode the existing compiler writes the body of such a
  // helper with each parameter read as a complex value, also an annotated
  // `real` one (`_SYS.cplx(t)`), and returns a complex value: `i · f(x)`
  // with `f(t: real) := 2t` has the real part `-0` there at `x = -0.75`,
  // and `0` on the structured route.
  if (functionTyped && registry.mode === 'complex')
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} is declared function: ` +
        `in the complex mode the existing compiler reads each of its ` +
        `parameters and its value as complex values`
    );
  if (!signature && !functionTyped)
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} has no signature of ground ` +
        'types (it has a type parameter with no bound, or a type that is ' +
        'not a function signature)'
    );
  // On the structured route, a parameter with a default value is an
  // ordinary parameter: the engine completes each call when it boxes it
  // (`f(3)` is `f(3, 2)`), and the existing compiler passes every argument
  // (`_fn_f(_.x, 2)`). A call that leaves it out declines
  // (`collectStructuredHelper()`).
  if (signature?.optArgs?.length && registry === undefined)
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} has an optional parameter`
    );
  /** The declared parameters of the signature, the optional ones last. */
  const signatureArgs = [
    ...(signature?.args ?? []),
    ...(registry === undefined ? [] : (signature?.optArgs ?? [])),
  ];
  if (signature?.variadicArg)
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} has a variadic parameter`
    );
  if (signature?.typeParams?.length)
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} has a type parameter`
    );
  // The structured route admits a helper whose signature states `random`:
  // its calls draw from the random stream (`IRCall`), in the order of the
  // program.
  const effects = signature?.effects;
  if (
    effects?.length &&
    !(
      registry !== undefined &&
      Array.isArray(effects) &&
      effects.every((label) => label === 'random')
    )
  )
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} is not pure: its signature has effects` +
        (registry !== undefined
          ? ` other than random (${Array.isArray(effects) ? effects.filter((l) => l !== 'random').join(', ') : 'any'})`
          : '')
    );
  if (!inferred && !bodyResult && !result)
    throw new Error(
      `JS scalar fragment: the declared result type of the helper ${call.operator} ` +
        `is not ${registry ? 'a number, a boolean or a list of numbers' : 'a number or a boolean'}`
    );
  const parameters: string[] = [];
  const parameterTypes: NonNullable<
    ReturnType<typeof structuredParameterType>
  >[] = [];
  const parameterSymbols: Expression[] = [];
  const parameterElementLabels: (string | undefined)[] = [];
  // The structured route also admits a list parameter
  // (`structuredListType()`), passed whole to the helper, and a numeric
  // parameter that `declaredNumberKind()` maps. A `number` parameter is
  // complex in the `complex` mode, and it is not converted at its reads: an
  // argument must then be complex (`argumentRefusal()`).
  const typeOf = (type: Type | undefined, name: string | undefined) =>
    type === undefined
      ? undefined
      : registry
        ? (structuredParameterType(type, name, registry.mode) ??
          (() => {
            const kind = declaredNumberKind(type, registry.mode);
            return kind === undefined ? undefined : { kind: kind.kind };
          })())
        : scalarType(type);
  /** For each parameter, whether it took the default kind of the mode. */
  const defaulted: boolean[] = [];
  /** For each parameter, whether it is declared `number` in the `complex`
   *  mode, where it is complex (`declaredNumberKind()`). */
  const wide: boolean[] = [];
  for (const literalParameter of literal.ops.slice(1)) {
    // A parameter with a default value, `Optional(k, d)`, is the parameter
    // `k` on the structured route (above).
    const parameter =
      registry !== undefined && isFunction(literalParameter, 'Optional')
        ? literalParameter.op1
        : literalParameter;
    const name = functionLiteralParameterName(parameter);
    const type = functionLiteralParameterType(parameter);
    // A parameter with no annotation whose type in the declared signature is
    // `unknown` (`f: (unknown) -> number`, `f := t ↦ t² + 1`) has the
    // default kind of the mode, as a parameter of a helper with an inferred
    // signature: the existing compiler writes the helper as it writes it
    // for that signature (`const _fn_f = (t) => t * t + 1;`).
    const unknownInSignature =
      registry !== undefined &&
      !inferred &&
      !functionTyped &&
      !isFunction(parameter) &&
      signatureArgs[parameters.length]?.type === 'unknown';
    const defaultType = inferred
      ? defaultedParameterKind(parameter, registry)
      : unknownInSignature
        ? defaultKind(registry.mode)
        : undefined;
    // On the structured route a parameter with no annotation of a helper
    // with a declared signature has the type of the signature, when that
    // type is a base kind (`real`, `integer`, `number`, `complex`,
    // `boolean`): the existing compiler writes the helper of such a
    // signature as it writes the helper with the annotation (`(t) =>
    // Math.sqrt(t)` for `(real) -> real`, `_SYS.csqrt(_SYS.cplx(t))` for
    // `(number) -> number` in the `complex` mode). It also reads a range of
    // the signature in the body (`Abs(t)` is `t` for `(real<0..>) -> real`,
    // `-2.5` where the argument is `-2.5`), which the route does not, so a
    // signature type with a range or a literal is refused. The nodes of the
    // body keep their own types, which the rules and the existing compiler
    // read alike. A list type keeps the refusal of the annotation rule.
    const signatureType =
      registry !== undefined &&
      !inferred &&
      !functionTyped &&
      defaultType === undefined &&
      type === undefined &&
      !isFunction(parameter)
        ? signatureArgs[parameters.length]?.type
        : undefined;
    if (
      signatureType !== undefined &&
      !['real', 'integer', 'number', 'complex', 'boolean'].includes(
        typeToString(signatureType)
      ) &&
      typeOf(signatureType, name) !== undefined &&
      typeOf(signatureType, name)?.kind !== 'list'
    )
      throw new Error(
        `JS scalar fragment: the parameter ${name} of the helper ${call.operator} has no ` +
          `type annotation, and the type ${typeToString(signatureType)} of its signature is ` +
          `not a base kind: the existing compiler reads the range of the signature in the ` +
          `body. Annotate the parameter in the function literal`
      );
    const signatureScalar =
      signatureType === undefined ? undefined : typeOf(signatureType, name);
    const fromSignature =
      signatureScalar !== undefined && signatureScalar.kind !== 'list';
    const scalar =
      defaultType ?? (fromSignature ? signatureScalar : typeOf(type, name));
    // The type of the signature is not one of the route (`collection`,
    // `broadcastable<real>`, a string): the message names it.
    if (
      scalar === undefined &&
      signatureType !== undefined &&
      signatureScalar === undefined
    )
      throw new Error(
        `JS scalar fragment: the parameter ${name} of the helper ${call.operator} has no ` +
          `type annotation, and the type ${typeToString(signatureType)} of its signature ` +
          `is not in the structured route: a parameter is a number, a boolean, a list ` +
          `of reals or of integers, or a tuple of reals`
      );
    const refusal = parameterRefusal(
      parameter,
      name,
      scalar,
      defaultType !== undefined || fromSignature,
      parameters,
      `the helper ${call.operator}`,
      true
    );
    // `parameterRefusal()` refuses a parameter with no type. The existing
    // route keeps its message.
    if (refusal !== undefined || !scalar)
      throw new Error(
        `JS scalar fragment: ${
          registry ? refusal : 'helper requires explicit scalar parameters'
        }`
      );
    // A helper declared `function`: the annotation is the declared type.
    const declared = functionTyped
      ? type
      : signatureArgs[parameters.length]?.type;
    const declaredScalar = defaultType ?? typeOf(declared, name);
    defaulted.push(defaultType !== undefined);
    const effective = fromSignature ? signatureType : type;
    wide.push(
      registry !== undefined &&
        effective !== undefined &&
        declaredNumberKind(effective, registry.mode)?.lifted === true
    );
    if (
      !declaredScalar ||
      structuredRepresentation(declaredScalar) !==
        structuredRepresentation(scalar) ||
      (declaredScalar.kind === 'list' &&
        scalar.kind === 'list' &&
        declaredScalar.element.kind !== scalar.element.kind)
    )
      throw new Error(
        'JS scalar fragment: helper parameter representation differs from signature'
      );
    parameters.push(name);
    parameterTypes.push(scalar);
    parameterSymbols.push(isFunction(parameter) ? parameter.op1 : parameter);
    parameterElementLabels.push(
      scalar.kind === 'list' ? elementLabel(type) : undefined
    );
  }
  if (
    !functionTyped &&
    (registry === undefined
      ? (signature!.args?.length ?? 0)
      : signatureArgs.length) !== parameters.length
  )
    throw new Error('JS scalar fragment: helper signature arity differs');
  // The compiled code is in radians: on the structured route the body of
  // the helper is rewritten for the angular unit of the engine, as the
  // compiled root is (`compileExpression()`) and as the existing compiler
  // rewrites each function body that it writes.
  const body = registry
    ? rewriteAngularUnit(literal.op1.canonical)
    : literal.op1.canonical;
  let capture: ScalarFragmentCapture | undefined;
  const captureSymbols = new Set<Expression>();
  /** The check of the body on the existing route. */
  const check = (node: Expression, root = false): void =>
    atNode(node, () => checkNode(node, root));
  const checkNode = (node: Expression, root: boolean): void => {
    refuseListHead(node, admission);
    refuseBooleanClaim(node, admission);
    refuseUndirectedInfinity(node, admission);
    refuseHaversineGrouping(node, admission, () => false);
    if (!node.isValid || node.type.type === 'error')
      throw new Error('JS scalar fragment: invalid helper body');
    if (isNumber(node)) return;
    if (isSymbol(node)) {
      if (
        parameters.includes(node.symbol) ||
        node.symbol === 'True' ||
        node.symbol === 'False'
      )
        return;
      const snapshot = numericSnapshot(node, false);
      if (snapshot === undefined)
        throw new Error(
          `JS scalar fragment: unsupported helper capture ${node.symbol}`
        );
      if (
        capture &&
        !capture.symbols.has(node) &&
        resolvedValueDefinition([...capture.symbols][0]) !== snapshot.binding
      )
        throw new Error(
          'JS scalar fragment: only one numeric capture is supported'
        );
      captureSymbols.add(node);
      capture ??= {
        symbols: captureSymbols,
        value: snapshot.value,
        assertCurrent: snapshot.assertCurrent,
      };
      return;
    }
    if (
      !isFunction(node) ||
      node.operator === 'Loop' ||
      !isAdmittedOperator(node, admission) ||
      !(
        node.operator === 'Add' ||
        (node.operator === 'Negate' && node.nops === 1) ||
        (node.operator === 'If' && node.nops === 3) ||
        (root && node.operator === 'Block' && node.nops === 1)
      )
    )
      throw new Error(
        `JS scalar fragment: unsupported helper body ${node.operator}`
      );
    checkCondition(node);
    for (const operand of admittedOperands(node)) check(operand);
  };
  // The structured route: the admission of a function body, the one of the
  // root function (`admitFunctionBody()`).
  if (registry !== undefined && named !== undefined)
    admitFunctionBody(body, parameters, target, admission, named, {
      name: call.operator,
      result,
      defaulted: new Set(parameters.filter((_, i) => defaulted[i])),
    });
  else check(body, true);
  const stored = registry
    ? storedParameters(registry, call.operator, parameters, body)
    : undefined;
  return {
    name: call.operator,
    literal,
    body,
    binding,
    capture,
    ...(stored === undefined ? {} : { captureArguments: stored.symbols }),
    // With an inferred signature, the representation of the fact of the
    // body (`annotateStructured()`).
    resultRepresentation:
      result === undefined
        ? undefined
        : (registry
            ? structuredRepresentation(result)
            : representation(result))!,
    declaredResult: result !== undefined,
    // A parameter of a captured expression takes the type of its argument,
    // the value where the call is.
    defaulted: [...defaulted, ...(stored?.names.map(() => false) ?? [])],
    wide: [...wide, ...(stored?.names.map(() => false) ?? [])],
    parameterElementLabels: [
      ...parameterElementLabels,
      ...(stored?.names.map(() => undefined) ?? []),
    ],
    fragment: {
      key: call.operator,
      name: call.operator,
      body,
      parameters: [...parameters, ...(stored?.names ?? [])],
      parameterTypes: [
        ...parameterTypes,
        ...(stored?.names.map(() => undefined) ?? []),
      ],
      parameterSymbols: [...parameterSymbols, ...(stored?.symbols ?? [])],
      // The interpreter applies the function to each element of a list
      // argument only when every parameter has a scalar type; otherwise a
      // list binds its parameter whole (`mapsListArguments`).
      broadcasts: userFunctionParamsAreScalar(call.engine, call.operator),
    },
  };
}

/**
 * The captured expressions that the body of the helper `helper` reads,
 * directly or through a helper that it calls
 * (`StructuredRegistry.storedCaptures`), as parameters of the helper after
 * those of its literal: the existing compiler computes each value once per
 * call, before the body, and the route computes it once at the start of the
 * root region and passes it at each call (`recordStoredRead()`). Each call
 * passes a symbol of the name (`ResolvedHelper.captureArguments`), which
 * reads the value where the call is: in the root, the captured value; in a
 * helper, its own parameter of the name. So the name must be bound by no
 * parameter or form of the body of a helper that receives it, and by no
 * form of the root (`refuseBoundStoredNames()`). `undefined` when the body
 * reads none.
 */
function storedParameters(
  registry: StructuredRegistry,
  helper: string,
  parameters: readonly string[],
  body: Expression
): { readonly names: string[]; readonly symbols: Expression[] } | undefined {
  const stored = registry.storedCaptures.get(helper);
  if (stored === undefined) return undefined;
  const bound = namesBoundIn(body);
  const name = stored.names.find((n) => parameters.includes(n) || bound.has(n));
  if (name !== undefined)
    throw new Error(
      `JS scalar fragment: the helper ${helper} reads the value of ${name}, ` +
        `a captured expression, and a parameter or a local of the helper ` +
        `has the name ${name}: the structured route passes the value to the ` +
        `helper by its name`
    );
  return stored;
}

/**
 * Refuse a program whose root binds the name of a captured expression that
 * a helper receives as a parameter (`storedParameters()`): a call under that
 * binder would pass the bound value. `boundInRoot` tells whether a form of
 * the root binds a name.
 */
function refuseBoundStoredNames(
  registry: StructuredRegistry,
  boundInRoot: (name: string) => boolean
): void {
  for (const [helper, stored] of registry.storedCaptures) {
    const name = stored.names.find(boundInRoot);
    if (name !== undefined)
      throw new Error(
        `JS scalar fragment: the helper ${helper} reads the value of ` +
          `${name}, a captured expression, and the program binds the name ` +
          `${name}: the structured route passes the value to the helper by ` +
          `its name`
      );
  }
}

/**
 * The helper of the local function `local` (`LocalFunction`) on the
 * structured route, with the rule of a helper with no declared signature
 * (`resolveHelper()`): each parameter of the literal has the type of its
 * annotation, or the default kind of the mode, and the result is the fact of
 * the body. Then one parameter for each captured name, with no declared
 * type: it takes the type of its argument, the captured name where the
 * function is called. The body has the admission of the body of a helper
 * (`admitFunctionBody()`), and is rewritten for the angular unit of the
 * engine, as the body of every helper is.
 */
function resolveLocalFunction(
  local: LocalFunction,
  target: CompileTarget<Expression>,
  admission: Admission,
  named: NamedCalls
): ResolvedHelper {
  const registry = named.structured!;
  const literal = local.literal;
  const parameters: string[] = [];
  const parameterTypes: NonNullable<
    ReturnType<typeof structuredParameterType>
  >[] = [];
  const parameterSymbols: Expression[] = [];
  const parameterElementLabels: (string | undefined)[] = [];
  const defaulted: boolean[] = [];
  const wide: boolean[] = [];
  for (const parameter of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const type = functionLiteralParameterType(parameter);
    const defaultType = defaultedParameterKind(parameter, registry);
    const numberKind =
      type === undefined || defaultType !== undefined
        ? undefined
        : declaredNumberKind(type, registry.mode);
    const scalar =
      defaultType ??
      (type === undefined
        ? undefined
        : numberKind !== undefined
          ? { kind: numberKind.kind }
          : structuredParameterType(type, name, registry.mode));
    const refusal = parameterRefusal(
      parameter,
      name,
      scalar,
      defaultType !== undefined,
      parameters,
      `the local function ${local.name}`
    );
    if (refusal !== undefined || !scalar)
      throw new Error(`JS scalar fragment: ${refusal}`);
    parameters.push(name);
    parameterTypes.push(scalar);
    parameterSymbols.push(isFunction(parameter) ? parameter.op1 : parameter);
    parameterElementLabels.push(
      scalar.kind === 'list' ? elementLabel(type) : undefined
    );
    defaulted.push(defaultType !== undefined);
    wide.push(numberKind?.lifted === true);
  }
  // The literal is a node of the root, which the preparation rewrote for
  // the angular unit: a second rewrite would scale `sin(t)` twice.
  const body = literal.ops[0].canonical;
  admitFunctionBody(
    body,
    [...parameters, ...local.captures],
    target,
    admission,
    named,
    {
      name: local.name,
      result: undefined,
      defaulted: new Set(parameters.filter((_, i) => defaulted[i])),
    }
  );
  const captured = local.captures.map(() => false);
  return {
    name: local.name,
    literal,
    body,
    binding: local.binding,
    resultRepresentation: undefined,
    declaredResult: false,
    defaulted: [...defaulted, ...captured],
    wide: [...wide, ...captured],
    parameterElementLabels: [
      ...parameterElementLabels,
      ...local.captures.map(() => undefined),
    ],
    captureArguments: local.captureArguments,
    fragment: {
      key: local.name,
      name: local.name,
      body,
      parameters: [...parameters, ...local.captures],
      parameterTypes: [
        ...parameterTypes,
        ...local.captures.map(() => undefined),
      ],
      parameterSymbols: [...parameterSymbols, ...local.captureArguments],
      broadcasts: paramsAreScalar(literal.type.type),
    },
  };
}
