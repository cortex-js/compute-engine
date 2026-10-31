// The types that the compiler modules share: fold cost contexts, condition
// nodes, element lanes, local frames, assignment checks, and the other records
// that were declared beside the compiler class.

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { CompileTarget, TargetSource } from './types.js';

/**
 * `foldCostEstimate`'s working state for one estimate.
 *
 * `cache` is a real memo of settled per-function costs, so a function called
 * from many places is analyzed once. `inProgress` is the separate
 * cycle guard — a name currently being expanded is recursive and has no
 * static bound. They must stay distinct: collapsing them into one set is what
 * turned the memo into a cycle guard and made the estimator exponential.
 */
export type FoldCostContext = {
  readonly cache: Map<string, number>;
  readonly inProgress: Set<string>;
  visits: number;
};

/**
 * An operand found by `unsafeIntegerOperands`, with the number of decimal
 * digits of the integer part of its magnitude (`Infinity` when the
 * approximate value overflowed). The digit count prices the exact fold
 * (`exactFoldValue`).
 *
 * The digit count is `undefined` when the operand cannot be checked: it has
 * no fold value of its own, usually because it mentions a variable bound in
 * the subtree, such as the index of a `Sum`. Such an operand is not known to
 * be in the safe integer range, so the fold does not use `.N()` for it.
 */
export type UnsafeIntegerOperand = {
  readonly operand: Expression;
  readonly digits: number | undefined;
};

/**
 * What the substitution of nested calls needs to know about the user-defined
 * function whose body it is rewriting, on the definition-emission route.
 *
 * `localNames` are the names the definition BINDS — its parameters, plus the
 * locals its body `Block` declares. They shadow the engine inside the body:
 * `q(g, t) := g(t) + g(t)^2` calls its own first parameter, whatever
 * engine-level `g` exists beside it. So a call of such a name is never
 * substituted, and neither is a callee whose body has a free symbol of that
 * name, which the binding would capture.
 *
 * `scalarNames` are the parameters that hold a run-time SCALAR. A caller never
 * passes a COLLECTION to a function whose formal parameters are all scalar:
 * the interpreter broadcasts the call element-wise instead
 * (`applyFunctionLiteral`, step 2b), and every emitted call site mirrors that,
 * with an unconditional `_SYS.bcastFn` dispatch or a runtime `Array.isArray`
 * guard around the direct call (`emitUserFunctionCall`). Each parameter
 * therefore holds one element, whatever its static type says — and a
 * definition body's parameters usually type `unknown`, so without this
 * evidence the argument test declines every nested call and nothing is ever
 * substituted. Empty when the definition's parameters are not all scalar,
 * which falls back to the static argument test alone.
 */
export type EnclosingDefinition = {
  scalarNames: ReadonlySet<string>;
  localNames: ReadonlySet<string>;
};

/**
 * A sink an emission route writes its DECLINE reason into on its way out.
 *
 * `ensureUserFunctionEmitted` and the routes below it report a decline by
 * returning `undefined`, which carries no explanation. Most callers only need
 * to know that the function was not emitted, so the sink is optional and
 * costs an absent argument. A caller that turns the decline into a
 * user-visible refusal — the value-position fail-closed refusal in
 * `compileExpr` — passes one and quotes `reason` in its message, so the
 * author is told WHICH property of the definition the target could not
 * express instead of only that it could not.
 *
 * The last writer wins: each route sets the field immediately before it
 * returns `undefined`, so the reason belongs to the decline that actually
 * ended the emission.
 */
export type DeclineNote = { reason?: string };

/**
 * A run-time check that an argument of a user function is present
 * (`BaseCompiler.absentArgumentChecks`): the message of the `TypeError` the
 * check throws, or `undefined` when an absent value is replaced by `NaN`
 * instead (a numeric parameter), and whether the check is also made on each
 * element of a list argument, at any depth (`elements`).
 */
export type AbsentArgumentCheck = {
  message: string | undefined;
  elements: boolean;
};

/**
 * How a target spells "the numeric fragment `x` holds a value a comparison can
 * DECIDE" — equivalently, "`x` is not this target's NaN".
 *
 * The default is the JavaScript family's `x === x`, which is false for exactly
 * one value. A target whose equality does not have that property, or which
 * spells it differently, passes its own (Python's `x == x`). The fragment
 * arrives already parenthesized when it needs to be.
 */
