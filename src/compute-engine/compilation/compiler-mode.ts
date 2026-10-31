// The compile mode (strict, promoting), promotion records, real-only
// lowerings, and the memos keyed by definition.

import type { Expression, FunctionInterface } from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import type { CompileMode, CompileTarget, CompiledFunction } from './types.js';
import type { UserFunctionRegistry } from './compiler-types.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';
import {
  _popComplexMemoLayer,
  complexDiscipline,
} from './compile-declarations.js';
import {
  COMPLEX_TRANSPARENT_HEADS,
  REAL_ONLY_BY_DEFINITION,
} from './compiler-tables.js';

/**
 * Per-compilation memos of the analysis that decides whether a user function
 * gets a definition with typed parameters (`BaseCompiler.
 * rangeSpecializedParameterTypes`, `BaseCompiler.declaredParameterLiteral`,
 * `BaseCompiler.unprovenRadicalCount`). They are keyed by the registry of
 * the compilation, so they end with it.
 */
export const radicalCountMemos = new WeakMap<
  UserFunctionRegistry,
  Map<string, number>
>();
export const rangeVerdictMemos = new WeakMap<
  UserFunctionRegistry,
  Map<string, (Type | undefined)[] | undefined>
>();
export const rangeVariantMemos = new WeakMap<
  UserFunctionRegistry,
  Map<string, (Type | undefined)[][]>
>();
export const declaredLiteralMemos = new WeakMap<
  UserFunctionRegistry,
  Map<
    string,
    {
      source: Expression & FunctionInterface;
      emitted: Expression & FunctionInterface;
    }
  >
>();

/**
 * The user-function definitions of a compilation whose body recorded a
 * promotion (a radical or logarithm lowered through a complex kernel) while
 * it compiled, by emitted name. See `BaseCompiler.hasPromotedDefinition`.
 */
export const promotedDefinitions = new WeakMap<
  UserFunctionRegistry,
  Map<string, boolean>
>();

/**
 * The latch above, for the target-side code that must ask the same question
 * this class asks: is a constant fold available in the compilation now
 * running, and against which target? `undefined` outside one, and for every
 * compilation that does not fold.
 */
export function oracleFoldTarget(): CompileTarget<Expression> | undefined {
  return CompilerState._oracleFoldTarget;
}

/**
 * Fold-before-shape (Tycho item 229): downgrade a `true` complexness
 * verdict to `false` when the node is a closed pure scalar whose memoized
 * constant fold is a real number. `√(5−√5)` — an exact value of
 * `cos`/`sin`(π·rational) — types the `complex` hedge and would
 * promote through `_SYS.csqrt`, yet its value is the plain real 1.6625…;
 * with the override, `tryConstantFold` inlines that literal (its
 * complex-shape gate reads this same oracle) and every analysis reports
 * the plain number the emission produces. A node whose fold declines
 * (free variables, impure, over budget, `'declined'`-memoized) keeps the
 * shape-first verdict, and so does every node when the latch is unset
 * (non-JavaScript targets, `constantFold: false`, `symbolDeps` capture,
 * outside a compilation). The fold outcome is memoized per
 * (target, expression), so the verdict cannot drift between analysis and
 * emission within one compilation.
 */
export function _withFoldedRealOverride(
  expr: Expression,
  verdict: boolean
): boolean {
  if (!verdict) return verdict;
  const target = CompilerState._oracleFoldTarget;
  if (target === undefined) return verdict;
  // An indexed READ is excluded: its complex verdict describes the
  // element convention of the emitted array, and `_SYS.at`'s run-time
  // handling of an exotic index (a complex index selects by its own
  // contract) is deliberately left to the runtime — the fold gate's
  // "may return either shape" class. Folding the read would replace that
  // contract with the interpreter's answer; the pinned behavior is the
  // structural emission (see `compile-complex-element-access.test.ts`,
  // "a COMPLEX index is left to its own handling").
  if (isFunction(expr, 'At')) return verdict;
  const v = core.constantFoldValue(expr, target)?.value;
  if (v !== undefined && isNumber(v) && !v.isComplex) return false;
  // Inside an unrolled `Sum`/`Product` term the index still appears as a
  // free symbol in the expression — the term binds it at the emitted-CODE
  // level — so the fold above declines for every subtree that mentions it.
  // Substituting the term's own index values settles those subtrees the
  // same way, and the emitters read the same values through
  // `assumedRealNonNegative`, so analysis and emission stay in step.
  const underIndices = unrolledIndexValueFold(expr);
  if (
    underIndices !== undefined &&
    isNumber(underIndices) &&
    !underIndices.isComplex
  )
    return false;
  return verdict;
}

