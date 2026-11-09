// The compiler state that one module assigns and other modules read: the
// compile mode, memos, budgets, and the frames of the current
// compilation. An imported `let` cannot be assigned, so these values are static
// fields of a class.

import type { ReferencesMemo } from '../boxed-expression/abstract-boxed-expression.js';
import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { KindLowering } from './kind-lowering.js';
import type { CompileMode, CompileTarget } from './types.js';
import type {
  ElementLane,
  UnrolledIndexFrame,
  UnsafeIntegerOperand,
  UnsettledShape,
} from './compiler-types.js';

/**
 * Step budget for one `Integrate` node's antiderivative-first attempt (a
 * step is one `checkDeadline` call on the engine frame; see `StepBudget` in
 * `common/interruptible.ts`).
 *
 * The attempt is an **optimization** — every integral it declines still
 * compiles, via the caller's numeric emitter (quadrature on the JavaScript
 * target, a rigorous enclosure on the interval target) — so it must never be
 * able to stall a compilation. Compilation establishes no deadline of its
 * own, and since `ce.timeLimit` was retired (`docs/TIMEOUT-MODEL.md` §5) work
 * outside a span runs unbounded: relying on "the enclosing span, if any"
 * meant the default (no span) case could spin forever. So the attempt arms
 * its own span.
 *
 * Per §3.4 nesting is `min()`, so an enclosing consumer span that is tighter
 * still preempts this budget — this can only shorten, never extend, a
 * caller's bound.
 *
 * The budget counts steps, not milliseconds. With a wall-clock budget the
 * same integral compiled to its closed form on a fast machine and to
 * numeric quadrature on a slow or loaded one, so the compiled code, and its
 * values, depended on the machine. A step budget stops the search at the
 * same point on every machine. A large wall-clock limit
 * ({@link ANTIDERIVATIVE_ATTEMPT_HANG_MS}) stays beside it only as a guard
 * against a hang in code that does not count steps.
 *
 * Sized against the steps of the symbolic resolutions in the
 * compile-integrate suite and the Rubi benchmark, with headroom, so no
 * integral that legitimately closes is pushed onto the numeric path.
 */
export const ANTIDERIVATIVE_ATTEMPT_STEPS = 300_000;

/** The wall-clock guard of all the attempts of one compilation. An attempt
 *  that spends its time in code that does not count steps (a polynomial
 *  GCD on coefficients with thousands of digits) can use its whole hang
 *  limit while spending few steps, so the step pool alone would not keep
 *  a compilation with many such integrals short. This guard can decide
 *  which integrals get a closed form only when the attempts of one
 *  compilation spend 30 s in total, a case that does not reach the step
 *  pool first unless each step is slow: there the result can still depend
 *  on the machine. */
export const ANTIDERIVATIVE_COMPILATION_HANG_MS = 30_000;

/**
 * Shared step budget for ALL antiderivative-first attempts in one
 * outermost compilation.
 *
 * The per-node budget above bounds one attempt, but an emission can carry
 * hundreds of `Integrate` nodes — a macro-expanded consumer document
 * produced 728 in one expression (Tycho item 226) — and a fresh budget
 * per node lets the aggregate reach nodes × the budget before the numeric
 * fallback. Since the attempt is purely an optimization, the attempts
 * share this pool: each consumes the steps it actually spends, and
 * once the pool is dry every remaining integral in the compilation skips
 * straight to its numeric emitter. Sized for a handful of hard legitimate
 * resolutions plus dozens of ordinary ones.
 *
 * Reset at each DEPTH-0 entry of `BaseCompiler.compile` — the boundary
 * every route crosses: `compileRoot` (raw custom targets),
 * `compileCseRoot` (registered targets invoked directly), and the public
 * `compile()` entry. Nested
 * compilations consume the outer pool rather than getting a fresh one, so
 * the aggregate is bounded by one pool per depth-0 entry. A caller that
 * deliberately issues several root compilations against one target — a
 * multi-statement shader body compiles each statement separately
 * (`compileShaderBody`) — therefore gets one pool per statement, which
 * keeps each statement's compile time bounded exactly as one expression's
 * is.
 */
export const ANTIDERIVATIVE_COMPILATION_STEPS = 600_000;
/**
 * Context shared by the analysis and code generation modules. Temporary
 * changes are restored in finally blocks: evaluation during compilation
 * can itself compile a callback, so synchronous execution still re-enters
 * these contexts.
 */
