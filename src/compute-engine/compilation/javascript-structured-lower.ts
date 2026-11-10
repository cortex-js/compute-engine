/**
 * The lowering of a prepared program of the internal scalar JavaScript
 * fragment target to the structured representation
 * (`structured-ir.ts`), verified with the policy of JavaScript
 * (`javascript-structured-policy.ts`).
 *
 * The lowering reads the prepared tree and the facts that the preparation
 * recorded: the annotation of `typeFragment()` (types, representations,
 * conversions, bindings), the inputs, and an effect fact per prepared node
 * (`StructuredPreparation`). It reads nothing else about an expression: no
 * type of the engine, no evaluation, no lookup of a symbol in the engine and
 * no compilation. A missing fact throws.
 *
 * It follows the prepared tree: the operands of a node are lowered in their
 * order, and each occurrence of a node is lowered separately, also when two
 * occurrences are the same boxed node. A conversion that the annotation
 * records for an operand is an operation that follows the operand, in the
 * region where the operand is evaluated. A local with one assignment is the
 * value of its initializer, which is evaluated where it is declared; each
 * read of the local is that value.
 *
 * A read of a binding that the admission captured is a capture read
 * (`IRCaptureRead`) of its snapshot. A helper is lowered once, at its first
 * call, as a function of the program; a call of a helper in the body of
 * another helper lowers the called helper first.
 *
 * A write to a local (`Assign`) makes a new value, and each later read on
 * its path is that value: no operation writes a named variable. An `If`
 * statement whose branches write locals has one result per local that a
 * branch writes and that a later statement reads: the merged value. A
 * branch that does not write the local yields its value before the `If`.
 * A local that no later statement reads is not merged; a read of it after
 * the `If` throws. An `If` statement with no merged value and no effect is
 * not lowered.
 *
 * A `Loop` over `Element(k, Range(a, b))` is a `loop` whose bounds are
 * evaluated once, before it. A local declared outside the loop and written
 * in its body is a carried value when a later statement reads it, or when
 * the body reads it before it writes it in the same iteration; its
 * parameter in the body is its value at the start of an iteration, and the
 * result of the loop is its value after the loop. A local written in the
 * body that is not carried has no value at the start of an iteration and
 * after the loop: a read of it there throws. A local declared in the body
 * is a value of the body region.
 *
 * A `Break` with no value, the last statement of a branch of an `If`
 * statement in the body of a `Loop`, is an `exit` of the innermost loop
 * whose operands are the current values of the carried locals of that
 * loop: after the loop, each local has the value that it had at the
 * `Break`. A branch that ends in `Break` is closed: the results of its `If`
 * are the values of the other branch.
 *
 * A list input or a list parameter of a helper is a value of a list type;
 * `At` and `Length` of it are the operations `at` and `length`.
 * `Comprehension` over a range is a `build`, `ReplaceAt` a `replace-at`. A
 * list can be the value of a local, a carried value, the value of an `If`,
 * of a helper and of the program; a list of integers and a list of reals
 * merge to a list of reals, as an integer and a real merge to a real. The
 * admission keeps a list out of every arithmetic operand.
 */
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { declareValueOperand } from './compile-declarations.js';
import { exactRationalDivisor } from './compiler-type-facts.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type {
  FragmentAnnotation,
  FragmentConversion,
  FragmentScope,
  FragmentValueFacts,
} from './fragment.js';
import type { ScalarRepresentation } from './javascript-fragment-facts.js';
import {
  exitsIn,
  joinEffects,
  operationCanAbort,
  type EffectFact,
  type IRCapture,
  type IRFunction,
  type IRInput,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type ScalarKind,
  type ValueType,
  type BinaryFunctionName,
  type UnaryFunctionName,
} from './structured-ir.js';
import { verifyJavaScriptProgram } from './javascript-structured-policy.js';
import { isShadowedSymbol } from '../library-shadowing.js';

export type StructuredInput = IRInput;

/**
 * The form of a `Power` or `Abs` node that the rule of its head admitted
 * (`javascript-fragment-target.ts`), recorded during the annotation:
 *
 * - `square`, `exp`, `three-halves`: the forms of `powerForm()`.
 * - `abs`: `Abs` written as the function `abs`.
 * - `abs-identity`: `Abs` of a real operand that the existing emitter proves
 *   non-negative, written as the operand itself, as that emitter writes it
 *   (`identityPassthrough()`): `-0` stays `-0`.
 */
export type StructuredForm =
  'square' | 'exp' | 'three-halves' | 'abs' | 'abs-identity';

/**
 * A binding of the engine that the program reads and does not bind, with
 * the value that the admission found in it (a finite real number). The
 * compiled code holds that value: a later change of the binding does not
 * change the code.
 */
export type StructuredCapture = {
  /** The identity of the binding: the value definition of the engine. */
  readonly binding: object;
  readonly name: string;
  /** The symbol nodes of the prepared tree that read the binding. */
  readonly symbols: ReadonlySet<Expression>;
  /** The value of the binding at the admission. */
  readonly value: number;
  /** Throw when the binding or its value changed after the admission. */
  readonly assertCurrent: () => void;
};

/** The facts that the preparation of the structured route records, and
 *  that the lowering reads. */
export type StructuredPreparation = {
  /** The prepared root: the body of the root function, or the expression. */
  readonly root: Expression;
  /** The root `Function` literal whose body is `root`, if any. */
  readonly functionRoot?: Expression;
  readonly annotation: FragmentAnnotation<ScalarRepresentation>;
  /** The resolved helpers, by name. The key of each in
   *  `annotation.functions` is its name. A helper can call another one;
   *  the admission refuses recursion. */
  readonly helpers: ReadonlyMap<
    string,
    {
      readonly name: string;
      readonly body: Expression;
      /** `IRFunction.parameterElementLabels`. */
      readonly parameterElementLabels?: readonly (string | undefined)[];
    }
  >;
  /** The bindings that the program reads as snapshots, in the order of
   *  their admission. */
  readonly captures: readonly StructuredCapture[];
  /** The parameters of the root function in order, or the free symbols of
   *  the expression in the order of their first read. */
  readonly inputs: readonly StructuredInput[];
  /** The effect fact of each prepared node that the annotation types. */
  readonly effects: ReadonlyMap<Expression, EffectFact>;
  /** For tests only: the heads that lower to the trace operation, with the
   *  trace id of each. */
  readonly testOperations: ReadonlyMap<string, string>;
  /** The form that the rule of its head chose for each `Power` and `Abs`
   *  node (`StructuredForm`). The lowering reads it, and no fact of the
   *  engine; a node of these heads with no form is an error. */
  readonly forms: ReadonlyMap<Expression, StructuredForm>;
  readonly numericPolicy: 'strict' | 'complex';
  /** The iteration budget of the compilation (`CompileTarget.iterationBudget`),
   *  recorded on each `loop`. */
  readonly iterationBudget?: number;
};

