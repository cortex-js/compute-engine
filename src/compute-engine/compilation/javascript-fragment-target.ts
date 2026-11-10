/** Internal opt-in scalar slice; intentionally absent from target registration. */
import type { Type } from '../../common/type/types.js';
import type { Expression } from '../global-types.js';
import type {
  CompilationOptions,
  CompilationResult,
  CompileTarget,
} from './types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { indexElementType } from '../../common/type/utils.js';
import { withoutNaNMember } from './compile-real-analysis.js';
import { NON_NEGATIVE_REAL_TYPE } from './compiler-naming.js';
import {
  JavaScriptTarget,
  type JavaScriptBodyEmitter,
} from './javascript-target.js';
import { BaseCompiler } from './base-compiler.js';
import { exactRationalDivisor } from './compiler-type-facts.js';
import { SHIFT_JUMP_HEADS } from './compile-folding.js';
import { exactDoubleValue } from '../numeric-value/exact-integer-value.js';
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
import { isLibraryOperator } from './builtin-callback.js';
import {
  typeFragment,
  walkIf,
  walkBlock,
  walkAssign,
  walkCountedLoop,
  fragmentTypeToString,
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
import { isPureComputedEffects } from '../../common/type/effects.js';
import type { EffectFact } from './structured-ir.js';
import { verifyJavaScriptProgram } from './javascript-structured-policy.js';
import {
  lowerStructuredProgram,
  preparedNodesOf,
  recordStructuredPreparation,
  structuredPreparationOf,
  type StructuredCapture,
  type StructuredInput,
  type StructuredPreparation,
} from './javascript-structured-lower.js';
import { emitStructuredProgram } from './javascript-structured-emit.js';

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
 * rule from facts (`structuredSqrtRule()`).
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

/** True when `node` reads no symbol other than `True` and `False`: its
 *  value is fixed when the program is compiled. */
function readsNoSymbol(node: Expression): boolean {
  if (isSymbol(node)) return node.symbol === 'True' || node.symbol === 'False';
  return isFunction(node) ? node.ops.every(readsNoSymbol) : true;
}

/**
 * `Multiply`: real operands, or two complex operands. A product with an
 * exact rational factor `p/q` whose denominator is not a power of two
 * (`exactRationalDivisor()`: the canonical form writes `x/49` as
 * `Multiply(1/49, x)`) has a real result, and the lowering writes it as the
 * existing emitter does, a division by `q` (`multiplyByRational()`). The code of a complex
 * product is the one of the existing emitter (`Multiply` in
 * `javascript-target.ts`): each operand is read once, and the real and the
 * imaginary parts are written from its components. The product of a real
 * and a complex operand, and a complex product of more than two operands,
 * are not in the structured route: the existing emitter writes the first
 * with no conversion of the real operand, which the structured route has
 * no operation for.
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
      if (node.nops !== 2 || facts.some((f) => f.type.kind !== 'complex'))
        return w.refuse(
          node,
          'signature',
          'a product with a complex operand is in the structured route only as ' +
            'the product of two complex operands'
        );
      return w.signatures(node, scope, context, [
        { operands: ['complex', 'complex'], result: 'complex' },
      ]);
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
 * `Less`, `LessEqual` and `Equal`: two real operands, a boolean result. The
 * canonical form writes `GreaterEqual(a, b)` as `LessEqual(b, a)`. A comparison
 * that reads no symbol is refused: its value is fixed at compile time, and
 * the existing emitter writes it as a literal also with `constantFold:
 * false`. A comparison of three operands or more is a conjunction of pairs
 * that the existing emitter writes with temporaries. `Equal` is the exact
 * comparison `===` of two numbers; a complex operand needs a comparison per
 * component, which the structured route does not have.
 */
function comparisonRule(operator: 'Less' | 'LessEqual' | 'Equal') {
  return {
    walk: (node, scope, context, w) => {
      const nops = isFunction(node) ? node.nops : 0;
      if (nops !== 2)
        return w.refuse(
          node,
          'signature',
          `${operator} with ${nops} operands is not in the structured route, which admits two`
        );
      if (readsNoSymbol(node))
        return w.refuse(
          node,
          'signature',
          `${operator} reads no symbol: its value is fixed at compile time`
        );
      const facts = operandFacts(node, scope, context, w);
      if (facts.some((f) => f.type.kind === 'complex'))
        return w.refuse(
          node,
          'signature',
          `${operator} with a complex operand is not in the structured route`
        );
      if (operator !== 'Equal' && facts.some((f) => f.type.kind === 'boolean'))
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
 * `_SYS.floorMod(a, b)` as by the existing emitter. Its result has the sign
 * of the divisor, as the interpreter gives it: `Mod(-7, 3)` is `2`,
 * `Mod(7, -3)` is `-2`, `Mod(-7.5, 2)` is `0.5`, and `Mod(5, 0)` is not a
 * number. An operand beyond the safe integer range throws, as on the
 * existing route. The result is an integer when both operands are.
 */
const modRule = realOperatorFacts('Mod', 2, integerWhenAll);

/**
 * `Floor`: the greatest integer not greater than its real operand, written
 * `Math.floor(x)`. The result is an integer, as the engine type of
 * `Floor(x)` is: `Floor(-2.5)` is `-3`. `Floor(-0)` is `-0`, where the
 * interpreter gives `0`, as on the existing route.
 */
const floorFacts = realOperatorFacts('Floor', 1, () => 'integer');
const floorRule = {
  walk: (node, scope, context, w) => {
    const constant = isFunction(node)
      ? inexactJumpConstant(node.ops)
      : undefined;
    if (constant !== undefined)
      return w.refuse(
        node,
        'signature',
        `Floor of an operand with the exact constant ${constant.toString()}, ` +
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
 */
function inexactJumpConstant(
  operands: readonly Expression[]
): Expression | undefined {
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
    if (node.unknowns.length === 0) {
      if (isNumber(node))
        return exact(node) || divisionFactor(node, parent) ? undefined : node;
      // `True` and `False` are not numbers: the rule of `Floor` refuses a
      // boolean operand.
      if (isSymbol(node, 'True') || isSymbol(node, 'False')) return undefined;
      if (isSymbol(node) && safeInteger(node.valueDefinition?.value))
        return undefined;
      return node;
    }
    if (!isFunction(node) || SHIFT_JUMP_HEADS.has(node.operator))
      return undefined;
    for (const op of node.ops) {
      const found = visit(op, node);
      if (found !== undefined) return found;
    }
    return undefined;
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
 */
const divideRule = realOperatorFacts('Divide', 2, () => 'real');

/**
 * `Power` with the literal exponent 2: the product of the operand with
 * itself, the operand evaluated once (the lowering writes a `multiply` of
 * one value by itself). A real operand gives a real result, an integer one
 * an integer, a complex one a complex result. The existing emitter writes
 * `_SYS.pow2(x)` (`x * x`) for a real operand and the same components for
 * a complex one. Every other exponent is refused.
 */
const powerRule = {
  walk: (node, scope, context, w) => {
    if (
      !isFunction(node) ||
      node.nops !== 2 ||
      !isNumber(node.op2) ||
      node.op2.re !== 2 ||
      node.op2.im !== 0
    )
      return w.refuse(
        node,
        'signature',
        'Power is in the structured route only with the literal exponent 2'
      );
    const [base, exponent] = operandFacts(node, scope, context, w);
    if (base.type.kind === 'boolean')
      return w.refuse(
        node,
        'signature',
        'Power with a boolean operand is not in the structured route'
      );
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
          `The bound \`${bound.toString()}\` of \`Loop\` does not have an integer ` +
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
 * The sign of the real operand `node` of a `Sqrt`, from facts of the
 * program: the value of a literal or of a captured snapshot (non-negative,
 * `-0` included, or negative), the declared type of a name (a subtype of
 * `real<0..>` is non-negative, a type whose values are all negative is
 * negative), and the operators whose result is non-negative when their
 * operands are: `Add` and `Multiply` of non-negative operands, `Max` with
 * one non-negative operand, `Min` of non-negative operands, `Sqrt` of a
 * non-negative operand. Every other node has an unknown sign. A `NaN`
 * literal has an unknown sign.
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
  deep: boolean
): Sign | { refusal: string } {
  const refusal = (sign: string) => ({
    refusal:
      `the engine knows that the operand ${node.toString()} of Sqrt is ` +
      `${sign}, and the structured route does not`,
  });
  const fromValue = (v: number): Sign =>
    Number.isNaN(v) ? 'unknown' : v >= 0 ? 'nonnegative' : 'negative';
  let sign: Sign | { refusal: string } = 'unknown';
  const snapshot = isSymbol(node) ? snapshotOf(node) : undefined;
  if (snapshot !== undefined) sign = fromValue(snapshot);
  else if (isNumber(node))
    sign = node.im === 0 ? fromValue(node.re) : 'unknown';
  else if (isSymbol(node)) {
    const type = withoutNaNMember(node.type.type);
    if (type !== undefined && isSubtype(type, NON_NEGATIVE_REAL_TYPE))
      sign = 'nonnegative';
    else if (type !== undefined && isSubtype(type, 'real<..<0>'))
      sign = 'negative';
  } else if (isFunction(node)) {
    const signs = (): (Sign | { refusal: string })[] =>
      node.ops.map((op) => signOf(op, snapshotOf, deep));
    const op = node.operator;
    // With no operand, the sign is unknown, as in `assumedRealNonNegative()`.
    if (
      (op === 'Add' || op === 'Multiply' || op === 'Min' || op === 'Max') &&
      node.nops > 0
    ) {
      const operands = signs();
      const found = operands.find((s) => typeof s === 'object');
      if (found !== undefined) return found;
      const nonNegative = operands.map((s) => s === 'nonnegative');
      if (op === 'Max' ? nonNegative.some(Boolean) : nonNegative.every(Boolean))
        sign = 'nonnegative';
    } else if (op === 'Sqrt' && node.nops === 1) {
      const [operand] = signs();
      if (typeof operand === 'object') return operand;
      if (operand === 'nonnegative') sign = 'nonnegative';
    }
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
 */
function structuredSqrtRule(
  mode: 'strict' | 'complex',
  snapshotOf: SnapshotOf
) {
  return {
    walk: (node, scope, context, w) => {
      if (!isFunction(node) || node.nops !== 1)
        return w.refuse(
          node,
          'signature',
          'Sqrt with other than one operand is not in the structured route'
        );
      const facts = w.value(node.op1, scope, context);
      if (facts.type.kind === 'boolean')
        return w.refuse(
          node,
          'signature',
          'Sqrt with a boolean operand is not in the structured route'
        );
      let lane: 'real' | 'complex' = 'complex';
      if (facts.representation !== 'complex') {
        const sign = signOf(node.op1, snapshotOf, mode === 'complex');
        if (typeof sign === 'object')
          return w.refuse(node, 'signature', sign.refusal);
        lane =
          mode === 'complex'
            ? sign === 'nonnegative'
              ? 'real'
              : 'complex'
            : sign === 'negative'
              ? 'complex'
              : 'real';
      }
      return w.signatures(node, scope, context, [
        { operands: [lane], result: lane },
      ]);
    },
  } satisfies FragmentRule<ScalarRepresentation>;
}

/** The rules of the structured route. The rule of `Sqrt` reads the compile
 *  mode and the captured values of a compilation: `annotateCalls()` puts
 *  `structuredSqrtRule()` in its place, and this entry only admits the
 *  head. */
const structuredRules: Record<string, FragmentRule<ScalarRepresentation>> = {
  Sqrt: {
    walk: () => {
      throw new Error(
        'JS scalar fragment invariant: Sqrt without its compile mode'
      );
    },
  },
  Add: withListLengthIntegers(addRule),
  Negate: withListLengthIntegers(negateRule),
  If: { walk: (node, scope, context, w) => ifRule(node, scope, context, w) },
  Multiply: withListLengthIntegers(multiplyRule),
  Less: comparisonRule('Less'),
  LessEqual: comparisonRule('LessEqual'),
  Equal: comparisonRule('Equal'),
  Mod: modRule,
  Floor: floorRule,
  Divide: divideRule,
  Power: powerRule,
  Loop: loopRule,
  And: logicalRule('And'),
  Or: logicalRule('Or'),
  Min: extremumRule('Min'),
  Max: extremumRule('Max'),
  At: { walk: (node, scope, context, w) => atRule(node, scope, context, w) },
  Length: {
    walk: (node, scope, context, w) => lengthRule(node, scope, context, w),
  },
};

/**
 * The type of a local on the structured route (`FragmentDefinition.localType`):
 * `integer` for a local declared `integer` with an integer value, and for a
 * local declared with no type (`Declare(c, {value: Mod(k, 3)})`, a `let`)
 * whose value is an integer and whose type, as the engine infers it from
 * every value written to it, is `integer`. Every other local has the rule of
 * the pass, which widens an integer to a real: a local declared `real`, and
 * a `let` local written later with a real value (`let c = 1` then
 * `c := c + x` with `x: real`), which the interpreter accepts and for which
 * the engine infers `real`. A write of a real value to an integer local is
 * refused by the rule of `Assign`. With an integer local, a loop bound
 * (`Range(1, m)`) and an integer parameter of a helper can read the local.
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
    value: { kind: string };
    declared: string | undefined;
    inferred: Type | undefined;
  },
  isLengthLocal: (name: string) => boolean = () => false
): { kind: 'integer' } | undefined {
  if (local.value.kind !== 'integer') return undefined;
  if (local.declared === 'integer') return { kind: 'integer' };
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

/**
 * Whether `node` is an integer computed from the length of a list with
 * integer arithmetic, on the structured route:
 *
 * - `Length(L)` (the library operator) of a symbol `L` of a list type of
 *   the structured route (`structuredListType()`);
 * - a symbol that `isIntegerName` accepts: at the admission, a local each
 *   of whose values is such an integer or has the type `integer`; in the
 *   pass, a name whose fact is `integer`;
 * - `Add`, `Negate`, `Multiply` or `Mod` (the library operators) whose
 *   operands each have the type `integer` or are such an integer, one of
 *   them at least being such an integer.
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
  isIntegerName: (symbol: Expression & { symbol: string }) => boolean
): boolean {
  if (isSymbol(node)) return isIntegerName(node);
  if (!isFunction(node) || !isLibraryOperator(node, node.operator))
    return false;
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
    if (integerFromListLength(operand, isIntegerName)) found = true;
    else if (!isSubtype(operand.type.type, 'integer')) return false;
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
      if (
        !operands.every((f) => f.type.kind === 'integer') ||
        !integerFromListLength(
          node,
          (s) => w.value(s, scope, context).type.kind === 'integer'
        )
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

//
// Lists on the structured route
//
// A list input of the program and a list parameter of a helper are read
// with `At` and `Length`, and passed whole to a helper parameter of the same
// list type. A list is not a local, a carried value, the value of an `If` or
// of the program, nor an operand of any other operator: the representation
// binding refuses a list local, `ifRule()` and `annotateStructured()` refuse
// a list value, and `withoutListOperands()` refuses a list operand.
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
 *  `array` where it is an input or a parameter. A list local, a list index
 *  and every other list binding have no representation, and the refusal
 *  says why (`bindingLimit`). */
const structuredDefinition: Pick<
  FragmentDefinition<ScalarRepresentation>,
  | 'typeOfSymbol'
  | 'representationOfBinding'
  | 'representationOfValue'
  | 'bindingLimit'
  | 'loopBoundFromFact'
  | 'passesListArgument'
> = {
  typeOfSymbol(node) {
    const scalar = definition.typeOfSymbol(node);
    if (scalar !== undefined) return scalar;
    const list = structuredListType(node.type.type);
    return list === undefined || 'refusal' in list ? undefined : list;
  },
  representationOfBinding: (type, binding) =>
    type.kind === 'list' &&
    binding.role !== 'input' &&
    binding.role !== 'parameter'
      ? undefined
      : structuredRepresentation(type),
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
      ? `The ${binding.role} \`${isSymbol(binding.symbol) ? binding.symbol.symbol : binding.symbol.toString()}\` ` +
        `has the type \`${fragmentTypeToString(type)}\`: the structured route admits a list ` +
        `only as an input or a parameter, read by At and Length, and not as a ${binding.role}`
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

/** `If` on the structured route: the rule of the pass (`walkIf()`), and a
 *  value that is not a list. An `If` whose branches are lists is a list
 *  that the program makes, which the structured route does not have. */
function ifRule(
  node: Expression,
  scope: FragmentScope<ScalarRepresentation>,
  context: FragmentContext<ScalarRepresentation>,
  w: FragmentWalker<ScalarRepresentation>
): FragmentFacts<ScalarRepresentation> {
  const facts = walkIf(node, scope, context, w);
  if (facts.type.kind === 'list')
    return w.refuse(
      node,
      'signature',
      'an If whose value is a list is not in the structured route'
    );
  return facts;
}

/**
 * The rule `rule` of `operator`, after a refusal of a list operand: the
 * interpreter applies an arithmetic operator or a function of a number to
 * each element of a list (`L + 1` is a list), and compares two lists as
 * values (`Equal(L, M)`); the structured route has neither. Every rule of
 * the structured route but those of `If`, `Loop`, `At` and `Length` is
 * wrapped.
 */
function withoutListOperands(
  operator: string,
  rule: FragmentRule<ScalarRepresentation>
): FragmentRule<ScalarRepresentation> {
  return {
    walk: (node, scope, context, w) => {
      const list = (isFunction(node) ? node.ops : []).find(
        (operand) => w.value(operand, scope, context).type.kind === 'list'
      );
      if (list !== undefined)
        return w.refuse(
          node,
          'signature',
          `${operator} with the list operand ${list.toString()} is not in the ` +
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
  [
    'Comprehension',
    'Comprehension makes a list, which the structured route does not have',
  ],
  [
    'ReplaceAt',
    'ReplaceAt makes a list, which the structured route does not have',
  ],
  ['List', 'a list literal is not in the structured route'],
  ['Tuple', 'a tuple is not in the structured route'],
]);

/**
 * The message of the refusal of `node` on the structured route, for a
 * library head of `LIST_HEAD_REFUSALS` and for an `At` with other than one
 * index, a `Range` index (a slice) or a string index; otherwise
 * `undefined`. The admission checks this before it reads the operands, so
 * that the message names the list operation, and not an operand that the
 * route does not have (`Range`, `Element`, a string).
 */
function structuredListRefusal(node: Expression): string | undefined {
  if (!isFunction(node) || !isLibraryOperator(node, node.operator))
    return undefined;
  const message = LIST_HEAD_REFUSALS.get(node.operator);
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
  // A list is an operand of `At`, `Length` and a helper call only. The
  // rules of `If` and `Loop` read no list operand: a branch or a body that
  // reads one is typed by the rule of its own head.
  for (const [name, rule] of Object.entries(rules))
    if (!['If', 'Loop', 'At', 'Length'].includes(name))
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
 *  and in the body of each function. */
function effectFacts(
  annotation: FragmentAnnotation<ScalarRepresentation>
): Map<Expression, EffectFact> {
  const result = new Map<Expression, EffectFact>();
  const visit = (scope: FragmentScope<ScalarRepresentation>) => {
    for (const node of scope.facts.keys())
      if (!result.has(node)) result.set(node, effectFact(node));
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(annotation.scope);
  for (const fn of annotation.functions.values()) visit(fn.scope);
  return result;
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
  }
): void {
  const registry = prepared.named.structured;
  if (!admission.structured || registry === undefined) return;
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
        },
      ])
    ),
    captures: [...registry.captures.values()],
    inputs: prepared.inputs(),
    effects: effectFacts(prepared.annotation),
    testOperations: admission.testOperations,
    numericPolicy: registry.mode,
    iterationBudget: target.iterationBudget,
  };
  recordStructuredPreparation(target, preparation);
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
      const program = lowerStructuredProgram(preparation);
      time = this.endPhase('lowering', time);
      verifyJavaScriptProgram(program, preparedNodesOf(preparation));
      time = this.endPhase('verification', time);
      const emission = emitStructuredProgram(program, names, {
        trace: this.hooks.trace,
      });
      this.endPhase('emission', time);
      return { ...emission, mode: program.numericPolicy };
    };
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

  protected prepareCompilation(
    expr: Expression,
    options: CompilationOptions<Expression>,
    batch?: unknown
  ): { expr: Expression; target: CompileTarget<Expression> } {
    const structured = this.admission.structured;
    const start = structured ? this.clock() : 0;
    if (
      batch !== undefined ||
      options.broadcast ||
      options.functions ||
      options.operators ||
      options.vars ||
      options.preamble ||
      options.imports?.length ||
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
    if (isFunction(prepared.expr, 'Function')) {
      attachBoundFunction(prepared.expr, prepared.target, admission, registry);
      if (structured) this.endPhase('annotation', annotationStart);
      return prepared;
    }
    const named: NamedCalls = { calls: new Set(), structured: registry };
    const seen = new Set<Expression>();
    /** The declared type of each free symbol, for the label of a list
     *  input (`elementLabel()`). */
    const symbolTypes = new Map<string, Type>();
    let readsSqrt = false;
    const check = (node: Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);
      refuseListHead(node, admission);
      if (!node.isValid || node.type.type === 'error')
        throw new Error('JS scalar fragment: invalid expression');
      if (isNumber(node)) return;
      if (isSymbol(node)) {
        if (node.symbol === 'True' || node.symbol === 'False') return;
        symbolTypes.set(node.symbol, node.type.type);
        // The structured route reads a captured binding as its snapshot.
        if (
          registry &&
          node.valueDefinition?.value !== undefined &&
          recordCapture(registry, node)
        )
          return;
        if (node.valueDefinition?.value !== undefined)
          throw new Error(
            `JS scalar fragment: unsupported binding ${node.symbol}`
          );
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
      if (
        (node.operator === 'If' && node.nops !== 3) ||
        ((node.operator === 'Sqrt' || node.operator === 'Negate') &&
          node.nops !== 1)
      )
        throw new Error('JS scalar fragment: unsupported arity');
      checkCondition(node);
      if (node.operator === 'Sqrt') readsSqrt = true;
      for (const operand of node.ops) check(operand);
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
          structuredInput(name, facts.type, symbolTypes.get(name))
        ),
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
function checkCondition(node: Expression): void {
  if (!isFunction(node, 'If') || node.nops < 2 || node.nops > 3) return;
  const type = node.op1.type.type;
  if (
    typeof type === 'object' &&
    type.kind === 'value' &&
    typeof type.value === 'boolean'
  )
    throw new Error(
      `JS scalar fragment: the condition of If has the constant type ${type.value}`
    );
  if (!isSubtype(type, 'boolean'))
    throw new Error(
      'JS scalar fragment: the condition of If does not have the type boolean'
    );
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
  for (const parameter of fn.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const declared = functionLiteralParameterType(parameter);
    // The structured route also admits a list parameter
    // (`structuredListType()`).
    const type =
      declared === undefined
        ? undefined
        : admission.structured
          ? structuredParameterType(declared, name)
          : scalarType(declared);
    if (
      !isFunction(parameter, 'Typed') ||
      parameter.nops !== 2 ||
      !name ||
      !type ||
      name === 'True' ||
      name === 'False' ||
      inputs.some((input) => input.name === name)
    )
      throw new Error(
        'JS scalar fragment: explicit distinct scalar parameters required'
      );
    inputs.push({ name, type, declared: type.kind });
    if (declared !== undefined) declaredTypes.set(name, declared);
  }
  const body = fn.op1.canonical;
  if (
    !isFunction(body, 'Block') ||
    body.nops < 2 ||
    !isLibraryOperator(body, 'Block')
  )
    throw new Error(
      'JS scalar fragment: a bound body requires one straight-line block'
    );
  // The declared type of each local, by its name: `let` for a local of the
  // form `Declare(t, {value: …})`, which has the type of its value.
  const locals = new Map<string, string>();
  /** The local that `declaration` declares, with its declared type. The
   *  structured route also admits the form of a `let`,
   *  `Declare(t, {value: …})`, which `parseEpsil()` gives. */
  const declareLocal = (declaration: Expression) => {
    const letForm =
      admission.structured &&
      isFunction(declaration, 'Declare') &&
      declaration.nops === 2 &&
      declareTypeOperand(declaration.ops) === undefined &&
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
    const declared = letForm ? 'let' : declaredTypeSource(declaration.op2);
    if (
      !declared ||
      !['real', 'integer', 'complex', 'boolean', 'let'].includes(declared) ||
      inputs.some((input) => input.name === local) ||
      locals.has(local) ||
      names.has(local) ||
      local === 'True' ||
      local === 'False'
    )
      throw new Error('JS scalar fragment: unsupported local declaration');
    return {
      local,
      declared,
      value: letForm ? declareValueOperand(declaration.ops)! : declaration.op3,
    };
  };
  const names = new Set(inputs.map((input) => input.name));
  const declaration = body.op1;
  const { local, declared, value: initializer } = declareLocal(declaration);
  // The structured route admits more than one local: every declaration of
  // the block, of a nested block, of a branch and of a loop body, and the
  // index of each loop.
  const bindings = new Set([
    ...names,
    local,
    ...(admission.structured ? boundNames(body) : []),
  ]);
  const named: NamedCalls = { calls: new Set(), structured: registry };
  // The heads that are not helper calls. The existing route also keeps
  // `Sqrt` here, so that it reaches the refusal below and not the helper
  // resolution.
  const operatorHeads: ReadonlySet<string> = admission.structured
    ? admission.heads
    : new Set(['Add', 'Negate', 'If', 'Sqrt']);
  /** Refuse a helper or a captured binding whose name is a parameter or a
   *  local of the root function. */
  const checkCollisions = (): void => {
    const collides = registry
      ? [
          ...registry.helpers.keys(),
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
  const checkValue = (node: Expression): void => {
    refuseListHead(node, admission);
    if (!node.isValid || node.type.type === 'error')
      throw new Error('JS scalar fragment: invalid bound expression');
    if (isNumber(node)) return;
    if (admission.structured && isFunction(node, 'Loop'))
      throw new Error(
        'JS scalar fragment: a Loop used as a value is not in the structured ' +
          'route: the interpreter gives a Loop the value Nothing'
      );
    if (isSymbol(node)) {
      if (
        names.has(node.symbol) ||
        node.symbol === 'True' ||
        node.symbol === 'False'
      )
        return;
      // The structured route reads a captured binding as its snapshot.
      if (registry && recordCapture(registry, node)) return checkCollisions();
      throw new Error(`JS scalar fragment: unsupported capture ${node.symbol}`);
    }
    if (isFunction(node) && !operatorHeads.has(node.operator)) {
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
      (node.operator === 'If' && node.nops !== 3)
    )
      throw new Error(
        `JS scalar fragment: unsupported bound head ${node.operator}`
      );
    checkCondition(node);
    for (const operand of node.ops) checkValue(operand);
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
  const isLengthLocal = (name: string): boolean =>
    lengthWritten.has(name) && !notLength.has(name);
  const fromLength = (value: Expression): boolean =>
    admission.structured &&
    integerFromListLength(value, (symbol) => isLengthLocal(symbol.symbol));
  const checkWrite = (value: Expression, name = local): void => {
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
  };
  locals.set(local, declared);
  checkValue(initializer);
  checkWrite(initializer);
  names.add(local);
  // The structured route: more declarations, writes to the declared locals,
  // `If` statements and counted loops (`checkStructuredStatement()`). Each
  // write makes a new value in the lowering.
  /** The index of each loop around the current statement. */
  const indices = new Set<string>();
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
   * A statement of the body of the structured route. `place`: the
   * statement is in the block of the body (`top`), in a branch of an `If`
   * (`branch`), or in the body of a `Loop` (`loop`), the innermost one.
   * `inBlock`: the statement is a statement of a block, where a `Declare`
   * is admitted, and not a whole branch or a whole loop body.
   */
  const checkStructuredStatement = (
    statement: Expression,
    place: 'top' | 'branch' | 'loop',
    inBlock: boolean
  ): void => {
    const head = isFunction(statement)
      ? statement.operator
      : statement.toString();
    if (isFunction(statement, 'Declare') && inBlock) {
      const declared = declareLocal(statement);
      locals.set(declared.local, declared.declared);
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
      if (!locals.has(name) || !names.has(name))
        throw new Error(
          `JS scalar fragment: only writes to a declared local are supported, ` +
            `and ${name} is ` +
            (inputs.some((input) => input.name === name)
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
      checkCondition(statement);
      for (const branch of statement.ops.slice(1))
        nested(() => checkStructuredStatement(branch, 'branch', false));
      return;
    }
    if (
      isFunction(statement, 'Block') &&
      isLibraryOperator(statement, 'Block') &&
      place !== 'top'
    ) {
      nested(() => {
        for (const inner of statement.ops)
          checkStructuredStatement(inner, place, true);
      });
      return;
    }
    if (isFunction(statement, 'Loop') && isLibraryOperator(statement, 'Loop'))
      return checkLoop(statement);
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
          `Element(k, Range(a, b)), with no step and no guard, and not over ${spec.toString()}`
      );
    for (const bound of spec.op2.ops) {
      checkValue(bound);
      // A bound computed from the length of a list with integer arithmetic
      // (`integerFromListLength()`), which the engine does not type
      // `integer`: the rule that `loopBoundFromFact` reads in the pass, with
      // the length locals as the integer names.
      if (!fromLength(bound) && !isSubtype(bound.type.type, 'integer'))
        throw new Error(
          `JS scalar fragment: the bound ${bound.toString()} of a Loop does not have the type integer`
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
  };
  if (admission.structured)
    for (const statement of body.ops.slice(1, -1))
      checkStructuredStatement(statement, 'top', true);
  for (const statement of admission.structured ? [] : body.ops.slice(1, -1)) {
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
  checkValue(body.ops[body.nops - 1]);
  const boundDefinition: FragmentDefinition<ScalarRepresentation> = {
    ...admission.definition,
    rules: {
      ...(admission.structured
        ? admission.definition.rules
        : { Add: addRule, Negate: negateRule, If: { walk: walkIf } }),
      Block: { walk: walkBlock },
      Assign: { walk: walkAssign },
    },
    ...(admission.structured
      ? {
          localType: (l: Parameters<typeof structuredLocalType>[0]) =>
            structuredLocalType(l, isLengthLocal),
        }
      : {}),
  };
  const annotation = (() => {
    const annotation = annotateCalls(
      body,
      boundDefinition,
      named,
      inputs,
      body
    );
    const scope = annotation.scope.inner.get(body);
    if (!scope)
      throw new Error('JS scalar fragment invariant: missing local binding');
    // Each write of a local, in the scope where the pass typed it: a
    // statement of the block, of a branch of an `If` statement, or of the
    // body of a `Loop`, which is typed in the scope of the loop.
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
          'JS scalar fragment: local writes must preserve representation'
        );
    };
    for (const statement of body.ops.slice(0, -1))
      checkWrites(statement, scope);
    return annotation;
  })();
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
        structuredInput(input.name, input.type!, declaredTypes.get(input.name))
      ),
  });
}

/** The names that `statement` binds: the local of each `Declare` and the
 *  index of each `Loop`, in a nested block, branch or loop body too. */
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
  if (['Block', 'If', 'Loop'].includes(statement.operator))
    for (const s of statement.ops) boundNames(s, names);
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
 *  of the input, for the label of a list (`elementLabel()`). */
function structuredInput(
  name: string,
  type: { readonly kind: string; readonly element?: { readonly kind: string } },
  declared?: Type
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
  return {
    name,
    type: kind as StructuredInput['type'],
    representation: rep,
    ...(label === undefined ? {} : { elementLabel: label }),
  };
}

type ResolvedHelper = ScalarFragmentHelper & {
  readonly binding: object;
  readonly resultRepresentation: ScalarRepresentation;
  readonly fragment: Omit<FragmentFunction, 'arguments'>;
  /** The label of each list parameter (`elementLabel()`). */
  readonly parameterElementLabels?: readonly (string | undefined)[];
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
  return { mode, helpers: new Map(), captures: new Map(), resolving: [] };
}

/**
 * The snapshot of the captured binding that the symbol `node` reads, or
 * `undefined` when the binding is not one that the fragment captures: an
 * explicitly declared real or integer binding (not inferred) that holds a
 * finite real number literal, and that is the binding the engine finds
 * for the name where the program is compiled (a binding of another scope
 * with the same name is not captured). `assertCurrent()` throws when the
 * binding, its declared type or its value changed after this call.
 */
function numericSnapshot(
  node: Expression & { symbol: string }
):
  | { binding: object; value: Expression; assertCurrent: () => void }
  | undefined {
  const binding = node.valueDefinition;
  const value = binding?.value;
  const ambient = node.engine.lookupDefinition(node.symbol);
  if (
    !binding ||
    binding.inferredType ||
    !isSubtype(binding.type.type, 'real') ||
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
        node.valueDefinition !== binding ||
        binding.inferredType ||
        binding.type.type !== declaredType ||
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
  const snapshot = numericSnapshot(node);
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

/** The snapshot read by the symbol `node`, for the rule of `Sqrt`. */
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
  const known = registry.helpers.get(name);
  if (known === undefined) {
    registry.resolving.push(name);
    try {
      registry.helpers.set(name, resolveHelper(node, target, admission, named));
    } finally {
      registry.resolving.pop();
    }
  } else {
    if ((node.valueDefinition ?? node.operatorDefinition) !== known.binding)
      throw new Error(
        `JS scalar fragment: two definitions of the helper ${name}`
      );
    // `resolveHelper()` checks this at the first call.
    BaseCompiler.assertCapturedCallableBindings(node, target);
  }
  named.calls.add(node);
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
 * `annotateCalls()` on the structured route: the rule of `Sqrt` for the
 * mode of the compilation, every helper of the registry (a call in the body
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
  const definition: FragmentDefinition<ScalarRepresentation> = {
    ...base,
    rules: {
      ...base.rules,
      Block: { walk: walkBlock },
      Sqrt: withoutListOperands(
        'Sqrt',
        structuredSqrtRule(registry.mode, snapshotReader(registry))
      ),
    },
    storedValue: (node: Expression) => {
      const capture = captureOf(node);
      if (capture === undefined) return undefined;
      capture.assertCurrent();
      return capture.stored;
    },
    functionOf: (call: Expression) => {
      const helper =
        isFunction(call) && calls.has(call)
          ? registry.helpers.get(call.operator)
          : undefined;
      return helper === undefined || !isFunction(call)
        ? undefined
        : { ...helper.fragment, arguments: call.ops };
    },
  };
  const annotation = typeFragment(root, definition, { inputs });
  if (annotation.refusal)
    throw new Error(`JS scalar fragment: ${annotation.refusal.message}`);
  // A list is read, not made: the value of the program is not a list.
  if (annotation.scope.facts.get(root)?.type.kind === 'list')
    throw new Error(
      'JS scalar fragment: the value of the program is a list, which the structured route does not have'
    );
  // No `refuseClosedComplex()` here: the structured route refuses constant
  // folding, and its emitter writes each node in the representation of its
  // fact, so a closed node with a complex fact is written complex.
  for (const helper of registry.helpers.values()) {
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
      throw new Error(
        'JS scalar fragment: helper arguments must preserve representation'
      );
  }
  return annotation;
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
 * Resolve the helper that `call` calls and check its body. On the
 * structured route (`named.structured`), the body can call another helper
 * (`collectStructuredHelper()`), and each read of a captured binding is
 * recorded in the registry; the existing route admits one captured binding
 * per helper and no call.
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
  const binding = call.valueDefinition ?? call.operatorDefinition;
  const held =
    call.valueDefinition?.value ??
    (call.operatorDefinition as { _lambdaLiteral?: Expression } | undefined)
      ?._lambdaLiteral;
  if (!binding || !held || !isFunction(held, 'Function'))
    throw new Error(`JS scalar fragment: unsupported head ${call.operator}`);
  BaseCompiler.assertCapturedCallableBindings(call, target);
  const literal = userFunctionLiteral(call.engine, call.operator);
  if (literal !== held)
    throw new Error('JS scalar fragment: helper definition identity differs');
  const signature = userFunctionSignature(call.engine, call.operator);
  const result =
    signature === undefined ? undefined : scalarType(signature.result);
  if (
    !signature ||
    !result ||
    signature.optArgs?.length ||
    signature.variadicArg ||
    signature.typeParams?.length ||
    signature.effects?.length
  )
    throw new Error(
      'JS scalar fragment: helper requires one pure scalar signature'
    );
  const parameters: string[] = [];
  const parameterTypes: NonNullable<
    ReturnType<typeof structuredParameterType>
  >[] = [];
  const parameterSymbols: Expression[] = [];
  const parameterElementLabels: (string | undefined)[] = [];
  // The structured route also admits a list parameter
  // (`structuredListType()`), passed whole to the helper.
  const typeOf = (type: Type | undefined, name: string | undefined) =>
    type === undefined
      ? undefined
      : registry
        ? structuredParameterType(type, name)
        : scalarType(type);
  for (const parameter of literal.ops.slice(1)) {
    const name = functionLiteralParameterName(parameter);
    const type = functionLiteralParameterType(parameter);
    const scalar = typeOf(type, name);
    if (
      !isFunction(parameter, 'Typed') ||
      parameter.nops !== 2 ||
      !name ||
      !scalar ||
      parameters.includes(name) ||
      name === 'True' ||
      name === 'False'
    )
      throw new Error(
        'JS scalar fragment: helper requires explicit scalar parameters'
      );
    const declared = signature.args?.[parameters.length]?.type;
    const declaredScalar = typeOf(declared, name);
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
    parameterSymbols.push(parameter.op1);
    parameterElementLabels.push(
      scalar.kind === 'list' ? elementLabel(type) : undefined
    );
  }
  if ((signature.args?.length ?? 0) !== parameters.length)
    throw new Error('JS scalar fragment: helper signature arity differs');
  const body = literal.op1.canonical;
  let capture: ScalarFragmentCapture | undefined;
  const captureSymbols = new Set<Expression>();
  const check = (node: Expression, root = false): void => {
    refuseListHead(node, admission);
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
      if (registry) {
        if (!recordCapture(registry, node))
          throw new Error(
            `JS scalar fragment: unsupported helper capture ${node.symbol}`
          );
        return;
      }
      const snapshot = numericSnapshot(node);
      if (snapshot === undefined)
        throw new Error(
          `JS scalar fragment: unsupported helper capture ${node.symbol}`
        );
      if (
        capture &&
        !capture.symbols.has(node) &&
        [...capture.symbols][0].valueDefinition !== snapshot.binding
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
    // A call of another helper, on the structured route. A library head
    // that the route does not admit reaches the refusal below.
    if (
      named !== undefined &&
      registry !== undefined &&
      isFunction(node) &&
      !admission.heads.has(node.operator) &&
      !isLibraryOperator(node, node.operator)
    ) {
      collectStructuredHelper(node, target, named, admission);
      for (const operand of node.ops) check(operand);
      return;
    }
    // A `Loop` is a statement of the body of a root `Function`, not of a
    // helper body.
    if (
      !isFunction(node) ||
      node.operator === 'Loop' ||
      !isAdmittedOperator(node, admission) ||
      !(
        (admission.structured &&
          node.operator !== 'Negate' &&
          node.operator !== 'If' &&
          admission.heads.has(node.operator)) ||
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
    for (const operand of node.ops) check(operand);
  };
  check(body, true);
  return {
    name: call.operator,
    literal,
    body,
    binding,
    capture,
    resultRepresentation: representation(result)!,
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