export function mode(): CompileMode {
  return CompilerState._mode;
}

/**
 * Whether the compilation in progress runs under the STRICT discipline's
 * binding-boundary rule: a complex-shaped value reaching a binding the
 * compilation shaped real is a `LaneMismatch` decline (design §3,
 * `docs/COMPILATION-MODEL.md`), never a specialization
 * or a silent real-lane emission.
 *
 * In force for `mode: 'strict'` and for `mode: 'auto'`, whose FIRST attempt
 * is the strict discipline (with promotion): the `LaneMismatch` it raises
 * is what the escalation catches to redo the compilation under `'complex'`
 * (design §4, `compileWithAutoEscalation` in `auto-escalation.ts`, which a
 * registered target applies inside its own `compile()`). Under `'complex'`
 * a wide binding is complex-shaped and nothing mismatches.
 */
export function strictLanes(): boolean {
  return CompilerState._mode === 'strict' || CompilerState._mode === 'auto';
}

/**
 * Run `fn` with promotion off: an unknown-sign `Sqrt`/`Ln`/`Log`, an even
 * `Root` and a non-integer `Power` stay on the real lane, and give NaN
 * outside their real domain, as in `mode: 'strict'`.
 *
 * The `Typed` lowering uses this for the value of a real ascription. The
 * answers of `isComplexValued` computed inside `fn` go into a new memo
 * layer, which is removed when `fn` returns, so they are never read with
 * promotion on, and the answers computed with promotion on are not read
 * inside `fn`.
 */
export function withPromotionSuppressed<T>(fn: () => T): T {
  CompilerState._promotionSuppressed += 1;
  _pushComplexMemoLayer();
  try {
    return fn();
  } finally {
    CompilerState._promotionSuppressed -= 1;
    _popComplexMemoLayer();
  }
}

/**
 * Run `fn` with the promotion of the compile mode, also when it is called
 * inside `withPromotionSuppressed`. For the compilation (or the analysis)
 * of a module-level definition: the definition is emitted once and called
 * from every call site, so its lane must not depend on the call site that
 * caused the emission. A call of such a definition inside a suppressed
 * value then reads the lane that the definition records
 * (`recordUserFunctionLane`): when that lane is complex, the value is
 * complex and the real ascription declines.
 */
export function withPromotionUnsuppressed<T>(fn: () => T): T {
  const saved = liftPromotionSuppression();
  try {
    return fn();
  } finally {
    restorePromotionSuppression(saved);
  }
}

/**
 * The first half of `withPromotionUnsuppressed`, for a caller whose
 * `try`/`finally` already encloses the compilation: set the count of
 * `withPromotionSuppressed` calls to zero and return the count it had.
 * The caller must give that count to `restorePromotionSuppression` in its
 * `finally` block.
 */
export function liftPromotionSuppression(): number {
  const saved = CompilerState._promotionSuppressed;
  if (saved === 0) return 0;
  CompilerState._promotionSuppressed = 0;
  _pushComplexMemoLayer();
  return saved;
}

/** The second half of `withPromotionUnsuppressed`: see
 * `liftPromotionSuppression`. */
export function restorePromotionSuppression(saved: number): void {
  if (saved === 0) return;
  CompilerState._promotionSuppressed = saved;
  _popComplexMemoLayer();
}

/**
 * Whether the D2/D6 RUNTIME rule is in force (`realOperandGuard`): a
 * maybe-complex operand of a real-only head is guarded at run time rather
 * than declined at compile time — the `auto` and `complex` disciplines. In
 * strict mode nothing changes: such an operand fails closed as before.
 */
