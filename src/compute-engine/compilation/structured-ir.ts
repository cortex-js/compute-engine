/**
 * The structured representation of a program of scalars and lists that it
 * reads and makes: its values, regions, operations and effect facts. The representation names no target: a
 * target gives each value a representation (a string that the target
 * chooses, such as `number` on JavaScript or `float` on GLSL), and the
 * verifier (`structured-verify.ts`) checks the representations against the
 * policy of that target.
 *
 * A program is lowered by a target from the prepared root and its
 * annotation (`javascript-structured-lower.ts` for JavaScript) after the
 * representation of each value is chosen. Each value is defined once and
 * has an id that is unique in its program. A write to a local makes a new
 * value; no operation writes a named variable. Operations are ordered in
 * regions. A region ends in one `yield`, whose operands are the values of
 * the region. A value that a region defines is visible in that region,
 * after its definition, and in the regions nested in it; a value of a
 * branch leaves the branch only through its `yield`: an `if` whose branches
 * write locals has one result per merged local.
 *
 * A `loop` runs its body region once per integer of a range. The body has
 * parameters: the index, and one parameter per value that an iteration
 * gives to the next one (a carried value). The body yields the next value
 * of each carried value, and the loop has one result per carried value.
 *
 * A region is open or closed (`isClosedRegion()`). An open region ends in
 * its yield. A closed region ends in an `exit` (`IRExit`), which leaves the
 * innermost loop, or in an `if` whose two branches are closed; it has no
 * yield. Only a branch of an `if` can be closed.
 *
 * There is no common-subexpression pass, no reordering and no collection:
 * each occurrence of a prepared node gives its own operations, in the order
 * of the prepared tree.
 *
 * The design is `docs/plans/2026-11-09-js-structured-scalar-emitter.md`,
 * "Representation and verifier" and "Effects are part of the prepared
 * contract", and the objectives of
 * `docs/plans/2026-11-09-js-compiler-status-and-plan.md`, "Objectives for
 * the representation".
 */
import type { Expression } from '../global-types.js';

/**
 * What the evaluation of an operation can do besides giving its value.
 * `pure`: nothing. `effectful`: an effect that the definition states (an
 * impurity label). `unknown`: the definition does not state its effects.
 * `unknown` never permits a reordering or a merge.
 */
export type EffectFact = 'pure' | 'effectful' | 'unknown';

/** The semantic type of a scalar value. */
export type ScalarKind = 'real' | 'integer' | 'boolean' | 'complex';

/** A list of elements of one scalar kind. The length is not part of the
 *  type: two lists of the same element type and different lengths have one
 *  type. A list is a value: no operation changes a list. */
export type ListType = `list<${ScalarKind}>`;

/** The semantic type of a value: a scalar or a list. */
export type ValueType = ScalarKind | ListType;

/** The kind of the elements of `type`, or `undefined` when `type` is not a
 *  list type. */
export function elementOf(type: ValueType): ScalarKind | undefined {
  return type.startsWith('list<')
    ? (type.slice(5, -1) as ScalarKind)
    : undefined;
}

/** The name of a representation of a target (`RepresentationPolicy`). */
export type Representation = string;

export type IRValue = {
  /** The program that defines the value (`IRProgram.owner`). */
  readonly owner: object;
  readonly revision: number;
  /** Unique in the program. */
  readonly id: number;
  readonly type: ValueType;
  readonly representation: Representation;
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
  readonly value:
    number | boolean | { readonly re: number; readonly im: number };
};

/** A read of the input `IRProgram.inputs[input]` at this position. */
export type IRInputRead = OperationBase & {
  readonly kind: 'input';
  readonly input: number;
};

/** An operation of the operands, which are already in the representation
 *  of the operation. `sqrt` is the principal square root of its one
 *  operand: a real result for a real operand (not a number for a negative
 *  one), a complex result for a complex operand. The rule of the target
 *  decides which of the two an occurrence is, and a real operand of a
 *  complex `sqrt` is converted first.
 *
 *  `add` of a complex result has at least one complex operand; a real
 *  operand of it is not converted, and adds to the real part only.
 *  `multiply` of a complex result has two complex operands. `mod` is the
 *  floored remainder: its result has the sign of the divisor, as the
 *  interpreter gives it (`Mod(-7, 3)` is `2`, `Mod(7, -3)` is `-2`,
 *  `Mod(-7.5, 2)` is `0.5`), and a zero divisor gives not a number.
 *  `floor` has an integer result. `divide` has a real result, also for
 *  integer operands. `not` is the negation of one boolean operand. */
