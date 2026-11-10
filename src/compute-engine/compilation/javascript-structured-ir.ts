/**
 * The structured representation of a program of the internal scalar
 * JavaScript fragment target, and its verifier.
 *
 * A program is lowered from the prepared root and its annotation
 * (`javascript-structured-lower.ts`) after the representation of each value
 * is chosen. Each value is defined once and has an id that is unique in its
 * program. Operations are ordered in regions. A region ends in one `yield`,
 * whose operand is the value of the region. A value that a region defines is
 * visible in that region, after its definition, and in the regions nested in
 * it; the value of a branch leaves the branch only through its `yield`.
 *
 * There is no common-subexpression pass, no reordering, no loop and no
 * collection: each occurrence of a prepared node gives its own operations,
 * in the order of the prepared tree.
 *
 * The verifier checks the structure, not that the lowering preserves the
 * value of the program: tests do that.
 *
 * The design is `docs/plans/2026-11-09-js-structured-scalar-emitter.md`,
 * "Representation and verifier" and "Effects are part of the prepared
 * contract".
 */
import type { Expression } from '../global-types.js';
import type { ScalarRepresentation } from './javascript-fragment-facts.js';

/**
 * What the evaluation of an operation can do besides giving its value.
 * `pure`: nothing. `effectful`: an effect that the definition states (an
 * impurity label). `unknown`: the definition does not state its effects.
 * `unknown` never permits a reordering or a merge.
 */
export type EffectFact = 'pure' | 'effectful' | 'unknown';

/** The semantic type of a value. */
export type ScalarKind = 'real' | 'integer' | 'boolean' | 'complex';

export type IRValue = {
  /** The program that defines the value (`IRProgram.owner`). */
  readonly owner: object;
  readonly revision: number;
  /** Unique in the program. */
  readonly id: number;
  readonly type: ScalarKind;
  readonly representation: ScalarRepresentation;
};

type OperationBase = {
  readonly result: IRValue;
  /** The values that the operation reads, evaluated before it. */
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  /** The prepared node that the operation comes from. */
  readonly origin: Expression;
};

/** A number, a boolean or a complex number. */
export type IRLiteral = OperationBase & {
  readonly kind: 'literal';
  readonly value: number | boolean | { readonly re: number; readonly im: number };
};

/** A read of the input `IRProgram.inputs[input]` at this position. */
export type IRInputRead = OperationBase & {
  readonly kind: 'input';
  readonly input: number;
};

/** An operation of the operands, which are already in the representation
 *  of the operation. */
export type IRArithmetic = OperationBase & {
  readonly kind:
    | 'add'
    | 'negate'
    | 'multiply'
    | 'less'
    | 'equal'
    | 'min'
    | 'max';
};

/** A conversion that changes the representation. An identity conversion
 *  has no operation. */
export type IRConvert = OperationBase & {
  readonly kind: 'convert';
  readonly conversion: 'real-to-complex';
};

/** The operand is the condition. Only the region that the condition
 *  selects is evaluated; its yield is the result. */
export type IRIf = OperationBase & {
  readonly kind: 'if';
  readonly then: IRRegion;
  readonly else: IRRegion;
};

/**
 * `and` and `or`. The operand is the first operand of the source. Each
 * region of `rest` is the next operand: it is evaluated only when the
 * earlier operands do not decide the result (`false` for `and`, `true` for
 * `or`), as JavaScript `&&` and `||` do.
 */
export type IRShortCircuit = OperationBase & {
  readonly kind: 'and' | 'or';
  readonly rest: readonly IRRegion[];
};

/** A call of `IRProgram.functions[function]`. The operands are the
 *  arguments, evaluated once, in order, before the call. */
export type IRCall = OperationBase & {
  readonly kind: 'call';
  readonly function: number;
};

/** An operation that exists only for tests. Its effect is the one that its
 *  declaration states; `trace` names it in the trace that an emitter
 *  writes. */
export type IRTrace = OperationBase & {
  readonly kind: 'trace';
  readonly trace: string;
};

/** The last operation of a region: its operand is the value of the
 *  region. */
export type IRYield = {
  readonly kind: 'yield';
  readonly result?: undefined;
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  readonly origin: Expression;
};

export type IROperation =
  | IRLiteral
  | IRInputRead
  | IRArithmetic
  | IRConvert
  | IRIf
  | IRShortCircuit
  | IRCall
  | IRTrace
  | IRYield;