export function runtimeRealGuards(): boolean {
  return CompilerState._mode === 'auto' || CompilerState._mode === 'complex';
}

/**
 * Whether the compilation in progress lowers head `h` with a real-only
 * lowering — the predicate the emission gates read
 * (`isRealOnlyLowering`), so the analysis and the emission agree on the
 * value SHAPE. Outside any compilation, and for an interval target, only
 * the heads that are real-only on every target by definition
 * (`REAL_ONLY_BY_DEFINITION`) answer `true`.
 */
export function isRealOnlyLoweringHead(h: string): boolean {
  const lookup = CompilerState._realOnlyLowering;
  if (lookup === undefined) return REAL_ONLY_BY_DEFINITION.has(h);
  return lookup(h);
}

/**
 * Whether `target` lowers the head `h` with a REAL-ONLY lowering: one
 * that computes with real numbers only, so a complex operand has no value
 * there. Each target declares its own real-only lowerings
 * (`CompileTarget.isRealOnlyLowering`): the same head can be real-only on
 * one target and have a complex lowering on another (`Erf` is real-only on
 * JavaScript and takes a complex argument on Python). A target that
 * declares nothing gets the default: the heads in
 * `REAL_ONLY_BY_DEFINITION`, and every head it maps to a plain helper name
 * (`stringHelperIsRealOnly`). An interval target, and a target with no
 * `language`, has no real-only lowering: it keeps no complex values.
 *
 * Read by every real-only gate of `compileExpr` (the function-codegen
 * branch, the helper-name branch and the JavaScript broadcast attempt) and,
 * through `_realOnlyLowering`, by `isComplexValued`.
 */
export function isRealOnlyLowering(
  target: CompileTarget<Expression>,
  h: string
): boolean {
  const language = target.language;
  if (language === undefined || language.startsWith('interval')) return false;
  const lowering = target.functions?.(h);
  if (target.isRealOnlyLowering !== undefined)
    return target.isRealOnlyLowering(h, lowering);
  return REAL_ONLY_BY_DEFINITION.has(h) || stringHelperIsRealOnly(h, lowering);
}

/**
 * Whether a head mapped to the plain helper name `lowering`
 * (`Erf: '_SYS.erf'`) is real-only by that mapping. A helper named by a
 * string takes its operands as they are, and the helpers of the
 * JavaScript and shader targets take real numbers only: handing one a
 * complex value returns a wrong value, not NaN (`_SYS.erf` of a complex
 * `z` answered −1). The heads that consume a complex value by definition
 * (`Real`, `Imaginary`, `Argument`, `Conjugate`) are excluded: some
 * targets map them to a complex-aware routine (Python `np.real`).
 */
export function stringHelperIsRealOnly(
  h: string,
  lowering: CompiledFunction<Expression> | undefined
): boolean {
  return typeof lowering === 'string' && !COMPLEX_TRANSPARENT_HEADS.has(h);
}

/** Record that a promotable head was lowered through a complex kernel. */
export function notePromoted(): void {
  CompilerState._promoted = true;
}

/**
 * Record, for the `promoted` report, that `head` (a promotable head) is
 * being lowered through a complex kernel because its operand is already
 * complex-valued — a promotion when that operand is complex only by
 * wideness (the complex discipline lifted it), a no-op otherwise. The
 * emitters call this on their "operand is complex" branch, whose lowering
 * is the same kernel either way; the decision is
 * `promotesRadicalToComplex`, which does the recording.
 */
export function recordPromotion(
  head: MathJsonSymbol,
  args: ReadonlyArray<Expression>
): void {
  void core.promotesRadicalToComplex(head, args);
}

/** True when a definition in `registry.defs` recorded a promotion while
 * its body compiled. */
export function hasPromotedDefinition(
  registry: UserFunctionRegistry | undefined
): boolean {
  if (registry === undefined) return false;
  const promotedDefs = promotedDefinitions.get(registry);
  if (promotedDefs === undefined) return false;
  for (const name of promotedDefs.keys())
    if (registry.defs.has(name)) return true;
  return false;
}

