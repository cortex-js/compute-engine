import type { ComputeEngine } from '../index.js';
import type { Expression } from '../types.js';
import type { EffectHandlers } from '../types-effects.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  isFunction,
  isNumber,
  isString,
} from '../boxed-expression/type-guards.js';
import { shadowsLibraryName } from '../library-shadowing.js';

/** Internal experiment. Deliberately absent from package exports. */
export interface BatchEntry {
  kind: 'slot' | 'definition' | 'expression';
  name: string;
  type?: string;
  resultType?: string;
  parameters?: readonly { name: string; type: string }[];
  body?: MathJsonExpression;
  initializer?: MathJsonExpression;
}
export interface Diagnostic {
  entry: number;
  code: string;
}
export interface Unsupported {
  status: 'unsupported';
  reasonCode: string;
  location?: string;
}
const unsupported = (reasonCode: string, location?: string): Unsupported => ({
  status: 'unsupported',
  reasonCode,
  location,
});
class Refusal extends Error {}
class ReadFailure extends Error {}

interface LiteralNode {
  kind: 'literal';
  type: string;
  value: Expression;
}
class ReadNode {
  readonly kind = 'read';
  constructor(readonly binding: Binding) {
    Object.freeze(this);
  }
  get type(): string {
    return this.binding.type;
  }
}
interface ParameterNode {
  kind: 'parameter';
  type: string;
  index: number;
}
interface CallNode {
  kind: 'call';
  type: string;
  binding: Binding | Operator;
  args: readonly Node[];
  error?: Expression;
}
interface OpaqueNode {
  kind: 'opaque';
  type: string;
  source: MathJsonExpression;
}
type Node = LiteralNode | ReadNode | ParameterNode | CallNode | OpaqueNode;
export interface Binding {
  readonly name: string;
  readonly kind: BatchEntry['kind'] | 'free';
  readonly index: number;
  readonly type: string;
  readonly parameters: readonly { name: string; type: string }[];
  readonly node?: Node;
  readonly invalid?: boolean;
  readonly effects: readonly string[];
  readonly cacheable?: boolean;
}
interface Operator {
  readonly kind: 'operator';
  readonly name: string;
  readonly type: string;
  readonly evaluate: (
    args: readonly Expression[],
    options: {
      engine: ComputeEngine;
      numericApproximation?: boolean;
      effects: EffectHandlers;
    }
  ) => Expression | undefined;
}

function immutableSource<T>(source: T): T {
  if (source && typeof source === 'object') {
    for (const value of Object.values(source)) immutableSource(value);
    Object.freeze(source);
  }
  return source;
}
function copyEntries(entries: readonly BatchEntry[]): readonly BatchEntry[] {
  return immutableSource(structuredClone(entries));
}

export function prepareBatch(
  engine: ComputeEngine,
  source: readonly BatchEntry[],
  externalDefinitions: readonly BatchEntry[] = []
):
  | {
      status: 'ready';
      unit: PreparedBatch;
      diagnostics: readonly Diagnostic[];
      entryCount: number;
    }
  | Unsupported {
  try {
    return new Builder(
      engine,
      copyEntries(source),
      copyEntries(externalDefinitions)
    ).prepare();
  } catch (error) {
    if (error instanceof Refusal) return unsupported(error.message);
    throw error;
  }
}

class Builder {
  readonly bindings = new Map<string, Binding>();
  readonly diagnostics: Diagnostic[] = [];
  readonly operators = new Map<string, Operator>();
  readonly resolving = new Set<Binding>();
  readonly resolved = new Set<Binding>();
  readonly entries: Binding[] = [];
  constructor(
    readonly engine: ComputeEngine,
    readonly source: readonly BatchEntry[],
    readonly external: readonly BatchEntry[]
  ) {}