export type IRRegion = {
  readonly operations: readonly IROperation[];
  /** The join of the effects of the operations (`joinEffects()`). */
  readonly effect: EffectFact;
};

export type IRInput = {
  readonly name: string;
  readonly type: ScalarKind;
  readonly representation: ScalarRepresentation;
};

/** A resolved helper, written once as a function of the program. */
export type IRFunction = {
  readonly name: string;
  /** Defined at the entry of the body. */
  readonly parameters: readonly IRValue[];
  readonly result: {
    readonly type: ScalarKind;
    readonly representation: ScalarRepresentation;
  };
  readonly body: IRRegion;
  readonly origin: Expression;
};

export type IRProgram = {
  /** Each lowering makes a new owner: a value of another program has
   *  another owner. */
  readonly owner: object;
  /** A transformation of the program makes a new revision. */
  readonly revision: number;
  readonly inputs: readonly IRInput[];
  /** The compile mode of the compilation. */
  readonly numericPolicy: 'strict' | 'complex';
  readonly functions: readonly IRFunction[];
  readonly root: IRRegion;
};

const EFFECT_RANK: Readonly<Record<EffectFact, number>> = {
  pure: 0,
  unknown: 1,
  effectful: 2,
};

/**
 * The effect of evaluating operations of the effects `effects`: the most
 * restrictive one. `effectful` includes `unknown` on purpose: both forbid
 * every transformation (a merge, a duplication, a removal or a reordering),
 * so a summary needs only the strongest one. A pass that must tell a region
 * with an unknown effect from a region with a stated effect must first change
 * the summary to keep both.
 */
export function joinEffects(...effects: readonly EffectFact[]): EffectFact {
  let result: EffectFact = 'pure';
  for (const e of effects) if (EFFECT_RANK[e] > EFFECT_RANK[result]) result = e;
  return result;
}

/** The representation that holds a value of the type `type`. */
export function representationOfKind(type: ScalarKind): ScalarRepresentation {
  return type === 'real' || type === 'integer' ? 'number' : type;
}

//
// The verifier
//

const fail = (message: string): never => {
  throw new Error(`JS structured representation: ${message}`);
};

const isEffect = (e: unknown): e is EffectFact =>
  e === 'pure' || e === 'effectful' || e === 'unknown';

/** The regions that `op` evaluates. */
function regionsOf(op: IROperation): readonly IRRegion[] {
  if (op.kind === 'if') return [op.then, op.else];
  if (op.kind === 'and' || op.kind === 'or') return op.rest;
  return [];
}

/** The operand of the yield of `region`, after `verifyRegionShape()`. */
function yielded(region: IRRegion): IRValue {
  return region.operations[region.operations.length - 1].operands[0];
}

/**
 * Throw when `program` is not well formed. The checks: each value is
 * defined once, by the program, before its uses, and is used only in the
 * region of its definition and the regions nested in it; each operation has
 * the operands and the result of its kind, and an effect fact; each region
 * ends in one yield; the two regions of an `if` yield values of one
 * representation; a conversion changes a number into a complex number; the
 * condition of an `if` is a boolean; the effect of each region is the join of
 * the effects of its operations, and the effect of an operation that
 * evaluates a region or calls a function includes the effect of that region
 * or of that function; each function yields a value of the type and the
 * representation of its result; each origin is one of `preparedNodes`, the
 * nodes of the prepared artifact that the program was lowered from.
 */