/**
 * The complex discipline's answer for a numeric binding of static type `t`
 * that the strict analysis shapes REAL by default: complex when the type
 * is WIDE — it admits a complex value (`unknown`, `any`, `number`, a
 * union containing them) — real when it is a real-only type or not a
 * number type at all. `false` outside complex mode, which is
 * the strict default this replaces.
 */
export function wideIsComplex(t: Type | undefined): boolean {
  if (!complexDiscipline()) return false;
  return wideNumericType(t);
}

/**
 * Is `t` a WIDE numeric type — one that admits a complex value without
 * being a real-only type: `unknown`, `any`, `number`, a non-real number
 * type, a union containing one? (Mode-independent; the
 * complex discipline's binding rule is `wideIsComplex`.)
 */
export function wideNumericType(t: Type | undefined): boolean {
  if (t === undefined) return false;
  if (isNonRealNumber(t)) return true;
  if (isSubtype(t, 'real')) return false;
  // Admits a complex value: `complex` (hence any complex number) is a
  // subtype of the binding's type, or the type is a top type.
  return isSubtype('complex', t);
}

/**
 * Nodes whose emission is currently OVERRIDDEN by a temporary's real
 * projection — the D2/D6 runtime rule (`realOperandGuard`). Consulted at
 * the top of `compile()`; keyed by node identity, scoped to the emission of
 * the guarded head.
 */
export const _codeOverrides = new Map<Expression, string>();

/**
 * Nodes whose value is already bound to a temporary, keyed by node
 * identity: `compile()` emits the temporary's name for such a node. Unlike
 * `_codeOverrides`, an alias is the value itself, not a real projection of
 * it, so the analyses (the element lane, `isComplexValued`) still read the
 * node as they would without the alias. Installed by
 * `compileRuntimeMatrixPower` while it emits the element-wise power.
 */
export const _codeAliases = new Map<Expression, string>();

/**
 * The reads of the vars object (`_.x`) that the code being emitted has
 * already tested for `undefined`, for each target object: the code is
 * inside the branch of such a test (the condition of an `If` that tests
 * `_.x !== undefined`, or the guard of `unsuppliedComparisonGuard`
 * itself). A comparison over such a read needs no test of its own. Keyed
 * by the target object, so that a definition compiled with another
 * target (a user function, a nested scope) does not see the marks: such
 * code can run where the test did not happen. A derived target that does
 * not see a mark emits one more test, which costs a comparison but is
 * never wrong. Each entry counts its nested marks.
 */
export const _presentReads = new WeakMap<object, Map<string, number>>();

/** Run `fn` with the vars-object reads `reads` marked as tested for
 * `undefined` on `target` (see `_presentReads`). */
export function withPresentReads<T>(
  target: CompileTarget<Expression>,
  reads: ReadonlyArray<string>,
  fn: () => T
): T {
  if (reads.length === 0) return fn();
  let marks = _presentReads.get(target);
  if (marks === undefined) {
    marks = new Map();
    _presentReads.set(target, marks);
  }
  for (const r of reads) marks.set(r, (marks.get(r) ?? 0) + 1);
  try {
    return fn();
  } finally {
    for (const r of reads) {
      const n = marks.get(r)! - 1;
      if (n === 0) marks.delete(r);
      else marks.set(r, n);
    }
  }
}

/** True when the vars-object read `code` is marked as tested for
 * `undefined` on `target` (see `_presentReads`). */
export function isPresentRead(
  code: string,
  target: CompileTarget<Expression>
): boolean {
  return _presentReads.get(target)?.has(code) === true;
}

/** The `Power` nodes whose base `compileRuntimeMatrixPower` is emitting,
 * so that its element-wise branch does not dispatch a second time. */
export const _runtimeMatrixPowerBases = new Set<Expression>();

/**
 * The calls of a user function that a repetition site has rewritten to
 * call the function's INVARIANT-PREFIX VARIANT, keyed by the call node
 * (`hoistLoopInvariants` installs an entry, `tryCompileUserFunction` reads
 * it). `prefixes` are the indices into the callee's prefix list
 * (`invariantPrefixes`) that this site hoists; `values` are the prefix
 * expressions with the call's arguments substituted for the callee's
 * parameters, one per index, in the same order. The site binds each value
 * once before the repetitions and gives its node a code override, so the
 * call site compiles each value to the binding's name and passes it as an
 * extra argument.
 */
