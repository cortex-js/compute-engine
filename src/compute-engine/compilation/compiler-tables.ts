// The constant tables of the compiler: the sets of operator heads that each
// rule applies to, fold limits, and the other read-only data.

import type { CompiledColorSpace } from './types.js';
import type { UserFunctionRegistry } from './compiler-types.js';

/** The empty name set, shared so an unremarkable case allocates nothing. */
export const NO_NAMES: ReadonlySet<string> = new Set<string>();

/**
 * The color space each of the interpreter's five typed color heads names.
 *
 * The heads are the ones `library/colors.ts` builds after `.evaluate()`, and
 * their operand order is the channel order of the space they name — sRGB
 * `r, g, b` in 0-1 for `Rgb`, `h, s, v` for `Hsv`, and so on — which is
 * exactly the `c0, c1, c2` layout of a compiled color value.
 */
export const INTERPRETED_COLOR_SPACES: Readonly<
  Record<string, CompiledColorSpace>
> = {
  Rgb: 'rgb',
  Hsv: 'hsv',
  Hsl: 'hsl',
  Oklab: 'oklab',
  Oklch: 'oklch',
};

/**
 * The interpreter's typed color head for each color space a compiled color
 * value can carry — the inverse of {@link INTERPRETED_COLOR_SPACES}.
 *
 * It is what lets the interpreter fallback CONSUME a color: a color a
 * compiled runner produced, handed back in as a `vars` value, boxes to the
 * head that names its space with its channels as operands.
 */
export const COLOR_SPACE_HEADS: Readonly<Record<CompiledColorSpace, string>> = {
  rgb: 'Rgb',
  hsv: 'Hsv',
  hsl: 'Hsl',
  oklab: 'Oklab',
  oklch: 'Oklch',
};

/** The memo of `registry` in `memos`, created when it does not exist. */
export function memoFor<V>(
  memos: WeakMap<UserFunctionRegistry, Map<string, V>>,
  registry: UserFunctionRegistry
): Map<string, V> {
  let memo = memos.get(registry);
  if (memo === undefined) {
    memo = new Map();
    memos.set(registry, memo);
  }
  return memo;
}

/**
 * The operators whose compiled code evaluates each operand exactly once, on
 * every target (`classifyLocalReads`): an assignment that an operand makes is
 * then certain after the operator. An operator that is not in the list, or
 * that has a lazy operand (`lazyOperandRegions`, a chained relation), is
 * taken to evaluate an operand maybe not at all.
 *
 * A lowering that skips an operand keeps an operator out of the list:
 * `Power(b, 0)` compiles to `1` and `Multiply` with a `0` operand compiles to
 * `0` on JavaScript and the shader targets, with no evaluation of the other
 * operands. The lowerings of these operators skip only number literals
 * (`tryGetConstant`), which assign nothing.
 */
export const STRICT_OPERATORS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Negate',
  'List',
  'Tuple',
]);
/**
 * Precedence used when compiling a folded symbol value. Higher than any
 * target's infix operator precedence, so a compound value parenthesizes
 * itself when spliced into a surrounding expression. See
 * `tryFoldKnownSymbol`.
 */
export const FOLD_OPERAND_PREC = 1000;