export type DecidedNumberTest = (x: TargetSource) => TargetSource;

/**
 * How a target spells the pieces a branch condition's decidedness analysis is
 * built from: whether a numeric fragment holds a value a comparison can
 * decide, the three-valued constants and the tests against them, and the two
 * forms — a conditional expression and a binding of one value to a name — the
 * three-valued lowering of the connectives is assembled out of.
 *
 * Only the WORDING is the target's business. Which tests are emitted, and how
 * a connective combines its operands, is the shared analysis in
 * `BaseCompiler.conditionDecidability` — see the "Branch conditions that
 * cannot be decided" comment there. The JavaScript family's spellings are the
 * default ({@link CONDITION_DIALECT_JS}); Python passes its own, because it
 * spells the undecided value `None`, negation `not`, and a binding a `lambda`
 * rather than an arrow.
 */
export interface ConditionDialect {
  /** "`x` holds a value a comparison can DECIDE": `x` is not this target's NaN. */
  readonly decidedNumber: DecidedNumberTest;
  /** The infix conjunction, between two already-parenthesized fragments. */
  readonly and: string;
  /**
   * The prefix negation, written immediately before its operand. A spelling
   * that is a word rather than a sign carries its own trailing space.
   */
  readonly not: string;
  /** The value a condition has when it is neither true nor false. */
  readonly undecided: TargetSource;
  /** The two decided values. */
  readonly trueValue: TargetSource;
  readonly falseValue: TargetSource;
  /**
   * The tests a three-valued fragment takes. `x` is always a name bound by
   * {@link bind}, so each may spell it more than once.
   */
  readonly isTrue: (x: TargetSource) => TargetSource;
  readonly isFalse: (x: TargetSource) => TargetSource;
  readonly isUndecided: (x: TargetSource) => TargetSource;
  /**
   * The three-valued value of a fragment that may not be a boolean at all —
   * `true`/`false` when it is exactly one of them, the undecided value
   * otherwise. `negate` exchanges the two decided answers, which is how a
   * `Not` over such a fragment is lowered: an emitted negation would turn the
   * undecided value into a confident boolean.
   */
  readonly kleeneOfValue: (x: TargetSource, negate: boolean) => TargetSource;
  /** A conditional expression, parenthesized. */
  readonly ternary: (
    test: TargetSource,
    then: TargetSource,
    otherwise: TargetSource
  ) => TargetSource;
  /**
   * Bind `args` to `params` for the duration of `body`, as one expression:
   * an immediately-applied arrow on the JavaScript family, a `lambda` on
   * Python. This is what makes the lowering LAZY — a value inside the body
   * runs only when the body is reached.
   */
  readonly bind: (
    params: ReadonlyArray<string>,
    body: TargetSource,
    args: ReadonlyArray<TargetSource>
  ) => TargetSource;
}

/**
 * The decidedness analysis of a branch condition, as a tree over the logical
 * connectives it is built from. Produced by
 * `BaseCompiler.conditionDecidability` and consumed by
 * `BaseCompiler.kleeneCondition`.
 *
 * A node stands for one sub-expression of the condition; `test` says how the
 * emitted code establishes whether that sub-expression is decided, and what
 * its value then is.
 */
export interface ConditionNode {
  /**
   * True when the sub-expression sat under an ODD number of `Not`s. The
   * negation is recorded here rather than left in `test`, because it must be
   * applied to a DECIDED value: `!undefined` is a confident `true`, an answer
   * from no evidence.
   */
  readonly negate: boolean;
  readonly test: ConditionTest;
}

