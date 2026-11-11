/**
 * The verifier of the structured representation (`structured-ir.ts`).
 *
 * The verifier checks the structure, not that the lowering preserves the
 * value of the program: tests do that. The structural checks (definitions,
 * visibility, yields, effects, owner, types) are the same for every
 * target. The checks of representations read the policy of the target
 * (`RepresentationPolicy`): the core names no representation.
 */
import type { Expression } from '../global-types.js';
import {
  definedValues,
  dischargedEffect,
  elementOf,
  isClosedRegion,
  isListType,
  isTupleType,
  listType,
  joinEffects,
  operationCanAbort,
  regionsOf,
  unionStates,
  weakerEffect,
  yieldedValues,
  type EffectFact,
  type IRState,
  type IRExit,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type BinaryFunctionName,
  type Representation,
  type UnaryFunctionName,
  type ValueType,
} from './structured-ir.js';

/** The operations whose operands and result the policy constrains, with no
 *  other rule. */
export type PolicyOperationKind =
  | 'add'
  | 'negate'
  | 'multiply'
  | 'less'
  | 'less-equal'
  | 'equal'
  | 'not-equal'
  | 'min'
  | 'max'
  | 'and'
  | 'or'
  | 'sqrt'
  | 'mod'
  | 'floor'
  | 'divide'
  | 'at'
  | 'length'
  | 'not'
  | 'build'
  | 'replace-at'
  | 'list'
  | 'tuple'
  | 'get'
  | 'append'
  | 'trace'
  | 'draw'
  | 'seeded'
  | 'host';

/** The operations of `PolicyOperationKind` that a target can lack: a target
 *  with no random stream (GLSL) has no `draw` and no `seeded`, and a target
 *  that calls no code of the host has no `host`; the verifier refuses them
 *  there. */
type OptionalPolicyOperationKind = 'draw' | 'seeded' | 'host';

/** The representations of the operands and of the result of an operation
 *  on a target. */
export type OperationRule = {
  /** The representations that the result can have. */
  readonly results: readonly Representation[];
  /** The representations that each operand can have, or `same`: each
   *  operand has the representation of the result. For `and` and `or`, the
   *  value of each region after the first operand is an operand too. */
  readonly operands: readonly Representation[] | 'same';
};

/**
 * What a target supplies to the verifier: its representations and the
 * rules that use them. The JavaScript policy is `JAVASCRIPT_POLICY`
 * (`javascript-structured-policy.ts`).
 *
 * A GLSL policy would supply the representations `float`, `int`, `bool`
 * and `vec2`; `float` for `real` and `integer` (a computed integer is a
 * float, as in `glslRepresentationOfValue()` of `glsl-fragment.ts`),
 * `bool` for `boolean` and `vec2` for `complex`; the conversions
 * `to-float` (`int` to `float`), `to-int` (a `float` read as an index) and
 * `real-to-complex` (`float` to `vec2`); and, for example, `add` on
 * `float`, `int` and `vec2` with operands of the representation of the
 * result, and `less` on `float` or `int` operands with a `bool` result.
 */
export type RepresentationPolicy = {
  /** The name of the target, at the start of each message of the
   *  verifier. */
  readonly name: string;
  /** Every representation of the target. */
  readonly representations: ReadonlySet<Representation>;
  /** The representation of a value of the type `type`, or `undefined` when
   *  the target holds no value of that type (a list of booleans on
   *  JavaScript). */
  readonly representationOf: (type: ValueType) => Representation | undefined;
  /** The conversions of the target by name (`IRConvert.conversion`): the
   *  representation of the operand, and the type and the representation of
   *  the result. */
  readonly conversions: Readonly<
    Record<
      string,
      {
        readonly from: Representation;
        readonly to: Representation;
        readonly type: ValueType;
      }
    >
  >;
  readonly operations: Readonly<
    Record<
      Exclude<PolicyOperationKind, OptionalPolicyOperationKind>,
      OperationRule
    > &
      Partial<Record<OptionalPolicyOperationKind, OperationRule>>
  >;
  /** The functions of one or two operands that the target has
   *  (`IRUnaryFunction`, `IRBinaryFunction`), each with the representations
   *  of its operands and of its result. A function that is not listed is
   *  not in the target: an operation that applies it fails the check. */
  readonly functions: Readonly<
    Partial<Record<UnaryFunctionName | BinaryFunctionName, OperationRule>>
  >;
};