/**
 * Largest EXPANDED node count a symbol's assigned value may have before
 * `tryFoldKnownSymbol` refuses to bake it into the generated source.
 *
 * The generated source is text, so a folded value that mentions the same
 * sub-value from several places is written out once per PATH, not once per
 * distinct node. A value that is a small shared graph can therefore emit an
 * enormous program: the `f(n+1) = f(n) + 2 f(n)` tower grows by three
 * distinct nodes per level while its emission quadruples. That is why the
 * measure here is the expanded (per-path) node count computed by
 * `expandedFoldSize`, and not the number of distinct nodes — no
 * distinct-node cap can separate the two classes.
 *
 * Calibrated from both sides on the JavaScript target, by instrumenting
 * this guard and reading the size of every fold performed:
 * - Legitimate side: across sixteen compile test suites (1149 tests,
 *   including `compile.test.ts`, `compile-assigned-symbol.test.ts`,
 *   `compile-subtree-folding.test.ts` and `compile-cse.test.ts`) the largest
 *   fold performed was 4 expanded nodes. A deliberately oversized ordinary
 *   value — a symbol assigned a 60-term polynomial — expands to 297 nodes
 *   and emits 1.5 KB, so the limit sits 5000x above what the corpus does
 *   and about 67x above a value already far larger than anything measured.
 * - Pathological side: the tower above expands to 4·2^n − 3 nodes and emits
 *   about three characters per expanded node. Depth 12 (16 381 nodes, 49 KB
 *   of source, ~8 s) is the deepest level still folded; depth 13 (32 765) is
 *   refused, and depth 14 (65 533 nodes, 197 KB, ~17 s) is already past the
 *   point where the compile visibly stalls, quadrupling with every level
 *   after it.
 * The limit therefore caps a single fold at roughly 60 KB of generated
 * source.
 *
 * On a target that can bind a folded value once as a shared local
 * (`bindsFoldedValue` — the JavaScript-family targets), the sharing is
 * removed rather than bounded: a symbol's compound pure value is emitted
 * ONCE in the preamble (`const _val_f = …;`) and every reference reads that
 * name, so the tower above emits three nodes per level. The size walk
 * charges what the emitter then actually writes — each bound value once,
 * each reference to it as one node — and this limit applies to that total.
 */
export const MAX_FOLD_EXPANDED_NODES = 20_000;

/**
 * Characters of generated source per expanded node, measured on the
 * JavaScript target (see `MAX_FOLD_EXPANDED_NODES`). Used only to put a
 * human-readable size in the refusal message.
 */
export const FOLD_CHARS_PER_NODE = 3;

/**
 * Operator heads that are word-spelled infix/prefix **keywords** in some
 * targets (Python `and` / `or` / `not`), never function calls. The alphabetic
 * op-string of these heads must NOT be treated as a function-call name — that
 * would emit `and(a, b)` (a Python SyntaxError). This is distinct from a user
 * override that intentionally maps an operator to a function name (e.g.
 * `Add: ['add', 11]` → `add(x, y)`): those heads are not in this set.
 */
export const WORD_KEYWORD_OPERATORS: ReadonlySet<string> = new Set([
  'And',
  'Or',
  'Not',
]);

/**
 * The arithmetic heads that fail closed over a `Tuple` with a list
 * coordinate (see the check in `compileExpr`). They are the heads whose
 * evaluate handlers report `listCoordinateTupleOperandError`. The other
 * heads that fail closed are those that apply to each coordinate of a tuple
 * (`broadcastsOverTuples`: `Sin`, `Ln`, `Floor`, …), whose component-wise
 * tuple broadcast (`tupleBroadcastCells`) reports the same error.
 */
export const TUPLE_ARITHMETIC_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Sqrt',
  'Root',
]);

/**
 * Structural / control-flow heads that `compileExpr` special-cases directly
 * (their own bespoke lowering — loops, conditionals, blocks, sequences,
 * bindings). A user operator definition's custom `compile` handler does NOT
 * override these: their compilation is not a simple operand-wise call and a
 * handler cannot express it. Every OTHER head — including operator-mapped
 * arithmetic/relational heads and function-mapped heads — IS overridable by
 * a custom handler (see the handler consult in `compileExpr`, finding A5).
 */
export const CONTROL_FLOW_HEADS: ReadonlySet<string> = new Set([
  'Sequence',
  'Sum',
  'Product',
  'Function',
  'Declare',
  'Assign',
  'Return',
  'Break',
  'Continue',
  'Loop',
  'Comprehension',
  'If',
  'Which',
  'When',
  'Match',
  'Block',
]);

