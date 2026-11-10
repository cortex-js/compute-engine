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
  type EffectFact,
  type IRCapture,
  type IRFunction,
  type IRInput,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type ScalarKind,
} from './structured-ir.js';
import { verifyJavaScriptProgram } from './javascript-structured-policy.js';

export type StructuredInput = IRInput;

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
    { readonly name: string; readonly body: Expression }
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
  Record<
    string,
    'add' | 'negate' | 'multiply' | 'less' | 'equal' | 'min' | 'max' | 'sqrt'
  >
> = {
  // The rule of `Sqrt` (`javascript-fragment-target.ts`) records the
  // conversion of a real operand of a complex square root.
  Sqrt: 'sqrt',
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

  /** End `operations` with the yield of `value` (of each value of an
   *  array) and summarize its effects. */
  private region(
    operations: IROperation[],
    origin: Expression,
    value: IRValue | readonly IRValue[]
  ): IRRegion {
    const operands = Array.isArray(value) ? value : [value as IRValue];
    operations.push({ kind: 'yield', operands, effect: 'pure', origin });
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
    if (capture === undefined) return fail(`no binding for the name ${node.symbol}`);
    const result = this.resultOf(this.facts(node, scope));
    let index = this.captureIndex.get(capture.binding);
    if (index === undefined) {
      index = this.captures.length;
      this.captures.push({
        binding: capture.binding,
        name: capture.name,
        type: result.type,
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
    this.statements(node.ops.slice(0, -1), inner, operations, namesIn(last));
    return this.value(last, inner, operations);
  }

  /**
   * The statements `statements`, in order, in `scope`. `liveOut`: the
   * names that the code after the statements can read.
   */
  private statements(
    statements: readonly Expression[],
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): void {
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
    statements.forEach((s, i) => this.statement(s, scope, operations, live[i]));
  }

  /**
   * A statement: a `Declare` binds its local to the value of its
   * initializer; an `Assign` gives the local a new value; an `If` statement
   * merges the values of the locals that its branches write; a `Block` (a
   * branch of an `If`) is its statements. The admission of the structured
   * route admits no other statement.
   */
  private statement(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): void {
    if (isFunction(node, 'Declare') && node.nops === 3 && isSymbol(node.op1)) {
      const name = node.op1.symbol;
      const binding = scope.bindings.get(name);
      const value = this.value(node.op3, scope, operations);
      if (
        binding === undefined ||
        !('representation' in binding) ||
        binding.representation !== value.representation
      )
        fail(`the local ${name} has no binding of the representation of its value`);
      let locals = this.bound.get(scope);
      if (locals === undefined) this.bound.set(scope, (locals = new Map()));
      locals.set(name, value);
      return;
    }
    if (isFunction(node, 'Assign') && node.nops === 2 && isSymbol(node.op1)) {
      const name = node.op1.symbol;
      const value = this.value(node.op2, scope, operations);
      const binder = bindingScope(scope, name);
      const locals = binder === undefined ? undefined : this.bound.get(binder);
      const binding = binder?.bindings.get(name);
      // The admission and the pass refuse a write to a name that is not a
      // local; an input of the program has no value in `bound`.
      if (locals === undefined || !locals.has(name) || binding === undefined)
        return fail(`the name ${name} is not a declared local`);
      if (!('representation' in binding) || binding.representation !== value.representation)
        fail(`a write to the local ${name} changes its representation`);
      locals.set(name, value);
      return;
    }
    if (isFunction(node, 'If') && (node.nops === 2 || node.nops === 3))
      return this.ifStatement(node, scope, operations, liveOut);
    if (isFunction(node, 'Block')) {
      const inner = scope.inner.get(node);
      if (inner === undefined) return fail('no scope for a block');
      return this.statements(node.ops, inner, operations, liveOut);
    }
    fail(`no lowering for the statement ${node.toString()}`);
  }

  /**
   * An `If` statement: an `if` whose results are the merged values of the
   * locals that a branch writes and that `liveOut` names, in the order of
   * their bindings. The `If` itself has no effect: its effect is the one
   * of its regions. A write to a local is not an effect: it makes a value.
   */
  private ifStatement(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): void {
    // The operations of the condition, kept apart until the `If` is known
    // to be lowered.
    const condition: IROperation[] = [];
    const test = this.value(node.ops[0], scope, condition);
    const before = this.snapshot();
    const branch = (statement: Expression | undefined) => {
      this.restore(before);
      const inner: IROperation[] = [];
      if (statement !== undefined) this.statement(statement, scope, inner, liveOut);
      return { operations: inner, values: this.snapshot() };
    };
    const a = branch(node.ops[1]);
    const b = branch(node.ops[2]);
    this.restore(before);
    // The locals to merge, with their values before the `If` and in each
    // branch.
    const merged: {
      locals: Map<string, IRValue>;
      name: string;
      then: IRValue;
      else: IRValue;
    }[] = [];
    for (const [binder, locals] of before)
      for (const [name, value] of locals) {
        const then = a.values.get(binder)?.get(name);
        const otherwise = b.values.get(binder)?.get(name);
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
    // integer and a real value.
    const results = merged.map((m) => {
      const types = new Set([m.then.type, m.else.type]);
      const type =
        types.size === 1
          ? m.then.type
          : types.has('integer') && types.has('real') && types.size === 2
            ? 'real'
            : fail(
                `the local ${m.name} has the type ${m.then.type} in one branch and ${m.else.type} in the other`
              );
      return this.newValue(type, m.then.representation as ScalarRepresentation);
    });
    merged.forEach((m, i) => m.locals.set(m.name, results[i]));
    const then = this.region(
      a.operations,
      node.ops[1],
      merged.map((m) => m.then)
    );
    const otherwise = this.region(
      b.operations,
      node.ops[2] ?? node,
      merged.map((m) => m.else)
    );
    // An `If` with no result and no effect has nothing to give: it is
    // not lowered, and its condition is lowered only when it has an effect
    // (with the pure operations that the effect reads).
    if (results.length === 0 && joinEffects(then.effect, otherwise.effect) === 'pure') {
      if (joinEffects(...condition.map((op) => op.effect)) !== 'pure')
        operations.push(...condition);
      return;
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
  }

  /** The value of each local and parameter, copied. */
  private snapshot(): Map<FragmentScope<ScalarRepresentation>, Map<string, IRValue>> {
    return new Map([...this.bound].map(([scope, locals]) => [scope, new Map(locals)]));
  }

  /** Make the values of `snapshot` the values of the locals again. */
  private restore(
    snapshot: ReadonlyMap<FragmentScope<ScalarRepresentation>, ReadonlyMap<string, IRValue>>
  ): void {
    for (const [scope, locals] of snapshot) this.bound.set(scope, new Map(locals));
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
      this.newValue(scalarKind(p.type), conversions[i].representation)
    );
    this.bound.set(
      entry.scope,
      new Map(entry.type.parameters.map((p, i) => [p.name, parameters[i]]))
    );
    const operations: IROperation[] = [];
    this.lowering.add(name);
    const value = this.value(entry.body, entry.scope, operations);
    this.lowering.delete(name);
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
  for (let s: FragmentScope<ScalarRepresentation> | undefined = scope; s; s = s.parent)
    if (s.bindings.has(name)) return s;
  return undefined;
}

/** The names of the symbols of `node`, read or written. */
function namesIn(node: Expression, names = new Set<string>()): Set<string> {
  if (isSymbol(node)) names.add(node.symbol);
  else if (isFunction(node)) for (const operand of node.ops) namesIn(operand, names);
  return names;
}
