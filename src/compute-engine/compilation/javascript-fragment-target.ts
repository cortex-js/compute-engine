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
  indexElementType,
  isNonRealNumber,
} from '../../common/type/utils.js';
import {
  assumedRealNonNegative,
  fixedLogBase,
  withoutNaNMember,
} from './compile-real-analysis.js';
import {
  negativeBaseRealPow,
  principalComplexPow,
} from './constant-folding.js';
import { asRational } from '../boxed-expression/numerics.js';
import { realPowerBranchTerms } from '../numerics/real-power.js';
import { NON_NEGATIVE_REAL_TYPE } from './compiler-naming.js';
import {
  JavaScriptTarget,
  isNonFiniteBound,
  type JavaScriptBodyEmitter,
} from './javascript-target.js';
import { BaseCompiler } from './base-compiler.js';
import { exactRationalDivisor } from './compiler-type-facts.js';
import { SHIFT_JUMP_HEADS } from './compile-folding.js';
import { exactDoubleValue } from '../numeric-value/exact-integer-value.js';
import {
  hasUnknownsWithMemo,
  type ReferencesMemo,
} from '../boxed-expression/abstract-boxed-expression.js';
import { CompilerState } from './compiler-state.js';
import { realOnlyLoweringOf } from './compiler-core.js';
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
  userFunctionSignature,
} from './compile-assignment-checks.js';
import { userFunctionSignatureIsInferred } from './compile-callbacks.js';
import { rangeSpecializedParameterTypes } from './compile-user-specialization.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { isLibraryOperator, systemScopeBinding } from './builtin-callback.js';
import { isOpaqueVarsSource, varsObjectSpelling } from './cse.js';
import { entryIsPure, inferSourcePurity } from './function-purity.js';
import {
  typeFragment,
  walkIf,
  walkBlock,
  walkAssign,
  walkBreak,
  walkCountedLoop,
  walkAggregate,
  fragmentTypeToString,
  hasShortText,
  nodeText,
  type FragmentConversion,
  type FragmentDeclaredInput,
  type FragmentListType,
  type FragmentValueFacts,
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
import type { EffectFact, IRHostBinding, IRState } from './structured-ir.js';
import { verifyJavaScriptProgram } from './javascript-structured-policy.js';
import {
  literalSeedOf,
  lowerStructuredProgram,
  piMultipleFactor,
  powerForm,
  preparedNodesOf,
  randomDomainOf,
  recordStructuredPreparation,
  STRUCTURED_OPERATION_LIMIT,
  StructuredLimitError,
  structuredPreparationOf,
  type StructuredCapture,
  type StructuredInput,
  type StructuredForm,
  type StructuredPreparation,
} from './javascript-structured-lower.js';
import { emitStructuredProgram } from './javascript-structured-emit.js';
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
 * The refusal of a node of a head of `JUMP_FUNCTIONS` (`jump-functions.ts`)
 * that the structured route admits (`Less`, `LessEqual`, `Equal`, `Mod`,
 * `Floor`) and that reads no input, parameter or local
 * (`unknowns` is empty: every symbol it reads is `True`, `False`, a
 * constant or a captured binding), or `undefined`. The existing compiler
 * folds such a node with the exact value of its operands, also with
 * `constantFold: false` (`closedExactJump()` in `compile-folding.ts`): with
 * the captures `N = 1/3` and `M = 3333333333333333/10^16`, `Less(M, N)` is
 * `true`, and the comparison of their doubles is `false`. The refusal is
 * wider than that rule, which keeps the code of a node with a float literal
 * or of integer literals only. A node that is not pure (`Less(Random(),
 * 1/2)`) is not refused: the fold evaluates only a pure node
 * (`constantFoldValue()`), so the existing compiler writes its code.
 */
function closedJumpRefusal(
  operator: string,
  node: Expression
): string | undefined {
  return node.unknowns.length === 0 && node.isPure
    ? `${operator} reads no input, parameter or local: the existing compiler ` +
        `folds it with the exact value of its operands (closedExactJump())`
    : undefined;
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
  const closed = (node: Expression): boolean => {
    if (isNumber(node)) return true;
    if (isSymbol(node))
      return (
        !bound(node.symbol) &&
        (node.isConstant ||
          node.engine._getSymbolValue(node.symbol) !== undefined)
      );
    if (isFunction(node)) return node.ops.every(closed);
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
 * `Less`, `LessEqual`, `Equal` and `NotEqual`: two real operands, a boolean
 * result. The
 * canonical form writes `GreaterEqual(a, b)` as `LessEqual(b, a)`. A
 * comparison that reads no input, parameter or local is refused
 * (`closedJumpRefusal()`): the existing compiler writes its exact value as
 * a literal also with `constantFold: false`. A comparison of three operands or more is a conjunction of pairs
 * that the existing emitter writes with temporaries. `Equal` is the exact
 * comparison `===` of two numbers, and `NotEqual` its negation `!==`, which
 * is true for a `NaN` operand, as the interpreter answers (the existing
 * emitter, `compileJSEquality()`); a complex operand needs a comparison per
 * component, which the structured route does not have.
 */
function comparisonRule(
  operator: 'Less' | 'LessEqual' | 'Equal' | 'NotEqual'
) {
  return {
    walk: (node, scope, context, w) => {
      const nops = isFunction(node) ? node.nops : 0;
      if (nops !== 2)
        return w.refuse(
          node,
          'signature',
          `${operator} with ${nops} operands is not in the structured route, which admits two`
        );
      const closed = closedJumpRefusal(operator, node);
      if (closed !== undefined) return w.refuse(node, 'signature', closed);
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
        { operands: ['real', 'real'], result: 'boolean' },
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
 *   `_SYS.floorMod` throws.
 *
 * A `Mod` that reads no input, parameter or local is refused too
 * (`closedJumpRefusal()`).
 */
const modFacts = realOperatorFacts('Mod', 2, integerWhenAll);
const modRule = {
  walk: (node, scope, context, w) => {
    if (isFunction(node) && node.nops === 2) {
      const [a, b] = node.ops;
      const closed = closedJumpRefusal('Mod', node);
      if (closed !== undefined) return w.refuse(node, 'signature', closed);
      if (isNumber(b) && b.im === 0 && b.re === 1)
        return w.refuse(
          node,
          'signature',
          'Mod with the literal divisor 1 is not in the structured route: the ' +
            'existing emitter writes % or the fractional part for it'
        );
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
} satisfies FragmentRule<ScalarRepresentation>;

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
const floorRule = {
  walk: (node, scope, context, w) => {
    const closed = closedJumpRefusal('Floor', node);
    if (closed !== undefined) return w.refuse(node, 'signature', closed);
    const constant = isFunction(node)
      ? inexactJumpConstant(node.ops)
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
} satisfies FragmentRule<ScalarRepresentation>;

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
 * A node object reached on several paths (a DAG) is visited once: the
 * verdict of a function node does not depend on its parent, and is
 * remembered, and the question whether a node has unknowns keeps one memo
 * for the call (`hasUnknownsWithMemo()`).
 */
function inexactJumpConstant(
  operands: readonly Expression[]
): Expression | undefined {
  const unknowns: ReferencesMemo = new Map();
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
    if (
      !hasUnknownsWithMemo(node, unknowns) &&
      (!isFunction(node) || node.isPure)
    ) {
      if (isNumber(node))
        return exact(node) || divisionFactor(node, parent) ? undefined : node;
      // `True` and `False` are not numbers: the rule of `Floor` refuses a
      // boolean operand.
      if (isSymbol(node, 'True') || isSymbol(node, 'False')) return undefined;
      if (isSymbol(node) && safeInteger(resolvedValueDefinition(node)?.value))
        return undefined;
      return node;
    }
    if (!isFunction(node) || SHIFT_JUMP_HEADS.has(node.operator))
      return undefined;
    if (verdicts.has(node)) return verdicts.get(node);
    let found: Expression | undefined;
    for (const op of node.ops) {
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
 * the form (no step, no guard, the statements of the body).
 */
const loopRule = {
  walk: (node, scope, context, w) => {
    const spec = isFunction(node) && node.nops === 2 ? node.op2 : undefined;
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
 */
function signOf(
  node: Expression,
  snapshotOf: SnapshotOf,
  deep: boolean,
  head = 'Sqrt'
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
      node.ops.map((op) => signOf(op, snapshotOf, deep, head));
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
 * of `JUMP_FUNCTIONS`, refused when it reads no input, parameter or local
 * (`closedJumpRefusal()`); `rounding`: a head of `SHIFT_JUMP_HEADS`,
 * refused for an operand with an exact constant that no double holds
 * (`inexactJumpConstant()`).
 */
const SCALAR_FUNCTION_HEADS: Readonly<
  Record<
    string,
    {
      readonly lane: ScalarFunctionLane;
      readonly complex: ComplexOperands;
      readonly jump?: 'jump' | 'rounding';
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
  forms: Map<Expression, StructuredForm>
) {
  const { lane, complex, jump } = SCALAR_FUNCTION_HEADS[head];
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 1)
        return w.refuse(
          node,
          'signature',
          `${head} with other than one operand is not in the structured route`
        );
      if (jump !== undefined) {
        const closed = closedJumpRefusal(head, node);
        if (closed !== undefined) return w.refuse(node, 'signature', closed);
      }
      if (jump === 'rounding') {
        const constant = inexactJumpConstant(node.ops);
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
 * `Sin`, `Cos`, `Tanh`, `Abs` (one operand) and `Arctan2` (two operands) on
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
 *   `Arctan2` with a complex operand is declined.
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
  head: 'Sin' | 'Cos' | 'Tanh' | 'Abs' | 'Arctan2',
  mode: 'strict' | 'complex',
  forms: Map<Expression, StructuredForm>
) {
  const arity = head === 'Arctan2' ? 2 : 1;
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
          head === 'Arctan2'
            ? 'Arctan2 with a complex operand is not in the structured route'
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
              : node.op2.unknowns.length === 0
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
        const refusal =
          base.type.kind === 'complex' || exponent.type.kind === 'complex'
            ? `Power with a complex operand and an exponent that is not a ` +
              `number literal is not in the structured route`
            : isSymbol(node.op1, 'ExponentialE')
              ? `Power of a symbol ExponentialE that a scope declares is not ` +
                `in the structured route`
              : node.op2.unknowns.length === 0
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
          : !literal && node.op2.unknowns.length === 0
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
    Log: structuredLogRule(mode, snapshotOf, forms),
    WithRandomSeed: seededRule(mode),
    ...Object.fromEntries(
      Object.keys(SCALAR_FUNCTION_HEADS).map((head) => [
        head,
        structuredScalarFunctionRule(head, mode, forms),
      ])
    ),
  };
}

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
  Log: withoutMode('Log'),
  ...Object.fromEntries(
    Object.keys(SCALAR_FUNCTION_HEADS).map((head) => [head, withoutMode(head)])
  ),
  Add: withRealFromRealOperands(withListLengthIntegers(structuredAddRule)),
  Negate: withRealFromRealOperands(withListLengthIntegers(negateRule)),
  // The rule of the pass: the value of an `If` can be a list. An `If` with
  // no else branch used as a value is a `Which` of one clause.
  If: {
    walk: (node, scope, context, w) =>
      isFunction(node) && node.nops === 2 && context.place !== 'statement'
        ? selectionRule(node, scope, context, w)
        : walkIf(node, scope, context, w),
  },
  Which: {
    walk: (node, scope, context, w) => selectionRule(node, scope, context, w),
  },
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
  Mod: modRule,
  Floor: floorRule,
  Divide: divideRule,
  Power: withoutMode('Power'),
  Root: withoutMode('Root'),
  Loop: loopRule,
  // A `Break` with no value in a counted loop; its place in the loop is the
  // rule of the admission (`checkStructuredStatement()`).
  Break: { walk: walkBreak },
  And: logicalRule('And'),
  Or: logicalRule('Or'),
  Min: withRealFromRealOperands(extremumRule('Min')),
  Max: withRealFromRealOperands(extremumRule('Max')),
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
  Random: {
    walk: (node, scope, context, w) => randomRule.walk(node, scope, context, w),
  },
  WithRandomSeed: withoutMode('WithRandomSeed'),
};

/** The heads whose rule reads a list operand itself; every other rule of
 *  the structured route refuses one (`withoutListOperands()`). */
const LIST_OPERAND_HEADS = [
  'If',
  'Loop',
  'At',
  'Length',
  'Comprehension',
  'ReplaceAt',
  'Typed',
  // The rule of an aggregate reads its index sets (`Limits`), which are not
  // values, and refuses a body that is a list.
  'Sum',
  'Product',
];

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
  | { kind: 'integer' | 'real' | 'complex' | 'boolean' }
  | FragmentListType;

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
    case 'list<real>':
      return { kind: 'list', element: { kind: 'real' } };
    case 'list<integer>':
      return { kind: 'list', element: { kind: 'integer' } };
  }
  return undefined;
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
      integerFromListLength(operand, isIntegerName, isIntegerCall, isIntegerOperand)
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
 * of a subtype of `real` (`list<finite_real>`).
 *
 * A refusal, with its message, for every other list type: a list of lists
 * or a matrix, a list of complex numbers (its elements are `{re, im}`
 * objects, and the structured route has no list of them), a list of
 * booleans (the existing emitter reads it with `_SYS.at`) and `vector` (a
 * list of `number`, whose elements can be complex). The result is
 * `undefined` for a type that is not a list type: a tuple (the existing
 * emitter reads it with `_SYS.at`), `indexed_collection<real>` (a supertype
 * of a tuple) and a string keep the message of a binding that the route
 * has no type for.
 */
function structuredListType(
  type: Type
): FragmentListType | { refusal: string } | undefined {
  if (isSubtype(type, 'list<integer>'))
    return { kind: 'list', element: { kind: 'integer' } };
  if (isSubtype(type, 'list<real>'))
    return { kind: 'list', element: { kind: 'real' } };
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

/** Whether `type` is a list type of the structured route. */
function isAdmittedList(type: Type): boolean {
  const list = structuredListType(type);
  return list !== undefined && !('refusal' in list);
}

/** The fragment type of a parameter of the declared engine type `type` on
 *  the structured route: a scalar type, or a list type
 *  (`structuredListType()`). Throws for another collection type. */
function structuredParameterType(type: Type, name: string | undefined) {
  const scalar = scalarType(type);
  if (scalar !== undefined) return scalar;
  const list = structuredListType(type);
  if (list !== undefined && 'refusal' in list)
    throw new Error(
      `JS scalar fragment: the parameter ${name ?? ''} has ${list.refusal}`
    );
  return list;
}

/** How the structured route holds a value of the type `type`: the
 *  representation of a scalar, and `array` for a list of reals or of
 *  integers. */
function structuredRepresentation(type: {
  readonly kind: string;
  readonly element?: { readonly kind: string };
}): ScalarRepresentation | undefined {
  if (type.kind !== 'list') return representation(type);
  const element = type.element?.kind;
  return element === 'real' || element === 'integer' ? 'array' : undefined;
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
  | 'listLocals'
> = {
  typeOfSymbol(node) {
    const scalar = definition.typeOfSymbol(node);
    if (scalar !== undefined) return scalar;
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
  representationOfValue: structuredRepresentation,
  // A bound computed from the length of a list with integer arithmetic,
  // whose fact is an integer (`integerFromListLength()`, with the names of
  // integer facts): the rule that `checkLoop` reads at the admission.
  loopBoundFromFact: (bound, isInteger) =>
    isInteger(bound) && integerFromListLength(bound, isInteger),
  // A list of integers and a list of reals are one JavaScript array of
  // numbers: the existing route passes the array to the helper, and the
  // interpreter reads the integers as reals.
  passesListArgument: (argument, parameter) =>
    argument.element.kind === 'integer' && parameter.element.kind === 'real',
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
 * Refused: an index with a real fact (the existing emitter reads a
 * fraction as out of range, which the structured route does not copy: it
 * reads an integer index only; round it with `Floor`), a base that is not
 * a list input or parameter. The admission refuses, before this rule, more
 * than one index, a `Range` index (a slice) and a string index
 * (`structuredListRefusal()`).
 */
function atRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node) || node.nops !== 2)
    return w.refuse(
      node,
      'signature',
      'At with other than one index is not in the structured route'
    );
  const [base, index] = operandFacts(node, scope, context, w);
  if (base.type.kind !== 'list' || base.representation !== 'array')
    return w.refuse(
      node,
      'signature',
      `At in the structured route reads a list input or a list parameter of ` +
        `reals or integers, and its first operand has the type ` +
        `\`${fragmentTypeToString(base.type)}\``
    );
  if (index.type.kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      `At with an index of the type \`${fragmentTypeToString(index.type)}\` is ` +
        `not in the structured route, which reads an index of the type integer`
    );
  const element = base.type.element.kind === 'integer' ? 'integer' : 'real';
  return w.valueFacts(node, { kind: element }, [
    w.convert(base, base.type)!,
    w.convert(index, index.type)!,
  ]);
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
  if (base.type.kind !== 'list' || base.representation !== 'array')
    return w.refuse(
      node,
      'signature',
      `Length in the structured route reads a list input or a list parameter ` +
        `of reals or integers, and its operand has the type ` +
        `\`${fragmentTypeToString(base.type)}\``
    );
  return w.valueFacts(node, { kind: 'integer' }, [w.convert(base, base.type)!]);
}

/**
 * The parts of `Comprehension(body, Element(j, Range(a, b)))`, or
 * `undefined` for another form. `Element` and `Range` are the operators of
 * the library.
 */
function comprehensionParts(
  node: Expression
):
  | { body: Expression; index: string; from: Expression; to: Expression }
  | undefined {
  if (!isFunction(node, 'Comprehension') || node.nops !== 2) return undefined;
  const spec = node.op2;
  if (
    !isFunction(spec, 'Element') ||
    !isLibraryOperator(spec, 'Element') ||
    spec.nops !== 2 ||
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
  };
}

/**
 * The message of the refusal of a `Comprehension` that is not of the form
 * of the structured route (`comprehensionParts()`), or `undefined`.
 */
function comprehensionRefusal(node: Expression): string | undefined {
  if (
    !isFunction(node, 'Comprehension') ||
    comprehensionParts(node) !== undefined
  )
    return undefined;
  if (node.nops !== 2)
    return 'Comprehension with other than one generator is not in the structured route, which admits Comprehension(body, Element(j, Range(a, b)))';
  const spec = node.op2;
  if (isFunction(spec, 'Element') && spec.nops === 3)
    return 'Comprehension with a guard is not in the structured route, which admits Comprehension(body, Element(j, Range(a, b)))';
  return (
    `Comprehension over ${nodeText(spec)} is not in the structured route, ` +
    `which admits a comprehension over Element(j, Range(a, b)) only, and not over a list`
  );
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
 * emitter makes it. Refused: a bound with a real fact, a body that is a
 * list (a list of lists), a complex or a boolean body. The admission
 * refuses another form before this rule (`comprehensionRefusal()`).
 */
function comprehensionRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const parts = comprehensionParts(node);
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
  const body = w.value(parts.body, inner, { ...context, loop: undefined });
  const kind = body.type.kind;
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
  if (node.nops < 2)
    return (
      `${head} of a collection (with no index set) is not in the structured ` +
      `route, which admits ${head}(body, Limits(k, a, b))`
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
  const impure = (e: Expression): boolean =>
    isFunction(e) && (effectFact(e) !== 'pure' || e.ops.some(impure));
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
  const refusal = aggregateRefusal(node);
  if (refusal !== undefined) return w.refuse(node, 'signature', refusal);
  const facts = walkAggregate(node, scope, context, w);
  if (!('representation' in facts)) return facts;
  const kind = facts.type.kind;
  if (kind !== 'real' && kind !== 'integer')
    return w.refuse(
      node,
      'signature',
      `${node.operator} whose body has the type \`${fragmentTypeToString(facts.type)}\` ` +
        `is not in the structured route, which adds or multiplies reals or integers`
    );
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
 *
 * Each head is the operator of the library: a user function of one of
 * these names is a helper call.
 */
function structuredValueParts(
  node: Expression,
  bodyValue: boolean
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
      inner: [parts.body],
    };
  return undefined;
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
 */
function replaceAtRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  if (!isFunction(node) || node.nops !== 3)
    return w.refuse(
      node,
      'signature',
      'ReplaceAt with other than a list, one index and a value is not in the structured route'
    );
  const [list, index, value] = operandFacts(node, scope, context, w);
  if (list.type.kind !== 'list' || list.representation !== 'array')
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
      : (scalarType(ascribed) ?? structuredListType(ascribed));
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
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const list = admittedOperands(node).find(
        (operand) => w.value(operand, scope, context).type.kind === 'list'
      );
      if (list !== undefined)
        return w.refuse(
          node,
          'signature',
          `${operator} with the list operand ${nodeText(list)} is not in the ` +
            `structured route, which reads a list only with At and Length and ` +
            `passes it whole to a helper`
        );
      return 'walk' in rule
        ? rule.walk(node, scope, context, w)
        : w.signatures(node, scope, context, rule.signatures);
    },
  };
}

/** The heads that make or read a list in a way that the structured route
 *  does not have, with the message of each refusal. */
const LIST_HEAD_REFUSALS: ReadonlyMap<string, string> = new Map([
  [
    'First',
    'First is not in the structured route, which reads a list with At and Length',
  ],
  [
    'Last',
    'Last is not in the structured route, which reads a list with At and Length',
  ],
  ['Rest', 'Rest makes a list, which the structured route does not have'],
  ['List', 'a list literal is not in the structured route'],
  ['Tuple', 'a tuple is not in the structured route'],
]);

/**
 * The message of the refusal of `node` on the structured route, for a
 * library head of `LIST_HEAD_REFUSALS`, for a `Comprehension` that is not
 * over one `Element(j, Range(a, b))` (`comprehensionRefusal()`), and for
 * an `At` with other than one index, a `Range` index (a slice) or a string
 * index; otherwise
 * `undefined`. The admission checks this before it reads the operands, so
 * that the message names the list operation, and not an operand that the
 * route does not have (`Range`, `Element`, a string).
 */
function structuredListRefusal(node: Expression): string | undefined {
  if (!isFunction(node) || !isLibraryOperator(node, node.operator))
    return undefined;
  const message =
    LIST_HEAD_REFUSALS.get(node.operator) ?? comprehensionRefusal(node);
  if (message !== undefined) return message;
  if (node.operator !== 'At') return undefined;
  if (node.nops !== 2)
    return `At with ${node.nops - 1} indexes is not in the structured route, which reads one index`;
  if (isFunction(node.op2, 'Range'))
    return 'At with a Range index (a slice) is not in the structured route, which reads one integer index';
  if (isString(node.op2))
    return 'At with a string index is not in the structured route, which reads one integer index';
  return undefined;
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
 * - the value of a local (`refuseHaversineLocal()`).
 */
function refuseHaversineGrouping(
  node: Expression,
  admission: Admission,
  input: (operand: Expression) => boolean
): void {
  if (!admission.structured || !isFunction(node)) return;
  /** A haversine that the existing emitter writes with no parentheses. */
  const bare = (op: Expression): boolean =>
    isFunction(op, 'Haversine') && op.nops === 1 && !input(op.op1);
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
    if (
      bare(term) ||
      (isSymbol(term.op1) && indexes.includes(term.op1.symbol))
    )
      grouped.push(term);
  }
  const first = grouped[0];
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
      isFunction(op, 'Divide') && op.nops === 2
        ? numerator(op.op1)
        : undefined;
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
 * also asks whether the node is complex-valued (`isComplexValued()`).
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
  for (const [name, rule] of Object.entries(rules))
    if (!LIST_OPERAND_HEADS.includes(name))
      rules[name] = withoutListOperands(name, rule);
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
  const readsRoot = (node: Expression): boolean =>
    mutates &&
    isSymbol(node) &&
    annotation.scope.bindings.has(node.symbol);
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
  const isDraw = (node: Expression): boolean =>
    readers.isDraw(node) ||
    isHost(node) ||
    (isFunction(node) &&
      helpers.has(node.operator) &&
      hasHost(helpers.get(node.operator)!.body));
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
 * `imports` and `preamble` are admitted (`structuredHosts()`), and
 * `broadcast` is ignored: the route makes no batch body, so `broadcast()`
 * runs the ordinary body for each cell, as with `broadcast: false`.
 */
function profileOptionDecline(
  options: CompilationOptions<Expression>
): CompileDeclineError | undefined {
  const option =
    typeof options.operators === 'function'
      ? 'the function form of the option `operators`'
      : options.mode === 'bigint'
        ? "the option `mode: 'bigint'`"
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
  refuseHoistedDraws(prepared.annotation, registry.helpers, hosts);
  refusePureHostInAggregates(prepared.annotation, registry.helpers, hosts);
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
    if (this.route !== 'structured' || !onPhase)
      return super.compile(expr, options);
    this.phaseSum = 0;
    const start = globalThis.performance.now();
    const result = super.compile(expr, options);
    onPhase('assembly', globalThis.performance.now() - start - this.phaseSum);
    return result;
  }

  /**
   * On the structured route, the emitter of the body: lower the program of
   * the preparation recorded on `target`, verify it and emit it.
   */
  protected bodyEmitter(
    target: CompileTarget<Expression>
  ): JavaScriptBodyEmitter | undefined {
    if (this.route !== 'structured') return undefined;
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
              const text = sources?.hosts.get(`${binding.form}:${binding.name}`);
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
    return structuredPreparationOf(
      this.prepareCompilation(expr, options).target
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
      if (typeof x !== 'function') throw new Error(`Unsupported import \`${x}\``);
    try {
      return this.prepareFragment(expr, options, batch);
    } catch (e) {
      throw profileDecline(e);
    }
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
    const definition = admission.definition;
    const prepared = super.prepareCompilation(expr, options);
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
        attachBoundFunction(
          prepared.expr,
          prepared.target,
          admission,
          registry
        )
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
    const checkNode = (node: Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);
      refuseListHead(node, admission);
      refuseBooleanClaim(node, admission);
      refuseUndirectedInfinity(node, admission);
      refuseHaversineGrouping(
        node,
        admission,
        (op) =>
          isSymbol(op) &&
          !indexes.has(op.symbol) &&
          resolvedValueDefinition(op)?.value === undefined
      );
      refuseWideRead(node, admission, registry?.mode);
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
      const parts = structured ? structuredValueParts(node, false) : undefined;
      if (parts !== undefined) {
        for (const operand of parts.outer) check(operand);
        const added: string[] = [];
        try {
          for (const { index, bounds } of parts.indexes ?? []) {
            for (const bound of bounds)
              checkAggregateBound(node, bound, registry, check);
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
        // The structured route reads a captured binding as its snapshot.
        if (
          registry &&
          mapped === undefined &&
          resolvedValueDefinition(node)?.value !== undefined &&
          recordCapture(registry, node)
        )
          return;
        if (resolvedValueDefinition(node)?.value !== undefined)
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}`
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
          ? structuredListType(node.type.type)
          : undefined;
        if (list !== undefined && 'refusal' in list)
          throw new Error(
            `JS scalar fragment: the input ${node.symbol} has ${list.refusal}`
          );
        if (definition.typeOfSymbol(node) === undefined)
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}`
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
    check(prepared.expr);
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
  if (!isSubtype(type, 'boolean'))
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
      `the structured route: a parameter is a number, a boolean, or a list ` +
      `of reals or of integers`
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
  for (const parameter of fn.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    // A refusal of a parameter names the parameter.
    try {
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
        structuredParameterType(declared, name) !== undefined
          ? undefined
          : declaredNumberKind(declared, registry.mode);
      const type = undeclared
        ? defaultType
        : declared === undefined
          ? undefined
          : numberKind !== undefined
            ? { kind: numberKind.kind }
            : admission.structured
              ? structuredParameterType(declared, name)
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
  const body = fn.op1.canonical;
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
            lifted.has(input.name)
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
  const collect = (node: Expression): void => {
    if (isSymbol(node)) {
      const name = node.symbol;
      if (
        name === 'True' ||
        name === 'False' ||
        bound.has(name) ||
        indexes.has(name) ||
        // A name that a `vars` entry maps is a free symbol, also with a
        // value: `varsEntryOf()` refuses that value.
        (resolvedValueDefinition(node)?.value !== undefined &&
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
      parts = structuredValueParts(node, false);
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
  admitFunctionBody(
    body,
    free.map((s) => s.symbol),
    target,
    admission,
    named,
    undefined,
    expression
  );
  /** The declared type of each free symbol, for the label of a list
   *  input (`elementLabel()`). */
  const symbolTypes = new Map<string, Type>();
  /** The free symbols with no declared type (`hasNoDeclaredType()`). */
  const defaulted = new Set<string>();
  /** The free symbols declared `number` in the `complex` mode
   *  (`declaredNumberKind()`). */
  const lifted = new Set<string>();
  for (const node of free)
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
      const list = structuredListType(node.type.type);
      if (list !== undefined && 'refusal' in list)
        throw new Error(
          `JS scalar fragment: the input ${node.symbol} has ${list.refusal}`
        );
      if (admission.definition.typeOfSymbol(node) === undefined)
        throw new Error(
          `JS scalar fragment: unsupported binding ${node.symbol}`
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
    if (statement.operator === 'Break') return;
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
    const valueFacts =
      value === undefined ? undefined : scope.facts.get(value);
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
  expressionRoot = false
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
    if (
      (letForm || typedLetForm) &&
      declaration.engine.angularUnit !== 'rad'
    )
      throw new Error(
        `JS scalar fragment: the local ${local} is declared with its value in ` +
          `a dictionary, and the angular unit is ` +
          `${declaration.engine.angularUnit}: the rewrite for the angular unit ` +
          `does not reach such a value`
      );
    // The structured route also admits a local declared as a list
    // (`structuredListLocalType()`).
    if (
      !declared ||
      !['real', 'integer', 'complex', 'boolean', 'let']
        .concat(admission.structured ? ['list<real>', 'list<integer>'] : [])
        .includes(declared) ||
      parameters.includes(local) ||
      locals.has(local) ||
      names.has(local) ||
      local === 'True' ||
      local === 'False'
    )
      throw new Error('JS scalar fragment: unsupported local declaration');
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
  /** `bodyValue`: `node` is the value of the body, where the structured
   *  route admits `Typed(value, T)` (`typedRule()`). */
  const checkValue = (node: Expression, bodyValue = false): void =>
    atNode(node, () => checkValueNode(node, bodyValue));
  const checkValueNode = (node: Expression, bodyValue: boolean): void => {
    refuseListHead(node, admission);
    refuseBooleanClaim(node, admission);
    refuseUndirectedInfinity(node, admission);
    refuseHaversineGrouping(node, admission, () => false);
    refuseWideRead(node, admission, registry?.mode);
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
      const nested = structuredValueParts(node, bodyValue);
      // The value of the body of a helper `f(…) -> T` is `Typed(value, T)`:
      // `T` must be the declared result of the helper.
      if (
        nested !== undefined &&
        helper?.result !== undefined &&
        node.operator === 'Typed'
      ) {
        const ascribed =
          structuredParameterType(node.type.type, helper.name) ??
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
        structuredListType(node.type.type) === undefined
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
      // The structured route reads a captured binding as its snapshot.
      if (registry && recordCapture(registry, node)) return checkCollisions();
      throw new Error(
        `JS scalar fragment: unsupported ${isRoot ? '' : 'helper '}capture ${node.symbol}`
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
      if (classes === undefined) writtenClasses.set(name, (classes = new Set()));
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
  /** The index of each loop around the current statement. */
  const indices = new Set<string>();
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
   */
  const checkStructuredStatement = (
    statement: Expression,
    place: 'top' | 'branch' | 'loop',
    inBlock: boolean,
    owner?: Expression
  ): void =>
    atNode(statement, () =>
      checkStructuredStatementNode(statement, place, inBlock, owner)
    );
  /** `owner`: the block of which `statement` is a statement, where a first
   *  write to a name that the block binds declares the name
   *  (`implicitLocal()`). */
  const checkStructuredStatementNode = (
    statement: Expression,
    place: 'top' | 'branch' | 'loop',
    inBlock: boolean,
    owner?: Expression
  ): void => {
    const head = isFunction(statement)
      ? statement.operator
      : statement.toString();
    const localFunction = admission.structured
      ? localFunctionStatement(statement)
      : undefined;
    if (localFunction !== undefined)
      return checkLocalFunction(statement, localFunction, place, owner);
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
      for (const branch of statement.ops.slice(1))
        nested(() => checkStructuredStatement(branch, 'branch', false));
      return;
    }
    // A block statement: also a statement of the body (`Block(Block(…))`,
    // the form of an Epsil program), whose locals are not visible after it.
    if (isFunction(statement, 'Block') && isLibraryOperator(statement, 'Block')) {
      nested(() => {
        statement.ops.forEach((inner, i) => {
          if (i < statement.nops - 1 && exits(inner))
            throw new Error(
              'JS scalar fragment: the structured route admits no statement after a Break, ' +
                'or after an If whose two branches end in Break'
            );
          checkStructuredStatement(inner, place, true, statement);
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
      indices.size > 0
    )
      return;
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
   * A `Loop` statement: `Loop(body, Element(k, Range(a, b)))`, with bounds
   * of the type `integer` and an index that names no parameter, local or
   * other index. The interpreter evaluates the bounds once and visits each
   * integer from `a` to `b`, in steps of -1 when `b` is less than `a`. A
   * loop with no index set, with a step or a guard, or over another
   * collection is refused.
   */
  const checkLoop = (
    loop: Expression & { ops: readonly Expression[] }
  ): void => {
    const spec = loop.ops[1];
    if (loop.ops.length !== 2)
      throw new Error(
        'JS scalar fragment: the structured route admits a Loop only with one index set, ' +
          'Element(k, Range(a, b))'
      );
    // `Element` and `Range` are the operators of the library: a user
    // function of one of these names is not an index set.
    if (
      !isFunction(spec, 'Element') ||
      !isLibraryOperator(spec, 'Element') ||
      spec.nops !== 2 ||
      !isSymbol(spec.op1) ||
      !isFunction(spec.op2, 'Range') ||
      !isLibraryOperator(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      throw new Error(
        `JS scalar fragment: the structured route admits a Loop only over ` +
          `Element(k, Range(a, b)), with no step and no guard, and not over ${nodeText(spec)}`
      );
    for (const bound of spec.op2.ops) {
      indexPositions.add(bound);
      checkValue(bound);
      // A bound computed from the length of a list with integer arithmetic
      // (`integerFromListLength()`), which the engine does not type
      // `integer`: the rule that `loopBoundFromFact` reads in the pass, with
      // the length locals as the integer names.
      if (!fromLength(bound) && !isSubtype(bound.type.type, 'integer'))
        throw new Error(
          `JS scalar fragment: the bound ${nodeText(bound)} of a Loop does not have the type integer`
        );
    }
    const index = spec.op1.symbol;
    if (
      names.has(index) ||
      locals.has(index) ||
      index === 'True' ||
      index === 'False'
    )
      throw new Error(
        `JS scalar fragment: the loop index ${index} has the name of a parameter, a local or another index`
      );
    nested(() => {
      names.add(index);
      indices.add(index);
      checkStructuredStatement(loop.ops[0], 'loop', false);
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
    if (declared !== undefined && declared !== 'function' && declared !== 'unknown')
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
    const visit = (node: Expression): void => {
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
        if (
          names.has(node.symbol) &&
          !locals.has(node.symbol) &&
          hostEffects()
        )
          throw new Error(
            `JS scalar fragment: ${what} reads the input ${node.symbol}, and ` +
              `the program has a read or a call of the host that is not ` +
              `declared pure: the structured route passes an input to a ` +
              `local function at the call, and a host operation can change ` +
              `it before the body reads it`
          );
        if (names.has(node.symbol))
          capture(node.symbol, node);
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
    const collectCalls = (node: Expression): void => {
      if (!isFunction(node)) return;
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
    const scan = (node: Expression): void => {
      if (!isFunction(node)) return;
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
function boundNames(statement: Expression, names: string[] = []): string[] {
  if (!isFunction(statement)) return names;
  if (statement.operator === 'Declare' && isSymbol(statement.op1))
    names.push(statement.op1.symbol);
  if (
    statement.operator === 'Loop' &&
    isFunction(statement.op2, 'Element') &&
    isSymbol(statement.op2.op1)
  )
    names.push(statement.op2.op1.symbol);
  if (statement.operator === 'Block')
    for (const s of statement.ops)
      if (
        isFunction(s, 'Assign') &&
        isSymbol(s.op1) &&
        implicitLocal(statement, s.op1.symbol)
      )
        names.push(s.op1.symbol);
  for (const s of statement.ops) boundNames(s, names);
  return names;
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
  if (statement.operator === 'DefineFunction' || statement.operator === 'Assign') {
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

/** The names of the symbols that `node` reads or writes. */
function namesIn(node: Expression, names = new Set<string>()): Set<string> {
  if (isSymbol(node)) names.add(node.symbol);
  else if (isFunction(node)) for (const op of node.ops) namesIn(op, names);
  return names;
}

/**
 * The spelling of the element type of the declared list type `type`, as the
 * existing emitter writes it as the third argument of `_SYS.atNumeric`
 * (`typeToString()` of `indexElementType()`): `finite_real` for
 * `list<finite_real>`, `real` for `vector<real>`. `undefined` for a type
 * that is not a list of the structured route.
 */
function elementLabel(type: Type | undefined): string | undefined {
  const list = type === undefined ? undefined : structuredListType(type);
  if (list === undefined || 'refusal' in list) return undefined;
  const element = indexElementType(type!);
  return element === undefined ? undefined : typeToString(element);
}

/** The input `name` of the structured route, with the type `type`: a
 *  scalar, or a list of reals or of integers. `declared`: the engine type
 *  of the input, for the label of a list (`elementLabel()`). `lifted`: a
 *  complex input with no declared type in the `complex` mode, which the
 *  host can give as a number or a complex value (`IRInput.lifted`). */
function structuredInput(
  name: string,
  type: { readonly kind: string; readonly element?: { readonly kind: string } },
  declared?: Type,
  lifted = false
): StructuredInput {
  const rep = structuredRepresentation(type);
  const kind = type.kind === 'list' ? `list<${type.element?.kind}>` : type.kind;
  if (
    rep === undefined ||
    !(
      [
        'real',
        'integer',
        'boolean',
        'complex',
        'list<real>',
        'list<integer>',
      ] as const
    ).some((k) => k === kind)
  )
    throw new Error(
      `JS scalar fragment invariant: no scalar or list input ${name}`
    );
  const label = type.kind === 'list' ? elementLabel(declared) : undefined;
  if (lifted && kind !== 'complex')
    throw new Error(
      `JS scalar fragment invariant: the lifted input ${name} is not complex`
    );
  return {
    name,
    type: kind as StructuredInput['type'],
    representation: rep,
    ...(label === undefined ? {} : { elementLabel: label }),
    ...(lifted ? { lifted: true as const } : {}),
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
    helpers: new Map(),
    captures: new Map(),
    resolving: [],
    forms: new Map(),
    lengthDeclarations: new Set(),
    localFunctions: new Map(),
    localFunctionNames: new Set(),
    localCalls: new Set(),
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
 * With the engine flag `_bindingUnits` (the default), boxing writes no
 * inferred type on a definition of the host's scopes: such a definition
 * holds an inferred type only because the host called `ce.infer()`,
 * `ce.assume()` or `ce.assign()`, or evaluated an assignment. A symbol whose
 * definition is the one that the engine finds for its name where the
 * program is compiled, with a type that is not `unknown` (an inferred type,
 * or the type `unknown` that an assumption narrowed), has a declared type:
 * the type of its occurrence, which the existing compiler reads too. The
 * definition of a parameter or of a local of the program is not that
 * definition, and boxing still narrows its type: such a name has no
 * declared type. Without the flag, boxing narrows the inferred type of
 * every name each time an expression that uses it is boxed, so the type is
 * never read: a rule that read it would depend on what was boxed before.
 *
 * The first test is `hasInferredType()` (`type-guards.ts`), which follows
 * the storage of bindings and of inferred types; every rule of the profile
 * that asks this question calls this function.
 */
export function hasNoDeclaredType(symbol: Expression): boolean {
  if (!isSymbol(symbol) || !hasInferredType(symbol)) return false;
  if (!symbol.engine._bindingUnits) return true;
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
):
  | { readonly kind: 'real' | 'complex'; readonly lifted: boolean }
  | undefined {
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
 * `assertCurrent()` throws when the binding, whether its type is declared,
 * its declared type or its value changed after this call.
 */
function numericSnapshot(
  node: Expression & { symbol: string },
  admitsUndeclared: boolean
):
  | { binding: object; value: Expression; assertCurrent: () => void }
  | undefined {
  const binding = resolvedValueDefinition(node);
  const value = binding?.value;
  const ambient = node.engine.lookupDefinition(node.symbol);
  // The existing route captures only a binding that the host declared: a
  // type that `ce.assign()` or `ce.infer()` wrote is not a declaration
  // there, and keeps the refusal of a binding with no declared type.
  const isUndeclared = (n: Expression) =>
    admitsUndeclared ? hasNoDeclaredType(n) : hasInferredType(n);
  const undeclared = isUndeclared(node);
  if (
    !binding ||
    (undeclared && !admitsUndeclared) ||
    (!undeclared &&
      !isSubtype(binding.type.type, 'real') &&
      !(
        admitsUndeclared &&
        declaredNumberKind(binding.type.type, 'strict') !== undefined
      )) ||
    !value ||
    !isNumber(value) ||
    !Number.isFinite(value.re) ||
    value.im !== 0 ||
    !ambient ||
    !('value' in ambient) ||
    ambient.value !== binding ||
    node.engine._getSymbolValue(node.symbol) !== value
  )
    return undefined;
  const declaredType = binding.type.type;
  return {
    binding,
    value,
    assertCurrent: () => {
      const current = node.engine.lookupDefinition(node.symbol);
      if (
        !current ||
        !('value' in current) ||
        current.value !== binding ||
        resolvedValueDefinition(node) !== binding ||
        isUndeclared(node) !== undeclared ||
        (!undeclared && binding.type.type !== declaredType) ||
        binding.value !== value ||
        node.engine._getSymbolValue(node.symbol) !== value
      )
        throw new Error(
          'JS scalar fragment invariant: different captured binding or value'
        );
    },
  };
}

/** Record the read `node` of a captured binding on the structured route.
 *  Returns false when `node` does not read a binding that the fragment
 *  captures (`numericSnapshot()`). */
function recordCapture(
  registry: StructuredRegistry,
  node: Expression & { symbol: string }
): boolean {
  const snapshot = numericSnapshot(node, true);
  if (snapshot === undefined) return false;
  let entry = registry.captures.get(snapshot.binding);
  if (entry === undefined) {
    entry = {
      binding: snapshot.binding,
      name: node.symbol,
      symbols: new Set(),
      stored: snapshot.value,
      value: snapshot.value.re,
      assertCurrent: snapshot.assertCurrent,
    };
    registry.captures.set(snapshot.binding, entry);
  }
  entry.symbols.add(node);
  return true;
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
  // A call of a local function (`LocalFunction`): its helper was resolved at
  // its definition. A call of a name that a statement of the body defines as
  // a local function, and that does not reach that definition (a call before
  // the definition, or of a function of the same name defined elsewhere), is
  // refused.
  if (registry.localFunctionNames.has(name)) {
    const local = registry.localFunctions.get(name);
    if (
      local === undefined ||
      !local.bindings.has(
        (node.valueDefinition ?? node.operatorDefinition) as object
      )
    )
      throw new Error(
        `JS scalar fragment: the call ${nodeText(node)} does not reach a ` +
          `local function ${name} defined before it in the body`
      );
    named.calls.add(node);
    registry.localCalls.add(node);
    return;
  }
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
    BaseCompiler.assertCapturedCallableBindings(node, target);
  }
  if (registry.mode === 'complex') refuseRangeSpecialization(node);
  named.calls.add(node);
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
  const definition: FragmentDefinition<ScalarRepresentation> = {
    ...base,
    // A helper body, as the body of the root function, has locals and
    // writes (`admitFunctionBody()`).
    rules: {
      ...base.rules,
      Block: { walk: walkBlock },
      Assign: { walk: walkAssign },
      ...Object.fromEntries(
        Object.entries(
          modeRules(
            registry.mode,
            snapshotReader(registry),
            registry.forms,
            registry.hosts?.vars
          )
        ).map(([head, rule]) => [head, withoutListOperands(head, rule)])
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
    // A free symbol with no declared type has the default kind of the mode
    // (`hasNoDeclaredType()`); its inferred type is not read.
    typeOfInput: (node: Expression) => {
      if (hasNoDeclaredType(node)) return defaultKind(registry.mode);
      // A name declared `number`: the kind of `number` in the mode.
      const numberKind = declaredNumberKind(node.type.type, registry.mode);
      return numberKind !== undefined
        ? { kind: numberKind.kind }
        : (base.typeOfInput ?? base.typeOfSymbol)(node);
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
          conversion.kind !== 'none' &&
          (helper.defaulted[j] || helper.wide[j])
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
  const { binding, valueDefinition, operatorDefinition } =
    helperBinding(call);
  const held =
    valueDefinition?.value ??
    (operatorDefinition as { _lambdaLiteral?: Expression } | undefined)
      ?._lambdaLiteral;
  if (!binding || !held || !isFunction(held, 'Function'))
    throw new Error(`JS scalar fragment: unsupported head ${call.operator}`);
  BaseCompiler.assertCapturedCallableBindings(call, target);
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
      : structuredParameterType(signature.result, call.operator) === undefined
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
          ? structuredParameterType(signature.result, call.operator)
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
  if (signature?.optArgs?.length)
    throw new Error(
      `JS scalar fragment: the helper ${call.operator} has an optional parameter`
    );
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
        ? (structuredParameterType(type, name) ??
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
  for (const parameter of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const type = functionLiteralParameterType(parameter);
    const defaultType = inferred
      ? defaultedParameterKind(parameter, registry)
      : undefined;
    const scalar = defaultType ?? typeOf(type, name);
    const refusal = parameterRefusal(
      parameter,
      name,
      scalar,
      defaultType !== undefined,
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
      : signature!.args?.[parameters.length]?.type;
    const declaredScalar = defaultType ?? typeOf(declared, name);
    defaulted.push(defaultType !== undefined);
    wide.push(
      registry !== undefined &&
        type !== undefined &&
        declaredNumberKind(type, registry.mode)?.lifted === true
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
  if (!functionTyped && (signature!.args?.length ?? 0) !== parameters.length)
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
  return {
    name: call.operator,
    literal,
    body,
    binding,
    capture,
    // With an inferred signature, the representation of the fact of the
    // body (`annotateStructured()`).
    resultRepresentation:
      result === undefined
        ? undefined
        : (registry
            ? structuredRepresentation(result)
            : representation(result))!,
    declaredResult: result !== undefined,
    defaulted,
    wide,
    parameterElementLabels,
    fragment: {
      key: call.operator,
      name: call.operator,
      body,
      parameters,
      parameterTypes,
      parameterSymbols,
    },
  };
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
          : structuredParameterType(type, name));
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
    },
  };
}