/**
 * The control-flow heads a custom per-operator `compile` handler MAY
 * override after all — the carve-out from the `CONTROL_FLOW_HEADS` guard
 * (Tycho item 180). `Which` qualifies because it has no binding structure:
 * its operands are plain condition/value pairs a handler can compile
 * operand-wise through the callback it is given, unlike a `Sum` index or
 * a `Function` parameter list. The handler keeps the standard
 * decline-falls-back contract — returning `undefined`/`null`/`''` falls
 * through to the bespoke `Which` lowering below — and the override is
 * per-engine (definition lookup), not process-global like a target
 * function-table entry. Extend deliberately: any head added here must not
 * bind variables, or the handler cannot see the binding structure its
 * lowering must respect.
 */
export const OVERRIDABLE_CONTROL_FLOW_HEADS: ReadonlySet<string> = new Set([
  'Which',
]);

/**
 * The heads that the compiler lowers BY NAME in its own code, in addition
 * to the heads a target lowers through its `functions` or `operators`
 * table: the control-flow heads (`CONTROL_FLOW_HEADS`) and the heads that
 * `compileExpr` and its helpers test by name before the user-function
 * route. Each of these lowerings computes the LIBRARY operator, so a user
 * definition that shadows one of these names must not reach it
 * (`shadowedLibraryLoweringError()`).
 */
export const NAMED_LOWERING_HEADS: ReadonlySet<string> = new Set([
  ...CONTROL_FLOW_HEADS,
  'Abs',
  'Norm',
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'And',
  'Or',
  'Not',
  'Xor',
  'Nand',
  'Nor',
  'Implies',
  'Equivalent',
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Sqrt',
  'Root',
  'Ln',
  'Log',
  'Sign',
  'IsMissing',
  'Coalesce',
  'AssertPresent',
  'Typed',
  'Apply',
  'Spread',
]);

/**
 * Operator symbols that lower to a valid *binary infix* lambda
 * (`(a, b) => a ∘ b`) when a bare operator symbol is used in value position —
 * a first-class function such as a `Reduce` combiner. Only the binary
 * arithmetic operators qualify: a unary operator (Negate/Not) would emit
 * wrong-arity or invalid source (e.g. `(a, b) => a ! b`), and a relational or
 * logical operator folds to a boolean that silently diverges from the
 * interpreter. Any operator symbol NOT in this set fails closed so the
 * engine falls back to the interpreter rather than emitting garbage behind
 * `success: true`. Keyed by symbol (not operator glyph) so it is
 * target-agnostic.
 */
export const BINARY_INFIX_VALUE_OPERATORS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
]);

/**
 * The heads whose JavaScript code is an infix operator, or a scalar kernel,
 * that gives a wrong value for an array operand: `[1, 2] + [3, 4]` is the
 * string `"1,23,4"`, `[1, 2] * [3, 4]` is `NaN`, `[1, 2] < 3` is `false`
 * where the interpreter gives `[True, True]`, and `[1, 2] = [1, 2]` is
 * `false`. An operand declared `any` or `value` gets a run-time check of
 * its value at these heads (`declaredTopGuard`), and at every other head
 * whose definition is `broadcastable` (`Sin`, `Sqrt`, `Abs`, …): the scalar
 * kernel of such a head gives `NaN` for an array (`Math.sin([1, 2])`), and
 * `sin(2p + 1)` would apply it to the list that the check of `2p + 1`
 * gives.
 */
export const DECLARED_TOP_GUARD_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Square',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);

/**
 * Function heads that consume a complex value and return a real (or complex)
 * result. These are string-mapped to a complex-aware library routine in some
 * targets (e.g. Python `Real: 'np.real'`), so — unlike a real-only helper —
 * a complex argument is expected and must NOT trip the fail-closed guard.
 */
export const COMPLEX_TRANSPARENT_HEADS: ReadonlySet<string> = new Set([
  'Real',
  'Imaginary',
  'Argument',
  'Conjugate',
]);