/**
 * Throw when `program` is not well formed under the policy `policy`. The
 * checks: each value is defined once, by the program, before its uses, and
 * is used only in the region of its definition and the regions nested in
 * it; each value has the representation that the policy gives to its type;
 * each operation has the operands and the result of its kind, and an effect
 * fact; each region ends in one yield, of one value, or of one value per
 * result for a region of an `if`; the regions of an `if` yield values of
 * the type and the representation of each result, in the order of the
 * results; a conversion is one of the policy; the condition of an `if` is a
 * boolean; the effect of each region is the join of the effects of its
 * operations, and the effect of an operation that evaluates a region or
 * calls a function includes the effect of that region or of that function;
 * each function yields a value of the type and the representation of its
 * result, and its body reads no input of the program; each capture of the
 * program has its own binding, and each read of a capture names a capture
 * of the program, with its binding, its snapshot, its type and its
 * representation, and is `pure`, so two reads of one binding agree on the
 * type and the representation; each origin is one of `preparedNodes`, the
 * nodes of the prepared artifact that the program was lowered from.
 *
 * For a list: an `at` reads a list, or a tuple whose elements have one
 * type, and an integer index and has the type of an element; a `length`
 * reads a list or such a tuple and has the type `integer`; both are `pure`.
 * A `list` reads its elements, each a real or an integer that fits the
 * element type of its result; a `tuple` reads one element per position of
 * its result type, each fitting that position; a `get` reads a tuple and
 * has the type of its position, which is in range; an `append` reads a
 * list and an element by the rule of `replace-at`; the four are `pure`.
 * A `build` reads two integer bounds, its body has one integer
 * parameter (the index) and yields a real or an integer element, and its
 * result is a list whose elements hold that element (an integer element in
 * a list of reals is accepted, a real element in a list of integers is
 * not). A `replace-at` reads a list, an integer index and a real or
 * integer element, is `pure`, and has a list result that holds the
 * elements of the list and the element by the same rule. The result of a
 * function, of an `if`, and a carried value of a loop can be a list; a
 * list of integers is a valid list of reals there, as an integer is a valid
 * real; a tuple is valid where its type fits position by position. No
 * other operation that computes a value (an arithmetic
 * operation, a comparison, `and`, `or`, a conversion, a trace) has a list
 * or a tuple operand or result: the interpreter applies such an operation
 * to each element of a list, and the representation has no such operation
 * (the route writes it as a `build` over the elements).
 *
 * For a `loop`: its bounds are integers; only the body of a loop has
 * parameters, each defined once, at the entry of the body, and visible in
 * the body and the regions nested in it only; the first parameter is the
 * index, an integer; then, for each carried value, the loop has one
 * initial value (an operand after the bounds), one parameter, one value
 * that the body yields, and one result, in the same order, and the four
 * have one representation; the parameter and the result have one type, and
 * the initial value and the yielded value have that type, or are integers
 * when it is `real` (as the two values of an `if` merge to `real`); the
 * iteration budget is absent or a positive number. A region records that
 * it can abort exactly when one of its operations can
 * (`operationCanAbort()`).
 *
 * For an `exit` (`IRExit`): it is the last operation of its region, and an
 * `if` whose two branches are closed is too; only a branch of an `if` is
 * closed (`isClosedRegion()`), so the body of a loop, of a `build`, of a
 * function, the root and a region of `and` or `or` are open. An `exit` is
 * in the body of a loop, or in a branch of an `if` there, at any depth of
 * branches, with no region of a `build`, an `and` or an `or` between: it
 * ends the innermost such loop. It has no result, is `pure`, and has one
 * operand per result of its loop, in the order of the results, each of the
 * representation of the carried value and of its type (an integer for a
 * real, a list of integers for a list of reals), as a value that the body
 * yields. An `if` with one closed branch has the results of its open
 * branch; an `if` with two closed branches has no result.
 *
 * For the states that an operation touches (`OperationBase.touches`,
 * `verifyStates()`): a `pure` operation names none and an `effectful` one at
 * least one; an operation with no region and no call names only its own,
 * so an `unknown` one names none; an operation that evaluates a region or
 * calls a function names every state of that region or of the body of that
 * function; the states of a region are the union of the states of its
 * operations. A `draw` has no operand, a real result, the effect
 * `effectful` and exactly the state `random`. A `seeded` has one real seed
 * (or complex in the `complex` mode) or a literal seed (a finite number or a
 * string), a body with no parameter that yields one value of its result,
 * and the effect and the states of its body without `random`
 * (`dischargedEffect()`): it discharges `random` only, and never an `unknown`
 * body. A target whose policy has no `draw` or no `seeded` refuses it.
 *
 * For a host operation (`IRHostCall`): it names a binding of
 * `IRProgram.hosts`; a read has no operand; the operands and the result have
 * the representations of the rule `host` of the policy (a target with no
 * such rule refuses it); the result has the type of the binding; the effect
 * is `pure` for a call of a binding declared pure and `unknown` otherwise,
 * and the operation names no state.
 *
 * A call cycle (a function that calls itself, directly or through other
 * functions) is accepted. The summary of the effects is correct for it:
 * the check of each call (its effect includes the effect of the body of
 * its function) and of each body (its effect is the join of its
 * operations) hold together around the cycle only when every body of the
 * cycle has at least the effect of every operation of the cycle, so no
 * effect of a function that a call reaches is missing from the call. A
 * target that cannot emit a cycle refuses it before lowering.
 */