export type IRArithmetic = OperationBase & {
  readonly kind:
    | 'add'
    | 'negate'
    | 'not'
    | 'multiply'
    | 'less'
    | 'less-equal'
    | 'equal'
    | 'min'
    | 'max'
    | 'sqrt'
    | 'mod'
    | 'floor'
    | 'divide';
};

/**
 * The functions of one operand that the representation names, by an
 * identifier that names no target. Each is defined on the real and the
 * complex numbers:
 *
 * - `exp`, `sin`, `cos` and `tanh`: a real result for a real operand, a
 *   complex result for a complex operand.
 * - `ln`: the natural logarithm. A real result for a real operand (not a
 *   number for a negative operand, minus infinity for 0), the principal
 *   complex logarithm for a complex operand. As for `sqrt`, the rule of the
 *   target decides which of the two an occurrence is, and a real operand of
 *   a complex `ln` is converted first.
 * - `abs`: the absolute value, or the modulus of a complex operand. The
 *   result is real; it is an integer for an integer operand.
 *
 * Only `abs` has an integer result, and only for an integer operand.
 */
export type UnaryFunctionName = 'exp' | 'ln' | 'sin' | 'cos' | 'tanh' | 'abs';

/**
 * The functions of two operands that the representation names, by an
 * identifier that names no target. `atan2(y, x)` is the angle of the point
 * `(x, y)` from the positive first axis, in `[-π, π]`: two real operands, a
 * real result.
 */
export type BinaryFunctionName = 'atan2';

/**
 * An application of a function of one operand (`unary`) or two operands
 * (`binary`) that `fn` names. One operation kind serves every such
 * function: the core checks the types of the operands and of the result by
 * the rule of the identifier (`UnaryFunctionName`, `BinaryFunctionName`),
 * the policy of a target says which identifiers it has and in which
 * representations, and the emitter of the target writes the code of each
 * identifier. A function of this kind is `pure`.
 */
export type IRUnaryFunction = OperationBase & {
  readonly kind: 'unary';
  readonly fn: UnaryFunctionName;
};

export type IRBinaryFunction = OperationBase & {
  readonly kind: 'binary';
  readonly fn: BinaryFunctionName;
};

/**
 * A read of a list. Both are `pure`: a list is a value, and no operation
 * changes it.
 *
 * - `at`: the operands are a list and an integer index, counted from 1 as in
 *   the language; a negative index counts from the end (`-1` is the last
 *   element). The result has the type of an element. An index out of range
 *   (0, beyond the length, or beyond the length from the end) gives the
 *   absent value of the target for the element type: every other operation
 *   applied to that value is unspecified (`docs/COMPILATION-MODEL.md`,
 *   "Caveats of compiled code").
 * - `length`: the operand is a list; the result is the number of its
 *   elements, an integer.
 */
export type IRListRead = OperationBase & {
  readonly kind: 'at' | 'length';
};

/**
 * A list that the program makes. Both are `pure` when their regions are: a
 * list is a value, and the result is a new list value.
 *
 * - `build`: the operands are `from` and `to`, two integers evaluated once,
 *   before the first element. The body region has one parameter, the
 *   index, and yields one element, a real or an integer. The body is
 *   evaluated once per integer from `from` to `to`, both included, in
 *   steps of 1, or of -1 when `to` is less than `from`, as the interpreter
 *   iterates `Range(from, to)`: a range always has at least one element
 *   (`Range(1, 0)` has the elements 1 and 0). The result is the list of the
 *   elements in that order; it is a list of integers only when the body
 *   yields an integer. A `build` does not count passes of the iteration
 *   budget: the interpreter and the existing compiler count the passes of
 *   a `Loop`, not the elements of a `Comprehension`
 *   (`docs/COMPILATION-MODEL.md`, "Not covered" of the iteration budget).
 * - `replace-at`: the operands are a list, an integer index and an element.
 *   The result is a new list, equal to the list but for the element at the
 *   index, counted from 1; a negative index counts from the end. An index
 *   out of range (0, beyond the length) has no value: the interpreter keeps
 *   the expression unevaluated, and compiled code throws
 *   (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"). The result
 *   is a list of integers only when the list and the element are integers.
 *   The operand list is not changed. An emitter can write the result into
 *   the array of the operand when no later code reads that array
 *   (`inPlaceUpdates()` in `structured-in-place.ts`).
 */