const PREPARATIONS = new WeakMap<
  CompileTarget<Expression>,
  StructuredPreparation
>();

/** Record the preparation of the structured route on its prepared target. */
export function recordStructuredPreparation(
  target: CompileTarget<Expression>,
  preparation: StructuredPreparation
): void {
  PREPARATIONS.set(target, preparation);
}

/** The preparation recorded on `target`. Throws when there is none. */
export function structuredPreparationOf(
  target: CompileTarget<Expression>
): StructuredPreparation {
  const preparation = PREPARATIONS.get(target);
  if (preparation === undefined)
    throw new Error(
      'JS structured lowering: the target holds no structured preparation'
    );
  return preparation;
}

const fail = (message: string): never => {
  throw new Error(`JS structured lowering: ${message}`);
};

/** The operations of the operators that map one to one. */
const OPERATIONS: Readonly<
  Record<
    string,
    | 'add'
    | 'negate'
    | 'multiply'
    | 'less'
    | 'less-equal'
    | 'equal'
    | 'not-equal'
    | 'min'
    | 'max'
    | 'sqrt'
    | 'mod'
    | 'floor'
    | 'divide'
    | 'at'
    | 'length'
    | 'not'
    | 'replace-at'
  >
> = {
  // The rule of `Sqrt` (`javascript-fragment-target.ts`) records the
  // conversion of a real operand of a complex square root.
  Sqrt: 'sqrt',
  Add: 'add',
  Negate: 'negate',
  Multiply: 'multiply',
  Less: 'less',
  LessEqual: 'less-equal',
  Equal: 'equal',
  NotEqual: 'not-equal',
  Min: 'min',
  Max: 'max',
  Mod: 'mod',
  Floor: 'floor',
  Divide: 'divide',
  // The rules of `At` and `Length` (`javascript-fragment-target.ts`) admit
  // a list input or parameter and, for `At`, one integer index.
  At: 'at',
  Length: 'length',
  Not: 'not',
  // The rule of `ReplaceAt` admits a list, an integer index and a real or
  // integer element.
  ReplaceAt: 'replace-at',
};

/** The functions of one or two operands, by the head of the library that
 *  applies them. `Exp(x)` has no head of its own: the canonical form
 *  writes it `Power(ExponentialE, x)` (`powerForm()`). */
const FUNCTIONS: Readonly<
  Record<
    string,
    | { readonly kind: 'unary'; readonly fn: UnaryFunctionName }
    | { readonly kind: 'binary'; readonly fn: BinaryFunctionName }
  >
> = {
  Ln: { kind: 'unary', fn: 'ln' },
  Sin: { kind: 'unary', fn: 'sin' },
  Cos: { kind: 'unary', fn: 'cos' },
  Tanh: { kind: 'unary', fn: 'tanh' },
  Abs: { kind: 'unary', fn: 'abs' },
  Arctan2: { kind: 'binary', fn: 'atan2' },
};

/**
 * The form of the `Power` node `node` that the structured route admits, or
 * `undefined`:
 *
 * - `square`: the literal exponent 2, the product of the base with itself.
 * - `exp`: the base is the constant `ExponentialE` of the library (not a
 *   symbol of that name that a scope declares), the exponential of the
 *   exponent. The canonical form writes `Exp(x)` so.
 * - `three-halves`: the literal exponent `1.5` or `3/2`, the product of the
 *   base and its square root, the base evaluated once. The rule of `Power`
 *   admits it only for a base that it proves non-negative.
 *
 * The rule of `Power` (`javascript-fragment-target.ts`) and the lowering
 * read the form from this function, so they agree.
 */
export function powerForm(
  node: Expression
): 'square' | 'exp' | 'three-halves' | undefined {
  if (!isFunction(node, 'Power') || node.nops !== 2) return undefined;
  const [base, exponent] = node.ops;
  if (isSymbol(base, 'ExponentialE') && !isShadowedSymbol(base)) return 'exp';
  if (!isNumber(exponent) || exponent.im !== 0) return undefined;
  if (exponent.re === 2) return 'square';
  if (exponent.re === 1.5) return 'three-halves';
  return undefined;
}

function scalarKind(type: { readonly kind: string }): ScalarKind {
  if (
    type.kind === 'real' ||
    type.kind === 'integer' ||
    type.kind === 'boolean' ||
    type.kind === 'complex'
  )
    return type.kind;
  return fail(`the type ${type.kind} is not a scalar type`);
}

/** The type of a value: a scalar type, or a list of reals or of integers,
 *  whatever its length. */
function valueType(type: {
  readonly kind: string;
  readonly element?: { readonly kind: string };
}): ValueType {
  if (type.kind !== 'list') return scalarKind(type);
  const element =
    type.element === undefined ? undefined : scalarKind(type.element);
  if (element !== 'real' && element !== 'integer')
    return fail(
      `the list type of elements ${type.element?.kind} is not in the structured route`
    );
  return `list<${element}>`;
}

/** Lower and verify the program that `preparation` describes. */
export function lowerStructuredFragment(
  preparation: StructuredPreparation
): IRProgram {
  const program = lowerStructuredProgram(preparation);
  verifyJavaScriptProgram(program, preparedNodesOf(preparation));
  return program;
}

/** Lower the program that `preparation` describes, without verifying it:
 *  the caller verifies it (`lowerStructuredFragment()` does both). */
export function lowerStructuredProgram(
  preparation: StructuredPreparation
): IRProgram {
  return new Lowering(preparation).program();
}

/** The nodes that the annotation of `preparation` types, in its root
 *  scope, a nested scope or a function: the origin of each operation must
 *  be one of them. */