export function verifyProgram(
  program: IRProgram,
  preparedNodes: ReadonlySet<Expression>,
  policy: RepresentationPolicy
): void {
  const fail = (message: string): never => {
    throw new Error(`${policy.name} structured representation: ${message}`);
  };
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
    if (!policy.representations.has(value.representation))
      fail(
        `the value ${value.id} has the representation ${value.representation}, which the target does not have`
      );
    const representation = policy.representationOf(value.type);
    if (representation === undefined)
      fail(
        `the value ${value.id} has the type ${value.type}, which the target does not hold`
      );
    if (representation !== value.representation)
      fail(
        `the value ${value.id} of the type ${value.type} has the representation ${value.representation}`
      );
  };
  const collect = (region: IRRegion) => {
    region.operations.forEach((op, index) => {
      for (const value of definedValues(op)) define(value, region, index);
      for (const inner of regionsOf(op)) {
        // The parameters of a region are defined at its entry (-1).
        for (const parameter of inner.parameters ?? [])
          define(parameter, inner, -1);
        collect(inner);
      }
    });
  };
  // The parameters of a function are the parameters of its body.
  for (const fn of program.functions) {
    for (const parameter of fn.parameters) define(parameter, fn.body, -1);
    collect(fn.body);
  }
  collect(program.root);

  // The captures of the program, each with its own binding.
  const bindings = new Set<object>();
  for (const capture of program.captures) {
    if (bindings.has(capture.binding))
      fail(`the binding ${capture.name} is captured twice`);
    bindings.add(capture.binding);
    if (!policy.representations.has(capture.representation))
      fail(
        `the capture ${capture.name} has the representation ${capture.representation}, which the target does not have`
      );
    if (policy.representationOf(capture.type) !== capture.representation)
      fail(
        `the capture ${capture.name} of the type ${capture.type} has the representation ${capture.representation}`
      );
    // A snapshot is a finite number: a real, or an integer of the type
    // `integer`. A capture of another type is refused, because an emitter
    // writes the snapshot as a number literal: a `complex` capture would
    // give a number where its reads promise a complex value.
    if (capture.type !== 'real' && capture.type !== 'integer')
      fail(`the capture ${capture.name} has the type ${capture.type}`);
    if (!Number.isFinite(capture.snapshot))
      fail(`the snapshot of the capture ${capture.name} is not finite`);
    if (capture.type === 'integer' && !Number.isInteger(capture.snapshot))
      fail(
        `the snapshot of the integer capture ${capture.name} is not an integer`
      );
  }

  // The bindings of the host: a scalar result, and a read is never pure.
  for (const binding of program.hosts ?? []) {
    if (binding.form !== 'call' && binding.form !== 'read')
      fail(`the host binding ${binding.name} has the form ${binding.form}`);
    if (elementOf(binding.result) !== undefined)
      fail(`the host binding ${binding.name} has a list result`);
    if (policy.representationOf(binding.result) === undefined)
      fail(
        `the host binding ${binding.name} has the type ${binding.result}, which the target does not hold`
      );
    if (binding.form === 'read' && binding.pure)
      fail(`the host binding ${binding.name} is a read, and is declared pure`);
  }

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
      fail(
        `the value ${value.id} is used outside the region of its definition`
      );
    if (definition.index >= frame!.index)
      fail(`the value ${value.id} is used before its definition`);
  };

  /** One yield, the last operation, of `count` values; or, for a closed
   *  branch of an `if`, no yield. No operation follows an `exit` or an `if`
   *  whose two branches are closed. */
  const verifyRegionShape = (
    region: IRRegion,
    count: number,
    owner?: IROperation
  ) => {
    region.operations.forEach((op, i) => {
      if (i === region.operations.length - 1) return;
      if (op.kind === 'exit') fail('an operation follows an exit');
      if (
        op.kind === 'if' &&
        isClosedRegion(op.then) &&
        isClosedRegion(op.else)
      )
        fail('an operation follows an if whose two branches are closed');
    });
    if (isClosedRegion(region)) {
      if (owner?.kind === 'loop')
        fail('the body of a loop is closed: every pass exits');
      if (owner?.kind !== 'if')
        fail(
          `a region that is not a branch of an if is closed (${owner?.kind ?? 'the body of a function or the root'})`
        );
      if (region.operations.some((op) => op.kind === 'yield'))
        fail('a closed region has a yield');
      return;
    }
    const yields = region.operations.filter((op) => op.kind === 'yield').length;
    if (yields === 0) fail('a region has no yield');
    if (yields > 1) fail(`a region has ${yields} yields`);
    const last = region.operations[region.operations.length - 1];
    if (last.kind !== 'yield')
      fail('the yield of a region is not its last operation');
    if (last.operands.length === count) return;
    if (owner?.kind === 'if')
      fail(
        `a region of an if yields ${last.operands.length} values, and the if has ${count} results`
      );
    if (owner?.kind === 'loop')
      fail(
        `the body of a loop yields ${last.operands.length} values, and the loop has ${count} results`
      );
    fail(
      `the operation yield has ${last.operands.length} operands, not ${count}`
    );
  };

  /** What an `exit` of a region would end: the innermost loop whose body
   *  holds the region, and the kind of the first region between the two that
   *  is not a branch of an `if` (`build`, `and`, `or`), if any. */
  type ExitScope = { readonly loop?: IRLoop; readonly barrier?: string };

  /** The checks of an `exit` that read its loop (`IRExit`). */
  const verifyExit = (op: IRExit, scope: ExitScope) => {
    const loop = scope.loop;
    if (loop === undefined)
      return fail('an exit is outside the body of a loop');
    if (scope.barrier !== undefined)
      fail(
        `an exit is in a region of the operation ${scope.barrier}, between it and its loop`
      );
    if (op.result !== undefined) fail('an exit has a result');
    if (op.effect !== 'pure') fail(`an exit has the effect ${op.effect}`);
    if (op.operands.length !== loop.results.length)
      fail(
        `an exit has ${op.operands.length} operands, and its loop has ${loop.results.length} results`
      );
    const parameters = loop.body.parameters ?? [];
    op.operands.forEach((value, i) => {
      const parameter = parameters[i + 1];
      if (parameter === undefined) return;
      if (value.representation !== parameter.representation)
        fail(
          `the operand ${i + 1} of an exit has the representation ${value.representation}, and the carried value ${i + 1} of its loop ${parameter.representation}`
        );
      if (!fitsType(value.type, parameter.type))
        fail(
          `the operand ${i + 1} of an exit has the type ${value.type}, and the carried value ${i + 1} of its loop the type ${parameter.type}`
        );
    });
  };

  // `inFunction`: the region is the body of a function or is nested in it.
  // Such a region reads no input of the program. `count`: the number of
  // values that the region yields. `exits`: what an `exit` of the region
  // ends.
  const verifyRegion = (
    region: IRRegion,
    outer: readonly Frame[],
    inFunction: boolean,
    count: number,
    owner?: IROperation,
    exits: ExitScope = {}
  ) => {
    verifyRegionShape(region, count, owner);
    if (
      region.parameters !== undefined &&
      owner?.kind !== 'loop' &&
      owner?.kind !== 'build'
    )
      fail(
        'a region that is not the body of a loop or of a build has parameters'
      );
    const effects: EffectFact[] = [];
    const states: (readonly IRState[] | undefined)[] = [];
    region.operations.forEach((op, index) => {
      const frames = [...outer, { region, index }];
      if (inFunction && op.kind === 'input')
        fail(`the body of a function reads the input ${op.input}`);
      if (!isEffect(op.effect))
        fail(`the operation ${op.kind} has no effect fact`);
      if (!preparedNodes.has(op.origin))
        fail(`the origin of the operation ${op.kind} is not a prepared node`);
      for (const operand of op.operands) use(operand, frames);
      if (op.kind === 'exit') verifyExit(op, exits);
      // A loop body starts a new scope of exits; a branch of an `if` keeps
      // the scope of its region; every other region is a barrier.
      const innerExits: ExitScope =
        op.kind === 'loop'
          ? { loop: op }
          : op.kind === 'if'
            ? exits
            : { ...exits, barrier: exits.barrier ?? op.kind };
      for (const inner of regionsOf(op)) {
        verifyRegion(
          inner,
          frames,
          inFunction,
          op.kind === 'if' || op.kind === 'loop' ? op.results.length : 1,
          op,
          innerExits
        );
        // A `seeded` discharges `random`: `verifyStates()` checks its effect.
        if (op.kind !== 'seeded' && weakerEffect(op.effect, inner.effect))
          fail(
            `the effect of the operation ${op.kind} (${op.effect}) omits the effect of its region (${inner.effect})`
          );
      }
      verifySignature(op, program, policy, fail);
      verifyStates(op, program, fail);
      effects.push(op.effect);
      states.push(op.touches);
    });
    if (!isEffect(region.effect)) fail('a region has no effect fact');
    // The abort fact, checked as the effect fact is.
    const aborts = region.operations.some((op) =>
      operationCanAbort(op, program.functions)
    );
    if ((region.canAbort === true) !== aborts)
      fail(
        `the abort fact of a region (${region.canAbort === true}) does not agree with its operations (${aborts})`
      );
    const joined = effects.reduce<EffectFact>(
      (result, effect) => joinEffects(result, effect),
      'pure'
    );
    if (region.effect !== joined)
      fail(
        `the effect of a region (${region.effect}) does not agree with its operations (${joined})`
      );
    // The states of a region are the union of the states of its operations.
    // A loop, not a spread: a region can hold more operations than a call
    // takes arguments.
    const all = new Set<IRState>();
    for (const list of states) for (const s of list ?? []) all.add(s);
    const touched = unionStates([...all]);
    if (!sameStates(region.touches, touched))
      fail(
        `the states of a region (${statesText(region.touches)}) do not agree with its operations (${statesText(touched)})`
      );
  };

  // A function body sees its parameters and its own values only.
  for (const fn of program.functions) {
    verifyRegion(fn.body, [], true, 1);
    if (policy.representationOf(fn.result.type) !== fn.result.representation)
      fail(
        `the result of ${fn.name} has the type ${fn.result.type} and the representation ${fn.result.representation}`
      );
    const value = yieldedValues(fn.body)[0];
    // An integer is a valid real, and a list of integers a valid list of
    // reals, as for an argument of a call.
    if (
      !fitsType(value.type, fn.result.type) ||
      value.representation !== fn.result.representation
    )
      fail(
        `the body of ${fn.name} yields a ${value.type} value, and its result is a ${fn.result.type}`
      );
  }
  verifyRegion(program.root, [], false, 1);
}