  prepare() {
    for (const [index, entry] of [...this.source, ...this.external].entries()) {
      if (entry.kind === 'slot' && (!entry.type || entry.type.includes('->')))
        throw new Refusal(
          entry.type ? 'mutable-callable-slot' : 'explicit-slot-type-required'
        );
      if (this.bindings.has(entry.name)) {
        if (index < this.source.length)
          this.diagnostics.push({
            entry: index,
            code: 'variable-redeclaration',
          });
        continue;
      }
      if (entry.kind === 'definition' && !entry.resultType)
        throw new Refusal('explicit-function-signature-required');
      const type =
        entry.kind === 'definition'
          ? `(${(entry.parameters ?? []).map((x) => x.type).join(', ')}) -> ${entry.resultType}`
          : (entry.type ?? 'unknown');
      // Parse now, without retaining an engine-dependent resolver in the record.
      new BoxedType(type);
      const binding: Binding = {
        name: entry.name,
        index,
        kind: entry.kind,
        type,
        effects: Object.freeze([]),
        parameters: immutableSource(structuredClone(entry.parameters ?? [])),
      };
      this.bindings.set(entry.name, binding);
      if (index < this.source.length) this.entries.push(binding);
    }
    for (const binding of this.bindings.values()) this.resolve(binding);
    for (let pass = 0; pass < this.bindings.size; pass++)
      for (const binding of this.bindings.values())
        if (binding.kind === 'expression' && binding.node)
          Object.assign(binding, { type: binding.node.type });
    for (const binding of this.bindings.values()) {
      Object.assign(binding, {
        cacheable:
          new BoxedType(binding.type).matches('number | string') &&
          binding.effects.every((effect) => effect === 'scope'),
      });
      Object.freeze(binding.parameters);
      Object.freeze(binding);
    }
    const unit = new PreparedBatch(
      this.engine,
      this.source,
      this.external,
      Object.freeze(this.entries),
      Object.freeze([...this.bindings.values()]),
      immutableSource(this.diagnostics)
    );
    return {
      status: 'ready' as const,
      unit,
      diagnostics: unit.diagnostics,
      entryCount: this.source.length,
    };
  }

  resolve(binding: Binding): void {
    if (this.resolved.has(binding) || binding.kind === 'free') return;
    if (this.resolving.has(binding)) throw new Refusal('recursive-definition');
    this.resolving.add(binding);
    const entry = [...this.source, ...this.external][binding.index];
    const body = entry.kind === 'slot' ? entry.initializer : entry.body;
    if (body !== undefined) {
      const parameters = new Map(
        binding.parameters.map((p, index) => [p.name, { ...p, index }])
      );
      const node = this.node(
        body,
        parameters,
        binding.kind === 'slot' ? binding : undefined
      );
      Object.assign(binding, {
        node,
        effects: Object.freeze(nodeEffects(node)),
        type: binding.kind === 'expression' ? node.type : binding.type,
      });
      const expected =
        entry.kind === 'definition' ? entry.resultType! : entry.type;
      if (
        expected &&
        node.type !== 'error' &&
        !new BoxedType(node.type).matches(expected)
      ) {
        this.diagnostics.push({
          entry: binding.index,
          code: 'incompatible-type',
        });
        Object.assign(binding, { invalid: true });
      }
    }
    this.resolving.delete(binding);
    this.resolved.add(binding);
  }