/**
 * Heads that produce a real-SHAPED value BY DEFINITION — whatever their
 * operand's type or complexness. Every target lowers them to a real scalar
 * (`Imaginary` → `(z).y` on GLSL/WGSL, `.im` on JS, `np.imag` on Python;
 * `Argument` → `atan(z.y, z.x)` / `_SYS.carg`), so an enclosing form may
 * treat them as real without parent and child disagreeing on the value
 * shape.
 *
 * Read by `isComplexValued` BEFORE any type-based branch: `Imaginary` types
 * bare `number` (deliberately — `Im(~oo)` is `NaN`), which would otherwise
 * fall through to the conservative operand recursion and report complex,
 * failing the real-only-helper gate closed on `Mod(Imaginary(z), 1)` (Tycho
 * item 147). And a `Real(±∞)` can type `+oo | -oo`, so the
 * short-circuit must also precede the `isNonRealNumber` branch.
 *
 * Deliberately excludes `Conjugate` (complex → complex: emits `vec2` /
 * `{re, im}`) and `AbsArg` (tuple-valued). `Arg` canonicalizes to
 * `Argument`, so it needs no entry.
 */
export const REAL_BY_DEFINITION_HEADS: ReadonlySet<string> = new Set([
  'Real',
  'Imaginary',
  'Argument',
]);

/**
 * Scalar arithmetic operator heads whose codegen would emit
 * element-wise-impossible scalar JS if handed a list-valued operand. Guarded
 * in `compileExpr`: such a form fails closed unless `tryCompileBroadcast`
 * already lowered it element-wise (e.g. `Negate([1,2,3])` → `_SYS.bcast`).
 */
export const SCALAR_ARITHMETIC_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
]);

/**
 * Heads whose lowering is real-only on EVERY target, because the operation
 * has no complex extension to reach for. Each target includes them in the
 * real-only lowerings it declares (`CompileTarget.isRealOnlyLowering`,
 * read through `BaseCompiler.isRealOnlyLowering`), and adds the heads that
 * are real-only in its OWN lowerings: the special functions (`Erf`,
 * `BesselJ`, …) have a complex extension in the interpreter, and a target
 * may or may not lower it (Python's `scipy.special.erf` takes a complex
 * argument, JavaScript's `_SYS.erf` does not).
 *
 * Five families:
 *
 *  - ROUNDING (`Floor`, `Ceiling`, `Round`, `Truncate`, `Fract`) — there is
 *    no rounding of a complex number. They are function codegen for an
 *    integer-operand shortcut or a half-away-from-zero reconstruction.
 *  - ORDER SELECTION (`Max`, `Min`, `Clamp`) — the complex numbers carry no
 *    total order, which is the same reason `Less`/`Greater` fail closed on a
 *    complex operand.
 *  - INTEGER DIVISION (`Mod`, `Remainder`, `GCD`, `LCM`).
 *  - STATISTICS that order the sample or that no target lowers over
 *    complex values (`Median`, the population forms of the variance and
 *    the standard deviation, `Mode`, `Kurtosis`, `Skewness`, `Quartiles`,
 *    `InterquartileRange`). The interpreter has no complex median (it
 *    answers an `incompatible-type` error). `Mean`, `Variance` and
 *    `StandardDeviation` are not listed: the interpreter computes them
 *    over complex values (the variance is the sum of `|x − μ|²` over
 *    `n − 1`), and the Python lowerings `np.mean`, `np.var(…, ddof=1)` and
 *    `np.std(…, ddof=1)` compute the same values. They are real-only on
 *    the JavaScript and shader targets only, whose reducers sum plain
 *    numbers (`JS_REAL_ONLY_LOWERINGS`, `GPU_REAL_ONLY_LOWERINGS`).
 *    Measured before the gate: `Mean([i, 2i])` compiled to `NaN` on
 *    JavaScript where the interpreter answers the complex mean.
 *  - COLOR HEADS (`Rgb`, `Hsv`, `Hsl`, `Oklab`, `Oklch`, `Colormap`,
 *    `ColorMix`, `ColorFromColorspace`) — color components and mix ratios
 *    are real by definition; the `_SYS.*` converters behind them do plain
 *    arithmetic on their channels. Measured (Tycho item 204, on 0.115.0):
 *    `Hsv(90·√(x+1), 1, 1)` under the default `auto` handed `_SYS.hsv`
 *    the promoted `{re, im}` object and returned `[NaN, NaN, NaN]` at
 *    EVERY input — including `x = 3`, where `√4 = 2` is entirely real —
 *    with no decline the consumer could detect; a `ColorMix` ratio and a
 *    `ColorFromColorspace` tuple component failed identically. With the
 *    guard, a real-at-runtime promoted value unwraps and yields the true
 *    color; a genuinely complex one yields an equally-sized NaN-filled
 *    color (`realOnlyResultKind` — never a bare scalar, which would flip
 *    the result shape at runtime under a caller's destructuring).
 *    `ColorFromColorspace` carries its scalars inside a literal
 *    components tuple, so the gate scans and binds the tuple's ELEMENTS
 *    (`realOnlyGuardOperands`); a non-literal components operand keeps
 *    the compile-time fail-closed decline. The `As*` converters take
 *    already-constructed colors and need no gate of their own.
 *
 * Measured on the DEFAULT path with `x` bound to `0`, so the operand
 * `x + (1+i)` is complex but not a foldable literal. Every one of these
 * compiled to `success: true` over code that ran to NaN:
 *
 * | shape                | compiled | interpreter          |
 * | -------------------- | -------- | -------------------- |
 * | `Floor(x + (1+i))`   | NaN      | `1 + i` (inert)      |
 * | `Max(x + (1+i))`     | NaN      | `max(1 + i)` (inert) |
 * | `Mod(x + (1+i), 2)`  | NaN      | `1`                  |
 *
 * `Sign`, `Erf`, `Gamma` and `Zeta` were already failing closed through the
 * helper-name rule (`stringHelperIsRealOnly`), which is what showed these
 * families to be an omission rather than a policy.
 *
 * `Ceil` and `Ceiling` are DISTINCT heads and both belong here: `Ceil` is the
 * one the library canonicalizes to and the JavaScript target lowers with
 * function codegen (`Math.ceil`), so it needs this gate; `Ceiling` reaches
 * its target lowering as a plain helper name and already fails closed on the
 * string branch, and is listed so that a target which ever gives it function
 * codegen inherits the rule. Likewise `ElementMax`/`ElementMin` are separate
 * heads from `Max`/`Min` — they lower straight to `Math.max`/`Math.min` — and
 * a set holding only the aggregate spelling left them emitting
 * `Math.max({re, im})`.
 */