const isEffect = (e: unknown): e is EffectFact =>
  e === 'pure' || e === 'effectful' || e === 'unknown';

const statesText = (states: readonly IRState[] | undefined): string =>
  states === undefined ? 'none' : states.join(', ');

const sameStates = (
  a: readonly IRState[] | undefined,
  b: readonly IRState[] | undefined
): boolean => statesText(a) === statesText(b);

/**
 * The checks of the states that `op` touches (`OperationBase.touches`): a
 * list of states, sorted, with no duplicate, and not empty. A `pure`
 * operation names none. An `effectful` operation names at least one. An
 * operation with no region and no call names only its own states, so an
 * `unknown` one names none. An operation that evaluates a region names the
 * states of each region, and a call the states of the body of its function.
 * A `draw` names exactly `random`. A `seeded` has the effect and the states
 * of its body without `random` (`dischargedEffect()`): an `unknown` body is
 * never discharged.
 */
function verifyStates(
  op: IROperation,
  program: IRProgram,
  fail: (message: string) => never
): void {
  const touches = op.touches;
  if (touches !== undefined) {
    if (
      !Array.isArray(touches) ||
      touches.length === 0 ||
      touches.some((s) => typeof s !== 'string' || s === '')
    )
      fail(`the operation ${op.kind} has a malformed list of states`);
    if (!sameStates(touches, unionStates(touches)))
      fail(
        `the states of the operation ${op.kind} are not sorted or have a duplicate`
      );
  }
  if (op.effect === 'pure' && touches !== undefined)
    fail(
      `the pure operation ${op.kind} touches the states ${statesText(touches)}`
    );
  if (op.effect === 'effectful' && touches === undefined)
    fail(`the effectful operation ${op.kind} names no state that it touches`);
  if (op.kind === 'draw') {
    if (op.effect !== 'effectful' || statesText(touches) !== 'random')
      fail(
        `a draw has the effect ${op.effect} and the states ${statesText(touches)}, not effectful and random`
      );
    return;
  }
  if (op.kind === 'seeded') {
    const expected = dischargedEffect(op.body.effect, op.body.touches);
    if (op.effect !== expected.effect || !sameStates(touches, expected.touches))
      fail(
        `a seeded has the effect ${op.effect} and the states ${statesText(touches)}, and its body discharged gives ${expected.effect} and ${statesText(expected.touches)}`
      );
    return;
  }
  const inner = [
    ...regionsOf(op).map((r) => r.touches),
    ...(op.kind === 'call'
      ? [program.functions[op.function]?.body.touches]
      : []),
  ];
  if (regionsOf(op).length === 0 && op.kind !== 'call') {
    if (op.effect === 'unknown' && touches !== undefined)
      fail(
        `the operation ${op.kind} of unknown effect names the states ${statesText(touches)}`
      );
    return;
  }
  for (const states of inner)
    for (const s of states ?? [])
      if (!(touches ?? []).includes(s))
        fail(
          `the states of the operation ${op.kind} (${statesText(touches)}) omit the state ${s} of its ${op.kind === 'call' ? 'function' : 'region'}`
        );
}

/** Whether a value of the type `type` is a valid value of the type
 *  `wider`: the same type, an integer for a real, a list of integers
 *  for a list of reals (the elements of a list of integers are valid
 *  reals), or a tuple of the length of `wider` whose element at each
 *  position fits the element of `wider` there. A real is not an integer. */
function fitsType(type: ValueType, wider: ValueType): boolean {
  if (type === wider || (type === 'integer' && wider === 'real')) return true;
  if (type === listType('integer') && wider === listType('real')) return true;
  return (
    isTupleType(type) &&
    isTupleType(wider) &&
    type.elements.length === wider.elements.length &&
    type.elements.every((e, i) => fitsType(e, wider.elements[i]))
  );
}

/** Whether `type` is a list or a tuple type: a value of several elements. */
const isAggregate = (type: ValueType): boolean =>
  isListType(type) || isTupleType(type);

/** The type of a value that is either a value of the type `a` or of the
 *  type `b` (the result of an `if`), or `undefined` when no type holds
 *  both. */