  node(
    source: MathJsonExpression,
    parameters: Map<string, { type: string; index: number }>,
    initializer?: Binding,
    requirement = 'unknown'
  ): Node {
    if (
      typeof source === 'number' ||
      (source &&
        typeof source === 'object' &&
        !Array.isArray(source) &&
        ('str' in source || 'num' in source))
    ) {
      const value = this.engine.box(source);
      return Object.freeze({
        kind: 'literal',
        value,
        type: value.type.toString(),
      });
    }
    if (typeof source === 'string') {
      const parameter = parameters.get(source);
      if (parameter)
        return Object.freeze({
          kind: 'parameter',
          type: parameter.type,
          index: parameter.index,
        });
      if (source === 'Missing')
        return Object.freeze({
          kind: 'literal',
          type: 'missing',
          value: this.engine.symbol('Missing'),
        });
      let binding = this.bindings.get(source);
      if (!binding) {
        binding = {
          name: source,
          kind: 'free',
          index: this.bindings.size,
          type: requirement,
          effects: Object.freeze(['scope']),
          parameters: [],
        };
        this.bindings.set(source, binding);
      } else if (binding.kind === 'free' && requirement !== 'unknown') {
        if (binding.type !== 'unknown' && binding.type !== requirement)
          throw new Refusal('conflicting-free-name-requirements');
        Object.assign(binding, { type: requirement });
      }
      if (
        initializer &&
        binding.kind === 'slot' &&
        binding.index >= initializer.index
      ) {
        if (
          !this.diagnostics.some(
            (x) =>
              x.entry === initializer.index &&
              x.code === 'read-before-declaration'
          )
        )
          this.diagnostics.push({
            entry: initializer.index,
            code: 'read-before-declaration',
          });
        Object.assign(initializer, { invalid: true });
      }
      if (binding.kind === 'expression') this.resolve(binding);
      return new ReadNode(binding);
    }
    if (!Array.isArray(source) || typeof source[0] !== 'string')
      throw new Refusal('unsupported-syntax');
    const [head, ...args] = source;
    if (head === 'List' && literalTransferSource(source)) {
      const value = this.engine.box(source);
      return Object.freeze({
        kind: 'literal',
        value,
        type: value.type.toString(),
      });
    }
    if (head === 'Function' || head === 'Map' || head === 'Range')
      return Object.freeze({
        kind: 'opaque',
        type: head === 'Function' ? '(real) -> real' : 'unknown',
        source,
      });
    const binding = this.bindings.get(head);
    if (binding) {
      if (binding.kind !== 'definition')
        throw new Refusal('unsupported-call-target');
      this.resolve(binding);
      if (args.length !== binding.parameters.length)
        throw new Refusal('unsupported-call-arity');
      const nodes = args.map((arg, i) =>
        this.node(arg, parameters, initializer, binding.parameters[i].type)
      );
      for (let i = 0; i < nodes.length; i++)
        if (!new BoxedType(nodes[i].type).matches(binding.parameters[i].type))
          throw new Refusal('incompatible-call-argument');
      const entry = [...this.source, ...this.external][binding.index];
      return Object.freeze({
        kind: 'call',
        binding,
        type: entry.resultType!,
        args: Object.freeze(nodes),
      });
    }
    if (!['Add', 'Multiply', 'Not', 'List', 'AssertPresent'].includes(head))
      throw new Refusal(`unsupported-operator:${head}`);
    let operator = this.operators.get(head);
    if (!operator) {
      const definition = this.engine.lookupDefinition(head);
      if (
        !definition ||
        !isOperatorDef(definition) ||
        !definition.operator.evaluate
      )
        throw new Refusal(`unsupported-operator:${head}`);
      // Only these audited built-ins are admitted; arbitrary host handlers can close over mutable metadata.
      if (shadowsLibraryName(this.engine, head))
        throw new Refusal(`mutable-external-handler:${head}`);
      operator = Object.freeze({
        kind: 'operator',
        name: head,
        type: definition.operator.signature.toString(),
        evaluate: definition.operator.evaluate as Operator['evaluate'],
      });
      this.operators.set(head, operator);
    }
    const operandRequirement =
      head === 'Not'
        ? 'boolean'
        : head === 'Add' || head === 'Multiply'
          ? 'number'
          : 'unknown';
    const nodes = args.map((arg) =>
      this.node(arg, parameters, initializer, operandRequirement)
    );
    if ((head === 'Not' || head === 'AssertPresent') && nodes.length !== 1)
      throw new Refusal('unsupported-call-arity');
    const type =
      head === 'Not'
        ? 'boolean'
        : head === 'List'
          ? nodes.every((x) => new BoxedType(x.type).matches('integer'))
            ? 'list<integer>'
            : 'list<value>'
          : head === 'AssertPresent'
            ? nodes[0].type === 'missing'
              ? 'error'
              : nodes[0].type
            : nodes.every((x) => new BoxedType(x.type).matches('real'))
              ? 'real'
              : 'number';
    if (
      (head === 'Add' || head === 'Multiply') &&
      nodes.some((x) => !new BoxedType(x.type).matches('number'))
    )
      throw new Refusal('unsupported-arithmetic-type');
    return Object.freeze({
      kind: 'call',
      binding: operator,
      args: Object.freeze(nodes),
      type,
      ...(type === 'error' && head === 'AssertPresent'
        ? { error: this.engine.error('expected-present', 'Missing') }
        : {}),
    });
  }
}