export function verifyProgram(
  program: IRProgram,
  preparedNodes: ReadonlySet<Expression>
): void {
  // Where each value is defined: the region and the position in it. The
  // parameters of a function are defined at the entry of its body (-1).
  const definitions = new Map<
    number,
    { value: IRValue; region: IRRegion; index: number }
  >();
  const define = (value: IRValue, region: IRRegion, index: number) => {
    checkValue(value);
    if (definitions.has(value.id))
      fail(`the value ${value.id} is defined twice`);
    definitions.set(value.id, { value, region, index });
  };
  const checkValue = (value: IRValue) => {
    if (value.owner !== program.owner || value.revision !== program.revision)
      fail(`the value ${value.id} belongs to another program`);
    if (representationOfKind(value.type) !== value.representation)
      fail(
        `the value ${value.id} of the type ${value.type} has the representation ${value.representation}`
      );
  };
  const collect = (region: IRRegion) => {
    region.operations.forEach((op, index) => {
      if (op.result !== undefined) define(op.result, region, index);
      for (const inner of regionsOf(op)) collect(inner);
    });
  };
  for (const fn of program.functions) {
    for (const parameter of fn.parameters) define(parameter, fn.body, -1);
    collect(fn.body);
  }
  collect(program.root);

  /** The regions around the current operation, outermost first, with the
   *  position of the operation that evaluates the next one. */
  type Frame = { region: IRRegion; index: number };

  const use = (value: IRValue, frames: readonly Frame[]) => {
    checkValue(value);
    const definition = definitions.get(value.id);
    if (definition === undefined)
      return fail(`the value ${value.id} has no definition`);
    if (
      definition.value.type !== value.type ||
      definition.value.representation !== value.representation
    )
      fail(
        `the value ${value.id} is used with another type or representation than its definition`
      );
    const frame = frames.find((f) => f.region === definition.region);
    if (frame === undefined)
      fail(`the value ${value.id} is used outside the region of its definition`);
    if (definition.index >= frame!.index)
      fail(`the value ${value.id} is used before its definition`);
  };

  const verifyRegion = (region: IRRegion, outer: readonly Frame[]) => {
    verifyRegionShape(region);
    const effects: EffectFact[] = [];
    region.operations.forEach((op, index) => {
      const frames = [...outer, { region, index }];
      if (!isEffect(op.effect))
        fail(`the operation ${op.kind} has no effect fact`);
      if (!preparedNodes.has(op.origin))
        fail(`the origin of the operation ${op.kind} is not a prepared node`);
      for (const operand of op.operands) use(operand, frames);
      for (const inner of regionsOf(op)) {
        verifyRegion(inner, frames);
        if (EFFECT_RANK[op.effect] < EFFECT_RANK[inner.effect])
          fail(
            `the effect of the operation ${op.kind} (${op.effect}) omits the effect of its region (${inner.effect})`
          );
      }
      verifySignature(op, program);
      effects.push(op.effect);
    });
    if (!isEffect(region.effect)) fail('a region has no effect fact');
    const joined = joinEffects(...effects);
    if (region.effect !== joined)
      fail(
        `the effect of a region (${region.effect}) does not agree with its operations (${joined})`
      );
  };

  // A function body sees its parameters and its own values only.
  for (const fn of program.functions) {
    verifyRegion(fn.body, []);
    if (representationOfKind(fn.result.type) !== fn.result.representation)
      fail(
        `the result of ${fn.name} has the type ${fn.result.type} and the representation ${fn.result.representation}`
      );
    const value = yielded(fn.body);
    if (
      value.type !== fn.result.type ||
      value.representation !== fn.result.representation
    )
      fail(
        `the body of ${fn.name} yields a ${value.type} value, and its result is a ${fn.result.type}`
      );
  }
  verifyRegion(program.root, []);
}

/** One yield, and it is the last operation. */
function verifyRegionShape(region: IRRegion): void {
  const yields = region.operations.filter((op) => op.kind === 'yield').length;
  if (yields === 0) fail('a region has no yield');
  if (yields > 1) fail(`a region has ${yields} yields`);
  if (region.operations[region.operations.length - 1].kind !== 'yield')
    fail('the yield of a region is not its last operation');
}