export type IRBuild = OperationBase & {
  readonly kind: 'build';
  readonly body: IRRegion;
};

export type IRReplaceAt = OperationBase & {
  readonly kind: 'replace-at';
};

/**
 * A read of the captured binding `IRProgram.captures[capture]`: a binding
 * of the engine that the program reads and does not bind (not an input, a
 * parameter or a local). The operation carries the identity of the binding
 * (`binding`, the object of the engine that holds it), not only its name,
 * and the value that the read gives (`snapshot`).
 *
 * A read of a snapshot is `pure`: the value is fixed when the program is
 * compiled, and the read does not read the binding when the code runs. A
 * later change of the binding has no effect on the compiled code; a new
 * compilation reads the new value.
 *
 * Not implemented, and what each would add:
 *
 * - A read of a LIVE binding (the value of the binding when the code runs)
 *   would not be pure with respect to a write of that binding. It would add
 *   a read set to the operation: the bindings that it reads. Each region
 *   would carry the union of the read sets of its operations, and an
 *   operation that calls a function the read set of the body of the
 *   function. Two operations could then be reordered, or run at the same
 *   time, only when the read set of each is disjoint from the write set of
 *   the other.
 * - A WRITE of a captured binding would be an operation of its own, with a
 *   write set (the bindings that it writes), summarized per region and per
 *   function as the read sets are. Its effect fact would be `effectful`,
 *   and the write set would tell which reads it orders.
 */
export type IRCaptureRead = OperationBase & {
  readonly kind: 'capture';
  readonly capture: number;
  readonly binding: object;
  readonly snapshot: number;
};

/** A conversion that changes the representation. An identity conversion
 *  has no operation. The policy of the target names the conversions that
 *  it has (`RepresentationPolicy.conversions`). */
export type IRConvert = OperationBase & {
  readonly kind: 'convert';
  readonly conversion: string;
};

/**
 * The operand is the condition. Only the region that the condition selects
 * is evaluated. Each region yields one value per result, in the order of
 * `results`; the result `i` is the value `i` of the selected region.
 *
 * An `if` that is a value has one result. An `if` that is a statement has
 * one result per local that a branch writes and that is read after the
 * `if`: the merged value of the local. A branch that does not write the
 * local yields the value of the local before the `if`. Such an `if` can
 * have no result, when its branches write no local that is read later.
 *
 * A branch can be closed (`isClosedRegion()`): it ends in an `exit`, and
 * the code after the `if` does not run when it is selected. An `if` with
 * one closed branch takes its results from the open branch only; the closed
 * branch yields nothing. An `if` with two closed branches has no result, is
 * closed itself, and is the last operation of its region.
 */
export type IRIf =Omit<OperationBase, 'result'> & {
  readonly kind: 'if';
  readonly result?: undefined;
  readonly results: readonly IRValue[];
  readonly then: IRRegion;
  readonly else: IRRegion;
};

/**
 * A loop over the integers from `from` to `to`, both included, in steps of
 * 1, or of -1 when `to` is less than `from`, as the interpreter iterates
 * `Range(from, to)`: the range from 1 to 0 has the two elements 1 and 0.
 * The operands are `from`, `to` and the initial value of each carried
 * value, evaluated once, before the first iteration.
 *
 * The parameters of the body region are the index, then one parameter per
 * carried value, in the order of `results`. Each iteration evaluates the
 * body with the index and the values that the previous iteration yielded
 * (the initial values for the first iteration). The body yields the next
 * value of each carried value, in the same order. The result `i` is the
 * value of the carried value `i` after the last iteration, or its initial
 * value when the range has no element.
 *
 * An `exit` in the body (`IRExit`) ends the loop before the end of its
 * range: the result `i` is then the operand `i` of that `exit`. The body
 * itself is open: a body that always exits is not a loop of the
 * representation.
 *
 * `iterationBudget` is the iteration budget of the compilation, or
 * `undefined` when it has none. A target writes its own check of the
 * budget, with the rule of the existing compiler of that target.
 *
 * A loop with a budget can abort: over the budget, the call of the
 * compiled code ends with an error. An abort is not an effect: it changes
 * no state that the program reads, so the effect of the loop is the effect
 * of its body, and a pure value can move across the loop (computed before
 * or after it gives the same value when the loop does not abort, and no
 * value when it does). The region that holds such a loop records that it
 * can abort (`IRRegion.canAbort`). A transformation must not delete an
 * operation that can abort, run it when the program would not, or run it
 * more times than the program does: each changes whether the call aborts.
 */