export function preparedNodesOf(
  preparation: StructuredPreparation
): Set<Expression> {
  const preparedNodes = new Set<Expression>();
  collectOrigins(preparation.annotation.scope, preparedNodes);
  for (const fn of preparation.annotation.functions.values())
    collectOrigins(fn.scope, preparedNodes);
  return preparedNodes;
}

class Lowering {
  private readonly owner = {};
  private readonly revision = 1;
  private nextId = 0;
  private readonly functions: IRFunction[] = [];
  private readonly functionIndex = new Map<string, number>();
  /** The helpers whose body is being lowered. */
  private readonly lowering = new Set<string>();
  private readonly captures: IRCapture[] = [];
  /** The index of each capture in `captures`, by its binding. */
  private readonly captureIndex = new Map<object, number>();
  /** The carried locals of each loop whose body is being lowered, the
   *  innermost last, and the operands of each `exit` of that loop: a
   *  `Break` reads the current value of each carried local. */
  private loops: {
    readonly carried: readonly {
      readonly binder: FragmentScope<ScalarRepresentation>;
      readonly name: string;
    }[];
    readonly exits: (readonly IRValue[])[];
  }[] = [];
  /** The value of each local and parameter, by the scope that binds it. */
  private readonly bound = new Map<
    FragmentScope<ScalarRepresentation>,
    Map<string, IRValue>
  >();

  constructor(private readonly prep: StructuredPreparation) {}

  program(): IRProgram {
    const { annotation, root } = this.prep;
    if (annotation.root !== root)
      fail('the annotation is not the annotation of the prepared root');
    const operations: IROperation[] = [];
    const value = this.value(root, annotation.scope, operations);
    return {
      owner: this.owner,
      revision: this.revision,
      inputs: this.prep.inputs,
      numericPolicy: this.prep.numericPolicy,
      captures: this.captures,
      functions: this.functions,
      root: this.region(operations, root, value),
    };
  }

  private newValue(type: ValueType, representation: ScalarRepresentation) {
    return {
      owner: this.owner,
      revision: this.revision,
      id: this.nextId++,
      type,
      representation,
    };
  }

  private resultOf(facts: FragmentValueFacts<ScalarRepresentation>): IRValue {
    return this.newValue(valueType(facts.type), facts.representation);
  }

  /** End `operations` with the yield of `value` (of each value of an
   *  array) and summarize its effects. */
  private region(
    operations: IROperation[],
    origin: Expression,
    value: IRValue | readonly IRValue[]
  ): IRRegion {
    const operands = Array.isArray(value) ? value : [value as IRValue];
    operations.push({ kind: 'yield', operands, effect: 'pure', origin });
    return this.closedRegion(operations);
  }

  /** Summarize the effects of `operations`, which end in an `exit` or an
   *  `if` whose two branches are closed, or in a yield (`region()`). */
  private closedRegion(operations: IROperation[]): IRRegion {
    const canAbort = operations.some((op) =>
      operationCanAbort(op, this.functions)
    );
    return {
      operations,
      effect: joinEffects(...operations.map((op) => op.effect)),
      ...(canAbort ? { canAbort: true as const } : {}),
    };
  }

  private facts(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>
  ): FragmentValueFacts<ScalarRepresentation> {
    const facts = scope.facts.get(node);
    if (facts === undefined || !('representation' in facts))
      return fail(`no value facts for ${node.toString()}`);
    return facts;
  }

  private effect(node: Expression): EffectFact {
    const effect = this.prep.effects.get(node);
    if (effect === undefined)
      return fail(`no effect fact for ${node.toString()}`);
    return effect;
  }

