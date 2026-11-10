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
  elementOf,
  joinEffects,
  operationCanAbort,
  regionsOf,
  weakerEffect,
  yieldedValues,
  type EffectFact,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type BinaryFunctionName,
  type Representation,
  type ScalarKind,
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
  | 'trace';

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
        readonly type: ScalarKind;
      }
    >
  >;
  readonly operations: Readonly<Record<PolicyOperationKind, OperationRule>>;
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
 * For a list: an `at` reads a list and an integer index and has the type of
 * an element; a `length` reads a list and has the type `integer`; both are
 * `pure`. A `build` reads two integer bounds, its body has one integer
 * parameter (the index) and yields a real or an integer element, and its
 * result is a list whose elements hold that element (an integer element in
 * a list of reals is accepted, a real element in a list of integers is
 * not). A `replace-at` reads a list, an integer index and a real or
 * integer element, is `pure`, and has a list result that holds the
 * elements of the list and the element by the same rule. The result of a
 * function, of an `if`, and a carried value of a loop can be a list; a
 * list of integers is a valid list of reals there, as an integer is a valid
 * real. No other operation that computes a value (an arithmetic
 * operation, a comparison, `and`, `or`, a conversion, a trace) has a list
 * operand or a list result: the interpreter applies such an operation to
 * each element of a list, and the representation has no such operation.
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

  /** One yield, the last operation, of `count` values. */
  const verifyRegionShape = (
    region: IRRegion,
    count: number,
    owner?: IROperation
  ) => {
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

  // `inFunction`: the region is the body of a function or is nested in it.
  // Such a region reads no input of the program. `count`: the number of
  // values that the region yields.
  const verifyRegion = (
    region: IRRegion,
    outer: readonly Frame[],
    inFunction: boolean,
    count: number,
    owner?: IROperation
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
    region.operations.forEach((op, index) => {
      const frames = [...outer, { region, index }];
      if (inFunction && op.kind === 'input')
        fail(`the body of a function reads the input ${op.input}`);
      if (!isEffect(op.effect))
        fail(`the operation ${op.kind} has no effect fact`);
      if (!preparedNodes.has(op.origin))
        fail(`the origin of the operation ${op.kind} is not a prepared node`);
      for (const operand of op.operands) use(operand, frames);
      for (const inner of regionsOf(op)) {
        verifyRegion(
          inner,
          frames,
          inFunction,
          op.kind === 'if' || op.kind === 'loop' ? op.results.length : 1,
          op
        );
        if (weakerEffect(op.effect, inner.effect))
          fail(
            `the effect of the operation ${op.kind} (${op.effect}) omits the effect of its region (${inner.effect})`
          );
      }
      verifySignature(op, program, policy, fail);
      effects.push(op.effect);
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
    const joined = joinEffects(...effects);
    if (region.effect !== joined)
      fail(
        `the effect of a region (${region.effect}) does not agree with its operations (${joined})`
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

/** Whether a value of the type `type` is a valid value of the type
 *  `wider`: the same type, an integer for a real, or a list of integers
 *  for a list of reals (the elements of a list of integers are valid
 *  reals). A real is not an integer. */
function fitsType(type: ValueType, wider: ValueType): boolean {
  return (
    type === wider ||
    (type === 'integer' && wider === 'real') ||
    (type === 'list<integer>' && wider === 'list<real>')
  );
}

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
 *  representation has no such operation, so none has a list operand or a
 *  list result. */
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
  'convert',
  'trace',
  'capture',
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
    const operands = policy.operations[kind].operands;
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
  // A list is an operand only of `at`, `length`, `replace-at`, a call, a
  // loop (as a carried value) and a yield, and the result only of an input,
  // a call, an `if`, a loop, a `build` and a `replace-at`.
  if (
    ELEMENTWISE_KINDS.has(op.kind) &&
    (op.operands.some((operand) => elementOf(operand.type) !== undefined) ||
      (op.result !== undefined && elementOf(op.result.type) !== undefined))
  )
    fail(`the operation ${op.kind} has a list operand or a list result`);
  switch (op.kind) {
    case 'yield':
      // The number of its operands is checked with its region.
      if (op.result !== undefined) fail('a yield has a result');
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
      // A complex sum has a complex operand; its real operands are read as
      // their real parts. A real sum has no complex operand.
      if (
        op.kind === 'add' &&
        (op.result.type === 'complex') !==
          op.operands.some((o) => o.type === 'complex')
      )
        fail(
          `the operation add has a result of the type ${op.result.type} and ` +
            `${op.result.type === 'complex' ? 'no' : 'a'} complex operand`
        );
      // A complex product is the product of two complex operands.
      if (
        op.kind === 'multiply' &&
        op.result.type === 'complex' &&
        (op.operands.length !== 2 ||
          op.operands.some((o) => o.type !== 'complex'))
      )
        fail('a complex multiply does not have two complex operands');
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
      // an integer operand; `atan2` has real operands and a real result;
      // every other function has a complex result for a complex operand and
      // a real one for a real or an integer operand.
      const expected: readonly ValueType[] =
        op.fn === 'abs'
          ? types[0] === 'integer'
            ? ['integer', 'real']
            : ['real']
          : op.fn === 'atan2'
            ? types.includes('complex')
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
        op.result.representation !== conversion.to
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
      const thenValues = yieldedValues(op.then);
      const elseValues = yieldedValues(op.else);
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
      const element = elementOf(op.operands[0].type);
      if (element === undefined)
        fail(
          `the operation ${op.kind} reads a value of the type ${op.operands[0].type}, not a list`
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