export interface PreparedEntryHandle {
  readonly unit: PreparedBatch;
  readonly binding: Binding;
}

export class PreparedBatch {
  constructor(
    readonly engine: ComputeEngine,
    readonly source: readonly BatchEntry[],
    readonly externalDefinitions: readonly BatchEntry[],
    readonly entries: readonly Binding[],
    readonly bindings: readonly Binding[],
    readonly diagnostics: readonly Diagnostic[]
  ) {
    Object.freeze(this);
  }
  instantiate() {
    const instance = new BatchInstance(this);
    return {
      status: 'ready' as const,
      instance,
      diagnostics: instance.initialize(),
    };
  }
  revise(replace: readonly BatchEntry[]) {
    return prepareBatch(
      this.engine,
      [
        ...this.source.map(
          (entry) => replace.find((x) => x.name === entry.name) ?? entry
        ),
        ...replace.filter(
          (entry) => !this.source.some((x) => x.name === entry.name)
        ),
      ],
      this.externalDefinitions
    );
  }
  resolve(
    name: string
  ): { status: 'ready'; handle: PreparedEntryHandle } | Unsupported {
    const binding = this.binding(name);
    return binding
      ? { status: 'ready', handle: Object.freeze({ unit: this, binding }) }
      : unsupported('unknown-entry', name);
  }
  binding(name: string): Binding | undefined {
    return this.bindings.find((x) => x.name === name);
  }
}

interface CachedResult {
  binding: Binding;
  numericApproximation: boolean;
  precision: number;
  requestedPrecision: number | undefined;
  tolerance: number;
  roundingTies: ComputeEngine['roundingTies'];
  angularUnit: ComputeEngine['angularUnit'];
  strict: boolean;
  effects: EffectHandlers;
  value: Expression;
}