type ConditionTest =
  /**
   * The compiled value is not necessarily a boolean at all: a
   * `boolean`-declared symbol the caller left unsupplied is `undefined`, and
   * a caller may pass any value. Inspect `expr` — the sub-expression with its
   * `Not`s stripped off — for being exactly a boolean.
   */
  | { readonly kind: 'value'; readonly expr: Expression }
  /**
   * `expr` is a relation whose compiled value is a genuine boolean, so an
   * undecided comparison has already collapsed into it (see
   * `BRANCH_RELATIONS`). Test these operands of it instead. An EMPTY
   * operand list means the relation is decided by construction.
   *
   * A relation with a NaN operand has its IEEE value — `false`, or `true`
   * for `NotEqual` (user decisions 2026-10-20 and 2026-10-23) — so its
   * operands are tested only for an absent value: a `missing`-typed operand
   * and an unsupplied variable.
   */
  | {
      readonly kind: 'operands';
      readonly expr: Expression;
      readonly operands: ReadonlyArray<Expression>;
    }
  /**
   * `expr` is an `And` or an `Or`. It is decided when one operand already
   * settles the result — a `false` operand for an `And`, a `true` one for an
   * `Or` — or when every operand is decided.
   */
  | {
      readonly kind: 'connective';
      readonly expr: Expression;
      readonly op: 'And' | 'Or';
      readonly operands: ReadonlyArray<ConditionNode>;
    };

/**
 * A branch condition compiled together with everything the selection around it
 * needs, so that an `If`/`Which` takes an arm only when the condition is
 * exactly decided. Built by `BaseCompiler.compileExactCondition` and consumed
 * by `BaseCompiler.exactSelect`.
 */
export interface CompiledCondition {
  /**
   * The condition's own source. For the `'value'` shape it is the condition
   * with its `Not`s stripped off — the negation lives in `negate` instead.
   */
  readonly code: TargetSource;
  /**
   * How to test that the condition is decided: `'value'` inspects `code`
   * itself for `true`/`false`, a list of source fragments tests the relation's
   * operands, and an empty list means the condition is decided by
   * construction.
   */
  readonly conjuncts: ReadonlyArray<TargetSource> | 'value';
  /**
   * Temporaries the condition's operands were bound to, in the order they must
   * be evaluated. They wrap the whole selection: both the condition and the
   * decidedness test read them.
   */
  readonly bindings: Array<[name: string, value: TargetSource]>;
  /**
   * True when the condition sat under an odd number of `Not`s. The selection
   * then exchanges the constants its two decided tests compare against, which
   * negates a decided verdict and leaves an undecided one undecided.
   */
  readonly negate: boolean;
}

/**
 * The type used to answer compile-time representation questions about `expr`.
 * A `reference` type — a `type alias`
 * or a nominal `type` — unfolds to its definition, because compilation is type
 * erasure and the tag carries no layout. Identity for every other type.
 *
 * Exported for the compile targets, which ask the same layout questions
 * (`gpuType` in gpu-emit.ts).
 */
/**
 * One validated `Element` clause of a loop (`BaseCompiler.elementClauseBinders`):
 * the clause itself, the names its binder introduces (a `_` position binds
 * nothing), the binder spelled for each target, and each bound leaf with the
 * static type of the source component it receives (`undefined` when the
 * source's element type is unknown).
 */
export interface ElementBinder {
  clause: Expression & {
    ops: ReadonlyArray<Expression>;
    op1: Expression;
    op2: Expression;
  };
  names: string[];
  /** `x`, or an array pattern such as `[a, , [b, c]]`. */
  jsPattern: string;
  /** `x`, or a tuple pattern such as `(a, _, (b, c))`. */
  pyPattern: string;
  leaves: Array<
    [leaf: Expression & { symbol: string }, type: Type | undefined]
  >;
}

/** The registry of the user functions emitted by one compilation. */
export type UserFunctionRegistry = NonNullable<
  CompileTarget<Expression>['userFunctions']
>;

/**
 * The value shape a broadcast closure's parameter holds at run time for one
 * operand: `true` for a `{re, im}` object at every position, `false` for a
 * plain number at every position, `'mixed'` when the positions do not all
 * share one shape or the shape cannot be decided statically, `undefined`
 * when no broadcast closure may be built over the operand at all. See
 * `BaseCompiler.operandElementLane`.
 */
export type ElementLane = boolean | 'mixed' | undefined;

/**
 * What one compilation knows about the lane of the value that each emitted
 * user-function definition returns (`BaseCompiler.recordUserFunctionLane`,
 * read by `BaseCompiler.userCallLane`).
 */