function mergedType(a: ValueType, b: ValueType): ValueType | undefined {
  if (fitsType(a, b)) return b;
  if (fitsType(b, a)) return a;
  return undefined;
}

/** The operations that compute a value from scalar operands. The
 *  interpreter applies each to the elements of a list operand; the
 *  representation has no such operation, so none has a list or a tuple
 *  operand, or a list or a tuple result. */
const ELEMENTWISE_KINDS: ReadonlySet<IROperation['kind']> = new Set<
  IROperation['kind']
>([
  'literal',
  'add',
  'negate',
  'not',
  'multiply',
  'less',
  'less-equal',
  'equal',
  'not-equal',
  'min',
  'max',
  'sqrt',
  'mod',
  'floor',
  'divide',
  'unary',
  'binary',
  'and',
  'or',
  'trace',
  'capture',
  'draw',
  'seeded',
  'host',
]);

function verifySignature(
  op: IROperation,
  program: IRProgram,
  policy: RepresentationPolicy,
  fail: (message: string) => never
): void {
  const arity = (n: number) => {
    if (op.operands.length !== n)
      fail(
        `the operation ${op.kind} has ${op.operands.length} operands, not ${n}`
      );
  };
  const atLeast = (n: number) => {
    if (op.operands.length < n)
      fail(
        `the operation ${op.kind} has ${op.operands.length} operands, fewer than ${n}`
      );
  };
  const operandsIn = (representations: readonly Representation[]) => {
    for (const operand of op.operands)
      if (!representations.includes(operand.representation))
        fail(
          `an operand of the operation ${op.kind} has the representation ${operand.representation}`
        );
  };
  const resultIn = (representations: readonly Representation[]) => {
    if (
      op.result === undefined ||
      !representations.includes(op.result.representation)
    )
      fail(
        `the result of the operation ${op.kind} has the representation ${op.result?.representation}`
      );
  };
  /** The representations that the rule of `kind` admits for an operand. */
  const operandRule = (
    kind: PolicyOperationKind
  ): readonly Representation[] => {
    const rule =
      policy.operations[kind] ?? fail(`the target has no operation ${kind}`);
    const operands = rule.operands;
    return operands === 'same' ? [op.result?.representation ?? ''] : operands;
  };
  // An arithmetic result is an integer only when every operand is one.
  const integerOnlyFromIntegers = () => {
    if (
      op.result?.type === 'integer' &&
      op.operands.some((operand) => operand.type !== 'integer')
    )
      fail(
        `the operation ${op.kind} has an integer result and an operand that is not an integer`
      );
  };
  // A list or a tuple is an operand only of `at`, `length`, `get`,
  // `replace-at`, `append`, a call, a loop (as a carried value), a yield and
  // a conversion of the representation of a list, and the result only of an
  // input, a call, an `if`, a loop, a `build`, a `list`, a `tuple`, a
  // `replace-at`, an `append` and such a conversion.
  if (
    ELEMENTWISE_KINDS.has(op.kind) &&
    (op.operands.some((operand) => isAggregate(operand.type)) ||
      (op.result !== undefined && isAggregate(op.result.type)))
  )
    fail(`the operation ${op.kind} has a list operand or a list result`);
  switch (op.kind) {
    case 'yield':
      // The number of its operands is checked with its region.
      if (op.result !== undefined) fail('a yield has a result');
      return;
    case 'exit':
      // Checked with its loop (`verifyExit()`).
      return;
    case 'literal': {
      arity(0);
      // The kind of the value agrees with the type of the result; the
      // representation of the result is the one of its type.
      const value = op.value;
      const types: readonly ValueType[] | undefined =
        typeof value === 'number'
          ? ['real', 'integer']
          : typeof value === 'boolean'
            ? ['boolean']
            : typeof value === 'object' &&
                value !== null &&
                typeof value.re === 'number' &&
                typeof value.im === 'number'
              ? ['complex']
              : undefined;
      if (types === undefined || !types.includes(op.result.type))
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
    case 'capture': {
      arity(0);
      const capture = program.captures[op.capture];
      if (capture === undefined)
        return fail(
          `a read of the capture ${op.capture}, which the program does not list`
        );
      if (op.binding !== capture.binding)
        fail(`a read of the capture ${capture.name} names another binding`);
      if (!Object.is(op.snapshot, capture.snapshot))
        fail(`a read of the capture ${capture.name} has another snapshot`);
      if (
        op.result.type !== capture.type ||
        op.result.representation !== capture.representation
      )
        fail(
          `a read of the capture ${capture.name} does not match the capture`
        );
      // A snapshot is fixed when the program is compiled.
      if (op.effect !== 'pure')
        fail(`a read of the capture ${capture.name} is not pure`);
      return;
    }
    case 'sqrt':
      arity(1);
      resultIn(policy.operations.sqrt.results);
      operandsIn(operandRule('sqrt'));
      // A square root is not an integer, also of an integer operand.
      if (op.result.type === 'integer')
        fail('the operation sqrt has an integer result');
      return;
    case 'add':
    case 'multiply':
    case 'min':
    case 'max':
      atLeast(2);
      resultIn(policy.operations[op.kind].results);
      operandsIn(operandRule(op.kind));
      integerOnlyFromIntegers();
      // A complex sum or product has a complex operand; a real operand of a
      // sum is read as its real part, of a product as a real factor of each
      // part. A real sum or product has no complex operand.
      if (
        (op.kind === 'add' || op.kind === 'multiply') &&
        (op.result.type === 'complex') !==
          op.operands.some((o) => o.type === 'complex')
      )
        fail(
          `the operation ${op.kind} has a result of the type ${op.result.type} and ` +
            `${op.result.type === 'complex' ? 'no' : 'a'} complex operand`
        );
      // A complex product has two operands.
      if (
        op.kind === 'multiply' &&
        op.result.type === 'complex' &&
        op.operands.length !== 2
      )
        fail(`a complex multiply has ${op.operands.length} operands, not two`);
      return;
    case 'mod':
      arity(2);
      resultIn(policy.operations.mod.results);
      operandsIn(operandRule('mod'));
      integerOnlyFromIntegers();
      return;
    case 'floor':
      arity(1);
      resultIn(policy.operations.floor.results);
      operandsIn(operandRule('floor'));
      if (op.result.type !== 'integer')
        fail(`the operation floor has a result of the type ${op.result.type}`);
      return;
    case 'divide':
      arity(2);
      resultIn(policy.operations.divide.results);
      operandsIn(operandRule('divide'));
      // A quotient of integers is not an integer.
      if (op.result.type === 'integer')
        fail('the operation divide has an integer result');
      // A complex quotient has a complex operand; a real quotient has none.
      if (
        (op.result.type === 'complex') !==
        op.operands.some((o) => o.type === 'complex')
      )
        fail(
          `the operation divide has a result of the type ${op.result.type} and ` +
            `${op.result.type === 'complex' ? 'no' : 'a'} complex operand`
        );
      return;
    case 'unary':
    case 'binary': {
      arity(op.kind === 'unary' ? 1 : 2);
      const rule = Object.hasOwn(policy.functions, op.fn)
        ? policy.functions[op.fn]
        : undefined;
      if (rule === undefined)
        return fail(`the target has no function ${op.fn}`);
      resultIn(rule.results);
      operandsIn(
        rule.operands === 'same' ? [op.result.representation] : rule.operands
      );
      if (op.effect !== 'pure') fail(`the function ${op.fn} is not pure`);
      const types = op.operands.map((operand) => operand.type);
      if (types.includes('boolean') || op.result.type === 'boolean')
        fail(`the function ${op.fn} has a boolean operand or result`);
      // The rule of each identifier (`UnaryFunctionName`,
      // `BinaryFunctionName`): `abs` has a real result, an integer only for
      // an integer operand; `complex` has two real operands and a complex
      // result; `pow` has two real operands and a real result, or two
      // complex operands and a complex result; each other function of two
      // operands has real operands and a real result; every other function
      // has a complex result for a complex operand and a real one for a real
      // or an integer operand.
      const complexOperands = types.filter((t) => t === 'complex').length;
      const expected: readonly ValueType[] =
        op.fn === 'abs'
          ? types[0] === 'integer'
            ? ['integer', 'real']
            : ['real']
          : op.fn === 'complex'
            ? complexOperands === 0
              ? ['complex']
              : []
            : op.fn === 'pow' && complexOperands === 2
              ? ['complex']
              : op.kind === 'binary'
                ? complexOperands > 0
                  ? []
                  : ['real']
                : [types[0] === 'complex' ? 'complex' : 'real'];
      if (!expected.includes(op.result.type))
        fail(
          `the function ${op.fn} of ${types.join(', ')} has a result of the type ${op.result.type}`
        );
      return;
    }
    case 'negate':
      arity(1);
      resultIn(policy.operations.negate.results);
      operandsIn(operandRule('negate'));
      integerOnlyFromIntegers();
      return;
    case 'not':
      arity(1);
      resultIn(policy.operations.not.results);
      operandsIn(operandRule('not'));
      if (op.operands[0].type !== 'boolean' || op.result.type !== 'boolean')
        fail(
          'the operation not has an operand or a result that is not a boolean'
        );
      return;
    case 'build': {
      // The bounds, the index and the element.
      arity(2);
      const integer = policy.representationOf('integer');
      for (const bound of op.operands)
        if (bound.type !== 'integer' || bound.representation !== integer)
          fail(`a bound of a build has the type ${bound.type}`);
      const parameters = op.body.parameters ?? [];
      if (parameters.length !== 1)
        fail(
          `the body of a build has ${parameters.length} parameters, not one index`
        );
      if (
        parameters[0].type !== 'integer' ||
        parameters[0].representation !== integer
      )
        fail(`the index of a build has the type ${parameters[0].type}`);
      const element = elementOf(op.result.type);
      if (element === undefined)
        return fail(
          `a build has a result of the type ${op.result.type}, not a list`
        );
      const value = yieldedValues(op.body)[0];
      // The element is a number; an integer element is a valid element of a
      // list of reals, a real one is not an element of a list of integers.
      if (
        (value.type !== 'real' && value.type !== 'integer') ||
        !fitsType(value.type, element)
      )
        fail(
          `the body of a build yields a value of the type ${value.type}, and its result has the type ${op.result.type}`
        );
      resultIn(policy.operations.build.results);
      // The effect of the body is checked with the region
      // (`verifyRegion()`).
      operandsIn(operandRule('build'));
      return;
    }
    case 'replace-at': {
      arity(3);
      const [list, index, value] = op.operands;
      const element = elementOf(list.type);
      if (element === undefined)
        return fail(
          `the operation replace-at reads a value of the type ${list.type}, not a list`
        );
      if (index.type !== 'integer')
        fail(
          `the index of the operation replace-at has the type ${index.type}`
        );
      const resultElement = elementOf(op.result.type);
      if (resultElement === undefined)
        return fail(
          `the operation replace-at has a result of the type ${op.result.type}, not a list`
        );
      // The result holds the elements of the list and the new element: an
      // integer fits a list of reals, a real does not fit a list of integers.
      if (
        (value.type !== 'real' && value.type !== 'integer') ||
        !fitsType(value.type, resultElement) ||
        !fitsType(element, resultElement)
      )
        fail(
          `the operation replace-at writes a ${value.type} element into a ${list.type} and has a result of the type ${op.result.type}`
        );
      resultIn(policy.operations['replace-at'].results);
      operandsIn(operandRule('replace-at'));
      if (op.effect !== 'pure') fail('the operation replace-at is not pure');
      return;
    }
    case 'less':
    case 'less-equal':
    case 'equal':
    case 'not-equal':
      arity(2);
      resultIn(policy.operations[op.kind].results);
      operandsIn(operandRule(op.kind));
      return;
    case 'convert': {
      arity(1);
      const [operand] = op.operands;
      const conversion = Object.hasOwn(policy.conversions, op.conversion)
        ? policy.conversions[op.conversion]
        : undefined;
      if (
        conversion === undefined ||
        operand.representation !== conversion.from ||
        op.result.type !== conversion.type ||
        op.result.representation !== conversion.to ||
        // A conversion that keeps the representation gives a value the
        // wider type of a local (an integer as a real).
        (conversion.from === conversion.to &&
          !fitsType(operand.type, op.result.type))
      )
        fail(
          `an invalid conversion ${String(op.conversion)} from ${operand.type} to ${op.result.type}`
        );
      return;
    }
    case 'if': {
      arity(1);
      if (op.operands[0].type !== 'boolean')
        fail('the condition of an if is not a boolean');
      // A closed branch yields nothing: the results are the values of the
      // open branch, or there are none when both are closed.
      const thenClosed = isClosedRegion(op.then);
      const elseClosed = isClosedRegion(op.else);
      if (thenClosed && elseClosed) {
        if (op.results.length > 0)
          fail(
            `an if whose two branches are closed has ${op.results.length} results`
          );
        return;
      }
      const thenValues = yieldedValues(thenClosed ? op.else : op.then);
      const elseValues = yieldedValues(elseClosed ? op.then : op.else);
      op.results.forEach((result, i) => {
        const a = thenValues[i];
        const b = elseValues[i];
        if (a.representation !== b.representation)
          fail(
            `the two results of an if have different representations (${a.representation}, ${b.representation})`
          );
        if (a.representation !== result.representation)
          fail(
            'the result of an if has another representation than its regions'
          );
        // The result has the type of both branches, or is `real` for an
        // integer branch and a real one (a list of reals for a list of
        // integers and a list of reals).
        if (mergedType(a.type, b.type) !== result.type)
          fail(
            `the result of an if has the type ${result.type}, and its regions the types ${a.type} and ${b.type}`
          );
      });
      return;
    }
    case 'at':
    case 'length': {
      arity(op.kind === 'at' ? 2 : 1);
      const base = op.operands[0].type;
      // A tuple is read by `at` when its elements have one kind.
      const element = isTupleType(base)
        ? base.elements.every((e) => e === base.elements[0])
          ? base.elements[0]
          : undefined
        : elementOf(base);
      if (element === undefined)
        fail(
          `the operation ${op.kind} reads a value of the type ${op.operands[0].type}, not a list` +
            (isTupleType(base) ? ' or a tuple of elements of one kind' : '')
        );
      if (op.kind === 'at' && op.operands[1].type !== 'integer')
        fail(
          `the index of the operation at has the type ${op.operands[1].type}`
        );
      const type = op.kind === 'at' ? element : 'integer';
      if (op.result.type !== type)
        fail(
          `the operation ${op.kind} of a ${op.operands[0].type} has a result of the type ${op.result.type}, not ${type}`
        );
      resultIn(policy.operations[op.kind].results);
      operandsIn(operandRule(op.kind));
      // A list is a value: no operation changes it, so a read has no effect.
      if (op.effect !== 'pure') fail(`the operation ${op.kind} is not pure`);
      return;
    }
    case 'list':
    case 'tuple': {
      // Each element fits its place: the element kind of a list, the kind
      // of its position in a tuple.
      const type = op.result.type;
      const places =
        op.kind === 'list'
          ? isListType(type)
            ? op.operands.map(() => type.element)
            : undefined
          : isTupleType(type)
            ? type.elements
            : undefined;
      if (places === undefined)
        return fail(
          `the operation ${op.kind} has a result of the type ${type}, not a ${op.kind}`
        );
      if (op.kind === 'tuple') arity(places.length);
      op.operands.forEach((operand, i) => {
        if (
          (operand.type !== 'real' && operand.type !== 'integer') ||
          !fitsType(operand.type, places[i])
        )
          fail(
            `the element ${i + 1} of the operation ${op.kind} has the type ${operand.type}, and its result the type ${type}`
          );
      });
      resultIn(policy.operations[op.kind].results);
      operandsIn(operandRule(op.kind));
      if (op.effect !== 'pure') fail(`the operation ${op.kind} is not pure`);
      return;
    }
    case 'get': {
      arity(1);
      const tuple = op.operands[0].type;
      if (!isTupleType(tuple))
        return fail(
          `the operation get reads a value of the type ${tuple}, not a tuple`
        );
      const position = op.position;
      if (
        !Number.isInteger(position) ||
        position < 1 ||
        position > tuple.elements.length
      )
        return fail(
          `the operation get reads the position ${String(position)} of a ${tuple}`
        );
      if (op.result.type !== tuple.elements[position - 1])
        fail(
          `the operation get of the position ${position} of a ${tuple} has a result of the type ${op.result.type}`
        );
      resultIn(policy.operations.get.results);
      operandsIn(operandRule('get'));
      if (op.effect !== 'pure') fail('the operation get is not pure');
      return;
    }
    case 'append': {
      arity(2);
      const [list, value] = op.operands;
      const element = elementOf(list.type);
      const resultElement = elementOf(op.result.type);
      if (element === undefined || resultElement === undefined)
        return fail(
          `the operation append reads a ${list.type} and has a result of the type ${op.result.type}: both are lists`
        );
      // The result holds the elements of the list and the new element, by
      // the rule of `replace-at`.
      if (
        (value.type !== 'real' && value.type !== 'integer') ||
        !fitsType(value.type, resultElement) ||
        !fitsType(element, resultElement)
      )
        fail(
          `the operation append writes a ${value.type} element after a ${list.type} and has a result of the type ${op.result.type}`
        );
      resultIn(policy.operations.append.results);
      operandsIn(operandRule('append'));
      if (op.effect !== 'pure') fail('the operation append is not pure');
      return;
    }
    case 'loop':
      return verifyLoop(op, policy, fail);
    case 'and':
    case 'or': {
      arity(1);
      const operands = operandRule(op.kind);
      operandsIn(operands);
      resultIn(policy.operations[op.kind].results);
      if (op.rest.length === 0)
        fail(`the operation ${op.kind} has no region after its first operand`);
      for (const region of op.rest)
        if (!operands.includes(yieldedValues(region)[0].representation))
          fail(`a region of the operation ${op.kind} does not yield a boolean`);
      return;
    }
    case 'call': {
      const fn = program.functions[op.function];
      if (fn === undefined)
        return fail(
          `a call of the function ${op.function}, which does not exist`
        );
      arity(fn.parameters.length);
      op.operands.forEach((operand, i) => {
        const parameter = fn.parameters[i];
        if (operand.representation !== parameter.representation)
          fail(
            `the argument ${i + 1} of a call of ${fn.name} has another representation than its parameter`
          );
        // An integer argument is a valid real, and a list of integers a
        // valid list of reals (the representations are equal, checked
        // above); a real is not an integer.
        if (!fitsType(operand.type, parameter.type))
          fail(
            `the argument ${i + 1} of a call of ${fn.name} has the type ${operand.type}, and its parameter the type ${parameter.type}`
          );
      });
      if (
        op.result.type !== fn.result.type ||
        op.result.representation !== fn.result.representation
      )
        fail(`the result of a call of ${fn.name} differs from its function`);
      if (weakerEffect(op.effect, fn.body.effect))
        fail(
          `the effect of a call of ${fn.name} (${op.effect}) omits the effect of its body (${fn.body.effect})`
        );
      return;
    }
    case 'trace':
      if (typeof op.trace !== 'string' || op.trace === '')
        fail('a trace operation has no trace id');
      // The rule of the policy for the test operation.
      operandsIn(operandRule('trace'));
      resultIn(policy.operations.trace.results);
      return;
    case 'draw': {
      // The states and the effect are checked by `verifyStates()`.
      arity(0);
      const rule =
        policy.operations.draw ?? fail('the target has no draw operation');
      resultIn(rule.results);
      if (op.result.type !== 'real')
        fail(`a draw has a result of the type ${op.result.type}`);
      return;
    }
    case 'seeded': {
      // The effect, the states and the abort fact are checked with the
      // region and by `verifyStates()`.
      const rule =
        policy.operations.seeded ?? fail('the target has no seeded operation');
      if (op.body.parameters !== undefined)
        fail('the body of a seeded has parameters');
      const seed = op.seed;
      if (op.operands.length === 0) {
        if (!(
          typeof seed === 'string' ||
          (typeof seed === 'number' && Number.isFinite(seed))
        ))
          fail(
            `a seeded with no seed operand has the literal seed ${String(seed)}, not a finite number or a string`
          );
      } else {
        arity(1);
        if (seed !== undefined)
          fail('a seeded has a seed operand and a literal seed');
        operandsIn(operandRule('seeded'));
        const type = op.operands[0].type;
        if (
          type !== 'real' &&
          type !== 'integer' &&
          !(type === 'complex' && program.numericPolicy === 'complex')
        )
          fail(
            `the seed of a seeded has the type ${type} in the ${program.numericPolicy} mode`
          );
      }
      resultIn(rule.results);
      const value = yieldedValues(op.body)[0];
      if (
        value === undefined ||
        !fitsType(value.type, op.result.type) ||
        value.representation !== op.result.representation
      )
        fail(
          `the body of a seeded yields a ${value?.type} value, and the seeded has a result of the type ${op.result.type}`
        );
      return;
    }
    case 'host': {
      // A host binding of the program; a read has no operand. The effect is
      // the one that the binding states (`IRHostCall`); `verifyStates()`
      // checks that it names no state.
      const rule =
        policy.operations.host ?? fail('the target has no host operation');
      const binding = program.hosts?.[op.host];
      if (binding === undefined)
        return fail(
          `a host operation of the binding ${op.host}, which does not exist`
        );
      if (binding.form === 'read') arity(0);
      operandsIn(operandRule('host'));
      resultIn(rule.results);
      if (op.result.type !== binding.result)
        fail(
          `a host operation of ${binding.name} has a result of the type ${op.result.type}, and its binding the type ${binding.result}`
        );
      const effect =
        binding.pure && binding.form === 'call' ? 'pure' : 'unknown';
      if (op.effect !== effect)
        fail(
          `a host operation of ${binding.name} has the effect ${op.effect}, not ${effect}`
        );
      return;
    }
    default:
      return fail(
        `an operation of the unknown kind ${(op as { kind: string }).kind}`
      );
  }
}

/** The checks of a `loop` that are not checks of its regions
 *  (`verifyProgram()`). */
function verifyLoop(
  op: IRLoop,
  policy: RepresentationPolicy,
  fail: (message: string) => never
): void {
  const count = op.results.length;
  if (op.operands.length !== count + 2)
    fail(
      `a loop has ${op.operands.length} operands and ${count} results: it reads two bounds and one initial value per result`
    );
  const integer = policy.representationOf('integer');
  for (const bound of op.operands.slice(0, 2))
    if (bound.type !== 'integer' || bound.representation !== integer)
      fail(`a bound of a loop has the type ${bound.type}`);
  const parameters = op.body.parameters ?? [];
  if (parameters.length !== count + 1)
    fail(
      `the body of a loop has ${parameters.length} parameters, and the loop has ${count} results: it needs the index and one parameter per result`
    );
  if (
    parameters[0].type !== 'integer' ||
    parameters[0].representation !== integer
  )
    fail(`the index of a loop has the type ${parameters[0].type}`);
  const next = yieldedValues(op.body);
  op.results.forEach((result, i) => {
    const initial = op.operands[i + 2];
    const parameter = parameters[i + 1];
    const value = next[i];
    const representations = new Set(
      [initial, parameter, value, result].map((v) => v.representation)
    );
    if (representations.size !== 1)
      fail(
        `the carried value ${i + 1} of a loop has the representations ${[...representations].join(', ')}`
      );
    if (result.type !== parameter.type)
      fail(
        `the carried value ${i + 1} of a loop has a parameter of the type ${parameter.type} and a result of the type ${result.type}`
      );
    // An integer is a valid real, and a list of integers a valid list of
    // reals, as for the two values of an `if`.
    const fits = (v: IRValue) => fitsType(v.type, parameter.type);
    if (!fits(initial))
      fail(
        `the carried value ${i + 1} of a loop has an initial value of the type ${initial.type} and a parameter of the type ${parameter.type}`
      );
    if (!fits(value))
      fail(
        `the carried value ${i + 1} of a loop has a next value of the type ${value.type} and a parameter of the type ${parameter.type}`
      );
  });
  const budget = op.iterationBudget;
  if (budget !== undefined && !(typeof budget === 'number' && budget > 0))
    fail(`a loop has the iteration budget ${String(budget)}`);
}