export class BatchInstance {
  private readonly values = new Map<Binding, Expression>();
  private cached: CachedResult | undefined;
  constructor(readonly unit: PreparedBatch) {}
  initialize(): readonly Diagnostic[] {
    this.cached = undefined;
    const diagnostics: Diagnostic[] = [];
    for (const binding of this.unit.entries) {
      if (binding.kind !== 'slot' || !binding.node || binding.invalid) continue;
      try {
        const value = this.run(binding.node, [], false);
        if (!value.isValid) throw new ReadFailure('initializer-failed');
        this.values.set(binding, value);
      } catch (error) {
        if (!(error instanceof ReadFailure)) throw error;
        diagnostics.push({ entry: binding.index, code: error.message });
      }
    }
    return diagnostics;
  }
  write(name: string, source: MathJsonExpression) {
    const binding = this.unit.binding(name);
    if (!binding || binding.kind !== 'slot')
      return unsupported('unknown-slot', name);
    if (!literalTransferSource(source))
      return unsupported('mutable-value', name);
    if (
      !new BoxedType(literalType(this.unit.engine, source)).matches(
        binding.type
      )
    )
      return {
        status: 'ready' as const,
        accepted: false,
        diagnostics: ['incompatible-type'],
      };
    const value = boxLiteral(this.unit.engine, source);
    if (!value)
      return {
        status: 'ready' as const,
        accepted: false,
        diagnostics: ['incompatible-type'],
      };
    this.values.set(binding, value);
    this.cached = undefined;
    return { status: 'ready' as const, accepted: true, diagnostics: [] };
  }
  evaluate(name: string, options: { numericApproximation?: boolean } = {}) {
    const binding = this.unit.binding(name);
    if (!binding) return unsupported('unknown-entry', name);
    return this.evaluateBinding(binding, options);
  }
  evaluateHandle(
    handle: PreparedEntryHandle,
    options: { numericApproximation?: boolean } = {}
  ) {
    if (handle.unit !== this.unit)
      return unsupported('foreign-revision', handle.binding.name);
    return this.evaluateBinding(handle.binding, options);
  }
  private evaluateBinding(
    binding: Binding,
    options: { numericApproximation?: boolean }
  ) {
    const name = binding.name;
    const engine = this.unit.engine;
    const numericApproximation = options.numericApproximation ?? false;
    const cacheable = binding.cacheable && !engine._atTransientConfiguration;
    const cached = this.cached;
    if (
      cacheable &&
      cached &&
      cached.binding === binding &&
      cached.numericApproximation === numericApproximation &&
      cached.precision === engine.precision &&
      cached.requestedPrecision === engine._requestedPrecision &&
      cached.tolerance === engine.tolerance &&
      cached.roundingTies === engine.roundingTies &&
      cached.angularUnit === engine.angularUnit &&
      cached.strict === engine.strict &&
      cached.effects === engine.effects
    )
      return { status: 'ready' as const, value: cached.value, diagnostics: [] };
    this.cached = undefined;
    try {
      const value =
        binding.kind === 'slot'
          ? this.read(binding)
          : binding.node
            ? this.run(binding.node, [], numericApproximation)
            : undefined;
      if (!value) return unsupported('non-value-entry', name);
      // Scope effects here are reads of this instance's slots. Every accepted
      // write clears the one record; captured definitions and audited handlers
      // are immutable and cannot read host bindings or invoke host effects.
      if (cacheable && value.isValid && (isNumber(value) || isString(value)))
        this.cached = {
          binding,
          numericApproximation,
          precision: engine.precision,
          requestedPrecision: engine._requestedPrecision,
          tolerance: engine.tolerance,
          roundingTies: engine.roundingTies,
          angularUnit: engine.angularUnit,
          strict: engine.strict,
          effects: engine.effects,
          value,
        };
      return { status: 'ready' as const, value, diagnostics: [] };
    } catch (error) {
      if (error instanceof Refusal) return unsupported(error.message, name);
      if (!(error instanceof ReadFailure)) throw error;
      return {
        status: 'ready' as const,
        value: this.unit.engine.error(error.message),
        diagnostics: [error.message],
      };
    }
  }
  private read(binding: Binding): Expression {
    const value = this.values.get(binding);
    if (!value) throw new ReadFailure('uninitialized-value');
    return value;
  }
  private run(
    node: Node,
    parameters: readonly Expression[],
    numericApproximation: boolean
  ): Expression {
    if (node.kind === 'literal')
      return numericApproximation ? node.value.N() : node.value;
    if (node.kind === 'parameter') return parameters[node.index];
    if (node.kind === 'opaque') throw new Refusal('revision-dependent-value');
    if (node.kind === 'read') {
      if (node.binding.kind === 'expression' && node.binding.node)
        return this.run(node.binding.node, parameters, numericApproximation);
      return this.read(node.binding);
    }
    if (node.error) return node.error;
    const args = node.args.map((x) =>
      this.run(x, parameters, numericApproximation)
    );
    if (node.binding.kind !== 'operator') {
      if (!node.binding.node || node.binding.invalid)
        throw new ReadFailure('initializer-failed');
      return this.run(node.binding.node, args, numericApproximation);
    }
    const value = node.binding.evaluate(args, {
      engine: this.unit.engine,
      numericApproximation,
      effects: this.unit.engine.effects,
    });
    if (!value || !value.isValid || value.operator === 'Error')
      throw new ReadFailure('initializer-failed');
    return value;
  }
}

/** Only copied literal syntax crosses a revision boundary. No runtime reads classify values. */
export function literalTransferSource(
  source: unknown
): source is MathJsonExpression {
  if (typeof source === 'number') return true;
  if (!source || typeof source !== 'object') return false;
  if (Array.isArray(source))
    return source[0] === 'List' && source.slice(1).every(literalTransferSource);
  return (
    Object.keys(source).length === 1 &&
    (('str' in source && typeof source.str === 'string') ||
      ('num' in source && typeof source.num === 'string'))
  );
}

export type TransferSource =
  | { instance: BatchInstance; name: string }
  | { aggregate: readonly TransferSource[] }
  | { literal: unknown };
