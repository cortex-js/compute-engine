/**
 * The structured representation of a scalar program: its values, regions,
 * operations and effect facts. The representation names no target: a
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
 * There is no common-subexpression pass, no reordering, no loop and no
 * collection: each occurrence of a prepared node gives its own operations,
 * in the order of the prepared tree.
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

/** The semantic type of a value. */
export type ScalarKind = 'real' | 'integer' | 'boolean' | 'complex';

/** The name of a representation of a target (`RepresentationPolicy`). */
export type Representation = string;

export type IRValue = {
  /** The program that defines the value (`IRProgram.owner`). */
  readonly owner: object;
  readonly revision: number;
  /** Unique in the program. */
  readonly id: number;
  readonly type: ScalarKind;
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
  readonly value: number | boolean | { readonly re: number; readonly im: number };
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
 *  complex `sqrt` is converted first. */
export type IRArithmetic = OperationBase & {
  readonly kind:
    | 'add'
    | 'negate'
    | 'multiply'
    | 'less'
    | 'equal'
    | 'min'
    | 'max'
    | 'sqrt';
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
 */
export type IRIf = Omit<OperationBase, 'result'> & {
  readonly kind: 'if';
  readonly result?: undefined;
  readonly results: readonly IRValue[];
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

/** The last operation of a region: its operands are the values of the
 *  region. A region of an `if` yields one value per result of the `if`;
 *  every other region yields one value. */
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
  | IRCaptureRead
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
  readonly representation: Representation;
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
  readonly result: {
    readonly type: ScalarKind;
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

/** The values that `op` defines: the results of an `if`, the result of
 *  every other operation but a yield. */
export function definedValues(op: IROperation): readonly IRValue[] {
  if (op.kind === 'if') return op.results;
  return op.result === undefined ? [] : [op.result];
}

/** The regions that `op` evaluates. */
export function regionsOf(op: IROperation): readonly IRRegion[] {
  if (op.kind === 'if') return [op.then, op.else];
  if (op.kind === 'and' || op.kind === 'or') return op.rest;
  return [];
}

/** The operands of the yield of `region`, the last operation of a region
 *  that the verifier accepted. */
export function yieldedValues(region: IRRegion): readonly IRValue[] {
  return region.operations[region.operations.length - 1].operands;
}