export const REAL_ONLY_BY_DEFINITION: ReadonlySet<string> = new Set([
  'Floor',
  'Ceil',
  'Ceiling',
  'Round',
  'Truncate',
  'Fract',
  'Max',
  'Min',
  'ElementMax',
  'ElementMin',
  'Clamp',
  'Mod',
  'Remainder',
  'GCD',
  'LCM',
  'Median',
  'PopulationVariance',
  'PopulationStandardDeviation',
  'Mode',
  'Kurtosis',
  'Skewness',
  'Quartiles',
  'InterquartileRange',
  'Rgb',
  'Hsv',
  'Hsl',
  'Oklab',
  'Oklch',
  'Colormap',
  'ColorMix',
  'ColorFromColorspace',
]);

/**
 * Heads that only PROPAGATE complexness from their operands: the value they
 * produce is complex exactly when one of their operands is. Read by
 * `isComplexValued` to answer from the OPERANDS rather than from a node type
 * that reads non-real — which is what keeps the `Sqrt`/`Ln`/`Log` carve-out
 * alive through the arithmetic wrapped around those heads (Tycho item 144).
 *
 * Deliberately excludes `Power`/`Root` (and the inverse trigs): those emit a
 * complex lowering off the node's TYPE (`resultIsComplexValued`), so their
 * value shape does not follow their operands and answering from the operands
 * here would put parent and child on different conventions.
 */
export const COMPLEX_PROPAGATING_HEADS: ReadonlySet<string> =
  // `Sign` is here for the same reason: on the real line its value is
  // ±1 or 0 and off it the complex `z/|z|`, so the value is complex exactly
  // when the operand is. Its node TYPE for an operand of unknown kind is
  // `complex | nan`, which would otherwise put the parent on the complex
  // lane while the emitter, choosing from the operand, wrote `Math.sign`.
  new Set(['Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Sign']);

