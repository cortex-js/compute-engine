// The types that the compiler modules share: fold cost contexts, condition
// nodes, element lanes, local frames, assignment checks, and the other records
// that were declared beside the compiler class.

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { CompileTarget } from './types.js';

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
  /** Names with no user body, for one lookup scope and cache generation. */
  nonUserFunctions?: WeakMap<
    object,
    { generation: number; names: Set<string> }
  >;
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
 * (`applyFunctionLiteral`, step 2b), and every emitted call site mirrors that
 * with a static map (`_SYS.mapFn`) over a list argument
 * (`emitUserFunctionCall`). Each parameter
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
 * A value with no settled shape that `unsettledShapeIn()`
 * (`compile-admission.ts`) found: `node`, and the `reason`. The reason is
 * `'branches'` when the branches of a conditional have conflicting shapes,
 * `'values'` when the values that a function literal, a `Loop` or the
 * root of the compilation can give have conflicting shapes,
 * `'assignments'` when the values and the types of one variable (in one
 * scope) have conflicting shape classes, or when a value that the code
 * assigns to an input conflicts with the type of the input (`node` is then
 * the `Assign`, the `Declare` or the function literal that adds the
 * conflicting type), `'index-assignment'` when an `Assign` in a function
 * literal writes the index of a `Loop`, `Sum`, `Product`, `Comprehension`
 * or `Integrate` that encloses the literal (`node` is then the `Assign`),
 * `'elementwise'` when an `If` or a `Which` whose condition is or can be a collection (it selects element by
 * element) has a branch that assigns a name or has a `Return`, a `Break` or
 * a `Continue` (`node` is then the conditional), `'scoped-assignment'` when
 * a `Comprehension`, a `Sum`, a `Product` or an `Integrate` has, in a part
 * where the interpreter and the compiled code do not agree on whether an
 * assignment changes the name outside the node, a part that assigns a name
 * or has a `Return`, a `Break` or a `Continue` (`node` is then that node),
 * or when a function literal that is called or applied by its parent
 * assigns a name of an enclosing scope (`node` is then its consumer, past
 * the branches of an `If` or a `Which` and the last statement of a
 * `Block`, or the node that passes the name of such a function as a value,
 * as `Filter(L, g)`),
 * `'return-in-loop'` when a `Return` is inside a `Loop` whose compiled code
 * would end only the loop (`node` is then the `Return`), and `'loop-value'`
 * when the value of a `Loop` is used and the compiled code cannot give it
 * (`node` is then the `Loop`), and `'handler-value'` when a caller's
 * `compile` handler wrote the code of a node whose static type admits
 * shapes that conflict and the stock code of a consumer reads its value
 * (`node` is then the node of the handler), `'block-value'` when a `Block`
 * with a statement other than a declaration with a value (an assignment,
 * a loop, a jump, any other statement before the last) is an operand (it
 * is not a statement, not
 * the body of a function, of the root or of a binder such as `Sum`, and
 * not their last value; `node` is then the `Block`; a block whose
 * statements before the last are only declarations with a value, as a
 * `where` clause gives, is a value and is not refused), and
 * `'nothing-value'` when the value of an assignment or of a declaration
 * is used (the last statement of a block whose value is used; `node` is
 * then the assignment).
 * `assertAdmitted()` reads the reason to write the message of the decline.
 */
export type UnsettledShape = {
  node: Expression;
  reason:
    | 'branches'
    | 'values'
    | 'assignments'
    | 'index-assignment'
    | 'elementwise'
    | 'scoped-assignment'
    | 'return-in-loop'
    | 'loop-value'
    | 'handler-value'
    | 'block-value'
    | 'nothing-value';
};

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
  /**
   * Emitted JavaScript definition name → the lane on which its body reads
   * each parameter, by position: `true` for the complex lane (a `{re, im}`
   * object), `false` for the real lane (a plain number), `undefined` for a
   * parameter that is not a plain symbol. Recorded from inside the shape
   * frames that the body compiles under (`recordUserFunctionParamLanes`).
   * A call reads it to give the real projection of a complex argument to
   * a parameter read on the real lane (`realLaneArguments`).
   */
  paramsByName: Map<string, ReadonlyArray<boolean | undefined>>;
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
   * The expressions that the test of the case compiles to compare the
   * subject with: each literal, each pin, the two endpoints of each range.
   * Empty for the irrefutable case. A target reads them to see what the
   * comparison runs, for example code supplied by the caller in a pin.
   */
  comparisons: ReadonlyArray<Expression>;
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
  /** The values assigned to the local, anywhere in the block. */
  values: Expression[];
};

export type LocalValueFrame = {
  /** The locals of the block, of the scopes nested in it, and the
   * variables outside it that it assigns, keyed by their definition. */
  byDef: Map<object, LocalEntry>;
};