export const _prefixCallOverrides = new Map<
  Expression,
  { prefixes: ReadonlyArray<number>; values: ReadonlyArray<Expression> }
>();

/** The heads whose real kernel can silently swallow a complex result. */
export const PROMOTABLE_RADICAL_HEADS = new Set(['Sqrt', 'Ln', 'Log']);

/**
 * The constant VALUE of `expr` once the index values of the unrolled
 * `Sum`/`Product` terms in progress are substituted into it, or `undefined`
 * when those values do not settle it.
 *
 * Answers `undefined` unless a term is being emitted, the compilation folds
 * constants (`_oracleFoldTarget` — the same latch `_withFoldedRealOverride`
 * reads, so a `constantFold: false` or `symbolDeps` compilation is
 * unaffected), and the substituted expression folds. So `undefined` means
 * "not decided here", never "not constant": the caller's own conservative
 * rules stand.
 *
 * An expression that does not MENTION one of the bound indices is left
 * undecided as well, even though substituting into it would be harmless.
 * Such a subtree is loop-invariant, so `hoistLoopInvariants` may compile it
 * once OUTSIDE any term's frame and let every term emit the resulting
 * temporary; deciding it differently inside a term would make the emitted
 * binding and the term that reads it disagree about its value shape. An
 * index-free constant is already answered by `_withFoldedRealOverride`
 * itself, which needs no substitution.
 */
export function unrolledIndexValueFold(
  expr: Expression
): Expression | undefined {
  const frames = CompilerState._unrolledIndexValues;
  if (frames.length === 0) return undefined;
  const target = CompilerState._oracleFoldTarget;
  if (target === undefined) return undefined;
  const innermost = frames[frames.length - 1];
  const hit = innermost.memo.get(expr);
  if (hit !== undefined) return hit ?? undefined;
  const values: Record<string, number> = {};
  // Outermost frame first, so an inner frame's value — and an inner
  // binder's MASK, which drops the name outright — overrides an enclosing
  // term's value for the same name.
  for (const frame of frames) {
    for (const name of frame.masked) delete values[name];
    for (const name of frame.lowerBounds?.keys() ?? []) delete values[name];
    for (const [name, value] of frame.values) values[name] = value;
  }
  const names = new Set(Object.keys(values));
  let result: Expression | undefined;
  // `.subs()` replaces only the free occurrences of a name, but it is not
  // capture-avoiding: a value that reads a name an inner binder binds
  // would be captured by that binder, and the binder's index is not
  // renamed. A node that re-binds one of the index names is left
  // undecided.
  if (mentionsAnyName(expr, names) && !rebindsAnyName(expr, names)) {
    try {
      result = core.constantFoldValue(expr.subs(values), target)?.value;
    } catch (e) {
      // A caller's cancellation propagates; any other error leaves the
      // term undecided.
      throwIfCallerCancellation(e, expr.engine._deadlineFrame);
      result = undefined;
    }
  }
  innermost.memo.set(expr, result ?? null);
  return result;
}

/** Does a symbol of `expr` spell one of `names`? */
export function mentionsAnyName(
  expr: Expression,
  names: ReadonlySet<string>
): boolean {
  if (isSymbol(expr)) return names.has(expr.symbol);
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => mentionsAnyName(op, names));
}

/** Does `expr`, or any node inside it, bind one of `names`? */
export function rebindsAnyName(
  expr: Expression,
  names: ReadonlySet<string>
): boolean {
  for (const name of boundVariableNames(expr)) if (names.has(name)) return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => rebindsAnyName(op, names));
}

/** Enter a lexical context: answers cached inside must not escape it. */
export function _pushComplexMemoLayer(): void {
  CompilerState._complexMemoStack.push(new WeakMap());
  CompilerState._elementLaneMemoStack.push(new WeakMap());
}