export function transferBatchData(
  source: TransferSource,
  target: BatchInstance,
  targetName?: string
):
  | ReturnType<BatchInstance['write']>
  | Unsupported
  | {
      status: 'ready';
      value: Expression;
      diagnostics: string[];
      accepted: boolean;
    } {
  const classify = (
    input: TransferSource
  ): MathJsonExpression | Unsupported => {
    if ('literal' in input)
      return literalTransferSource(input.literal)
        ? input.literal
        : unsupported('mutable-value');
    if ('aggregate' in input) {
      const elements: MathJsonExpression[] = [];
      for (const child of input.aggregate) {
        const value = classify(child);
        if (isTransferRefusal(value)) return value;
        elements.push(value);
      }
      return ['List', ...elements];
    }
    const binding = input.instance.unit.binding(input.name);
    if (binding?.node?.kind === 'opaque')
      return unsupported('revision-dependent-value');
    const value = input.instance.evaluate(input.name);
    if (value.status === 'unsupported') return value;
    return (
      transferLiteral(value.value) ?? unsupported('revision-dependent-value')
    );
  };
  const value = classify(source);
  if (isTransferRefusal(value)) return value;
  if (!targetName) return unsupported('unsupported-transfer-target');
  const result = target.write(targetName, value);
  return result.status === 'ready' && result.accepted
    ? { ...result, value: boxLiteral(target.unit.engine, value) }
    : result;
}
function isTransferRefusal(
  value: MathJsonExpression | Unsupported
): value is Unsupported {
  return !!value && typeof value === 'object' && 'status' in value;
}
export function transferBatchValue(
  source: BatchInstance,
  name: string,
  target: BatchInstance,
  targetName: string
) {
  return transferBatchData({ instance: source, name }, target, targetName);
}

function literalType(
  engine: ComputeEngine,
  source: MathJsonExpression
): string {
  if (typeof source === 'number')
    return !Number.isFinite(source)
      ? 'number'
      : Number.isInteger(source)
        ? 'integer'
        : 'real';
  if (Array.isArray(source))
    return `list<${(source as MathJsonExpression[]).slice(1).every((x) => literalType(engine, x) === 'integer') ? 'integer' : 'value'}>`;
  if (typeof source === 'object' && source && 'str' in source) return 'string';
  if (typeof source === 'object' && source && 'num' in source) {
    const type = engine.number(source.num).type;
    return type.matches('integer')
      ? 'integer'
      : type.matches('real')
        ? 'real'
        : 'number';
  }
  return 'number';
}
function boxLiteral(
  engine: ComputeEngine,
  source: MathJsonExpression
): Expression {
  if (typeof source === 'number') return engine.number(source);
  if (Array.isArray(source))
    return engine._fn(
      source[0] as string,
      (source as MathJsonExpression[])
        .slice(1)
        .map((x) => boxLiteral(engine, x))
    );
  if (typeof source === 'object' && source && 'str' in source)
    return engine.string(source.str);
  if (typeof source === 'object' && source && 'num' in source)
    return engine.number(source.num);
  throw new Refusal('unsupported-literal');
}

export function transferLiteral(
  value: Expression
): MathJsonExpression | undefined {
  if (isString(value)) return { str: value.string };
  if (isNumber(value)) return value.json;
  if (
    isFunction(value) &&
    (value.operator === 'List' || value.operator === 'Tuple')
  ) {
    const elements = value.ops.map(transferLiteral);
    if (elements.some((x) => x === undefined)) return undefined;
    return [value.operator, ...(elements as MathJsonExpression[])];
  }
  return undefined;
}

export function mixPreparedEntries(
  entries: readonly { unit: PreparedBatch; name: string }[]
): Unsupported {
  if (entries.some((entry) => entry.unit !== entries[0]?.unit))
    return unsupported('cross-revision-syntax');
  return unsupported('explicit-source-preparation-required');
}

function nodeEffects(node: Node): string[] {
  if (node.kind === 'read')
    return node.binding.kind === 'expression'
      ? [...node.binding.effects]
      : ['scope'];
  if (node.kind !== 'call') return [];
  return [
    ...new Set([
      ...node.args.flatMap(nodeEffects),
      ...(node.binding.kind === 'operator' ? [] : node.binding.effects),
    ]),
  ];
}