/**
 * The ORDERING relational heads — the ones whose lowering needs a total
 * order on its operands. `Equal`/`NotEqual` are deliberately absent: they
 * are defined on the complex numbers and have their own complex-aware
 * codegen.
 */
export const ORDERING_HEADS: ReadonlySet<string> = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
]);

/**
 * Logical operator heads that are `broadcastable` but return booleans. Like
 * relational operators, they are excluded from numeric element-wise
 * broadcasting on the compile target (a boolean-list has no coverage).
 */
export const LOGICAL_BROADCAST_HEADS: ReadonlySet<string> = new Set([
  'And',
  'Or',
  'Not',
  'Xor',
  'Nand',
  'Nor',
  'Implies',
  'Equivalent',
]);

/**
 * The heads whose declared `'tuples'` broadcast exemption the compiled
 * lanes already reproduce, because their exempted shape is value-equivalent
 * under an element-wise lowering: tuple arithmetic IS component-wise, so
 * mapping the scalar lowering over the components answers what the head's
 * own handler answers. A tuple operand of one of these heads therefore keeps
 * the element-wise lanes it has always taken, and the atomic reading of
 * {@link isBroadcastExemptTupleOperand} does not apply to it. The same set,
 * with the two equality heads added, gates `tryCompileBroadcast`.
 */
export const ELEMENTWISE_TUPLE_EXEMPT_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Negate',
  'Subtract',
  'Divide',
]);

/**
 * Source text that may be REPEATED in the emitted code without repeating any
 * work: a numeric literal, a bare name, or a chain of property reads off one
 * (`_.W` — what a declared input compiles to). Anything else — a call, an
 * operator expression, an array literal — is bound once to a temporary and
 * read from there, so the operand is still evaluated exactly once.
 */
export const REPEATABLE_SOURCE =
  /^(?:-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/;

/** The heads `exponentExactness` reads through: their value is exact when
 * every operand is exact, and a float when an operand is a float. */
export const EXACT_EXPONENT_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Square',
  'Sqrt',
]);

/**
 * The parts of a plain `_SYS.bcast` emission — its element parameters,
 * the statements and result of its closure body, and its operand sources —
 * kept by the emitted text, so that an enclosing broadcast can absorb the
 * emission instead of nesting it ({@link emitFusedBroadcast}).
 *
 * The text is the key because the text is what an enclosing emitter holds
 * for an operand; the decomposition is a function of the text alone, so an
 * entry recorded by an earlier compilation that produced the same text
 * decomposes it the same way. Two facts make that sound, and a change to
 * either must revisit this memo: `tempVar` never repeats a name within one
 * compilation, so an absorbed closure's parameters cannot collide with the
 * enclosing closure's; and the rendered text of a well-formed emission
 * determines its parts, so a lookup hit is the emission it was recorded
 * for and never a different call that happens to print the same. Bounded:
 * cleared when it grows past {@link PLAIN_BROADCAST_MEMO_LIMIT} entries,
 * after which the affected operands simply nest.
 */
export const PLAIN_BROADCASTS = new Map<
  string,
  {
    params: string[];
    statements: string[];
    result: string;
    args: string[];
    /** Every operand source pure and compiler-emitted (see the caller). */
    pure: boolean;
  }
>();
export const PLAIN_BROADCAST_MEMO_LIMIT = 4096;

/**
 * The heads whose scalar lowering answers NaN whenever one operand is NaN
 * (IEEE propagation through the JavaScript operators and `Math` calls),
 * read by {@link emitFusedBroadcast}. `Power` is the exception among the
 * arithmetic heads (`Math.pow(NaN, 0)` is 1) and is handled there; the
 * relational and logical heads answer `false`/`true` for a NaN operand or
 * let a dominant operand absorb it (`guardConnectiveAbsence`).
 */
export const NAN_PROPAGATING_BROADCAST_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Sqrt',
  'Square',
  'Abs',
  'Exp',
  'Ln',
  'Log',
  'Log2',
  'Log10',
  'Sin',
  'Cos',
  'Tan',
  'Sinh',
  'Cosh',
  'Tanh',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Floor',
  'Ceil',
  'Round',
  'Sign',
  'Mod',
  'Min',
  'Max',
]);