  /**
   * Apply the conversion that the facts of `node` record for an operand
   * whose value is `value`. A conversion that changes the representation is
   * an operation that follows the operand in `operations`.
   */
  private convert(
    value: IRValue,
    conversion: FragmentConversion<ScalarRepresentation> | undefined,
    node: Expression,
    operations: IROperation[]
  ): IRValue {
    if (conversion === undefined)
      return fail(`no conversion fact for an operand of ${node.toString()}`);
    if (conversion.kind === 'none') {
      if (conversion.representation !== value.representation)
        fail(
          `an identity conversion of ${node.toString()} changes the representation`
        );
      return value;
    }
    if (conversion.kind !== 'real-to-complex')
      return fail(
        `the conversion ${conversion.kind} is not in the structured route`
      );
    const result = this.newValue('complex', 'complex');
    operations.push({
      kind: 'convert',
      conversion: 'real-to-complex',
      result,
      operands: [value],
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /** The operands of `node` in order, each with its conversion. */
  private operands(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue[] {
    return node.ops.map((operand, i) =>
      this.convert(
        this.value(operand, scope, operations),
        facts.conversions?.[i],
        node,
        operations
      )
    );
  }

  /** Lower `node`, typed in `scope`, at the end of `operations`. */
  private value(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    if (isFunction(node, 'Block')) return this.block(node, scope, operations);
    const facts = this.facts(node, scope);
    if (isNumber(node) || isSymbol(node, 'True') || isSymbol(node, 'False')) {
      const result = this.resultOf(facts);
      operations.push({
        kind: 'literal',
        value: isSymbol(node)
          ? node.symbol === 'True'
          : result.representation === 'complex'
            ? { re: node.re, im: node.im }
            : node.re,
        result,
        operands: [],
        effect: this.effect(node),
        origin: node,
      });
      return result;
    }
    if (isSymbol(node)) return this.read(node, scope, operations);
    if (!isFunction(node)) return fail(`no lowering for ${node.toString()}`);

    const effect = this.effect(node);
    const operator = node.operator;

    // `Typed(value, T)` around the value of a function body: the rule of
    // `Typed` admits a value whose fact is `T`, or an integer (a list of
    // integers) for a real (a list of reals), which is a valid value of the
    // result of the function as it is.
    if (operator === 'Typed') return this.value(node.ops[0], scope, operations);

    if (operator === 'Comprehension')
      return this.build(node, facts, scope, operations, effect);

    if (operator === 'If') {
      if (node.nops !== 3) fail('an If needs a condition and two branches');
      const [condition, a, b] = node.ops;
      const test = this.convert(
        this.value(condition, scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      const branch = (operand: Expression, index: number): IRRegion => {
        const inner: IROperation[] = [];
        const v = this.convert(
          this.value(operand, scope, inner),
          facts.conversions?.[index],
          node,
          inner
        );
        return this.region(inner, operand, v);
      };
      const then = branch(a, 1);
      const otherwise = branch(b, 2);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'if',
        results: [result],
        operands: [test],
        then,
        else: otherwise,
        effect: joinEffects(effect, then.effect, otherwise.effect),
        origin: node,
      });
      return result;
    }

    if (operator === 'And' || operator === 'Or') {
      const [head, ...tail] = node.ops;
      const first = this.convert(
        this.value(head, scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      const rest = tail.map((operand, i) => {
        const inner: IROperation[] = [];
        const v = this.convert(
          this.value(operand, scope, inner),
          facts.conversions?.[i + 1],
          node,
          inner
        );
        return this.region(inner, operand, v);
      });
      const result = this.resultOf(facts);
      operations.push({
        kind: operator === 'And' ? 'and' : 'or',
        result,
        operands: [first],
        rest,
        effect: joinEffects(effect, ...rest.map((r) => r.effect)),
        origin: node,
      });
      return result;
    }

    const entry = this.prep.annotation.functions.get(operator);
    if (entry !== undefined && this.prep.helpers.has(operator)) {
      const args = this.operands(node, facts, scope, operations);
      const index = this.helper(operator, args, facts, node);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'call',
        function: index,
        result,
        operands: args,
        effect: joinEffects(effect, this.functions[index].body.effect),
        origin: node,
      });
      return result;
    }

    const trace = this.prep.testOperations.get(operator);
    if (trace !== undefined) {
      const operands = this.operands(node, facts, scope, operations);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'trace',
        trace,
        result,
        operands,
        effect,
        origin: node,
      });
      return result;
    }

    // `Power` in the form that its rule recorded (`StructuredForm`, the
    // forms of `powerForm()`). `Power(x, 2)`: the product of
    // the operand with itself; `Power(x, 1.5)`: the product of the operand
    // and its square root. The operand is evaluated once, and the literal
    // exponent has no operation. `Power(ExponentialE, x)`: the function
    // `exp` of the exponent, whose conversion is the first one of the facts
    // (the rule of `Power` types no base for this form).
    if (operator === 'Power') {
      const form = this.prep.forms.get(node);
      if (form === 'exp') {
        const exponent = this.convert(
          this.value(node.ops[1], scope, operations),
          facts.conversions?.[0],
          node,
          operations
        );
        const result = this.resultOf(facts);
        operations.push({
          kind: 'unary',
          fn: 'exp',
          result,
          operands: [exponent],
          effect,
          origin: node,
        });
        return result;
      }
      if (form !== 'square' && form !== 'three-halves')
        return fail(`no recorded form for the power ${node.toString()}`);
      const operand = this.convert(
        this.value(node.ops[0], scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      let factor = operand;
      if (form === 'three-halves') {
        factor = this.newValue('real', 'number');
        operations.push({
          kind: 'sqrt',
          result: factor,
          operands: [operand],
          effect,
          origin: node,
        });
      }
      const result = this.resultOf(facts);
      operations.push({
        kind: 'multiply',
        result,
        operands: [operand, factor],
        effect,
        origin: node,
      });
      return result;
    }

    const fn = Object.hasOwn(FUNCTIONS, operator)
      ? FUNCTIONS[operator]
      : undefined;
    if (fn !== undefined) {
      // `Abs` of an operand that the existing emitter proves non-negative
      // is the operand itself (`abs-identity`).
      const form = operator === 'Abs' ? this.prep.forms.get(node) : 'abs';
      if (form !== 'abs' && form !== 'abs-identity')
        return fail(`no recorded form for ${node.toString()}`);
      const operands = this.operands(node, facts, scope, operations);
      if (form === 'abs-identity') return operands[0];
      const result = this.resultOf(facts);
      operations.push(
        fn.kind === 'unary'
          ? { kind: 'unary', fn: fn.fn, result, operands, effect, origin: node }
          : {
              kind: 'binary',
              fn: fn.fn,
              result,
              operands,
              effect,
              origin: node,
            }
      );
      return result;
    }

    if (
      operator === 'Multiply' &&
      facts.representation !== 'complex' &&
      node.ops.some((op) => exactRationalDivisor(op) !== undefined)
    )
      return this.multiplyByRational(node, facts, scope, operations, effect);

    const kind = Object.hasOwn(OPERATIONS, operator)
      ? OPERATIONS[operator]
      : undefined;
    if (kind === undefined) return fail(`no lowering for the head ${operator}`);
    const operands = this.operands(node, facts, scope, operations);
    const result = this.resultOf(facts);
    operations.push({ kind, result, operands, effect, origin: node });
    return result;
  }

  /**
   * `Comprehension(body, Element(j, Range(a, b)))`, which the rule of
   * `Comprehension` checked: a `build` whose bounds are the values of `a`
   * and `b`, evaluated here, before it, and whose body region has the index
   * `j` as its parameter and yields the value of `body`. The index is bound
   * in the scope of the comprehension.
   */
  private build(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const [body, spec] = node.ops;
    const inner = scope.inner.get(node);
    if (
      inner === undefined ||
      node.ops.length !== 2 ||
      !isFunction(spec, 'Element') ||
      spec.nops !== 2 ||
      !isSymbol(spec.op1) ||
      !isFunction(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      return fail(`no lowering for the comprehension ${node.toString()}`);
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${b.toString()} of a comprehension is not an integer`);
      return value;
    };
    const from = bound(spec.op2.op1);
    const to = bound(spec.op2.op2);
    const index = this.newValue('integer', 'number');
    this.bound.set(inner, new Map([[spec.op1.symbol, index]]));
    const bodyOperations: IROperation[] = [];
    const element = this.value(body, inner, bodyOperations);
    const region: IRRegion = {
      ...this.region(bodyOperations, body, element),
      parameters: [index],
    };
    const result = this.resultOf(facts);
    operations.push({
      kind: 'build',
      result,
      operands: [from, to],
      body: region,
      effect: joinEffects(effect, region.effect),
      origin: node,
    });
    return result;
  }

  /**
   * A product with an exact rational factor `p/q` (`exactRationalDivisor()`:
   * `q` is not 1 nor a power of two), lowered as the existing emitter
   * writes it (`Multiply` in `compile-operators.ts`): the product of the
   * other factors, in order, divided by `q`, then multiplied by `p` when `p`
   * is not 1, or negated when `p` is -1. So `Multiply(1/49, k)` is
   * `k / 49`, `Multiply(29/50, n)` is `n / 50 * 29` and `Multiply(2/3, x,
   * y)` is `x * y / 3 * 2`. A division is correctly rounded, so `k / 49` is
   * exactly 1 at `k = 49`, where the product by the rounded `1/49` is
   * `0.9999999999999999`. The first such factor is the divisor; another
   * rational factor is a number literal of the product.
   */
  private multiplyByRational(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const index = node.ops.findIndex(
      (op) => exactRationalDivisor(op) !== undefined
    );
    const rational = node.ops[index];
    const { p, q } = exactRationalDivisor(rational)!;
    const factors = node.ops.flatMap((operand, i) =>
      i === index
        ? []
        : [
            this.convert(
              this.value(operand, scope, operations),
              facts.conversions?.[i],
              node,
              operations
            ),
          ]
    );
    const literal = (value: number): IRValue => {
      const result = this.newValue('integer', 'number');
      operations.push({
        kind: 'literal',
        value,
        result,
        operands: [],
        effect: 'pure',
        origin: rational,
      });
      return result;
    };
    const push = (
      kind: 'multiply' | 'divide' | 'negate',
      operands: IRValue[],
      result: IRValue
    ): IRValue => {
      operations.push({ kind, result, operands, effect, origin: node });
      return result;
    };
    const numerator =
      factors.length > 1
        ? push(
            'multiply',
            factors,
            this.newValue(
              factors.every((f) => f.type === 'integer') ? 'integer' : 'real',
              'number'
            )
          )
        : factors[0];
    const quotient = push(
      'divide',
      [numerator, literal(q)],
      this.newValue('real', 'number')
    );
    if (p === 1) return quotient;
    if (p === -1)
      return push('negate', [quotient], this.newValue('real', 'number'));
    return push(
      'multiply',
      [quotient, literal(p)],
      this.newValue('real', 'number')
    );
  }

  /**
   * A read of a name, in the scope that binds it: a local or a parameter
   * is its value; an input of the program is a read of the input at this
   * position.
   */
  private read(
    node: Expression & { symbol: string },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const name = node.symbol;
    for (
      let s: FragmentScope<ScalarRepresentation> | undefined = scope;
      s;
      s = s.parent
    ) {
      if (!s.bindings.has(name)) continue;
      const value = this.bound.get(s)?.get(name);
      if (value !== undefined) return value;
      if (s !== this.prep.annotation.scope)
        return fail(`the name ${name} is read before its value is lowered`);
      const facts = this.facts(node, scope);
      const input = this.prep.inputs.findIndex((i) => i.name === name);
      if (input < 0) return fail(`the name ${name} is not an input`);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'input',
        input,
        result,
        operands: [],
        effect: this.effect(node),
        origin: node,
      });
      return result;
    }
    return this.captureRead(node, scope, operations);
  }

  /**
   * A read of a name that no scope binds: a binding that the admission
   * captured, read as its snapshot. The facts of the node are the facts of
   * the snapshot value (`FragmentDefinition.storedValue`).
   */
  private captureRead(
    node: Expression & { symbol: string },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const capture = this.prep.captures.find((c) => c.symbols.has(node));
    if (capture === undefined)
      return fail(`no binding for the name ${node.symbol}`);
    const facts = this.facts(node, scope);
    const result = this.resultOf(facts);
    let index = this.captureIndex.get(capture.binding);
    if (index === undefined) {
      index = this.captures.length;
      this.captures.push({
        binding: capture.binding,
        name: capture.name,
        type: scalarKind(facts.type),
        representation: result.representation,
        snapshot: capture.value,
      });
      this.captureIndex.set(capture.binding, index);
    }
    operations.push({
      kind: 'capture',
      capture: index,
      binding: capture.binding,
      snapshot: capture.value,
      result,
      operands: [],
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /**
   * A block that has a value: its statements in order (`statement()`),
   * then its last statement, which is the value of the block.
   */
  private block(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const inner = scope.inner.get(node);
    if (inner === undefined) return fail('no scope for a block');
    if (node.ops.length === 0) return fail('an empty block has no value');
    const last = node.ops[node.ops.length - 1];
    if (this.statements(node.ops.slice(0, -1), inner, operations, namesIn(last)))
      fail('a statement of a block that has a value is a Break');
    return this.value(last, inner, operations);
  }

  /**
   * The statements `statements`, in order, in `scope`. `liveOut`: the
   * names that the code after the statements can read. True when the last
   * statement closes the region (`statement()`).
   */
  private statements(
    statements: readonly Expression[],
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): boolean {
    // The names that the code after the statement `i` can read: the names
    // in the statements after it, and `liveOut`. A name that a later
    // statement writes before it reads it counts too: the set is larger
    // than needed, never smaller.
    const live: ReadonlySet<string>[] = [];
    let after = new Set(liveOut);
    for (let i = statements.length - 1; i >= 0; i--) {
      live[i] = after;
      after = new Set([...after, ...namesIn(statements[i])]);
    }
    let closed = false;
    statements.forEach((s, i) => {
      if (closed) fail('a statement follows a Break');
      closed = this.statement(s, scope, operations, live[i]);
    });
    return closed;
  }

  /**
   * A statement: a `Declare` binds its local to the value of its
   * initializer (`Declare(t, type, value)`, or `Declare(t, {value: …})`,
   * the form of a `let`); an `Assign` gives the local a new value; an `If`
   * statement merges the values of the locals that its branches write; a
   * `Loop` carries the values of the locals that its body writes
   * (`loopStatement()`); a `Block` (a branch of an `If`, the body of a
   * `Loop`) is its statements; a `Break` is an `exit` of the innermost loop.
   * The admission of the structured route admits no other statement.
   *
   * True when the statement closes the region: a `Break`, an `If` whose two
   * branches close, or a `Block` whose last statement closes.
   */
  private statement(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): boolean {
    const initializer = isFunction(node, 'Declare')
      ? declareValueOperand(node.ops)
      : undefined;
    if (
      isFunction(node, 'Declare') &&
      initializer !== undefined &&
      isSymbol(node.op1)
    ) {
      const name = node.op1.symbol;
      const binding = scope.bindings.get(name);
      const value = this.value(initializer, scope, operations);
      if (
        binding === undefined ||
        !('representation' in binding) ||
        binding.representation !== value.representation
      )
        fail(
          `the local ${name} has no binding of the representation of its value`
        );
      let locals = this.bound.get(scope);
      if (locals === undefined) this.bound.set(scope, (locals = new Map()));
      locals.set(name, value);
      return false;
    }
    if (isFunction(node, 'Assign') && node.nops === 2 && isSymbol(node.op1)) {
      const name = node.op1.symbol;
      const value = this.value(node.op2, scope, operations);
      const binder = bindingScope(scope, name);
      const locals = binder === undefined ? undefined : this.bound.get(binder);
      const binding = binder?.bindings.get(name);
      // The admission and the pass refuse a write to a name that is not a
      // local; an input of the program is bound in the root scope. A local
      // can have no value before the write: a local that a loop body writes
      // and does not carry (`loopStatement()`).
      if (
        locals === undefined ||
        binder === this.prep.annotation.scope ||
        binding === undefined
      )
        return fail(`the name ${name} is not a declared local`);
      if (
        !('representation' in binding) ||
        binding.representation !== value.representation
      )
        fail(`a write to the local ${name} changes its representation`);
      locals.set(name, value);
      return false;
    }
    if (isFunction(node, 'If') && (node.nops === 2 || node.nops === 3))
      return this.ifStatement(node, scope, operations, liveOut);
    if (isFunction(node, 'Loop') && node.nops === 2) {
      this.loopStatement(node, scope, operations, liveOut);
      return false;
    }
    if (isFunction(node, 'Block')) {
      const inner = scope.inner.get(node);
      if (inner === undefined) return fail('no scope for a block');
      return this.statements(node.ops, inner, operations, liveOut);
    }
    if (isFunction(node, 'Break') && node.nops === 0) {
      const loop = this.loops[this.loops.length - 1];
      if (loop === undefined) return fail('a Break outside a loop');
      const operands = loop.carried.map(
        ({ binder, name }) =>
          this.bound.get(binder)?.get(name) ??
          fail(`the carried local ${name} has no value at a Break`)
      );
      loop.exits.push(operands);
      operations.push({ kind: 'exit', operands, effect: 'pure', origin: node });
      return true;
    }
    return fail(`no lowering for the statement ${node.toString()}`);
  }

  /**
   * An `If` statement: an `if` whose results are the merged values of the
   * locals that a branch writes and that `liveOut` names, in the order of
   * their bindings. The `If` itself has no effect: its effect is the one
   * of its regions. A write to a local is not an effect: it makes a value.
   *
   * A branch that ends in `Break` is closed: the values of the locals after
   * the `If` are those of the other branch, and the closed branch yields
   * nothing. When both branches are closed, the `if` has no result and
   * closes the region (true).
   */
  private ifStatement(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): boolean {
    // The operations of the condition, kept apart until the `If` is known
    // to be lowered.
    const condition: IROperation[] = [];
    const test = this.value(node.ops[0], scope, condition);
    const before = this.snapshot();
    const branch = (statement: Expression | undefined) => {
      this.restore(before);
      const inner: IROperation[] = [];
      const closed =
        statement !== undefined &&
        this.statement(statement, scope, inner, liveOut);
      return { operations: inner, values: this.snapshot(), closed };
    };
    const a = branch(node.ops[1]);
    const b = branch(node.ops[2]);
    this.restore(before);
    if (a.closed && b.closed) {
      const then = this.closedRegion(a.operations);
      const otherwise = this.closedRegion(b.operations);
      operations.push(...condition, {
        kind: 'if',
        results: [],
        operands: [test],
        then,
        else: otherwise,
        effect: joinEffects(then.effect, otherwise.effect),
        origin: node,
      });
      return true;
    }
    // The values after the `If` of each branch: those of the other branch
    // for a closed branch, which does not reach the code after the `If`.
    const thenValues = a.closed ? b.values : a.values;
    const elseValues = b.closed ? a.values : b.values;
    // The locals to merge, with their values before the `If` and in each
    // branch.
    const merged: {
      locals: Map<string, IRValue>;
      name: string;
      then: IRValue;
      else: IRValue;
    }[] = [];
    // The names of each scope that has values before the `If`: a name with
    // no value before it (a local that a loop body writes and does not
    // carry, `loopStatement()`) has a value after it when both branches
    // write it. A scope that a branch opens is not visible after the `If`.
    for (const [binder, locals] of before)
      for (const name of new Set([
        ...locals.keys(),
        ...(thenValues.get(binder)?.keys() ?? []),
        ...(elseValues.get(binder)?.keys() ?? []),
      ])) {
        const value = locals.get(name);
        const then = thenValues.get(binder)?.get(name);
        const otherwise = elseValues.get(binder)?.get(name);
        if (then === value && otherwise === value) continue;
        const target = this.bound.get(binder)!;
        // A local that no later statement reads has no value after the
        // `If`: a read of it throws. A local with no value after a branch
        // is such a local: a nested `If` of the branch removed it, and its
        // later statements are the ones of this `If`.
        if (then === undefined || otherwise === undefined || !liveOut.has(name))
          target.delete(name);
        else merged.push({ locals: target, name, then, else: otherwise });
      }
    // The merged value has the type of both branches, or is `real` for an
    // integer and a real value (a list of reals for a list of integers and
    // a list of reals).
    const results = merged.map((m) => {
      const type =
        widerType(m.then.type, m.else.type) ??
        fail(
          `the local ${m.name} has the type ${m.then.type} in one branch and ${m.else.type} in the other`
        );
      return this.newValue(type, m.then.representation as ScalarRepresentation);
    });
    merged.forEach((m, i) => m.locals.set(m.name, results[i]));
    const then = a.closed
      ? this.closedRegion(a.operations)
      : this.region(
          a.operations,
          node.ops[1],
          merged.map((m) => m.then)
        );
    const otherwise = b.closed
      ? this.closedRegion(b.operations)
      : this.region(
          b.operations,
          node.ops[2] ?? node,
          merged.map((m) => m.else)
        );
    // An `If` with no result and no effect has nothing to give: it is
    // not lowered, and its condition is lowered only when it has an effect
    // (with the pure operations that the effect reads). A branch that can
    // abort (a loop with an iteration budget) keeps the `If`, and so does a
    // branch that holds an `exit`, at any depth: the exit decides which
    // operations run after the `If`.
    if (
      exitsIn(then).length === 0 &&
      exitsIn(otherwise).length === 0 &&
      results.length === 0 &&
      joinEffects(then.effect, otherwise.effect) === 'pure' &&
      then.canAbort !== true &&
      otherwise.canAbort !== true
    ) {
      if (joinEffects(...condition.map((op) => op.effect)) !== 'pure')
        operations.push(...condition);
      return false;
    }
    operations.push(...condition);
    operations.push({
      kind: 'if',
      results,
      operands: [test],
      then,
      else: otherwise,
      effect: joinEffects(then.effect, otherwise.effect),
      origin: node,
    });
    return false;
  }

  /**
   * A `Loop` statement over `Element(k, Range(a, b))`, which the admission
   * of the structured route checked: a `loop` whose operands are the values
   * of `a` and `b`, evaluated here, before the loop, and the value before
   * the loop of each carried local.
   *
   * The carried locals are the locals declared outside the loop that the
   * body writes, and that `liveOut` names or that the body reads before it
   * writes them in an iteration (`exposedReads()`), in the order of their
   * bindings. The parameter of a carried local has the type of its value
   * before the loop; when the body yields a real value for an integer
   * parameter, the body is lowered again with a real parameter, as the two
   * values of an `If` merge to `real`, until no parameter changes (each
   * pass but the last makes at least one more parameter real, so there are
   * at most one pass per carried local, and one more). A local that the body writes and
   * does not carry has no value at the start of the body and after the
   * loop. The index is bound in the scope of the loop.
   *
   * A `Break` of the body passes the current value of each carried local to
   * the result of the loop (an `exit`); a real value there makes the
   * parameter real too, as a real next value does. A body that always
   * exits throws: the admission refuses it.
   */
  private loopStatement(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): void {
    const [body, spec] = node.ops;
    const loopScope = scope.inner.get(node);
    if (
      loopScope === undefined ||
      !isFunction(spec, 'Element') ||
      spec.nops !== 2 ||
      !isSymbol(spec.op1) ||
      !isFunction(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      return fail(`no lowering for the loop ${node.toString()}`);
    const index = spec.op1.symbol;
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${b.toString()} of a loop is not an integer`);
      return value;
    };
    const from = bound(spec.op2.op1);
    const to = bound(spec.op2.op2);

    // The locals of the scopes around the loop that the body writes.
    const written = assignedNames(body);
    const candidates: {
      binder: FragmentScope<ScalarRepresentation>;
      name: string;
    }[] = [];
    for (const name of written) {
      const binder = bindingScope(scope, name);
      if (binder !== undefined && this.bound.get(binder)?.has(name))
        candidates.push({ binder, name });
    }
    const exposed = exposedReads(body);
    const carried = candidates.filter(
      ({ name }) => liveOut.has(name) || exposed.has(name)
    );
    const initial = carried.map(({ binder, name }) =>
      this.bound.get(binder)!.get(name)!
    );
    const carriedNames = new Set(carried.map((c) => c.name));

    const before = this.snapshot();
    let types = initial.map((v) => v.type);
    for (let pass = 0; ; pass++) {
      this.restore(before);
      const indexValue = this.newValue('integer', 'number');
      const parameters = carried.map((c, i) =>
        this.newValue(
          types[i],
          initial[i].representation as ScalarRepresentation
        )
      );
      for (const { binder, name } of candidates)
        this.bound.get(binder)!.delete(name);
      carried.forEach(({ binder, name }, i) =>
        this.bound.get(binder)!.set(name, parameters[i])
      );
      this.bound.set(loopScope, new Map([[index, indexValue]]));
      const inner: IROperation[] = [];
      const context = { carried, exits: [] as (readonly IRValue[])[] };
      this.loops.push(context);
      let closed: boolean;
      try {
        closed = this.statement(body, loopScope, inner, carriedNames);
      } finally {
        this.loops.pop();
      }
      if (closed) fail('the body of a loop always exits');
      const next = carried.map(({ binder, name }) => {
        const value = this.bound.get(binder)?.get(name);
        if (value === undefined)
          return fail(
            `the carried local ${name} has no value at the end of the loop body`
          );
        return value;
      });
      // A real next value of an integer parameter: lower the body again
      // with a real parameter. A parameter that is real is never changed.
      const widened = next.map((v, i) =>
        [v, ...context.exits.map((exit) => exit[i])].reduce<ValueType>(
          (type, value) =>
            widerType(type, value.type) ??
            fail(
              `the carried local ${carried[i].name} has the type ${types[i]} before the loop and ${value.type} in its body`
            ),
          types[i]
        )
      );
      if (widened.some((t, i) => t !== types[i])) {
        if (pass >= carried.length)
          fail('the types of the carried locals of a loop do not settle');
        types = widened;
        continue;
      }
      const region: IRRegion = {
        ...this.region(inner, body, next),
        parameters: [indexValue, ...parameters],
      };
      this.restore(before);
      const results = parameters.map((p) =>
        this.newValue(p.type, p.representation as ScalarRepresentation)
      );
      for (const { binder, name } of candidates)
        this.bound.get(binder)!.delete(name);
      carried.forEach(({ binder, name }, i) =>
        this.bound.get(binder)!.set(name, results[i])
      );
      operations.push({
        kind: 'loop',
        results,
        operands: [from, to, ...initial],
        body: region,
        effect: region.effect,
        iterationBudget: this.prep.iterationBudget,
        origin: node,
      });
      return;
    }
  }

  /** The value of each local and parameter, copied. */
  private snapshot(): Map<
    FragmentScope<ScalarRepresentation>,
    Map<string, IRValue>
  > {
    return new Map(
      [...this.bound].map(([scope, locals]) => [scope, new Map(locals)])
    );
  }

  /** Make the values of `snapshot` the values of the locals again. A
   *  scope that has no values in `snapshot` has none after. */
  private restore(
    snapshot: ReadonlyMap<
      FragmentScope<ScalarRepresentation>,
      ReadonlyMap<string, IRValue>
    >
  ): void {
    this.bound.clear();
    for (const [scope, locals] of snapshot)
      this.bound.set(scope, new Map(locals));
  }

  /**
   * The index of the function of the helper `name`, lowered once, at its
   * first call, whatever the number of its calls. A call in its body of
   * another helper lowers that helper first, so a function of the program
   * calls only functions of a lower index. Its parameters have the types
   * and representations that the conversions of the call record (the
   * admission requires identity conversions), and its result the
   * representation of the call. A helper that calls itself, directly or
   * through other helpers, throws: the admission refuses it.
   */
  private helper(
    name: string,
    args: readonly IRValue[],
    facts: FragmentValueFacts<ScalarRepresentation>,
    node: Expression
  ): number {
    const known = this.functionIndex.get(name);
    if (known !== undefined) return known;
    if (this.lowering.has(name)) return fail(`the helper ${name} calls itself`);
    const entry = this.prep.annotation.functions.get(name)!;
    if (
      entry.type.kind !== 'function' ||
      entry.body !== this.prep.helpers.get(name)?.body
    )
      return fail(`the helper ${name} has no function facts`);
    const conversions = facts.conversions ?? [];
    if (
      conversions.length !== args.length ||
      entry.type.parameters.length !== args.length
    )
      fail(`a call of ${name} does not match its parameters`);
    const parameters = entry.type.parameters.map((p, i) =>
      this.newValue(valueType(p.type), conversions[i].representation)
    );
    this.bound.set(
      entry.scope,
      new Map(entry.type.parameters.map((p, i) => [p.name, parameters[i]]))
    );
    const operations: IROperation[] = [];
    this.lowering.add(name);
    // A `Break` of the helper leaves a loop of the helper, never a loop of
    // the code that calls it.
    const loops = this.loops;
    this.loops = [];
    const value = this.value(entry.body, entry.scope, operations);
    this.loops = loops;
    this.lowering.delete(name);
    const result = {
      type: valueType(entry.type.result),
      representation: facts.representation,
    };
    if (value.representation !== result.representation)
      fail(
        `the body of ${name} does not have the representation of its result`
      );
    const labels = this.prep.helpers.get(name)!.parameterElementLabels;
    this.functions.push({
      name,
      parameters,
      ...(labels?.some((l) => l !== undefined)
        ? { parameterElementLabels: labels }
        : {}),
      result,
      body: this.region(operations, entry.body, value),
      origin: node,
    });
    this.functionIndex.set(name, this.functions.length - 1);
    return this.functions.length - 1;
  }
}

/** The type that holds a value of the type `a` and a value of the type
 *  `b`: the type of both, `real` for an integer and a real, a list of reals
 *  for a list of integers and a list of reals; otherwise `undefined`. */
function widerType(a: ValueType, b: ValueType): ValueType | undefined {
  if (a === b) return a;
  const pair = new Set([a, b]);
  if (pair.has('integer') && pair.has('real')) return 'real';
  if (pair.has('list<integer>') && pair.has('list<real>')) return 'list<real>';
  return undefined;
}

/** Every node that has facts in `scope` or in a scope nested in it, and
 *  every statement that the pass checked there. */
function collectOrigins(
  scope: FragmentScope<ScalarRepresentation>,
  origins: Set<Expression>
): void {
  for (const node of scope.facts.keys()) origins.add(node);
  for (const node of scope.statements) origins.add(node);
  for (const inner of scope.inner.values()) collectOrigins(inner, origins);
}

/** The scope that binds `name`, from `scope` outward. */
function bindingScope(
  scope: FragmentScope<ScalarRepresentation>,
  name: string
): FragmentScope<ScalarRepresentation> | undefined {
  for (
    let s: FragmentScope<ScalarRepresentation> | undefined = scope;
    s;
    s = s.parent
  )
    if (s.bindings.has(name)) return s;
  return undefined;
}

/** The names that an `Assign` of `statement` writes, in a nested block,
 *  branch or loop too. */
function assignedNames(
  statement: Expression,
  names = new Set<string>()
): Set<string> {
  if (!isFunction(statement)) return names;
  if (statement.operator === 'Assign' && isSymbol(statement.op1))
    names.add(statement.op1.symbol);
  else if (statement.operator === 'Block' || statement.operator === 'If')
    for (const s of statement.ops) assignedNames(s, names);
  else if (statement.operator === 'Loop') assignedNames(statement.op1, names);
  return names;
}

/**
 * The names that `statement` can read before it writes them, when it runs
 * from its start: a read on a path where no earlier statement of the path
 * wrote the name. After an `If`, a name is written when both branches write
 * it; after a `Loop`, the names that its body writes are not written,
 * because the body can run no time. A read in the body of a nested `Loop`
 * counts when no statement before it in the body, nor before the loop,
 * writes the name. The admission of the structured route admits the
 * statements `Block`, `Declare`, `Assign`, `If` and `Loop`; any other node
 * is read as an expression.
 */
function exposedReads(statement: Expression): Set<string> {
  const exposed = new Set<string>();
  const reads = (
    node: Expression | undefined,
    written: ReadonlySet<string>
  ) => {
    if (node === undefined) return;
    for (const name of namesIn(node)) if (!written.has(name)) exposed.add(name);
  };
  const visit = (node: Expression, written: Set<string>): Set<string> => {
    if (!isFunction(node)) {
      reads(node, written);
      return written;
    }
    switch (node.operator) {
      case 'Block':
        return node.ops.reduce((w, s) => visit(s, w), written);
      case 'Declare':
        reads(declareValueOperand(node.ops), written);
        return isSymbol(node.op1)
          ? new Set([...written, node.op1.symbol])
          : written;
      case 'Assign':
        reads(node.op2, written);
        return isSymbol(node.op1)
          ? new Set([...written, node.op1.symbol])
          : written;
      case 'If': {
        reads(node.op1, written);
        const a = visit(node.op2, new Set(written));
        const b = node.nops === 3 ? visit(node.op3, new Set(written)) : written;
        return new Set([...a].filter((name) => b.has(name)));
      }
      case 'Loop': {
        // The bounds, then the body, which can run no time.
        if (node.nops === 2) reads(node.op2, written);
        visit(node.op1, new Set(written));
        return written;
      }
      default:
        reads(node, written);
        return written;
    }
  };
  visit(statement, new Set());
  return exposed;
}

/** The names of the symbols of `node`, read or written. */
function namesIn(node: Expression, names = new Set<string>()): Set<string> {
  if (isSymbol(node)) names.add(node.symbol);
  else if (isFunction(node))
    for (const operand of node.ops) namesIn(operand, names);
  return names;
}