export class CompilerState {
  /**
   * The kind lowering of the compilation in progress (`kind-lowering.ts`):
   * set at the compile boundary when the expression holds a kind value and
   * every kind type found has a representation on the target, `undefined`
   * otherwise. Read by `compileKindOperation()`. Compilation is synchronous,
   * so one static serves, like `_mode`; it is cleared when the outermost
   * compilation ends.
   */
  static _kindLowering: KindLowering | undefined;
  /** The kind lowering of the most recent outermost compilation, kept after
   * it ends for the target that builds the result (`kindLoweringReport()`). */
  static _lastKindLowering: KindLowering | undefined;
  /**
   * The outermost JavaScript compilation's target, latched at the depth-0
   * entry when constant folding is allowed (no `constantFold: false`, no
   * `symbolDeps` capture) — undefined otherwise, and outside compilations.
   * With it set, `isComplexValued` consults the memoized constant fold
   * before reporting a closed pure scalar complex: a real folded value
   * overrides the shape verdict, and `tryConstantFold`'s complex-shape gate
   * — which reads the same oracle — then admits the fold, so the emitted
   * literal and every analysis answer describe the same plain number.
   */
  static _oracleFoldTarget: CompileTarget<Expression> | undefined;
  /**
   * The target of the innermost `compile()` in progress, or `undefined`
   * outside a compilation. A lowering asks for the lane of its operands
   * while it compiles its own node, so this is the target that an operand
   * which is a user-function call is compiled with: `userCallLane` emits the
   * definition that the call uses against it.
   */
  static _callSiteTarget: CompileTarget<Expression> | undefined;
  /** The innermost compile target's `boundVars`, synced by `compile()`. */
  static _boundVarsCtx: ReadonlySet<string> | undefined;
  /**
   * The compile mode of the OUTERMOST compilation (`CompileMode`), latched by
   * `compile()` at depth 0 from the target's `mode` (validated against its
   * `supportedModes`, defaulting per `resolveCompileMode`) and restored on
   * the way out. `'strict'` outside any compilation.
   *
   * Consulted by the analysis and the emitters through the three gates
   * `strictLanes` (strict), `complexDiscipline` (complex) and
   * `promotionActive`/`runtimeRealGuards` (complex); see
   * `docs/COMPILATION-MODEL.md` for the disciplines.
   */
  static _mode: Exclude<CompileMode, 'bigint'> = 'strict';
  /**
   * The representation of the integer lane for the OUTERMOST compilation,
   * latched and restored with `_mode`. `'bigint'` when the caller requested
   * `mode: 'bigint'` (JavaScript target only): `_mode` is then `'strict'`,
   * so the strict discipline applies unchanged (`strictLanes()` is `true`,
   * `complexDiscipline()` is `false`, nothing is promoted), and this latch
   * says that integer values are computed as JavaScript `bigint` values.
   * `'double'` in every other mode and outside any compilation. Read it
   * through `integerLane()` (`compiler-mode.ts`).
   */
  static _integerLane: 'double' | 'bigint' = 'double';
  /**
   * The number of `withPromotionSuppressed` calls in progress. While it is
   * more than zero, `promotionActive` is `false`. Both the analysis
   * (`isComplexValued`, through `promotesRadicalToComplex`) and the emitters
   * read `promotionActive`, so they agree on the shape of every node that is
   * compiled while the count is more than zero.
   *
   * A module-level definition (a user function, a folded symbol value) is
   * shared by every call site, so it is never compiled with the count of the
   * call site that emits it: `withPromotionUnsuppressed` sets the count to
   * zero for that compilation.
   */
  static _promotionSuppressed = 0;
  /**
   * The OUTERMOST compilation's real-only predicate
   * (`isRealOnlyLowering(target, h)`), latched by `compile()` at depth 0
   * (only for a target with a `language` other than the interval family) and
   * restored on the way out. `undefined` outside any compilation.
   *
   * Analysis and code generation consult the same predicate, so a numeric
   * operation without a complex implementation is never read as a complex
   * object. Complex-mode callers project a real-valued complex operand, or
   * return NaN when its imaginary part is nonzero. Strict mode declines
   * such an operand; a definitely non-real operand declines in every mode.
   */
  static _realOnlyLowering: ((h: string) => boolean) | undefined = undefined;
  /**
   * The report of the most recently COMPLETED outermost compilation, read by
   * `modeReport` when a target attaches `mode` to its result. A
   * compilation that DECLINES leaves the neutral value written at its entry
   * instead — it emitted no code for a report to describe.
   */
  static _lastReport: {
    mode: 'strict' | 'complex' | 'bigint';
  } = { mode: 'strict' };
  /** The answers of `isConstantPole` for the evaluated operands of this
   * compilation; reset at each outermost compilation, as
   * `_knownExponentMemo`. */
  static _constantPoleMemo = new WeakMap<Expression, boolean>();
  /**
   * The values of the exponents that `knownExponentPower` evaluated in this
   * compilation (`null`: no value that replaces the exponent). Reset at each
   * outermost compilation, since the values of the engine symbols are stable
   * within one compilation only.
   */
  static _knownExponentMemo = new WeakMap<Expression, Expression | null>();
  /**
   * Heads whose body is being looked through (`withCollectionElements`,
   * `elementsRealByConstruction`, the `Apply(Derivative(f), …)` arm of
   * `isComplexValued`), so a recursive definition stops the look-through.
   */
  static _userCallVisited: Set<string> = new Set();
  /**
   * Memo for {@link operandElementLane}, layered exactly like the complexness
   * memo (`_complexMemoStack`): a lane answer embeds `isComplexValued`
   * answers, so it is valid in precisely the same lexical context. Managed by
   * the same four bookkeeping helpers.
   */
  static _elementLaneMemoStack: WeakMap<object, ElementLane>[] = [
    new WeakMap(),
  ];
  /**
   * Per-compilation memo of `constantFoldValue`'s post-gate EVALUATION
   * outcome, keyed per target then per expression. One compilation reaches
   * the same constant subtree from both the emission fold (`tryConstantFold`)
   * and the shape analyses (`isProvablyRealValued`), and the two MUST see the
   * same outcome: two independently budgeted evaluations of a
   * deadline-degradable operator (adaptive quadrature) could settle on
   * different estimates, letting the emitted literal and the wrap decision
   * disagree about the value's shape. The GATES are deliberately NOT
   * memoized — they read compile context (bound names, a target's
   * exclusions) that legitimately differs between call sites — and the
   * per-target keying is for `maxInlineElements`, which shapes the
   * materialized `elements`. Reset at each outermost compilation entry,
   * where engine symbol values may have changed (the complexness memo's
   * policy).
   */
  static _foldValueMemo = new WeakMap<
    object,
    Map<
      Expression,
      { value: Expression; elements: Expression[] | undefined } | 'declined'
    >
  >();
  /**
   * Per-compilation memo of `foldValueBlocked`, keyed by node identity.
   * Reset together with `_foldValueMemo` at each outermost compilation entry,
   * for the same reason: the answer reads engine symbol VALUES, which are
   * stable within one compilation but not across compilations.
   */
  static _foldValueBlockedMemo = new Map<Expression, boolean>();
  /** The references of each function node walked by `hasUnknowns` in this
   * compilation (see `hasUnknownsWithMemo`). Reset with the other fold memos
   * at the outermost compilation, since the values of the engine symbols are
   * stable within one compilation only. A `WeakMap`, because it holds every
   * node of the compiled expression: it must not keep the expression alive
   * after the compilation. */
  static _unknownsMemo: ReferencesMemo = new WeakMap();
  /**
   * Per-compilation memo of `foldValueImpure`, keyed by node identity; reset
   * with `_foldValueMemo` at each outermost compilation entry.
   */
  static _foldValueImpureMemo = new Map<Expression, boolean>();
  /**
   * Per-compilation memo of `foldValueMentions`, keyed by node identity;
   * reset with `_foldValueMemo` at each outermost compilation entry.
   */
  static _foldValueMentionsMemo = new Map<Expression, ReadonlySet<string>>();
  /**
   * Per-compilation memo of `nameHasAngularDefinition`, keyed by symbol
   * name; reset with `_foldValueMemo` at each outermost compilation entry,
   * since the definitions of the engine are stable within one compilation
   * only.
   */
  static _angularDefinitionMemo = new Map<string, boolean>();
  /**
   * Per-compilation memo of `nameReachesAbsArg`, keyed by symbol name; reset
   * with the other compilation memos.
   */
  static _absArgMemo = new Map<string, boolean>();
  /**
   * Per-compilation memo of `reachesCallerCodeOn`, keyed per target, then
   * per expression. The answer also depends on the caller's provenance
   * predicates of the target (`cse.harvestOptions`), which a new session can
   * replace on the same target object, so each entry records the predicates
   * it was computed with. Reset with the other compilation memos.
   */
  static _callerCodeMemo = new WeakMap<
    CompileTarget<Expression>,
    { options: object | undefined; answers: WeakMap<Expression, boolean> }
  >();
  /**
   * Per-compilation memo of `unsafeIntegerOperands`, keyed per target then
   * per expression, like `_foldValueMemo`; reset with `_foldValueMemo` at
   * each outermost compilation entry. Without it, every subtree was scanned
   * again from each of its ancestors, and a nesting of digit operators
   * (`DigitSum(DigitSum(…))`) was scanned an exponential number of times.
   */
  static _unsafeOperandsMemo = new WeakMap<
    object,
    Map<Expression, ReadonlyArray<UnsafeIntegerOperand>>
  >();
  /**
   * Per-compilation memo of `variantResultType()`, keyed per target, then
   * per call (`null`: no result type). The answer reads the current
   * function literal of the callee, the block-local functions and the bound
   * variables of the target, so it is emptied when the outermost
   * compilation starts and when it ends: a later compilation of the same
   * call after `g := t ↦ t + 1` reads the new literal of `g`.
   */
  static _variantResultTypeMemo = new WeakMap<
    object,
    WeakMap<Expression, Type | null>
  >();
  /** See `emitFoldedValue`: folding is off while a folded value is emitted. */
  static _emittingFoldedValue = false;
  /**
   * The node whose operands the currently-dispatched handler is lowering —
   * the CSE edge key for emitters that are handed an operand LIST rather than
   * the node (the targets' `Sum`/`Product` handlers). Synced by
   * `_compileInner`, like `_boundVarsCtx`; compilation is synchronous, so a
   * static is safe. `undefined` simply means no region is pushed (CSE
   * degrades to the enclosing region).
   */
  static _cseParent: Expression | undefined;
  /**
   * The `Block` node that `compileCollectionValueBlock` compiles. The
   * `Block` branch of `compileExpr` reads it (and clears it) to know that
   * the value of this block is consumed whole. Compilation is synchronous,
   * so a static is safe.
   */
  static _collectionValueBlock: Expression | undefined;
  /**
   * Fail closed when a destructuring-assignment TARGET carries an
   * enforcement the compiled per-leaf write cannot reproduce.
   *
   * The interpreter's destructuring `Assign` is ATOMIC: every leaf is validated
   * against its target's existing binding (`assertAssignable`) in a read-only
   * pass, and one rejection leaves the WHOLE pattern unwritten. The lowering
   * here is a sequence of plain per-leaf writes with no such validation, so a
   * pattern the interpreter refuses outright ran to completion compiled:
   * `(x, y) := (7, 4.5)` over `x, y: integer` wrote both (compiled `704.5`
   * against the interpreter's `102`, where neither target moved), and a `const`
   * target was silently overwritten where the interpreter throws.
   *
   * Reproducing the check would mean emitting a run-time type test per leaf and
   * an all-or-nothing commit — a whole tier, not a gate — so the shapes that
   * need it fail closed instead.
   *
   * An UNTYPED / inferred-type target keeps compiling byte-identically: nothing
   * is enforced there, so the sequence of writes IS the interpreter's outcome.
   * That is the state-threading idiom `(v, j) := step(j)`, which this must not
   * disturb.
   */
  /**
   * The enforced-target frames of the lexically enclosing statement lists
   * (`compileBlock`), innermost last — the only route by which a destructuring
   * assign nested in a LOOP BODY can see the enclosing block's declarations,
   * since `compileLoopBody` is handed the body's statements alone. An emitted
   * user-function body enters its own annotated PARAMETERS the same way
   * (`withEnforcedParams`), which is the only route to a declaration that
   * lives on the lambda literal rather than in an installed scope.
   *
   * Managed exactly like `_localComplex`/`_localVector`: pushed before the
   * statements are compiled, popped in the same `finally`.
   */
  static _enforcedTargets: ReadonlySet<string>[] = [];
  /**
   * The target-language lvalue an `Assign` writes for the variable `name` —
   * the SAME spelling a READ of that name compiles to.
   *
   * The two halves of a variable must agree. A bound name (a block local, a
   * parameter, a loop index, a desugar temporary) is resolved to its own bare
   * identifier by the enclosing binding form's `var` override, and a target
   * that resolves nothing (the shader targets, which declare a free symbol as
   * a bare identifier) also keeps the bare write — both unchanged. But a
   * target that spells a FREE symbol as something else — JavaScript's
   * vars-object lookup `_.<name>` — used to get a bare `name = …` write while
   * every read compiled to `_.<name>`: in sloppy mode the write created a
   * stray global and the read saw `undefined`. `{ s ⩴ 0; for k ∈ 1..3 { s ⩴ s
   * + … }; s }` therefore ran to `undefined` behind `success: true` whenever
   * the name was NOT hoisted to a block-local — which is exactly what happens
   * for a name the enclosing scope chain already binds (the library scope
   * pre-declares `e`, `i`, `m` and `s`), where the interpreter writes the
   * outer binding and reads it back.
   *
   * A resolution that is not an assignable REFERENCE — a baked constant
   * (`Pi` → `Math.PI`), a folded assigned value, a non-string `vars` mapping —
   * has nowhere to write: fail closed rather than emit a write the reads
   * cannot see.
   */
  /** The depth of the `withFreshBlockLocals` calls that are running. */
  static _freshBlockLocals = 0;
  /**
   * Lexical frames of `Block` locals, innermost last, each mapping a local's
   * name to its inferred complex-ness. Pushed/popped by `compileBlock` around
   * the compilation of its statements (compilation is synchronous, so a
   * static stack is safe), and consulted by `isComplexValued` so that every
   * target's operand analysis agrees with the emitted local bindings.
   */
  static _localComplex: Map<string, boolean>[] = [];
  /**
   * Frames of names bound by a binder form currently being ANALYZED (as
   * opposed to compiled) by `isComplexValued` — see `binderParts`. Innermost
   * last.
   *
   * Like `_boundVarsCtx`, a shielded name is not a free engine symbol, so the
   * engine-value fallback must not read through it. Unlike `_localComplex`, a
   * shield leaves the name's declared type in play: a lambda parameter can
   * legitimately be complex (a parameter declared `complex` receives a
   * `{re, im}` value at every call; Tycho item 60), so it is shielded but
   * not forced real.
   */
  static _binderShield: Set<string>[] = [];
  /**
   * The integer value each index of the unrolled `Sum`/`Product` terms
   * currently being emitted holds, or a runtime loop's known lower bound,
   * innermost frame last, together with a per-frame memo of `unrolledIndexValueFold` (`null` records "does not
   * fold", which a `WeakMap` miss cannot express).
   *
   * An unrolled term substitutes its index at the emitted-CODE level — the
   * compile target maps the index NAME to a literal — so the expression the
   * shape analysis reads still carries the free index symbol. Without the
   * value a radicand such as `1 − 0.025²·(i − 0.5)²` has an unknown sign and
   * the radical promotes to the complex lane in every term; with it, the
   * radicand is a closed constant that folds to a positive number and the
   * real kernel stands.
   *
   * The memo hangs off the INNERMOST frame because that frame is pushed after
   * every enclosing one and popped before them: while it is live the whole
   * stack — and therefore the substitution the answers were computed under —
   * is fixed.
   *
   * A frame is keyed by index NAME, so an inner binder that binds the same
   * name — a `Map` lambda whose parameter is also called `i`, a nested `Sum`
   * over `i` — must not read the enclosing term's value: inside it the name
   * stands for the inner binder's own variable. Every scope crossing goes
   * through `_enterUnrolledIndexBinder`, which pushes a MASKING frame for such
   * a name and hides it from the fold below for the length of that scope.
   */
  static _unrolledIndexValues: UnrolledIndexFrame[] = [];
  /**
   * Memoized `isComplexValued` answers for FUNCTION expressions (Tycho item
   * 148). Keyed by expression IDENTITY, valid only for the context the
   * analysis reads: the `_localComplex` frames, the `_binderShield` frames,
   * `_boundVarsCtx`, and the engine's assigned symbol values.
   *
   * The memo is LAYERED to mirror the context's lexical nesting: entering a
   * frame or binder mask pushes a fresh layer, leaving it pops back to the
   * enclosing layer — which is valid again, because the enclosing context is
   * restored exactly (the enter/exit sites are all symmetric try/finally
   * pairs). Only the top layer is ever read or written, so an answer computed
   * under a mask can never leak outside it; and because a binder NODE's own
   * verdict is stored in its enclosing layer, sibling and repeat queries of
   * the binder hit the memo instead of re-entering the mask — without this,
   * nested `Sum`/`Product` chains would be scanned quadratically.
   * `isComplexValued` only consults the memo while a compilation is
   * running (`_compileDepth > 0`), where engine values are stable.
   */
  static _complexMemoStack: WeakMap<object, boolean>[] = [new WeakMap()];
  /**
   * Nesting depth of `compile()`. Zero outside any compilation — where the
   * complexness memo is neither read nor written, because engine symbol
   * values may change between compilations.
   */
  static _compileDepth = 0;
  /**
   * True while `compileCseRoot()` emits a root that it checks itself for
   * the admission rules of the compilation (every value has a settled
   * shape, every input has a type: `unsettledShapeIn()` and
   * `assertAdmitted()`, `compile-admission.ts`). A call of `compile()` at
   * depth 0 inside that emission (the body of a `Function` literal root)
   * does not run these checks again.
   */
  static _rootAdmission = false;
  /**
   * For tests only: a function that `compile()` calls with each node whose
   * code it writes, and the target that it writes it for, before it writes
   * the code. A node whose code is fixed by an override (a code override or
   * an alias) is not passed. A test of the GLSL target sets it to check
   * that every node written in the body of a user function has facts in
   * the annotation of the typing pass (`FragmentTargetFields.fragmentScope`,
   * `fragmentNodeIsTyped()` in `fragment.ts`). It is `undefined` outside a
   * test, and the compiler then does nothing for it.
   */
  static _emitProbe:
    | ((expr: Expression, target: CompileTarget<Expression>) => void)
    | undefined = undefined;
  /**
   * The admission checks of the outermost compilation in progress: its
   * root, its target, and the value with no settled shape that
   * `unsettledShapeIn()` found before the code was generated. `compile()`
   * and `compileCseRoot()` set it, and `assertAdmitted()` declines for it
   * after the code was generated. A lowering that would generate code for
   * a form that then declines (a block whose value is the `Nothing` of an
   * assignment) declines for it at once
   * (`throwPendingUnsettledShape()`, `compile-admission.ts`).
   */
  static _pendingAdmission:
    | {
        root: Expression;
        target: CompileTarget<Expression>;
        unsettled: UnsettledShape | undefined;
      }
    | undefined = undefined;
  /**
   * The nodes of the outermost compilation in progress whose operator has
   * a caller-supplied `compile` handler (a handler on the definition that
   * is not one of the engine's own), mapped to `true` when that handler
   * wrote the code of every lowering of the node, and to `false` when it
   * returned no code for one of them, so that the stock lowering wrote
   * that code. `compileExpr()` fills it. The admission rule that a
   * conditional has branches of one shape (`unsettledShapeIn()`,
   * `compile-admission.ts`) is a rule of the stock lowering, so it does
   * not apply to a node mapped to `true`. It is reset where the admission
   * checks of an outermost compilation start (`compile()`,
   * `compileCseRoot()`).
   */
  static _callerLowered = new Map<Expression, boolean>();
  /**
   * Lexical frames of `Block` locals, innermost last, each mapping a local's
   * name to its inferred aggregate width. The vector analog of
   * `_localComplex`: pushed and popped by `compileBlock`, consulted by
   * `aggregateComponentCount` so a local that merely ALIASES a vector-valued
   * local (`q ⩴ p`) is recognized as vector-valued too. Innermost frame
   * containing the name decides, so a shadowing inner local is not poisoned by
   * an outer vector one.
   *
   * A NON-NEGATIVE entry is an observed component count. The "not an
   * aggregate" cases use negative sentinels rather than `0`, because `0` is a
   * genuine — and invalid — observed width (an empty `Tuple`/`List`); reading
   * it back as "scalar" left the local declared `float` while its assignment
   * compiled to `float[0]()`.
   */
  static _localVector: Map<string, number>[] = [];
  /** Remaining wall-clock guard of the current compilation — see
   *  {@link ANTIDERIVATIVE_COMPILATION_HANG_MS}. */
  static antiderivativeHangMsLeft = ANTIDERIVATIVE_COMPILATION_HANG_MS;
  /** The per-attempt budget in force: the constant above, unless a test
   *  shortened it with {@link setAntiderivativeAttemptBudgetForTesting}. */
  static antiderivativeAttemptSteps = ANTIDERIVATIVE_ATTEMPT_STEPS;
  /** Remaining shared antiderivative budget for the current compilation —
   *  see {@link ANTIDERIVATIVE_COMPILATION_STEPS}. Module state is safe:
   *  compilation is synchronous and single-threaded. */
  static antiderivativeStepsLeft = ANTIDERIVATIVE_COMPILATION_STEPS;
  static nextDefinitionId = 1;
  /** How many antiderivative-first attempts have RUN, as opposed to being
   *  skipped. Read by tests, before and after a compilation. */
  static antiderivativeAttemptCount = 0;
}