/**
 * The element-wise heads whose lowering combines its operands' elements
 * WITHOUT ever promoting a real element to the complex lane. Read by
 * {@link elementsRealByConstruction}, which passes the realness question
 * through such a head to its operands.
 *
 * `Power` and the radicals are deliberately absent: under a promoting
 * discipline `√x` and `x^0.5` lower through the complex kernels when the
 * sign of `x` is unknown, so a real operand does not make the result real.
 */
export const NON_PROMOTING_ELEMENTWISE_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Square',
]);

/**
 * The operators whose value has the width of their vector operands, with
 * a scalar operand applied to each component: the arithmetic operators and
 * the one-argument functions that the shader targets apply to each
 * component (`sin(vec2)` is a `vec2`). Read by `aggregateComponentCount`.
 */
export const ELEMENTWISE_WIDTH_OPERATORS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Exp',
  'Ln',
  'Abs',
  'Sign',
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Fract',
  'Sin',
  'Cos',
  'Tan',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Sinh',
  'Cosh',
  'Tanh',
]);

/**
 * True when the operand `a`, whose type is a collection with no `missing`
 * arm, can still be the absent collection (`undefined`) at run time on
 * the JavaScript target, so a consumer that reads it as an array must
 * test it first (`absentCollectionOperandGuard`):
 * - a checked call whose failed check gives `undefined`
 *   (`checkedCallMayBeAbsent`);
 * - a `Take` or a `Drop` whose count can be `NaN` or have no value at run
 *   time (`countMayBeNaN`): the slice then gives `undefined`, as the
 *   interpreter has no value;
 * - an application that `absentCollectionOperandGuard` itself guards and
 *   whose result is a collection: an absent operand at a position where
 *   the operator propagates absence makes the application the absent
 *   collection (`Reverse(Take(xs, k))`).
 */
/**
 * The operators that handle a `missing` operand and that give a value
 * for an absent one (a fallback, a verdict, a raised error) or read it
 * lazily, so that `absentCollectionOperandGuard` must not test it first.
 * Every other operator that handles or passes through a `missing`
 * operand reads an absent WHOLE collection as an array (`undefined[0]`,
 * `undefined.length` throw), and is guarded.
 */
export const ABSENCE_DISCHARGING_HEADS: ReadonlySet<string> = new Set([
  'Coalesce',
  'IsMissing',
  'AssertPresent',
  'If',
  'Which',
  'When',
]);

/**
 * The heads that hold their operands as values without reading them as a
 * collection: a collection input at their operand is not iterated
 * (`collectionReadInputs`). `Tuple(L, 1)` holds the array `L`.
 */
export const COLLECTION_HOLDING_HEADS: ReadonlySet<string> = new Set([
  'List',
  'Tuple',
  'Pair',
  'Single',
  'Triple',
  'Sequence',
  'Hold',
  'Apply',
]);