export type UserFunctionLanes = {
  /**
   * Emitted definition name → `true` when the definition returns a complex
   * scalar, `false` for a real scalar, `undefined` for a value that is not a
   * scalar.
   */
  byName: Map<string, boolean | undefined>;
  /**
   * Call node → the name of the emitted definition that the call uses, once
   * that definition is emitted (`userCallLane`).
   */
  byNode: WeakMap<Expression, string>;
  /**
   * The definitions emitted because an analysis asked for the lane of a call
   * (`userCallDefinition`) before the call was compiled. The ones that the
   * compiled code does not reference are removed from the preamble.
   */
  onAsk: Set<string>;
  /**
   * The definitions whose recursive call was read as real while the
   * definition was compiling, because the call's type is not complex and
   * the lane discipline in force reads that type as real.
   */
  assumedReal: Set<string>;
  /**
   * The definitions that are compiled a second time with their recursive
   * calls read as complex, because the first compilation read them as real
   * and the body then returned a complex value (`RecursiveLaneRetry`).
   */
  assumedComplex: Set<string>;
  /**
   * The definitions with a collection body whose recursive call was read,
   * while the definition was compiling, with the lane of its entries taken
   * from its type (`userCallElementLane`). A type such as `matrix<number>`
   * gives the wide lane, and a linear-algebra head over the call then takes
   * its real helper.
   */
  assumedRealElements: Set<string>;
  /**
   * The definitions with a collection body that are compiled a second time
   * with the entries of their recursive calls read as complex, because the
   * first compilation read them from the type and the body then returned
   * complex entries (`RecursiveLaneRetry`).
   */
  assumedComplexElements: Set<string>;
  /**
   * Emitted definition name → the lane of the ENTRIES of the collection
   * that the definition returns (`linearAlgebraOperandLane` of its body),
   * for a definition whose body is a collection. Read by
   * `linearAlgebraOperandLane` for a call of the definition
   * (`userCallElementLane`).
   */
  elementByName: Map<string, 'real' | 'complex' | 'wide'>;
};

/**
 * One entry of `BaseCompiler._unrolledIndexValues`: the integer value each
 * index of an unrolled `Sum`/`Product` term holds (or its loop lower bound),
 * the names an inner binder
 * has REBOUND (whose enclosing values must therefore not be read), the names
 * whose own binder has not been entered yet, and the fold memo the frame owns.
 * See the field's own documentation.
 */
export type UnrolledIndexFrame = {
  values: ReadonlyMap<string, number>;
  lowerBounds?: ReadonlyMap<string, number>;
  masked: ReadonlySet<string>;
  /**
   * The frame's own names, less the ones whose binder has already been
   * entered. The first scope that binds a name is the binder the frame was
   * pushed FOR; every later one rebinds it. Mutated only by
   * `_enterUnrolledIndexBinder`, which restores what it removed.
   */
  pending: Set<string>;
  memo: WeakMap<Expression, Expression | null>;
};

/**
 * What `BaseCompiler._enterUnrolledIndexBinder` must undo: whether it pushed a
 * masking frame, and the (frame, name) pairs whose `pending` mark it consumed.
 */
export type UnrolledIndexBinderEntry = {
  pushed: boolean;
  owned: Array<[UnrolledIndexFrame, string]>;
};

/**
 * One binding minted by {@link BaseCompiler.hoistLoopInvariants}: the local
 * name, the code its right-hand side compiled to, and the representative node
 * that code came from. The node is carried so a target whose local
 * declarations are typed (the shader languages need `float x = …;`) can read
 * the static type off the expression instead of guessing it from the code.
 */
/**
 * One case of a `Match` as `BaseCompiler.compileMatchTernary` hands it to the
 * `statement` hook of a target: the case body and guard as written, and
 * functions that compile the case test and the body.
 */
export type MatchStatementClause = {
  /** The case body, as written in the `Match`. */
  body: Expression;
  /** The case guard, as written in the `Match`, if the case has one. */
  guard?: Expression;
  /**
   * Compile the test of the case: the comparison of the subject with the
   * case patterns, and the guard after `&&`. The guard is compiled through
   * the `arm` option of `compileMatchTernary`, as in the ternary form,
   * because `&&` evaluates it only when the comparison holds. Absent for
   * the irrefutable case that ends the clause list (`_`), which always
   * matches.
   */
  test?: () => string;
  /** Compile the case body. */
  compileBody: () => string;
};

