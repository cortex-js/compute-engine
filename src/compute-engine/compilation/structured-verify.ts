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
  type IRLiteral,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type ListType,
  type AbortKind,
  type BinaryFunctionName,
  type CollectionFunctionName,
  type CollectionResultArray,
  type IntegerFunctionName,
  type IRRoutine,
  type Representation,
  type RoutineName,
  type UnaryFunctionName,
  type ValueType,
  ROUNDED_INTEGER_FUNCTIONS,
  statesText,
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
  | 'copy'
  | 'list'
  | 'tuple'
  | 'get'
  | 'append'
  | 'trace'
  | 'draw'
  | 'seeded'
  | 'host'
  | 'collection';

/** The representations of the operands and of the result of an operation
 *  on a target. */
export type OperationRule = {
  /** The representations that the result can have. */
  readonly results: readonly Representation[];
  /** The representations that each operand can have, or `same`: each
   *  operand has the representation of the result. For `and` and `or`, the
   *  value of each region after the first operand is an operand too. */
  readonly operands: readonly Representation[] | 'same';
  /** For a function of lists with a list result (`collections`): what the
   *  array of the result is (`CollectionResultArray`). An `IRCollection`
   *  that states `resultArray` states this one. Absent: the result can be
   *  the array of an operand. */
  readonly resultArray?: CollectionResultArray;
};

/** The facts and the representations of a numeric routine of a target
 *  (`IRRoutine`, `RepresentationPolicy.routines`). */