function verifySignature(op: IROperation, program: IRProgram): void {
  const arity = (n: number) => {
    if (op.operands.length !== n)
      fail(`the operation ${op.kind} has ${op.operands.length} operands, not ${n}`);
  };
  const atLeast = (n: number) => {
    if (op.operands.length < n)
      fail(
        `the operation ${op.kind} has ${op.operands.length} operands, fewer than ${n}`
      );
  };
  const operandsIn = (...representations: ScalarRepresentation[]) => {
    for (const operand of op.operands)
      if (!representations.includes(operand.representation))
        fail(
          `an operand of the operation ${op.kind} has the representation ${operand.representation}`
        );
  };
  const resultIn = (...representations: ScalarRepresentation[]) => {
    if (op.result === undefined || !representations.includes(op.result.representation))
      fail(
        `the result of the operation ${op.kind} has the representation ${op.result?.representation}`
      );
  };
  // An arithmetic result is an integer only when every operand is one.
  const integerOnlyFromIntegers = () => {
    if (
      op.result?.type === 'integer' &&
      op.operands.some((operand) => operand.type !== 'integer')
    )
      fail(`the operation ${op.kind} has an integer result and an operand that is not an integer`);
  };
  switch (op.kind) {
    case 'yield':
      arity(1);
      if (op.result !== undefined) fail('a yield has a result');
      return;
    case 'literal': {
      arity(0);
      const value = op.value;
      const representation =
        typeof value === 'number'
          ? 'number'
          : typeof value === 'boolean'
            ? 'boolean'
            : typeof value === 'object' &&
                value !== null &&
                typeof value.re === 'number' &&
                typeof value.im === 'number'
              ? 'complex'
              : undefined;
      if (representation !== op.result.representation)
        fail(
          `a literal of the representation ${op.result.representation} holds another kind of value`
        );
      return;
    }
    case 'input': {
      arity(0);
      const input = program.inputs[op.input];
      if (
        input === undefined ||
        input.type !== op.result.type ||
        input.representation !== op.result.representation
      )
        fail(`a read of the input ${op.input} does not match the input`);
      return;
    }
    case 'add':
      atLeast(2);
      resultIn('number', 'complex');
      operandsIn(op.result.representation);
      integerOnlyFromIntegers();
      return;
    case 'negate':
      arity(1);
      resultIn('number', 'complex');
      operandsIn(op.result.representation);
      integerOnlyFromIntegers();
      return;
    case 'multiply':
    case 'min':
    case 'max':
      atLeast(2);
      resultIn('number');
      operandsIn('number');
      integerOnlyFromIntegers();
      return;
    case 'less':
    case 'equal':
      arity(2);
      resultIn('boolean');
      operandsIn('number');
      return;
    case 'convert': {
      arity(1);
      const [operand] = op.operands;
      if (
        op.conversion !== 'real-to-complex' ||
        operand.representation !== 'number' ||
        op.result.type !== 'complex'
      )
        fail(
          `an invalid conversion ${String(op.conversion)} from ${operand.type} to ${op.result.type}`
        );
      return;
    }
    case 'if': {
      arity(1);
      if (op.operands[0].representation !== 'boolean')
        fail('the condition of an if is not a boolean');
      const a = yielded(op.then);
      const b = yielded(op.else);
      if (a.representation !== b.representation)
        fail(
          `the two results of an if have different representations (${a.representation}, ${b.representation})`
        );
      if (a.representation !== op.result.representation)
        fail('the result of an if has another representation than its regions');
      // The result has the type of both branches, or is `real` for an
      // integer branch and a real one.
      const types = new Set([a.type, b.type]);
      if (
        !(types.size === 1 && op.result.type === a.type) &&
        !(
          op.result.type === 'real' &&
          types.has('real') &&
          types.has('integer')
        )
      )
        fail(
          `the result of an if has the type ${op.result.type}, and its regions the types ${a.type} and ${b.type}`
        );
      return;
    }
    case 'and':
    case 'or':
      arity(1);
      operandsIn('boolean');
      resultIn('boolean');
      if (op.rest.length === 0)
        fail(`the operation ${op.kind} has no region after its first operand`);
      for (const region of op.rest)
        if (yielded(region).representation !== 'boolean')
          fail(`a region of the operation ${op.kind} does not yield a boolean`);
      return;
    case 'call': {
      const fn = program.functions[op.function];
      if (fn === undefined) return fail(`a call of the function ${op.function}, which does not exist`);
      arity(fn.parameters.length);
      op.operands.forEach((operand, i) => {
        const parameter = fn.parameters[i];
        if (operand.representation !== parameter.representation)
          fail(
            `the argument ${i + 1} of a call of ${fn.name} has another representation than its parameter`
          );
        // An integer argument is a valid real; a real is not an integer.
        if (
          operand.type !== parameter.type &&
          !(operand.type === 'integer' && parameter.type === 'real')
        )
          fail(
            `the argument ${i + 1} of a call of ${fn.name} has the type ${operand.type}, and its parameter the type ${parameter.type}`
          );
      });
      if (
        op.result.type !== fn.result.type ||
        op.result.representation !== fn.result.representation
      )
        fail(`the result of a call of ${fn.name} differs from its function`);
      if (EFFECT_RANK[op.effect] < EFFECT_RANK[fn.body.effect])
        fail(
          `the effect of a call of ${fn.name} (${op.effect}) omits the effect of its body (${fn.body.effect})`
        );
      return;
    }
    case 'trace':
      if (typeof op.trace !== 'string' || op.trace === '')
        fail('a trace operation has no trace id');
      // The test heads take real operands and have a real value.
      operandsIn('number');
      resultIn('number');
      return;
    default:
      return fail(`an operation of the unknown kind ${(op as { kind: string }).kind}`);
  }
}