export type IRLoop = Omit<OperationBase, 'result'> & {
  readonly kind: 'loop';
  readonly result?: undefined;
  readonly results: readonly IRValue[];
  readonly body: IRRegion;
  readonly iterationBudget?: number;
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
 *  arguments, evaluated once, in order, before the call. The effect of the
 *  call includes the effect of the body of the function, which includes the
 *  effect of each call in that body: the effect of a call is the effect of
 *  every function that it reaches. */
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

/** The last operation of an open region: its operands are the values of
 *  the region. A region of an `if` yields one value per result of the `if`,
 *  and the body of a `loop` one value per result of the `loop`; every other
 *  region yields one value. A closed region has no yield
 *  (`isClosedRegion()`). */
export type IRYield = {
  readonly kind: 'yield';
  readonly result?: undefined;
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  readonly origin: Expression;
};

/**
 * The second way to end a region: the last operation of a closed region,
 * which ends the innermost `loop` that holds it. Its operands are the value,
 * at this point, of each carried value of that loop, in the order of the
 * results of the loop: the result `i` of the loop is the operand `i`. An
 * `exit` defines no value and has no effect (`pure`).
 *
 * Between the `exit` and the body of its loop there are only branches of
 * `if` operations: no region of a `build`, of an `and` or an `or`, and no
 * body of a function. The `exit` passes values to the results of the loop
 * as the yield of the body does, so each value keeps one definition.
 */
export type IRExit = {
  readonly kind: 'exit';
  readonly result?: undefined;
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  readonly origin: Expression;
};

export type IROperation =
  | IRLiteral
  | IRInputRead
  | IRCaptureRead
  | IRArithmetic
  | IRUnaryFunction
  | IRBinaryFunction
  | IRListRead
  | IRBuild
  | IRReplaceAt
  | IRConvert
  | IRIf
  | IRLoop
  | IRShortCircuit
  | IRCall
  | IRTrace
  | IRYield
  | IRExit;

export type IRRegion = {
  /** The values that the region defines at its entry, before its first
   *  operation: the parameters of the body of a `loop`, and the index of
   *  the body of a `build`. Each is visible in
   *  the region and in the regions nested in it. The body of a function
   *  has none: the parameters of a function are `IRFunction.parameters`,
   *  which the verifier defines at the entry of its body in the same way. */
  readonly parameters?: readonly IRValue[];
  readonly operations: readonly IROperation[];
  /** True when the evaluation of the region can abort
   *  (`operationCanAbort()` for one of its operations); absent otherwise.
   *  A region that can abort is never removed, also when it is `pure`. */
  readonly canAbort?: true;
  /** The join of the effects of the operations (`joinEffects()`). */
  readonly effect: EffectFact;
};

export type IRInput = {
  readonly name: string;
  readonly type: ValueType;
  readonly representation: Representation;
  /** For a list input: the spelling of the element type that the program
   *  declares (`finite_real` for `list<finite_real>`), which the type
   *  `list<real>` does not keep. A label for a target that names the
   *  element type in its code or its messages; no check reads it. */
  readonly elementLabel?: string;
};

/** A binding that the program reads as a snapshot (`IRCaptureRead`). */
export type IRCapture = {
  /** The identity of the binding: the object of the engine that holds it.
   *  Two captures of a program have different bindings. */
  readonly binding: object;
  /** The name of the binding, for a message. */
  readonly name: string;
  readonly type: ScalarKind;
  readonly representation: Representation;
  /** The value of the binding when the program was compiled. */
  readonly snapshot: number;
};

/** A resolved helper, written once as a function of the program. A helper
 *  can call another helper; the body of a helper reads its parameters and
 *  the captures of the program, and no input. */
export type IRFunction = {
  readonly name: string;
  /** Defined at the entry of the body. */
  readonly parameters: readonly IRValue[];
  /** For each list parameter, the spelling of the element type that the
   *  helper declares (`IRInput.elementLabel`); `undefined` for another
   *  parameter. */
  readonly parameterElementLabels?: readonly (string | undefined)[];
  /** A scalar, or a list: the body of a helper can make a list. */
  readonly result: {
    readonly type: ValueType;
    readonly representation: Representation;
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
  /** The bindings that the program reads as snapshots, in the root or in
   *  a function (`IRCaptureRead`). */
  readonly captures: readonly IRCapture[];
  readonly functions: readonly IRFunction[];
  readonly root: IRRegion;
};

const EFFECT_RANK: Readonly<Record<EffectFact, number>> = {
  pure: 0,
  unknown: 1,
  effectful: 2,
};

/** Whether the effect `a` is weaker than the effect `b` (`joinEffects()`
 *  orders them). */
export function weakerEffect(a: EffectFact, b: EffectFact): boolean {
  return EFFECT_RANK[a] < EFFECT_RANK[b];
}

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

/** The values that `op` defines: the results of an `if` or a `loop`, the
 *  result of every other operation but a yield. */
export function definedValues(op: IROperation): readonly IRValue[] {
  if (op.kind === 'if' || op.kind === 'loop') return op.results;
  return op.result === undefined ? [] : [op.result];
}

/** Whether the evaluation of `op` can abort: a `loop` with an iteration
 *  budget, an operation whose region can abort, or a call of a function
 *  whose body can abort (`IRLoop`). `functions`: the functions of the
 *  program. */
export function operationCanAbort(
  op: IROperation,
  functions: readonly IRFunction[]
): boolean {
  if (op.kind === 'loop' && op.iterationBudget !== undefined) return true;
  if (op.kind === 'call' && functions[op.function]?.body.canAbort === true)
    return true;
  return regionsOf(op).some((region) => region.canAbort === true);
}

/** The regions that `op` evaluates. */
export function regionsOf(op: IROperation): readonly IRRegion[] {
  if (op.kind === 'if') return [op.then, op.else];
  if (op.kind === 'loop' || op.kind === 'build') return [op.body];
  if (op.kind === 'and' || op.kind === 'or') return op.rest;
  return [];
}

/** Whether `region` is closed: its last operation is an `exit`, or an `if`
 *  whose two branches are closed. Every other region is open and ends in a
 *  yield. */
export function isClosedRegion(region: IRRegion): boolean {
  const last = region.operations[region.operations.length - 1];
  if (last === undefined) return false;
  if (last.kind === 'exit') return true;
  return (
    last.kind === 'if' && isClosedRegion(last.then) && isClosedRegion(last.else)
  );
}

/** The operands of the yield of `region`, the last operation of an open
 *  region that the verifier accepted. A closed region yields no value: the
 *  result is empty. */
export function yieldedValues(region: IRRegion): readonly IRValue[] {
  if (isClosedRegion(region)) return [];
  return region.operations[region.operations.length - 1].operands;
}

/** The `exit` operations that end `loop`: in its body, or in a branch of an
 *  `if` there, at any depth of branches. An `exit` in the body of an inner
 *  loop ends that loop, and is not one of these. */
export function exitsOf(loop: IRLoop): IRExit[] {
  return exitsIn(loop.body);
}

/** The `exit` operations in `region` that leave the loop that encloses
 *  `region`: those of the region and of the branches of its `if`
 *  operations, at any depth, and not those of a loop in it. A region that
 *  holds one changes which operations run after it, also when its effect
 *  is `pure` and it yields nothing, so it is never removed. */
export function exitsIn(region: IRRegion): IRExit[] {
  const exits: IRExit[] = [];
  const visit = (r: IRRegion) => {
    for (const op of r.operations) {
      if (op.kind === 'exit') exits.push(op);
      if (op.kind === 'if') {
        visit(op.then);
        visit(op.else);
      }
    }
  };
  visit(region);
  return exits;
}