/**
 * The compile plan for a CUSTOM `(accumulator, element)` combiner of a
 * `Reduce`/`Scan`: which lanes its two parameters run in, whether the seed
 * must be lifted, and the combiner expression to compile.
 *
 * Two lanes flow through a combiner. The ELEMENT lane is the source's: a
 * `list<complex>` (or a literal list of complex scalars) hands the body a
 * `{re, im}` per step. The ACCUMULATOR lane is the fold's own: it is the
 * SEED's shape on the first step (or the first element's, for a seedless
 * `Scan`), and it WIDENS to complex the moment the body yields a complex
 * value. Before this plan existed only the element lane was reasoned about
 * (by the type system's element inference on an inline lambda, and not at
 * all for a bare function symbol), so every accumulator shape compiled the
 * accumulator as a plain number — `Reduce([1+2i, i], (a,x) ↦ a + 2x, 0)`
 * answered `{re: "[object Object]0", im: 2}` (`a + {re, im}` concatenates)
 * where the interpreter gives `2 + 6i`; a COMPLEX seed `1+i` was no better
 * (`3 + 7i` expected); a seedless `Scan` over complex elements the same;
 * and a bare `h(a,x) := a + 2x` as combiner reached the real-lane `_fn_h`
 * and answered `NaN`. An interim fail-closed gate covered only the first
 * shape; ruled 2026-08-16 (Arno) to land the real fix instead.
 *
 * The plan:
 * - `eltComplex`: every element is a complex scalar
 *   (`hasUniformComplexScalarElements`).
 * - `accComplex`: the accumulator lane, by ONE-STEP WIDENING — complex when
 *   the accumulator parameter is DECLARED complex, or the seed is
 *   complex-shaped, or the fold is seedless over complex elements, or the
 *   body's result is complex when analyzed with the element in its lane and
 *   the accumulator real (the state of the first step). Widening is
 *   monotone, so one re-analysis settles it.
 * - `coerceSeed`: a real seed into a complex accumulator lane is lifted to
 *   `{re, im: 0}` (the call-boundary convention `coerceToComplex` applies
 *   to a real argument bound to a complex-typed parameter).
 * - `op`: the combiner to compile. An inline lambda is compiled under a
 *   local shape frame binding its two parameters to their lanes; a bare
 *   user-function symbol whose lanes are complex is replaced by its
 *   eta-expansion `(_a: complex?, _x: complex?) ↦ h(_a, _x)`, whose call
 *   site then binds a complex-typed argument to `h`'s parameter — a
 *   `LaneMismatch` for a WIDE parameter under strict shapes (declined by
 *   `strict`, escalated to complex mode by `auto`, where the one emission
 *   of `h` lifts its parameter at use), a coercion for a declared-complex
 *   one. A bare symbol with both lanes real is returned unchanged.
 *
 * `undefined` when `op` is not a two-parameter combiner this analysis can
 * see (a builtin, an infix operator symbol, a multi-clause function): the
 * caller keeps its previous lowering for those.
 */
/** The builtin combiners the JavaScript target folds with natively
 * (`builtinCombiner` in `javascript-target.ts`); their fold runs in the
 * elements' lane, widened by a complex seed. */
export const BUILTIN_FOLD_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Min',
  'Max',
]);

/**
 * Operator heads the compiler lowers directly in `compileExpr`, independent
 * of any target operator/function mapping (control-flow, binding, and
 * indexing-set forms). `analyzeReferences` never reports these as
 * "unsupported".
 */
export const STRUCTURAL_HEADS: ReadonlySet<string> = new Set([
  'Sequence',
  'Sum',
  'Product',
  'Function',
  'Declare',
  'Assign',
  'Return',
  'Break',
  'Continue',
  'Loop',
  'Comprehension',
  'If',
  'Which',
  'When',
  'Match',
  'Block',
  // Indexing-set wrappers consumed by Sum/Product/Loop — never compiled
  // standalone.
  'Limits',
  'Element',
  // Ascription — a bespoke, always-lowerable branch in `compileExpr` (it
  // compiles its operand); canonical function-literal bodies carry their
  // return marker as a `Typed` node, so without this the reference
  // analysis mislabeled every annotated body as unsupported.
  'Typed',
]);

/**
 * The operators whose application is EXPENSIVE enough for an invariant
 * prefix to be worth a variant of the callee: a transcendental call, which
 * costs tens of nanoseconds, where the arithmetic around it costs one. A
 * call of a user-defined function counts too (`invariantPrefixes`), since
 * its body can hold any amount of work.
 */
/**
 * The arithmetic heads whose operands the compiled code reads as numbers
 * or arrays. An operand typed as a function is refused at these heads
 * (see `_compileInner`).
 */
export const ARITHMETIC_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'Abs',
]);

export const EXPENSIVE_PREFIX_HEADS: ReadonlySet<string> = new Set([
  'Sin',
  'Cos',
  'Tan',
  'Sinh',
  'Cosh',
  'Tanh',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arctan2',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Exp',
  'Ln',
  'Log',
  'Lb',
  'Lg',
  'Gamma',
  'LogGamma',
  'Erf',
  'Erfc',
]);
