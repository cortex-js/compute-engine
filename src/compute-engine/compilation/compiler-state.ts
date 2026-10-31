// The compiler state that one module assigns and other modules read: the
// compile mode, promotion flags, memos, budgets, and the frames of the current
// compilation. An imported `let` cannot be assigned, so these values are static
// fields of a class.

import type { ReferencesMemo } from '../boxed-expression/abstract-boxed-expression.js';
import type { Expression } from '../global-types.js';
import type { KindLowering } from './kind-lowering.js';
import type { CompileMode, CompileTarget } from './types.js';
import type {
  CheckedLocalsFrame,
  ElementLane,
  UnrolledIndexFrame,
  UnsafeIntegerOperand,
  UserFunctionRegistry,
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
 * `compileCseRoot` (registered targets invoked directly), the public
 * `compile()` entry, and each attempt of an auto-mode escalation. Nested
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
 * The compiler state that more than one module assigns. A static field on
 * a class can be assigned from any module that imports the class, which an
 * imported `let` binding cannot.
 */
export class CompilerState {
  /**
   * How the compiled lanes read a symbol declared `any` or `value`, and an
   * application over such a symbol that the compiled lanes read as a scalar
   * (`isDeclaredTopOperand`). `undefined` is the default: an arithmetic site of
   * the JavaScript target over such an operand emits a run-time check of the
   * value (`declaredTopGuard` in `BaseCompiler`). The check compiles the site
   * twice: once with `'scalar'` (the operand is a number, and the code is the
   * code compiled before the check existed) and once with `'list'` (the operand
   * may be a list, and the code broadcasts). Inside either compilation, no
   * other check is emitted.
   */
  static declaredTopMode: 'scalar' | 'list' | undefined = undefined;
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
   * `strictLanes` (strict, auto), `complexDiscipline` (complex) and
   * `promotionActive`/`runtimeRealGuards` (auto, complex); see
   * `docs/COMPILATION-MODEL.md` for the disciplines.
   */
  static _mode: CompileMode = 'strict';
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
   * Set when this compilation lowered a promotable head through a complex
   * kernel — the `promoted` field of the result (design §4): the signal that
   * the compiled unit would NOT compute the same value on a shader target's
   * real kernel, escalation or not. Reset at the outermost compilation entry,
   * frozen into `_lastReport` at its exit. A compile-time fact decided from
   * the source (operand sign provability, operand type), never from a
   * runtime value — so the same source always reports the same flag.
   */
  static _promoted = false;
  /**
   * The OUTERMOST compilation's real-only predicate
   * (`isRealOnlyLowering(target, h)`), latched by `compile()` at depth 0
   * (only for a target with a `language` other than the interval family) and
   * restored on the way out. `undefined` outside any compilation.
   *
   * It exists so that `isComplexValued` can answer for a head the target
   * lowers with a real-only lowering (`Erf: '_SYS.erf'`, `Floor`, …). Such a
   * head never yields a complex value: a maybe-complex operand takes the
   * D2/D6 runtime rule (`realOperandGuard` — the lowering runs on the real
   * part when the imaginary part is exactly zero, `NaN` otherwise) and a
   * definitely non-real one is a compile-time decline. Yet several of these
   * heads have a WIDE result type (`Erf`, `Gamma`, `Zeta`, `Digamma`,
   * `Factorial`, `LambertW`, `Arsinh`, `ErfInv` all type `number`), so the
   * type-based analysis fell through to the operand recursion and reported
   * them complex whenever an operand was — a promoted unknown-sign radical,
   * say. The enclosing arithmetic then read `.re`/`.im` off a plain number.
   * Measured before this latch, in the default `auto` mode: `2·Erf(√y)`
   * compiled to `{re: 2 * _b.re, …}` around a bare `_SYS.erf(…)` and ran to
   * `{re: NaN}` at every point, and `Limit` at +∞ — whose growth oracles
   * probe through the compiler — declined `k·Erf(√y) + anything` for every
   * `k ≠ 1` (test `limit.test.ts` › "sum mixing a scaled Erf(∞) addend with a
   * decaying addend").
   */
  static _realOnlyLowering: ((h: string) => boolean) | undefined = undefined;
  /**
   * The report of the most recently COMPLETED outermost compilation, read by
   * `modeReport` when a target attaches `mode`/`promoted` to its result. A
   * compilation that DECLINES leaves the neutral value written at its entry
   * instead — it emitted no code for a report to describe.
   */
  static _lastReport: {
    mode: 'strict' | 'complex';
    promoted: boolean;
  } = { mode: 'strict', promoted: false };
  /**
   * What `_lastReport` was computed from, so that the report can be
   * computed again when unreferenced user-function definitions are removed
   * from the emitted code (`pruneUnreferencedVariantBases`): the registry of
   * the definitions, whether the discipline was `complex`, and whether a
   * promotion was recorded outside the body of every definition.
   */
  static _lastReportBasis:
    | {
        registry: UserFunctionRegistry | undefined;
        complexDiscipline: boolean;
        promotedOutsideDefinitions: boolean;
      }
    | undefined;
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
   * The frames of `checkedLocalReads`, innermost last, while the statements
   * of their blocks are compiled.
   */
  static _checkedLocals: CheckedLocalsFrame[] = [];
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
   * nested `Sum`/`Product` chains stayed O(d²) (review finding on the item-148
   * fix). `isComplexValued` only consults the memo while a compilation is
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
  /**
   * The relations that a branch condition reads by value and that read a
   * local of a block being compiled (`conditionNode`), and the links of
   * such a chain.
   */
  static _poisonConditions = new WeakSet<Expression>();
  /** While true, `operandInputNodes` gives a block local only its own read,
   * not the caller inputs of its block (`poisonSlot`). */
  static _directInputsOnly = false;
  /** True when a comparison of the compilation emitted the throw of
   * `_SYS.noValue` (`poisonSlot`). Set by the compilation, read and cleared
   * by `catchNoValue`. */
  static _noValueUsed = false;
}
