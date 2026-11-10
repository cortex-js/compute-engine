/**
 * The lowering of a prepared program of the internal scalar JavaScript
 * fragment target to the structured representation
 * (`javascript-structured-ir.ts`).
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
 */
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
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
  joinEffects,
  verifyProgram,
  type EffectFact,
  type IRFunction,
  type IRInput,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type ScalarKind,
} from './javascript-structured-ir.js';

export type StructuredInput = IRInput;

/** The facts that the preparation of the structured route records, and
 *  that the lowering reads. */
export type StructuredPreparation = {
  /** The prepared root: the body of the root function, or the expression. */
  readonly root: Expression;
  /** The root `Function` literal whose body is `root`, if any. */
  readonly functionRoot?: Expression;
  readonly annotation: FragmentAnnotation<ScalarRepresentation>;
  /** The resolved helper. Its key in `annotation.functions` is its name. */
  readonly helper?: { readonly name: string; readonly body: Expression };
  /** The parameters of the root function in order, or the free symbols of
   *  the expression in the order of their first read. */
  readonly inputs: readonly StructuredInput[];
  /** The effect fact of each prepared node that the annotation types. */
  readonly effects: ReadonlyMap<Expression, EffectFact>;
  /** For tests only: the heads that lower to the trace operation, with the
   *  trace id of each. */
  readonly testOperations: ReadonlyMap<string, string>;
  readonly numericPolicy: 'strict' | 'complex';
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
  Record<string, 'add' | 'negate' | 'multiply' | 'less' | 'equal' | 'min' | 'max'>
> = {
  Add: 'add',
  Negate: 'negate',
  Multiply: 'multiply',
  Less: 'less',
  Equal: 'equal',
  Min: 'min',
  Max: 'max',
};

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

/** Lower and verify the program that `preparation` describes. */
export function lowerStructuredFragment(
  preparation: StructuredPreparation
): IRProgram {
  const program = lowerStructuredProgram(preparation);
  verifyProgram(program, preparedNodesOf(preparation));
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
      functions: this.functions,
      root: this.region(operations, root, value),
    };
  }

  private newValue(type: ScalarKind, representation: ScalarRepresentation) {
    return {
      owner: this.owner,
      revision: this.revision,
      id: this.nextId++,
      type,
      representation,
    };
  }

  private resultOf(facts: FragmentValueFacts<ScalarRepresentation>): IRValue {
    return this.newValue(scalarKind(facts.type), facts.representation);
  }

  /** End `operations` with the yield of `value` and summarize its effects. */
  private region(
    operations: IROperation[],
    origin: Expression,
    value: IRValue
  ): IRRegion {
    operations.push({ kind: 'yield', operands: [value], effect: 'pure', origin });
    return {
      operations,
      effect: joinEffects(...operations.map((op) => op.effect)),
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
    if (effect === undefined) return fail(`no effect fact for ${node.toString()}`);
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
        fail(`an identity conversion of ${node.toString()} changes the representation`);
      return value;
    }
    if (conversion.kind !== 'real-to-complex')
      return fail(`the conversion ${conversion.kind} is not in the structured route`);
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
        result,
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
    if (entry !== undefined && this.prep.helper?.name === operator) {
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
      operations.push({ kind: 'trace', trace, result, operands, effect, origin: node });
      return result;
    }

    const kind = Object.hasOwn(OPERATIONS, operator) ? OPERATIONS[operator] : undefined;
    if (kind === undefined) return fail(`no lowering for the head ${operator}`);
    const operands = this.operands(node, facts, scope, operations);
    const result = this.resultOf(facts);
    operations.push({ kind, result, operands, effect, origin: node });
    return result;
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
    return fail(`no binding for the name ${name}`);
  }

  /**
   * A block: each `Declare` binds its local to the value of its
   * initializer, then the last statement is the value of the block. The
   * admission of the structured route admits no other statement.
   */
  private block(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const inner = scope.inner.get(node);
    if (inner === undefined) return fail('no scope for a block');
    if (node.ops.length === 0) return fail('an empty block has no value');
    for (const statement of node.ops.slice(0, -1)) {
      if (
        !isFunction(statement, 'Declare') ||
        statement.nops !== 3 ||
        !isSymbol(statement.op1)
      )
        return fail(`no lowering for the statement ${statement.toString()}`);
      const name = statement.op1.symbol;
      const binding = inner.bindings.get(name);
      const value = this.value(statement.op3, inner, operations);
      if (
        binding === undefined ||
        !('representation' in binding) ||
        binding.representation !== value.representation
      )
        fail(`the local ${name} has no binding of the representation of its value`);
      let locals = this.bound.get(inner);
      if (locals === undefined) this.bound.set(inner, (locals = new Map()));
      locals.set(name, value);
    }
    return this.value(node.ops[node.ops.length - 1], inner, operations);
  }

  /**
   * The index of the function of the helper `name`, lowered at its first
   * call. Its parameters have the types and representations that the
   * conversions of the call record (the admission requires identity
   * conversions), and its result the representation of the call.
   */
  private helper(
    name: string,
    args: readonly IRValue[],
    facts: FragmentValueFacts<ScalarRepresentation>,
    node: Expression
  ): number {
    const known = this.functionIndex.get(name);
    if (known !== undefined) return known;
    const entry = this.prep.annotation.functions.get(name)!;
    if (entry.type.kind !== 'function' || entry.body !== this.prep.helper?.body)
      return fail(`the helper ${name} has no function facts`);
    const conversions = facts.conversions ?? [];
    if (
      conversions.length !== args.length ||
      entry.type.parameters.length !== args.length
    )
      fail(`a call of ${name} does not match its parameters`);
    const parameters = entry.type.parameters.map((p, i) =>
      this.newValue(scalarKind(p.type), conversions[i].representation)
    );
    this.bound.set(
      entry.scope,
      new Map(entry.type.parameters.map((p, i) => [p.name, parameters[i]]))
    );
    const operations: IROperation[] = [];
    const value = this.value(entry.body, entry.scope, operations);
    const result = {
      type: scalarKind(entry.type.result),
      representation: facts.representation,
    };
    if (value.representation !== result.representation)
      fail(`the body of ${name} does not have the representation of its result`);
    this.functions.push({
      name,
      parameters,
      result,
      body: this.region(operations, entry.body, value),
      origin: node,
    });
    this.functionIndex.set(name, this.functions.length - 1);
    return this.functions.length - 1;
  }
}

/** Every node that has facts in `scope` or in a scope nested in it. */
function collectOrigins(
  scope: FragmentScope<ScalarRepresentation>,
  origins: Set<Expression>
): void {
  for (const node of scope.facts.keys()) origins.add(node);
  for (const inner of scope.inner.values()) collectOrigins(inner, origins);
}