export type LoopInvariantBinding = [
  name: string,
  code: string,
  node: Expression,
];

/**
 * The function-valued locals of one statement list whose value can change
 * while the list runs (`BaseCompiler.reboundLocalNames`).
 *
 * - `rebound`: each such name, with the function literal a call of it is
 *   compiled against (`literal`, one of the literals the name is assigned —
 *   they all have the same signature), or the reason a call of it cannot
 *   compile (`decline`).
 * - `writes`: for each top-level statement, the names of `rebound` that the
 *   statement assigns, at its top level or inside it.
 */
export type ReboundFunctionLocals = {
  rebound: Map<
    string,
    {
      literal?: Expression;
      literals?: ReadonlyArray<Expression>;
      decline?: string;
    }
  >;
  writes: Map<Expression, Set<string>>;
};

/** See `BaseCompiler.blockLocalValueFrame`. */
export type LocalEntry = {
  name: string;
  /** The frame that holds the local. */
  frame: LocalValueFrame;
  /** The values assigned to the local, anywhere in the block. */
  values: Expression[];
  /** A local of the block itself, not of a scope nested in it, or a
   * variable outside the block that the block assigns. Its read is in
   * scope everywhere in the block. */
  own: boolean;
  /** A variable outside the block that the block assigns: a variable of
   * the vars object (`_.c = …`), or a parameter of the enclosing function. */
  outer: boolean;
  /** Whether every value of the local reads an absent value as NaN
   * (`readsAbsenceAsNaN`), once it is known. */
  absenceAsNaN?: boolean;
  /** Whether a value of the local could depend on a caller input
   * (`localDependsOnInputs`), once it is known. */
  dependent?: boolean;
};

export type LocalValueFrame = {
  /** The locals of the block, of the scopes nested in it, and the
   * variables outside it that it assigns, keyed by their definition. */
  byDef: Map<object, LocalEntry>;
  /** The same locals, by name (`blockLocalsNamed`). */
  byName: Map<string, LocalEntry[]>;
  /** The definitions that the binders inside the block create. */
  binderDefs: Set<object>;
  /** The statements of the block. */
  stmts: ReadonlyArray<Expression>;
  /** The block node, when there is one. */
  node: Expression | undefined;
  /** The free variables of the block (`unknowns`). */
  names: ReadonlySet<string>;
  /** The caller inputs that the block reads (`blockInputs`), once known. */
  inputs?: Expression[];
  /** The index of each `Loop` clause of the block (`Element(k, xs)`),
   * by its definition, with the collection it ranges over as its value
   * (`localDependsOnInputs`). */
  loopIndices: Map<object, LocalEntry>;
  /** True once `localDependsOnInputs` has set `dependent` on every local
   * of the frame. */
  dependenceKnown?: boolean;
  /** For each statement, the locals assigned by a top-level statement
   * before it. */
  assignedBefore: Set<string>[];
  /** The index of the statement being compiled. */
  current: number;
  /** The local of each emitted name. */
  bySpelling: Map<string, string>;
};

/** See `BaseCompiler.classifyLocalReads`. */
export type LocalReadClasses = {
  /** The locals that have a read of class 3 (assigned on some paths only),
   * with the value definition of each one when the scope of the block has
   * one. */
  unproved: ReadonlyMap<string, object | undefined>;
  /** The reads of class 1 (assigned on every path). */
  safe: ReadonlySet<Expression>;
};

/** See `BaseCompiler.checkedLocalReads`. */
export type CheckedLocalsFrame = {
  /** The name of the marker object of each checked local. */
  markers: ReadonlyMap<string, string>;
  /** The spelling of each checked local. */
  spelled: ReadonlyMap<string, string>;
  /** The value definition of each checked local, when the scope of the
   * body has one. A read is checked only when it reads this binding: a
   * parameter or a local of another function with the same name is not. */
  defs: ReadonlyMap<string, object>;
  /** The reads that come after an assignment on every path. */
  safe: ReadonlySet<Expression>;
};