export type RoutineRule = OperationRule & {
  /** The representation of the parameter of the body. */
  readonly parameter: Representation;
  /** The effect of the routine itself, without its body: a routine that
   *  keeps state between calls or samples a source of the runtime is
   *  `effectful`. */
  readonly effect: EffectFact;
  /** The states that the routine itself touches (`IRState`), sorted;
   *  absent when there is none. */
  readonly touches?: readonly IRState[];
  /** The kinds of abort of the routine itself (`AbortKind`), sorted;
   *  absent when it does not abort. */
  readonly aborts?: readonly AbortKind[];
  /** The number of equal panels from which `integrate` starts when the
   *  operation states none (`IRRoutine.initialPanels`). */
  readonly defaultPanels?: number;
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
  /** The rule of each operation that the target has. A target that does not
   *  list an operation does not have it, and the verifier refuses it there:
   *  a target with no random stream (GLSL) has no `draw` and no `seeded`, a
   *  target that calls no code of the host has no `host`, a target with
   *  no functions of lists has no `collection`, and a target whose integer
   *  is exact has no `sqrt` and no `divide`. */
  readonly operations: Readonly<
    Partial<Record<PolicyOperationKind, OperationRule>>
  >;
  /** The functions of one or two operands that the target has
   *  (`IRUnaryFunction`, `IRBinaryFunction`), each with the representations
   *  of its operands and of its result. A function that is not listed is
   *  not in the target: an operation that applies it fails the check. */
  readonly functions: Readonly<
    Partial<Record<UnaryFunctionName | BinaryFunctionName, OperationRule>>
  >;
  /** The functions of lists that the target has (`IRCollection`), each with
   *  the representations of its operands and of its result. Absent, or a
   *  function that is not listed: not in the target. */
  readonly collections?: Readonly<
    Partial<Record<CollectionFunctionName, OperationRule>>
  >;
  /** The integer functions that the target has (`IRIntegerFunction`), each
   *  with the representations of its operands and of its result; absent:
   *  none. A function that is not listed is not in the target. */
  readonly integers?: Readonly<
    Partial<Record<IntegerFunctionName, OperationRule>>
  >;
  /** The numeric routines that the target has (`IRRoutine`), each with its
   *  facts and representations; absent: none. A routine that is not listed
   *  is not in the target (a GLSL policy has none). */
  readonly routines?: Readonly<Partial<Record<RoutineName, RoutineRule>>>;
  /** The kinds of abort of the operation `op` itself (`AbortKind`), sorted,
   *  or `undefined` when it does not abort: each operation carries them
   *  (`OperationBase.aborts`), and the verifier checks that they are these.
   *  Absent: no operation of the target aborts by itself (a `loop` with an
   *  iteration budget and a `seeded` with a seed operand abort with no such
   *  field, `operationCanAbort()`). */
  readonly aborts?: (op: IROperation) => readonly AbortKind[] | undefined;
  /** The representation of the value that a call gives when its evaluation
   *  aborts with `no-value` (`IRProgram.noValueResult`); absent: no
   *  operation of the target aborts with `no-value`. */
  readonly noValueResult?: Representation;
  /** Whether a literal of the representation `representation` can hold the
   *  value `value` (`IRLiteral.value`): the target writes each kind of
   *  value in its own representation. Absent: the kind of the value agrees
   *  with the type of the literal only. */
  readonly literalAdmits?: (
    representation: Representation,
    value: IRLiteral['value']
  ) => boolean;
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
 * real; a tuple is valid where its type fits position by position. A
 * function of lists (`collection`) has the operands and the result of the
 * rule of its identifier (`verifyCollection()`), is `pure`, and is one that
 * the policy lists. No
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
 * For a `routine` (`IRRoutine`): the policy lists its name
 * (`RepresentationPolicy.routines`; a target with no routines refuses it);
 * it has the real or integer operands of its name (two bounds for
 * `integrate` and `integrate-sampled`, a point and an optional direction
 * for `limit`, a point for `derivative`) of the representations of its
 * rule, a body (and an `alternative`, only on the two integrals) with one
 * `real` parameter of the representation of the rule that yields one real
 * or integer value, a `real` result, `initialPanels` only on `integrate`
 * and a positive integer there, and `order` exactly on `derivative`, a
 * positive integer; its effect is the effect of the rule joined with the
 * effect of its regions, its states the union of the states of all, and
 * its abort kinds those of the rule; no `exit` in its regions leaves it.
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
    // `integer`; or, for the type `complex`, the two finite parts of a
    // complex number. A capture of another type is refused, and so is a
    // snapshot that is not of the form of its type: an emitter writes a
    // number snapshot as a number literal and a complex one as the object
    // of its parts.
    const { snapshot } = capture;
    if (
      capture.type !== 'real' &&
      capture.type !== 'integer' &&
      capture.type !== 'complex'
    )
      fail(`the capture ${capture.name} has the type ${capture.type}`);
    if (capture.type === 'complex') {
      if (
        typeof snapshot !== 'object' ||
        !Number.isFinite(snapshot.re) ||
        !Number.isFinite(snapshot.im)
      )
        fail(
          `the snapshot of the complex capture ${capture.name} is not a complex number of finite parts`
        );
    } else if (typeof snapshot !== 'number' || !Number.isFinite(snapshot))
      fail(`the snapshot of the capture ${capture.name} is not finite`);
    else if (capture.type === 'integer' && !Number.isInteger(snapshot))
      fail(
        `the snapshot of the integer capture ${capture.name} is not an integer`
      );
  }

  // The constants of the program: a list of reals or of integers, or a list
  // of such lists (rank 2, rows of any length), each with its own binding,
  // whose elements (the cells of each row) are finite numbers of the
  // element type.
  for (const constant of program.constants ?? []) {
    if (bindings.has(constant.binding))
      fail(
        `the constant ${constant.name} has the binding of another capture or constant`
      );
    bindings.add(constant.binding);
    const rowType =
      isListType(constant.type) && isListType(constant.type.element)
        ? constant.type.element
        : undefined;
    const cell = rowType?.element ?? (constant.type as ListType).element;
    if (
      !isListType(constant.type) ||
      (cell !== 'real' && cell !== 'integer')
    )
      fail(`the constant ${constant.name} has the type ${String(constant.type)}`);
    if (!policy.representations.has(constant.representation))
      fail(
        `the constant ${constant.name} has the representation ${constant.representation}, which the target does not have`
      );
    if (policy.representationOf(constant.type) !== constant.representation)
      fail(
        `the constant ${constant.name} of the type ${String(constant.type)} has the representation ${constant.representation}`
      );
    if (constant.elements.length === 0)
      fail(`the constant ${constant.name} has no element`);
    const checkCell = (element: unknown) => {
      if (
        typeof element !== 'number' ||
        !Number.isFinite(element) ||
        (cell === 'integer' && !Number.isInteger(element))
      )
        fail(
          `the constant ${constant.name} has the element ${String(element)}, which is not a finite number of the type ${String(cell)}`
        );
    };
    for (const element of constant.elements as readonly unknown[]) {
      if (rowType === undefined) {
        checkCell(element);
        continue;
      }
      if (!Array.isArray(element))
        fail(
          `the constant ${constant.name} of the type ${String(constant.type)} has the row ${String(element)}, which is not an array`
        );
      for (const e of element as readonly unknown[]) checkCell(e);
    }
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

  // `inFunction`: the region is the body of a function or is nested in it:
  // the inputs that the function lists (`IRFunction.inputs`), with the
  // inputs that its operations read, added as they are reached; `false`
  // for the root. Such a region reads no other input of the program.
  // `count`: the number of values that the region yields. `exits`: what an
  // `exit` of the region ends.
  const verifyRegion = (
    region: IRRegion,
    outer: readonly Frame[],
    inFunction:
      | false
      | { readonly listed: ReadonlySet<number>; readonly read: Set<number> },
    count: number,
    owner?: IROperation,
    exits: ExitScope = {}
  ) => {
    verifyRegionShape(region, count, owner);
    if (
      region.parameters !== undefined &&
      owner?.kind !== 'loop' &&
      owner?.kind !== 'build' &&
      owner?.kind !== 'routine'
    )
      fail(
        'a region that is not the body of a loop, of a build or of a routine has parameters'
      );
    const effects: EffectFact[] = [];
    const states: (readonly IRState[] | undefined)[] = [];
    region.operations.forEach((op, index) => {
      const frames = [...outer, { region, index }];
      if (inFunction !== false && op.kind === 'input') {
        if (!inFunction.listed.has(op.input))
          fail(
            `the body of a function reads the input ${op.input}, which the function does not list`
          );
        inFunction.read.add(op.input);
      }
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
      verifyStates(op, program, fail, policy);
      if (verifyAborts(op, policy, fail)) noValue = true;
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

  /** Whether an operation of the program aborts with `no-value`. */
  let noValue = false;
  // A function body sees its parameters and its own values only, and reads
  // exactly the inputs that the function lists.
  for (const fn of program.functions) {
    const listed = fn.inputs ?? [];
    listed.forEach((input, i) => {
      if (
        !Number.isInteger(input) ||
        program.inputs[input] === undefined ||
        (i > 0 && input <= listed[i - 1])
      )
        fail(
          `the inputs of ${fn.name} are not inputs of the program in increasing order`
        );
    });
    if (fn.inputs !== undefined && fn.inputs.length === 0)
      fail(`the function ${fn.name} lists no input`);
    const read = new Set<number>();
    verifyRegion(fn.body, [], { listed: new Set(listed), read }, 1);
    if (read.size !== listed.length)
      fail(
        `the function ${fn.name} lists an input that its body does not read`
      );
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
  // The value of a call that aborts with `no-value` is the one of the
  // policy, named exactly when an operation can give it.
  if (program.noValueResult !== undefined) {
    if (policy.noValueResult === undefined)
      fail(
        `the program has a no-value result ${program.noValueResult}, and the target has none`
      );
    if (program.noValueResult !== policy.noValueResult)
      fail(
        `the program has the no-value result ${program.noValueResult}, and the target ${policy.noValueResult}`
      );
  }
  if (noValue !== (program.noValueResult !== undefined))
    fail(
      noValue
        ? 'an operation aborts with no-value, and the program has no no-value result'
        : 'the program has a no-value result, and no operation aborts with no-value'
    );
  verifyAbsentMatrices(program, fail);
}

/** The matrix functions that read an operand that can have no value
 *  (`IRCollection.absent`): their runtime helper gives the absent value, or
 *  a number, for it. */
const ABSENT_MATRIX_READERS: ReadonlySet<CollectionFunctionName> = new Set([
  'determinant',
  'trace',
  'norm',
  'transpose',
  'row-reduce',
  'inverse',
  'matrix-power',
  'matrix-multiply',
  'diagonal',
  'dot',
] as const);

/**
 * The checks of the values that can have no value (`IRCollection.absent`):
 * only a matrix function with a list result carries the fact; a matrix
 * function with a list result and such an operand carries it; and such a
 * value is used only as the value of the program (a yield of the root), as
 * an operand of a function of `ABSENT_MATRIX_READERS`, or as the list of an
 * `at`.
 */
function verifyAbsentMatrices(
  program: IRProgram,
  fail: (message: string) => never
): void {
  const absent = new Set<number>();
  const visit = (region: IRRegion, root: boolean) => {
    for (const op of region.operations) {
      op.operands.forEach((operand, i) => {
        if (!absent.has(operand.id)) return;
        const read =
          (op.kind === 'yield' && root) ||
          (op.kind === 'at' && i === 0) ||
          (op.kind === 'collection' && ABSENT_MATRIX_READERS.has(op.fn));
        if (!read)
          fail(
            `the value ${operand.id}, which can have no value, is an operand of ${op.kind}`
          );
      });
      if (op.kind === 'collection') {
        const listResult = op.result !== undefined && isListType(op.result.type);
        if (op.absent === true && (!listResult || !MATRIX_LIST_FUNCTIONS.has(op.fn)))
          fail(`the function of lists ${op.fn} carries the fact absent`);
        if (
          listResult &&
          op.absent !== true &&
          op.operands.some((o) => absent.has(o.id))
        )
          fail(
            `the function of lists ${op.fn} reads a value that can have no value, and does not carry the fact absent`
          );
        if (op.absent === true) absent.add(op.result!.id);
      }
      for (const inner of regionsOf(op)) visit(inner, false);
    }
  };
  for (const fn of program.functions) visit(fn.body, false);
  visit(program.root, true);
}

/** The matrix functions with a list result that can have no value
 *  (`IRCollection.absent`). */
const MATRIX_LIST_FUNCTIONS: ReadonlySet<CollectionFunctionName> = new Set([
  'transpose',
  'row-reduce',
  'inverse',
  'matrix-power',
  'matrix-multiply',
  'matrix-product',
  'diagonal',
] as const);

/**
 * The check of the abort kinds of `op` itself (`OperationBase.aborts`): a
 * list of kinds, sorted, with no duplicate, and not empty, equal to the
 * kinds that the policy states for the operation (`RepresentationPolicy.
 * aborts`); none when the policy states none. Returns whether `op` aborts
 * with `no-value`.
 */
function verifyAborts(
  op: IROperation,
  policy: RepresentationPolicy,
  fail: (message: string) => never
): boolean {
  const aborts = op.aborts;
  if (aborts !== undefined) {
    if (
      !Array.isArray(aborts) ||
      aborts.length === 0 ||
      aborts.some((k) => k !== 'error' && k !== 'no-value') ||
      aborts.some((k, i) => i > 0 && aborts[i - 1] >= k)
    )
      fail(`the operation ${op.kind} has a malformed list of abort kinds`);
  }
  // A routine has the abort kinds of its rule (`RoutineRule.aborts`).
  const expected =
    op.kind === 'yield' || op.kind === 'exit'
      ? undefined
      : op.kind === 'routine'
        ? routineRule(op, policy)?.aborts
        : policy.aborts?.(op);
  const text = (kinds: readonly AbortKind[] | undefined) =>
    kinds === undefined || kinds.length === 0 ? 'none' : kinds.join(', ');
  if (text(aborts) !== text(expected))
    fail(
      `the operation ${op.kind} has the abort kinds ${text(aborts)}, and the target states ${text(expected)}`
    );
  return aborts?.includes('no-value') === true;
}

const isEffect = (e: unknown): e is EffectFact =>
  e === 'pure' || e === 'effectful' || e === 'unknown';

/** The rule of the routine of `op` in `policy`, or `undefined` when the
 *  target does not have it. */
function routineRule(
  op: IRRoutine,
  policy: RepresentationPolicy
): RoutineRule | undefined {
  const routines = policy.routines;
  return routines !== undefined && Object.hasOwn(routines, op.fn)
    ? routines[op.fn]
    : undefined;
}

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
 * never discharged. A `routine` has the effect of its rule joined with the
 * effect of its body, and the states of both (`RoutineRule`).
 */
function verifyStates(
  op: IROperation,
  program: IRProgram,
  fail: (message: string) => never,
  policy: RepresentationPolicy
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
  if (op.kind === 'routine') {
    // The rule is checked by `verifySignature()`, which runs first.
    const rule = routineRule(op, policy);
    if (rule === undefined) return;
    const regions = regionsOf(op);
    const effect = regions.reduce<EffectFact>(
      (e, r) => joinEffects(e, r.effect),
      rule.effect
    );
    const states = unionStates(rule.touches, ...regions.map((r) => r.touches));
    if (op.effect !== effect || !sameStates(touches, states))
      fail(
        `a routine ${op.fn} has the effect ${op.effect} and the states ${statesText(touches)}, and the target states ${effect} and ${statesText(states)} for it and its ${regions.length > 1 ? 'regions' : 'body'}`
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
 *  `wider`: the same type, an integer for a real, a list whose elements fit
 *  the elements of `wider` (the elements of a list of integers are valid
 *  reals), or a tuple of the length of `wider` whose element at each
 *  position fits the element of `wider` there. A real is not an integer. */
function fitsType(type: ValueType, wider: ValueType): boolean {
  if (type === wider || (type === 'integer' && wider === 'real')) return true;
  if (isListType(type) && isListType(wider))
    return fitsType(type.element, wider.element);
  return (
    isTupleType(type) &&
    isTupleType(wider) &&
    type.elements.length === wider.elements.length &&
    type.elements.every((e, i) => fitsType(e, wider.elements[i]))
  );
}

/** Whether a value of the type `type` can be an element of a list: a real,
 *  an integer, a boolean (a list of booleans, of one level: the value of
 *  an element-wise comparison), a tuple (a list of points), or a list whose
 *  elements can be elements of a list (a row of a list of lists), at every
 *  depth. A complex number is not an element of a list of the
 *  representation, at any depth, and a boolean is not an element of a row
 *  of a list of lists. Whether a target holds a list of booleans is a
 *  question of its policy (`RepresentationPolicy.representationOf`). */
function isElementType(type: ValueType, depth = 0): boolean {
  return (
    type === 'real' ||
    type === 'integer' ||
    (type === 'boolean' && depth === 0) ||
    isTupleType(type) ||
    (isListType(type) && isElementType(type.element, depth + 1))
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
  'integer',
  'no-value',
  'and',
  'or',
  'trace',
  'capture',
  'draw',
  'seeded',
  'routine',
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
  /** The rule of the operation `kind` in the policy: a target that does not
   *  list it does not have it. */
  const ruleOf = (kind: PolicyOperationKind): OperationRule =>
    policy.operations[kind] ?? fail(`the target has no operation ${kind}`);
  /** The representations that the rule of `kind` admits for an operand. */
  const operandRule = (
    kind: PolicyOperationKind
  ): readonly Representation[] => {
    const operands = ruleOf(kind).operands;
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
  // `replace-at`, `append`, a `copy`, a function of lists, a call, a loop
  // (as a carried value), a yield and a conversion of the representation of
  // a list, and the result only of an input, a call, an `if`, a loop, a
  // `build`, a `list`, a `tuple`, a `replace-at`, an `append`, a `copy`, a
  // function of lists and such a conversion.
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
          : typeof value === 'bigint'
            ? ['integer']
            : typeof value === 'boolean'
              ? ['boolean']
              : typeof value === 'object' &&
                  value !== null &&
                  typeof value.re === 'number' &&
                  typeof value.im === 'number'
                ? ['complex']
                : undefined;
      if (
        types === undefined ||
        !types.includes(op.result.type) ||
        policy.literalAdmits?.(op.result.representation, value) === false
      )
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
      if (input?.unread)
        fail(`a read of the input ${input.name}, which the program never reads`);
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
    case 'constant': {
      arity(0);
      const constant = program.constants?.[op.constant];
      if (constant === undefined)
        return fail(
          `a read of the constant ${op.constant}, which the program does not list`
        );
      if (
        op.result.type !== constant.type ||
        op.result.representation !== constant.representation
      )
        fail(
          `a read of the constant ${constant.name} does not match the constant`
        );
      // A constant is fixed when the program is compiled.
      if (op.effect !== 'pure')
        fail(`a read of the constant ${constant.name} is not pure`);
      return;
    }
    case 'sqrt':
      arity(1);
      resultIn(ruleOf('sqrt').results);
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
      resultIn(ruleOf(op.kind).results);
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
      resultIn(ruleOf('mod').results);
      operandsIn(operandRule('mod'));
      integerOnlyFromIntegers();
      return;
    case 'floor':
      arity(1);
      resultIn(ruleOf('floor').results);
      operandsIn(operandRule('floor'));
      if (op.result.type !== 'integer')
        fail(`the operation floor has a result of the type ${op.result.type}`);
      return;
    case 'divide':
      arity(2);
      resultIn(ruleOf('divide').results);
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
      // an integer operand, and `sign` of an integer operand an integer or a
      // real result; `complex` has two real operands and a complex
      // result; `pow` has two real operands and a real result, or two
      // complex operands and a complex result; each other function of two
      // operands has real operands and a real result; every other function
      // has a complex result for a complex operand and a real one for a real
      // or an integer operand.
      const complexOperands = types.filter((t) => t === 'complex').length;
      const expected: readonly ValueType[] =
        op.fn === 'abs' || (op.fn === 'sign' && types[0] === 'integer')
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
    case 'integer': {
      const rule = Object.hasOwn(policy.integers ?? {}, op.fn)
        ? policy.integers![op.fn]
        : undefined;
      if (rule === undefined)
        return fail(`the target has no integer function ${op.fn}`);
      // The number of operands of each function (`IntegerFunctionName`).
      if (op.fn === 'gcd' || op.fn === 'lcm') atLeast(1);
      else
        arity(
          op.fn === 'remainder' ||
            op.fn === 'quotient' ||
            op.fn === 'rounded-pow' ||
            op.fn === 'int-pow' ||
            op.fn === 'binomial'
            ? 2
            : 1
        );
      resultIn(rule.results);
      operandsIn(
        rule.operands === 'same' ? [op.result.representation] : rule.operands
      );
      if (op.effect !== 'pure')
        fail(`the integer function ${op.fn} is not pure`);
      if (op.operands.some((operand) => operand.type !== 'integer'))
        fail(
          `the integer function ${op.fn} has an operand that is not an integer`
        );
      const type = op.fn === 'is-prime' ? 'boolean' : 'integer';
      if (op.result.type !== type)
        fail(
          `the integer function ${op.fn} has a result of the type ${op.result.type}, not ${type}`
        );
      // A rounding exactly for the functions that have one; the square root
      // of an integer is never exact.
      const rounding = op.rounding;
      if (ROUNDED_INTEGER_FUNCTIONS.has(op.fn)) {
        if (
          rounding !== 'floor' &&
          rounding !== 'ceil' &&
          rounding !== 'round-ties-away' &&
          rounding !== 'truncate' &&
          !(rounding === 'exact' && op.fn !== 'isqrt')
        )
          fail(
            `the integer function ${op.fn} has the rounding ${String(rounding)}`
          );
      } else if (rounding !== undefined)
        fail(`the integer function ${op.fn} has a rounding`);
      return;
    }
    case 'no-value': {
      arity(0);
      if (op.value !== 'undefined' && op.value !== 'infinite')
        fail(`a no-value operation names the value ${String(op.value)}`);
      if (op.result.type !== 'integer')
        fail(`a no-value operation has a result of the type ${op.result.type}`);
      if (op.effect !== 'pure') fail('a no-value operation is not pure');
      if (!op.aborts?.includes('no-value'))
        fail('a no-value operation does not abort with no-value');
      return;
    }
    case 'negate':
      arity(1);
      resultIn(ruleOf('negate').results);
      operandsIn(operandRule('negate'));
      integerOnlyFromIntegers();
      return;
    case 'not':
      arity(1);
      resultIn(ruleOf('not').results);
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
      // The element is a number or a tuple; an integer element is a valid
      // element of a list of reals, a real one is not an element of a list
      // of integers.
      if (!isElementType(value.type) || !fitsType(value.type, element))
        fail(
          `the body of a build yields a value of the type ${value.type}, and its result has the type ${op.result.type}`
        );
      resultIn(ruleOf('build').results);
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
        !isElementType(value.type) ||
        !fitsType(value.type, resultElement) ||
        !fitsType(element, resultElement)
      )
        fail(
          `the operation replace-at writes a ${value.type} element into a ${list.type} and has a result of the type ${op.result.type}`
        );
      resultIn(ruleOf('replace-at').results);
      operandsIn(operandRule('replace-at'));
      if (op.effect !== 'pure') fail('the operation replace-at is not pure');
      return;
    }
    case 'less':
    case 'less-equal':
    case 'equal':
    case 'not-equal':
      arity(2);
      resultIn(ruleOf(op.kind).results);
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
      // A list of tuples reads a tuple.
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
      resultIn(ruleOf(op.kind).results);
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
      // An element of a list is a number or a tuple, an element of a tuple
      // a number.
      op.operands.forEach((operand, i) => {
        if (
          (op.kind === 'list'
            ? !isElementType(operand.type)
            : operand.type !== 'real' && operand.type !== 'integer') ||
          !fitsType(operand.type, places[i])
        )
          fail(
            `the element ${i + 1} of the operation ${op.kind} has the type ${operand.type}, and its result the type ${type}`
          );
      });
      resultIn(ruleOf(op.kind).results);
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
      resultIn(ruleOf('get').results);
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
        !isElementType(value.type) ||
        !fitsType(value.type, resultElement) ||
        !fitsType(element, resultElement)
      )
        fail(
          `the operation append writes a ${value.type} element after a ${list.type} and has a result of the type ${op.result.type}`
        );
      resultIn(ruleOf('append').results);
      operandsIn(operandRule('append'));
      if (op.effect !== 'pure') fail('the operation append is not pure');
      return;
    }
    case 'copy': {
      arity(1);
      const [list] = op.operands;
      const element = elementOf(list.type);
      if (element === undefined)
        return fail(
          `the operation copy reads a value of the type ${list.type}, not a list`
        );
      // The copy has the type and the representation of its operand; two
      // levels are a list of lists.
      if (
        op.result.type !== list.type ||
        op.result.representation !== list.representation
      )
        fail(
          `the operation copy of a ${list.type} has a result of the type ${op.result.type}`
        );
      if (op.levels !== 1 && (op.levels !== 2 || !isListType(element)))
        fail(
          `the operation copy of a ${list.type} copies ${String(op.levels)} levels`
        );
      resultIn(ruleOf('copy').results);
      operandsIn(operandRule('copy'));
      if (op.effect !== 'pure') fail('the operation copy is not pure');
      return;
    }
    case 'collection': {
      verifyCollection(op, policy, fail);
      // After the operands and the result: the fact of the result array is
      // the one of the target.
      const stated = policy.collections?.[op.fn]?.resultArray;
      if (op.resultArray !== undefined && op.resultArray !== stated)
        fail(
          `the function of lists ${op.fn} states the result array ${op.resultArray}, ` +
            `and the target states ${stated ?? 'none'}`
        );
      return;
    }
    case 'loop':
      return verifyLoop(op, policy, fail);
    case 'and':
    case 'or': {
      arity(1);
      const operands = operandRule(op.kind);
      operandsIn(operands);
      resultIn(ruleOf(op.kind).results);
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
      resultIn(ruleOf('trace').results);
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
    case 'routine': {
      // The effect, the states and the abort kinds are checked by
      // `verifyStates()` and `verifyAborts()`; that no `exit` leaves the
      // body, with the region (a routine is a barrier of `exit`).
      const rule =
        routineRule(op, policy) ??
        fail(`the target has no routine ${String(op.fn)}`);
      // The operands of each routine (`RoutineName`), by name.
      const names: readonly string[] =
        op.fn === 'integrate' || op.fn === 'integrate-sampled'
          ? ['lower bound', 'upper bound']
          : op.fn === 'limit'
            ? ['point', 'direction']
            : ['point'];
      if (op.fn === 'limit') {
        if (op.operands.length !== 1 && op.operands.length !== 2)
          fail(
            `the operation routine limit has ${op.operands.length} operands, not one or two`
          );
      } else arity(names.length);
      operandsIn(
        rule.operands === 'same' ? [op.result.representation] : rule.operands
      );
      op.operands.forEach((operand, i) => {
        if (operand.type !== 'real' && operand.type !== 'integer')
          fail(
            `the ${names[i]} of a routine ${op.fn} has the type ${operand.type}`
          );
      });
      // The body, and the alternative of an integral.
      const regions: [string, IRRegion][] = [['body', op.body]];
      if (op.alternative !== undefined) {
        if (op.fn !== 'integrate' && op.fn !== 'integrate-sampled')
          fail(`a routine ${op.fn} has an alternative`);
        regions.push(['alternative', op.alternative]);
      }
      for (const [what, region] of regions) {
        const parameters = region.parameters ?? [];
        if (parameters.length !== 1)
          fail(
            `the ${what} of a routine ${op.fn} has ${parameters.length} parameters, not one`
          );
        if (
          parameters[0].type !== 'real' ||
          parameters[0].representation !== rule.parameter
        )
          fail(
            `the parameter of the ${what} of a routine ${op.fn} has the type ${parameters[0].type} and the representation ${parameters[0].representation}`
          );
        const yielded = yieldedValues(region);
        if (yielded.length !== 1)
          fail(
            `the ${what} of a routine ${op.fn} yields ${yielded.length} values, not one`
          );
        const value = yielded[0];
        if (
          !fitsType(value.type, 'real') ||
          !rule.results.includes(value.representation)
        )
          fail(
            `the ${what} of a routine ${op.fn} yields a ${value.type} value, not a real`
          );
      }
      resultIn(rule.results);
      if (op.result.type !== 'real')
        fail(
          `a routine ${op.fn} has a result of the type ${op.result.type}, not real`
        );
      const panels = op.initialPanels;
      if (panels !== undefined) {
        if (op.fn !== 'integrate')
          fail(`a routine ${op.fn} states a number of panels`);
        if (
          !(typeof panels === 'number' && Number.isInteger(panels) && panels > 0)
        )
          fail(
            `a routine ${op.fn} starts from ${String(panels)} panels, not a positive integer`
          );
      }
      const order = op.order;
      if (op.fn === 'derivative') {
        if (
          !(typeof order === 'number' && Number.isInteger(order) && order > 0)
        )
          fail(
            `a routine derivative has the order ${String(order)}, not a positive integer`
          );
      } else if (order !== undefined)
        fail(`a routine ${op.fn} has an order`);
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

/** The element kind of a list operand of a function of lists, or of a
 *  tuple where `tuples` admits one: `real` or `integer`, else `undefined`. */
function numericElement(
  type: ValueType,
  tuples: boolean
): 'real' | 'integer' | undefined {
  const element = isTupleType(type)
    ? tuples && type.elements.every((e) => e === 'real' || e === 'integer')
      ? type.elements.every((e) => e === 'integer')
        ? 'integer'
        : 'real'
      : undefined
    : elementOf(type);
  return element === 'real' || element === 'integer' ? element : undefined;
}

/** The kind and the rank of the numbers of a list of the type `type` (a
 *  list of reals or of integers, or a list of such lists at every depth),
 *  or `undefined` for another type (a tuple, a list of tuples). */
function numericCells(
  type: ValueType
): { kind: 'real' | 'integer'; rank: number } | undefined {
  const element = elementOf(type);
  if (element === 'real' || element === 'integer')
    return { kind: element, rank: 1 };
  if (element === undefined || !isListType(element)) return undefined;
  const inner = numericCells(element);
  return inner === undefined
    ? undefined
    : { kind: inner.kind, rank: inner.rank + 1 };
}

/**
 * The checks of a function of lists (`IRCollection`), by the rule of its
 * identifier (`CollectionFunctionName`): `norm`, `mean`, `median` and
 * `variance` read one list or tuple of numbers and have a real result;
 * `dot` reads two lists of numbers and has a real result; `take`, `drop`,
 * `rotate-left` and `rotate-right` read a list of numbers and an integer
 * count, `range` two integers, or two numbers and a step; `reverse` and `sort` one
 * list of numbers, `join` two or more, and each has a list result whose
 * element holds the elements of its list operands (a list of integers only
 * when every list operand is one). The statistics read one list or tuple
 * (`covariance` and `correlation` two lists) and have a real result;
 * `ordering` reads a list and gives a list of integers, `unique` a list of
 * its elements; `index-of` and `contains` read a list and a number and give
 * an integer and a boolean; `repeat` reads a number and an integer count,
 * `linspace` two numbers and an integer count; `slice` reads a list and two
 * numbers; `at-real` a list and a number, and gives an element; `gather` a
 * list and a list of indexes, and gives a list of its elements; `take` and
 * `drop` also read a real count. The operation is `pure`, and the policy
 * of the target lists the identifier and its representations.
 */
function verifyCollection(
  op: Extract<IROperation, { kind: 'collection' }>,
  policy: RepresentationPolicy,
  fail: (message: string) => never
): void {
  const fn = op.fn;
  const rule =
    policy.operations.collection !== undefined &&
    policy.collections !== undefined &&
    Object.hasOwn(policy.collections, fn)
      ? policy.collections[fn]
      : undefined;
  if (rule === undefined)
    return fail(`the target has no function of lists ${fn}`);
  if (op.effect !== 'pure') fail(`the function of lists ${fn} is not pure`);
  const operands = op.operands;
  const count = (ok: boolean) => {
    if (!ok)
      fail(`the function of lists ${fn} has ${operands.length} operands`);
  };
  const listOperand = (i: number, tuples = false) =>
    numericElement(operands[i].type, tuples) ??
    fail(
      `the operand ${i + 1} of the function of lists ${fn} has the type ${operands[i].type}`
    );
  /** The kind of the numbers of the list operand `i`, a list of reals or of
   *  integers of the rank `rank` (any rank of 1 or more when absent). */
  const cellsOf = (i: number, rank?: number): 'real' | 'integer' => {
    const cell = numericCells(operands[i].type);
    if (cell === undefined || (rank !== undefined && cell.rank !== rank))
      return fail(
        `the operand ${i + 1} of the function of lists ${fn} has the type ${operands[i].type}`
      );
    return cell.kind;
  };
  /** The operand `i` is a real or an integer. */
  const numberOperand = (i: number) => {
    if (operands[i].type !== 'real' && operands[i].type !== 'integer')
      fail(
        `the operand ${i + 1} of the function of lists ${fn} has the type ${operands[i].type}, not a number`
      );
  };
  /** The operand `i` is a list of numbers, not a tuple. */
  const flatList = (i: number) => {
    if (isTupleType(operands[i].type))
      fail(`the function of lists ${fn} reads a list, not a tuple`);
    return listOperand(i);
  };
  let result: ValueType;
  switch (fn) {
    case 'population-variance':
    case 'standard-deviation':
    case 'population-standard-deviation':
    case 'skewness':
    case 'kurtosis':
    case 'mode':
    case 'interquartile-range':
      count(operands.length === 1);
      listOperand(0, true);
      result = 'real';
      break;
    case 'covariance':
    case 'correlation':
      count(operands.length === 2);
      flatList(0);
      flatList(1);
      result = 'real';
      break;
    case 'ordering':
      count(operands.length === 1);
      flatList(0);
      result = listType('integer');
      break;
    case 'unique':
      count(operands.length === 1);
      result = listType(flatList(0));
      break;
    case 'index-of':
    case 'contains':
      count(operands.length === 2);
      flatList(0);
      numberOperand(1);
      result = fn === 'contains' ? 'boolean' : 'integer';
      break;
    case 'repeat':
      count(operands.length === 2);
      numberOperand(0);
      if (operands[1].type !== 'integer')
        fail(
          `the count of the function of lists repeat has the type ${operands[1].type}`
        );
      result = listType(operands[0].type === 'integer' ? 'integer' : 'real');
      break;
    case 'linspace':
      count(operands.length === 3);
      numberOperand(0);
      numberOperand(1);
      if (operands[2].type !== 'integer')
        fail(
          `the count of the function of lists linspace has the type ${operands[2].type}`
        );
      result = listType('real');
      break;
    case 'slice':
      count(operands.length === 3);
      numberOperand(1);
      numberOperand(2);
      result = listType(flatList(0));
      break;
    case 'at-real':
      count(operands.length === 2);
      numberOperand(1);
      result = flatList(0);
      break;
    case 'gather': {
      count(operands.length === 2);
      const element = flatList(0);
      listOperand(1);
      if (isTupleType(operands[1].type))
        fail('the indexes of the function of lists gather are a tuple');
      result = listType(element);
      break;
    }
    case 'norm':
      // A list or a tuple of numbers, or a list of lists of numbers of any
      // rank, and an order.
      count(operands.length === 1 || operands.length === 2);
      if (!isTupleType(operands[0].type)) cellsOf(0);
      else listOperand(0, true);
      if (
        operands.length === 2 &&
        operands[1].type !== 'real' &&
        operands[1].type !== 'integer'
      )
        fail(`the order of the function of lists norm has the type ${operands[1].type}`);
      result = 'real';
      break;
    case 'mean':
    case 'median':
    case 'variance':
      count(operands.length === 1);
      listOperand(0, true);
      result = 'real';
      break;
    // The matrix functions: a matrix, a list of lists of rank 2 of reals or
    // of integers.
    case 'determinant':
    case 'trace':
      count(operands.length === 1);
      cellsOf(0, 2);
      result = 'real';
      break;
    case 'transpose':
      count(operands.length === 1);
      result = listType(listType(cellsOf(0, 2)));
      break;
    case 'row-reduce':
    case 'inverse':
      count(operands.length === 1);
      cellsOf(0, 2);
      result = listType(listType('real'));
      break;
    case 'matrix-power':
      count(operands.length === 2);
      cellsOf(0, 2);
      if (operands[1].type !== 'integer')
        fail(
          `the exponent of the function of lists matrix-power has the type ${operands[1].type}`
        );
      result = listType(listType('real'));
      break;
    case 'matrix-multiply':
    case 'matrix-product': {
      // Two matrices, or a matrix and a list: of rank 2 for two matrices.
      count(operands.length === 2);
      const ranks = operands.map((o) => numericCells(o.type)?.rank);
      if (
        !ranks.every((r) => r === 1 || r === 2) ||
        !ranks.some((r) => r === 2)
      )
        fail(
          `the function of lists ${fn} reads ${operands[0].type} and ${operands[1].type}`
        );
      result =
        ranks[0] === 2 && ranks[1] === 2
          ? listType(listType('real'))
          : listType('real');
      break;
    }
    case 'diagonal': {
      // The diagonal of a matrix, or the matrix of the diagonal of a list.
      count(operands.length === 1);
      const cell = numericCells(operands[0].type);
      if (cell === undefined || cell.rank > 2)
        fail(
          `the operand of the function of lists diagonal has the type ${operands[0].type}`
        );
      result =
        cell!.rank === 2 ? listType(cell!.kind) : listType(listType(cell!.kind));
      break;
    }
    case 'flatten':
      count(operands.length === 1);
      result = listType(cellsOf(0));
      break;
    case 'dot':
      count(operands.length === 2);
      listOperand(0);
      listOperand(1);
      if (isTupleType(operands[0].type) || isTupleType(operands[1].type))
        fail('the function of lists dot reads two lists, not a tuple');
      result = 'real';
      break;
    case 'take':
    case 'drop':
    case 'rotate-left':
    case 'rotate-right': {
      count(operands.length === 2);
      if (isTupleType(operands[0].type))
        fail(`the function of lists ${fn} reads a list, not a tuple`);
      // A list of numbers, of tuples or of lists: the result has its
      // elements.
      const tuple = elementOf(operands[0].type);
      const element =
        tuple !== undefined && (isTupleType(tuple) || isListType(tuple))
          ? tuple
          : listOperand(0);
      // A real count of `take` and `drop` is rounded; a shift is an
      // integer.
      if (
        operands[1].type !== 'integer' &&
        !(
          (fn === 'take' || fn === 'drop') &&
          operands[1].type === 'real' &&
          op.result.representation !== 'bigint-array'
        )
      )
        fail(
          `the count of the function of lists ${fn} has the type ${operands[1].type}`
        );
      result = listType(element);
      break;
    }
    case 'reverse':
    case 'sort':
    case 'join': {
      count(fn === 'join' ? operands.length >= 2 : operands.length === 1);
      if (operands.some((o) => isTupleType(o.type)))
        fail(`the function of lists ${fn} reads lists, not a tuple`);
      // `reverse` and `join` of lists of one tuple type (a list of points)
      // have elements of that type; `sort` reads numbers.
      const tuple = elementOf(operands[0].type);
      if (fn !== 'sort' && tuple !== undefined && isTupleType(tuple)) {
        if (operands.some((o) => elementOf(o.type) !== tuple))
          fail(
            `the function of lists ${fn} reads lists of other elements than ${tuple}`
          );
        result = listType(tuple);
        break;
      }
      // `reverse` and `join` of lists of lists: the rows of the operands,
      // whose types merge (a row of integers is a valid row of reals).
      if (fn !== 'sort' && tuple !== undefined && isListType(tuple)) {
        let row: ValueType = tuple;
        for (const o of operands) {
          const element = elementOf(o.type);
          const merged: ValueType | undefined =
            element !== undefined && isListType(element)
              ? mergedType(row, element)
              : undefined;
          if (merged === undefined)
            return fail(
              `the function of lists ${fn} reads lists of other elements than ${tuple}`
            );
          row = merged;
        }
        result = listType(row as ListType);
        break;
      }
      const elements = operands.map((_, i) => listOperand(i));
      result = listType(
        elements.every((e) => e === 'integer') ? 'integer' : 'real'
      );
      break;
    }
    case 'range':
      // Two integer bounds, or two bounds and a step, each a real or an
      // integer: a list of integers when the three are integers.
      count(operands.length === 2 || operands.length === 3);
      if (operands.length === 2 && operands.some((o) => o.type !== 'integer'))
        fail('the bounds of the function of lists range are not integers');
      if (operands.some((o) => o.type !== 'integer' && o.type !== 'real'))
        fail(
          'the bounds and the step of the function of lists range are not numbers'
        );
      result = listType(
        operands.every((o) => o.type === 'integer') ? 'integer' : 'real'
      );
      break;
    default:
      return fail(`the function of lists ${String(fn)} is not known`);
  }
  // A list of integers is a valid list of reals.
  if (!fitsType(result, op.result.type))
    fail(
      `the function of lists ${fn} has a result of the type ${op.result.type}, not ${result}`
    );
  for (const operand of operands)
    if (
      !(
        rule.operands === 'same' ? [op.result.representation] : rule.operands
      ).includes(operand.representation)
    )
      fail(
        `an operand of the function of lists ${fn} has the representation ${operand.representation}`
      );
  if (!rule.results.includes(op.result.representation))
    fail(
      `the result of the function of lists ${fn} has the representation ${op.result.representation}`
    );
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
  // A loop that tests its count has an index of the representation
  // `number`, whose range has a last index (`IRLoop.checksCount`).
  if (op.checksCount === true && parameters[0].representation !== 'number')
    fail('a loop that tests its count has an index that is not a number');
  // A loop with no end has an index that no operation reads: the code of a
  // target writes no index for it.
  if (op.unbounded === true) {
    if (op.ascending === true || op.checksCount === true)
      fail('a loop with no end is also a loop over a range');
    const index = parameters[0].id;
    const reads = (operations: readonly IROperation[]): boolean =>
      operations.some(
        (o) =>
          o.operands.some((v) => v.id === index) ||
          regionsOf(o).some((r) => reads(r.operations))
      );
    if (reads(op.body.operations))
      fail('the index of a loop with no end is read');
  }
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
