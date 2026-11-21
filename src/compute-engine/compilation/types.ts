import type { MathJsonSymbol } from '../../math-json/types.js';
import type {
  BoolInterval,
  Interval,
  IntervalResult,
} from '../interval/types.js';

/**
 * The arithmetic discipline a compilation runs under: how a numeric binding
 * whose static type is wide (`unknown`, `number`, an unannotated
 * parameter) is shaped, and what happens when a complex-shaped
 * value reaches one:
 *
 * - `'strict'` — shape follows static analysis: a `complex`/`imaginary`-typed
 *   value, a `Complex(…)` literal, `ImaginaryUnit`, a symbol whose assigned
 *   value is complex and a radical/logarithm of a provably negative operand
 *   are complex-shaped; a wide binding is real, and a complex-shaped value
 *   meeting one fails closed with a `LaneMismatch`. No promotion of an
 *   unknown-sign radical. This is the shader targets' model, applied to
 *   every target. An operation whose exact value is complex on a real lane
 *   gives the target's `NaN` (`Sqrt(x)` with `x: real` at `x = -4`).
 * - `'complex'` — a wide numeric binding is complex-shaped and lifted at use;
 *   unknown-sign radicals/logarithms promote. Always sound, only slower. The
 *   compiled code returns a JavaScript `number` when the value is real and a
 *   `{re, im}` object only when the imaginary part is nonzero.
 * - `'bigint'` — JavaScript target only. The `strict` discipline, with every
 *   integer-typed value computed as a JavaScript `bigint`, so an integer past
 *   `2^53 − 1` stays exact. A node that is not on the integer lane declines
 *   with `code: 'bigint-lane'`. No promotion, and no detection of a value
 *   past `2^53`: the mode is used only when it is requested, and the result
 *   reports `mode: 'bigint'`. The
 *   compiled code returns a `bigint` for every finite integer value, a
 *   `boolean` for a boolean value, and a `number` (`NaN` or `Infinity`)
 *   when a sub-expression had no finite value; that `number` has no defined
 *   relation to the value of `evaluate()`. The rules are in
 *   `docs/COMPILATION-MODEL.md`, "Compile modes", and in
 *   `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`.
 *
 * `'strict'` is the default of every target. `'complex'` and `'bigint'` are
 * used only when they are requested. A request for the removed mode
 * `'auto'` (from a host that does not type-check its options) declines with
 * `code: 'unsupported-mode'`; `'complex'` replaces it. Which discipline the
 * returned code was compiled under is reported on the result
 * (`CompilationResult.mode`).
 *
 * A declared real result is real in every mode. The body of a function
 * declared with a real result type (`(real) -> real`, `-> finite_real`,
 * `-> nan | real`) is a real ascription. When the body is complex only
 * because of promotion, it compiles with promotion off, as `'strict'`
 * compiles it, also under `'complex'`: an unknown-sign radical
 * in it gives `NaN` outside its real domain. A body that is complex also
 * without promotion (a `complex`-typed operand) still declines.
 */
export type CompileMode = 'strict' | 'complex' | 'bigint';

/**
 * Where the values of a free symbol live on a shader target — the kinds a
 * `storage` hint (`CompilationOptions.storage`) may name.
 *
 * - `'sampler2D'`: a fixed-length numeric list whose values the host uploads
 *   as a single-channel 32-bit float texture, one value per texel, laid out
 *   row-major from texel (0, 0) with nearest filtering. The texture must hold
 *   at least as many texels as the list's declared length; a larger texture
 *   is fine (its trailing texels are never addressed). The texture's width is
 *   read at run time inside the generated helper, so the host may pick any
 *   width and resize without recompiling.
 */
export type StorageKind = 'sampler2D';

/**
 * One `storage` hint: a storage kind, spelled either as the bare kind string
 * (`'sampler2D'`) or as an object with a `kind` field (`{ kind: 'sampler2D' }`).
 * The two spellings are the same hint.
 */
export type StorageHint = 'sampler2D' | { readonly kind: 'sampler2D' };

/**
 * Which of the two kinds of compile decline a diagnostic reports:
 *
 * - `'capability'` — a compilable thing that this target or mode cannot
 *   lower (an unsupported operator, a mode the target does not offer, a
 *   comparison over a statically non-real operand). Nothing wrong was ever
 *   computed; the expression simply has no compiled value here.
 * - `'correctness'` — a value the compiler could have computed incorrectly is
 *   withdrawn instead (a complex-shaped value meeting a real-shaped binding,
 *   a sub-expression of static type `error` for which the interpreter gives
 *   an error).
 *
 * A consumer counting declines must keep the two apart: the second kind is
 * a fix, not a regression.
 */
export type CompileDiagnosticKind = 'capability' | 'correctness';

/**
 * A structured compile decline, carried on `CompilationResult.diagnostic`
 * beside the human-readable `error` string (which stays a string: it is
 * interpolated into warning messages), or a warning about a successful
 * compilation, carried on `CompilationResult.warnings`.
 *
 * - `code` — a stable machine-readable identifier: `'lane-mismatch'`,
 *   `'unsupported-mode'`, `'bigint-lane'` (in `mode: 'bigint'`, a node that
 *   is not on the integer lane; it is not a lane mismatch),
 *   `'static-type-error'` (a sub-expression of
 *   static type `error`), `'untyped-input'` (an input whose static type is
 *   `unknown` or `any`, so its shape is not known; the kind is
 *   `'correctness'`), `'unsettled-shape'` (a value that has no single shape
 *   at compile time, for example an `If` whose branches differ in shape),
 *   `'compile-error'` (the generic fail-closed decline), `'outside-profile'`
 *   (with the `profile` option, the first node outside the profile, or an
 *   option that the profile does not have), ….
 * - `kind` — see `CompileDiagnosticKind`.
 * - `message` — the human-readable reason (same text as `error`).
 * - `boundary` — for a lane mismatch, the binding boundary that refused
 *   ("user-function parameter", "Block local", …).
 * - `binding` — a USER-LEGIBLE name for the binding: an authored identifier
 *   (the parameter `x` of `b`, the local `k`) or an honest description ("the
 *   accumulator of the `Reduce`") — never a compiler-internal temporary.
 * - `value` — the LaTeX of the complex-shaped expression that reached it;
 *   for a `'static-type-error'` decline, the sub-expression of type `error`,
 *   as `toString()` writes it; for a warning, the expression it is about, as
 *   `toString()` writes it.
 * - `operator` — the head of the node that the diagnostic is about, when it
 *   is a function expression: for an `'outside-fragment'` decline of
 *   `canCompile()`, the head of the first node outside the fragment of the
 *   target (`Integrate`), and for an `'outside-profile'` decline, the head
 *   of the first node outside the profile. A host counts declines by head
 *   with it, without parsing `value`.
 */
export type CompileDiagnostic = {
  code: string;
  kind: CompileDiagnosticKind;
  message: string;
  boundary?: string;
  binding?: string;
  value?: string;
  operator?: string;
};

/**
 * What a compiled `interval-js` runner returns: an `IntervalResult` for a
 * scalar expression, a `BoolInterval` (`'true'`, `'false'` or `'maybe'`) for
 * a comparison or another boolean expression, and for a collection-valued
 * one (a comprehension, a list of points) an ARRAY of these, nested as the
 * collection is. The runner
 * never returns a bare `Interval`: it wraps the bare enclosure of a constant
 * or of a bare variable as `{ kind: 'interval', value }`. The `Interval`
 * member stays in this union so that the code of a caller that also accepts
 * it still type-checks. The
 * interval domain is "one interval per quantity"; a collection is that many
 * quantities, so it is an array of them rather than one interval (user
 * ruling 2026-08-22, confirming what comprehension roots already produced).
 *
 * Defined here (not in a `types-*.ts` file) because the layering rules forbid
 * the type-definition layer from importing `interval/`; `compilation/` may.
 */
export type IntervalValue =
  IntervalResult | BoolInterval | Interval | IntervalValue[];

/**
 * What a compiled `interval-js` runner accepts for each variable: a plain
 * number (auto-converted to a point interval), an `Interval`, or — for a
 * collection-valued variable, read by `At`/`Length`/`PointX`… — an array of
 * these, nested as the collection is; every number in it is converted to a
 * point interval on the way in.
 *
 * A variable declared `boolean` takes a JavaScript boolean or a
 * {@link BoolInterval} string. The runner converts `true` to `'true'` and
 * `false` to `'false'` on the way in, the strings the compiled code tests.
 * `'maybe'` says that the condition can be either value, and the result
 * covers both: `If(c, 1, 2)` gives `[1, 2]` for `c = 'maybe'`, `1` for
 * `c = true` or `c = 'true'`. When the result runs the interpreter (an
 * expression this target cannot compile), the strings are read as the
 * booleans for a variable declared `boolean` (`'maybe'` as a variable with
 * no value), and as text for a variable declared `string`. `broadcast()`
 * takes a JavaScript boolean (every cell) or a plain array of booleans
 * (one per cell, not a pair), and not the strings.
 */
export type IntervalInput =
  number | Interval | boolean | BoolInterval | IntervalInput[];

/**
 * Options for compilation
 */
export interface CompilationOptions {
  /**
   * The target of the compilation:
   * - `'javascript'` (default): JavaScript, with a `run` function
   * - `'glsl'`: GLSL ES 3.0 source (OpenGL Shading Language)
   * - `'interval-js'`: JavaScript with interval arithmetic, with a `run`
   *   function
   *
   * Every entry of the package compiles to the three targets.
   *
   * @example
   * ```typescript
   * const shader = compile(expr, { to: 'glsl' });
   * ```
   */
  to?: string;

  /**
   * Map a symbol to the target-language source emitted for it (e.g. a GLSL
   * uniform name `{ a: 'u_var_a' }`, or a JS literal `{ a: 5 }`).
   *
   * A `vars`-mapped symbol is **never constant-folded**, even when the symbol
   * has an assigned value in the engine (`ce.assign('a', …)`). The mapping
   * always wins, so the generated code keeps referencing the mapped
   * identifier — a per-frame uniform / argument write updates the result
   * without recompiling. This is a guaranteed contract.
   *
   * A symbol that is *not* mapped here but *is* known to the engine (an
   * assigned value or a declared constant) is folded into the generated code,
   * matching `evaluate()` and `expr.unknowns`. A genuinely free symbol (no
   * mapping, no value) is emitted through the target's free-symbol plumbing.
   */
  vars?: Record<MathJsonSymbol, string>;

  /**
   * The names of the symbols that are inputs of the compiled code.
   *
   * A symbol named here is read as an input wherever the compilation reads
   * its name: in the expression, in the bodies of the user functions that
   * the expression calls and in the values of the symbols that it reads. Its
   * stored value is not read (it is not folded, and no analysis sees it),
   * and the emitted code names it as any other input of the target (`_.a`
   * on JavaScript). The host supplies its value at each run. Unlike `vars`,
   * the option gives no source text.
   *
   * The type of the input is the type that the scope of the compilation
   * declares for the name. A host that declares the name in a scope pushed
   * around the compilation (an axis, a parameter of a kernel) names it here,
   * so that a function defined outside that scope reads the input too.
   *
   * A symbol whose value cannot be left out makes the compilation decline:
   * a constant, and a symbol whose type was inferred from an assigned value
   * and not declared.
   */
  symbolic?: readonly MathJsonSymbol[];

  /**
   * Accepted for the hosts that set it, with no effect: on the GLSL target
   * a shader function takes every input that its body reads as a parameter.
   */
  callerLocals?: readonly MathJsonSymbol[];

  /**
   * The arithmetic discipline to compile under — `'strict'` (the default),
   * `'complex'` or, on the `javascript` target only, `'bigint'` (see
   * `CompileMode`). Effective mode = this option ?? the target's `mode` ??
   * `'strict'`. The `javascript` target offers all three;
   * `interval-js` and `glsl` offer `'strict'` only.
   * Requesting a mode the target does not offer is a `capability` decline
   * (`success: false`, `diagnostic.code === 'unsupported-mode'`), never a
   * silent coercion. The removed mode `'auto'` is such a decline on every
   * target; request `'complex'` instead.
   *
   * `'bigint'` computes every integer value as a JavaScript `bigint`, so a
   * counting function stays exact past `2^53 − 1`. It is used only when a
   * host requests it. A node that is not on the integer lane declines
   * with `diagnostic.code === 'bigint-lane'`. The inputs are `bigint` values
   * or safe-integer numbers; the result is a `bigint`, a `boolean`, or a
   * `number` (`NaN`, `Infinity`) that has no defined relation to the value
   * of `evaluate()`. `broadcast()` and `broadcastAsync()` refuse the mode.
   * See `docs/COMPILATION-MODEL.md`, "Compile modes".
   *
   * The result reports the discipline the returned code was compiled under
   * (`CompilationResult.mode`).
   *
   * Under the default `'strict'`, the lane of a value follows its static
   * type: an unknown-sign `Sqrt`/`Ln`/`Log`/`Power` stays on the real lane
   * and gives `NaN` outside its real domain, and a complex-shaped value
   * reaching a binding shaped real declines with a lane mismatch. Under
   * `'complex'` such a radical promotes (except in the body of a function
   * declared with a real result, which compiles on the real lane in every
   * mode when only promotion would make it complex — see `CompileMode`).
   */
  mode?: CompileMode;

  /**
   * Whether the JavaScript runner performs the D3 ENTRY CHECK on each call
   * (default `true`): a `{re, im}` value bound to a free symbol or lambda
   * parameter the compilation shaped REAL throws a `TypeError` naming it, a
   * plain number bound to a `complex`-typed one is lifted to `{re, im: 0}`,
   * and a string bound to one declared with a list or collection type whose
   * elements are not text (`indexed_collection`, `list<number>`) throws a
   * `TypeError` naming it, because the compiled code reads it as an array.
   * No other value is tested against its declared type: the host supplies
   * every input with a value of its declared type, and the result for any
   * other value is undefined (`x + 1` gives `2` for `x = true` with
   * `x: real`).
   * The entries of a list are never read and a returned collection is never
   * copied: the compiled route requires inputs of the shape the code reads
   * (plain arrays, not typed arrays) and its results are read-only by
   * contract (see the `EntryPlan` description in `javascript-runtime.ts`).
   * One `typeof` per checked binding per call — which is one READ of each
   * checked free symbol on the vars object, whether or not the compiled code
   * would read it on that call (a getter-backed vars object sees the read).
   *
   * In the `'bigint'` mode the check also applies to each integer input
   * (a binding or a parameter typed a subtype of `integer`): a `number`
   * that is not a safe integer, and a value that is neither a `number` nor
   * a `bigint`, throw a `TypeError` that names the input. It converts the
   * `number` cells of a `list<integer>` input (also nested) to `bigint`, in
   * a copy, and refuses a cell that is not an integer. The conversion of a
   * scalar `number` input to `bigint` is in the emitted code, so it is done
   * also when the check is off. With `entryChecks: false` a `list<integer>`
   * input must hold `bigint` cells: its `number` cells are not converted,
   * and the result is then unspecified.
   *
   * `false` is for ENGINE-INITIATED (implicit) compilations — the auto-
   * compiled `Map` drains, the numeric kernels, the compiled `Reduce` fast
   * path — whose callers own their argument contract and validate the result
   * themselves (a `NaN` or malformed result re-runs the element through the
   * interpreter); a thrown entry check would turn that self-healing fallback
   * into an evaluation error. `implicitCompile` passes it. A compiled
   * lambda still lifts a plain number passed to a parameter on the complex
   * lane, because its body reads `.re` and `.im`; a free symbol has no
   * such lift.
   */
  entryChecks?: boolean;

  /**
   * Cap the trip count of emitted `Sum`/`Product` loops: a loop whose
   * iteration count would exceed the budget (including infinite bounds)
   * evaluates to `NaN` instead of running, or to the `entire` interval on
   * the `interval-js` target. It also caps (floors, then
   * truncates to) the `PointList` zip length on the JavaScript target — a
   * capped point list is truncated, not `NaN`-poisoned.
   *
   * It also limits a `Loop` on the JavaScript and `interval-js` targets. Each
   * iteration of a `Loop` adds one to one total for a call of the compiled
   * code, including nested loops and the loops in the bodies of user functions.
   * Over the budget, the code throws a `CancellationError` with the cause
   * `'iteration-limit-exceeded'`: a `Loop` has no value to replace with `NaN`.
   * The limit is a count, not a time.
   *
   * `broadcast()` gives `NaN` for such a cell, as for any error of a cell, and
   * only the slice form counts the failures: a synchronous `broadcast()` gives
   * the `NaN` with no report. The budget applies to each cell, so a batch costs
   * up to the number of cells times the budget.
   *
   * Code that counts passes and whose value is a function, other than a
   * `Function` literal at the root, declines. Its calls would share one total.
   *
   * Without the option, the code of a `Loop` on the JavaScript and
   * `interval-js` targets has no check.
   *
   * On the GLSL target, `compile()` always caps the passes, with a default
   * of 10,000. Each pass of each loop that the shader runs (a `Sum`, a
   * `Product`, a `Loop` and a `parallel for`, also in the bodies of user
   * functions) adds one to one count for each evaluation of the compiled
   * expression. Over the cap, the loops stop and the value of the
   * expression is `NaN` (`false` for a boolean value). `Infinity` sets no
   * cap: the code counts no pass. A finite value is floored and kept at
   * most `2^30`. On every target, `NaN` or a value of at most 0 is
   * refused: `compile()` throws and `canCompile()` answers `ok: false`.
   *
   * ```ts
   * const { run } = compile(expr, { iterationBudget: 1e6 });
   * ```
   */
  iterationBudget?: number;

  /**
   * Quadrature strategy for compiled definite integrals (`Integrate`).
   *
   * - `'adaptive'` (default) — deterministic adaptive Gauss–Kronrod (GK15):
   *   near machine precision on smooth integrands, µs-scale, with automatic
   *   Monte-Carlo fallback on non-convergence.
   * - `'monte-carlo'` — force the stochastic Monte-Carlo estimator
   *   (~1e-4 typical error, different result each call).
   */
  quadrature?: 'adaptive' | 'monte-carlo';

  /**
   * Compile-time constant folding (default `true`).
   *
   * A **pure** subtree with no free variables — no unknowns, no `vars`-mapped
   * symbols, no enclosing bound names, no caller-overridden operators — is
   * evaluated at compile time and emitted as a number or boolean literal:
   * `Sum(Take(Map(_ ↦ _^2, 1..20), 10))` compiles to `385` instead of a
   * map/slice/reduce chain. The evaluation runs under a short time budget and
   * the engine's collection-size cap; a subtree whose evaluation does not
   * complete, or whose value is not a number or boolean, compiles structurally
   * as before. The folded value is the interpreter's (`.N()`), so folding can
   * change the last-ulp rounding of results the structural code computed in a
   * different operation order — by design, compiled output tracks `evaluate()`.
   *
   * `false` disables folding — use it to inspect the structural lowering of a
   * constant expression (codegen tests do this).
   *
   * One exception: a function whose result jumps at a point (`Floor`, `Ceil`,
   * `Round`, `Truncate`, `Fract`, `Mod`, `Remainder`, `Chop`, `Sign`,
   * `Heaviside`, the comparisons) applied to closed exact operands is folded
   * also when this is `false`. Its structural code would compute the operands
   * as doubles, and a double can be on the other side of the jump:
   * `Floor((25! − 1)/24!)` compiles to `24`, the interpreter's value, where
   * the structural code gives `25`.
   */
  constantFold?: boolean;

  /**
   * Where the values of a free symbol live on a SHADER target, per symbol
   * name. Today one kind exists, `'sampler2D'` (see {@link StorageKind}): the
   * symbol is a fixed-length numeric list (`list<number^1600>`) whose values
   * the host uploads as a single-channel float texture, and a positional read
   * of it lowers to a texel fetch instead of a uniform-array subscript:
   *
   * ```typescript
   * ce.declare('S', 'list<number^1600>');
   * ce.declare('k', 'integer');
   * compile(ce.box(['At', 'S', 'k']), {
   *   to: 'glsl',
   *   storage: { S: 'sampler2D' },
   * });
   * // The code reads `_gpu_ir_texel(S, …)`; the preamble declares the helper.
   * // The host declares `uniform sampler2D S;` and uploads the texture.
   * ```
   *
   * The host also declares `precision highp sampler2D;` before the
   * preamble: the default precision of a sampler in a fragment shader is
   * `lowp`, and a `lowp` fetch from a float texture can lose precision.
   *
   * The default, with no hint, is the uniform-array lowering (a read of
   * `uniform float S[1600];`). Both forms share one
   * index contract: 1-based, a negative index counts from the end, and `0`, a
   * non-integer, a non-finite value or an index out of range reads as NaN.
   *
   * A sampler-backed symbol can be read ONLY through a positional access; any
   * other reference to it (as an operand, in a reduction, as a bare value) is
   * a compile error on the shader targets, because a texture has no shader
   * value of its own. The hint is IGNORED on the JavaScript and interval
   * targets — one options bag serves every lane — but it is VALIDATED
   * on every target: an unknown storage kind, or a hint naming a symbol that
   * is not a free symbol of the expression being compiled, throws an
   * option-contract error before compilation starts (never an interpreter
   * fallback). Each value is either the bare kind string or `{ kind }`.
   */
  storage?: Readonly<Record<MathJsonSymbol, StorageHint>>;

  /**
   * When provided, the compiler records the id of every symbol whose engine
   * value or function-literal definition it consults while emitting code (the
   * generated code's capture set).
   */
  symbolDeps?: Set<MathJsonSymbol>;

  /**
   * When provided, the compiler records the id of every free symbol it emitted
   * as a vars-object lookup.
   *
   * Readable by the caller even when the compilation FAILS, which is the point:
   * compiling a `Function` literal whose body has such a symbol is declined
   * (the lambda ABI has nowhere to bind it), and a caller that must tell
   * "blocked on a free symbol, retry once it is assigned" from "structurally
   * uncompilable, never retry" reads this set to do so. `map-auto-compile`'s
   * `{symbol}` no-compile mark (D4) is that caller.
   */
  varsObjectRefs?: Set<MathJsonSymbol>;

  /**
   * Common-subexpression elimination (default `true`).
   *
   * A repeated **pure** subtree inside one compiled expression is evaluated
   * once and referenced by a temporary, instead of being emitted — and
   * executed — at every occurrence. Values are unchanged
   * (same operations, no reassociation), selection laziness is preserved (no
   * binding crosses a conditional arm, a short-circuited connective tail, or a
   * binder body), and draw streams are unchanged (only pure subtrees, never a
   * user-defined function application, are candidates).
   *
   * `false` disables CSE. The generated names are deterministic with or
   * without it.
   */
  cse?: boolean;

  /**
   * What `compile()` does with an expression that it cannot compile (a
   * decline).
   *
   * - **Unset / `true`** (default): return `{ success: false, error,
   *   diagnostic, run }`, where `run` evaluates the expression with the
   *   interpreter (on `interval-js`, with an interval-shaped result), and
   *   warn.
   * - **`false`**: throw the decline.
   */
  fallback?: boolean;

  /**
   * Accepted for the hosts that set it, with no effect: every compilation on
   * `javascript`, `glsl` and `interval-js` uses the compiler of
   * `src/compute-engine/compilation/ir`. The result reports `profile: 'ir'`.
   * Another value throws.
   */
  profile?: 'ir';
}

/**
 * The type report of one free symbol of a compiled expression (see
 * `CompilationResult.freeSymbolTypes`).
 */
export type FreeSymbolType = {
  /**
   * The engine type of the symbol, as a type string (`real`, `complex`,
   * `color | string | tuple`, …). For an undeclared symbol this is the type
   * the engine inferred from the uses of the symbol.
   */
  type: string;

  /**
   * The type the compiled code reads the value of the symbol as, spelled for
   * the target:
   *
   * - `glsl`: the shader type the host must give the uniform: `float`,
   *   `bool`, `vec2` for a complex value or a two-component point, `vec3`
   *   for a colour or a three-component point, `vec4`, or an array
   *   (`float[5]`; for a list of tuples of 2 to 4 real numbers an array of
   *   points, `vec2[3]`). A matrix of 2 to 4 columns is the array of its
   *   rows (`vec2[3]` for 3 rows of 2 numbers, `M[0]` its first row); no
   *   `matN` is emitted.
   * - `javascript`: the runner value convention: `number`, `complex` (a
   *   `{ re, im }` object), `boolean`, `string`, `point` (an array of
   *   numbers of a fixed width), `color`, `array` (a list), or `function`.
   * - `interval-js`: `interval` for a real number (a number or a
   *   `{ lo, hi }` interval), else as for `javascript`.
   *
   * `unknown` when the target has no single static type for the value.
   *
   * This can differ from `type`: after `ColorMix(a, b, 0.5)` the engine type
   * of `a` is `color | string | tuple`, but a shader reads a `vec3`.
   */
  lowered: string;

  /**
   * `'declared'` when the symbol has an explicit declaration (`ce.declare`),
   * `'inferred'` otherwise (its type was inferred from its uses, or it has
   * no definition at all).
   */
  provenance: 'declared' | 'inferred';
};

/**
 * Built-in targets that produce an executable `run` function.
 */
type ExecutableTarget = 'javascript' | 'interval-js';

/**
 * Result of a complex number computation: `{ re, im }`.
 */
export type ComplexResult = { re: number; im: number };

/**
 * The color space a {@link CompiledColor} carries.
 *
 * `oklch` is the preferred internal space: every color constructor and every
 * operator that produces a color answers a value in it. The four other
 * spellings appear only where an explicit conversion asked for them
 * (`AsRgb`, `AsHsv`, `AsHsl`, `AsOklab`). `ColorToColorspace` is not one of
 * them: it answers COMPONENTS — a plain array of channels, as its `-> tuple`
 * signature says — and never a color value.
 */
export type CompiledColorSpace = 'oklch' | 'rgb' | 'hsv' | 'hsl' | 'oklab';

/**
 * A color value on the JavaScript compilation target.
 *
 * The value is a flat object that carries its own color space, so a consumer
 * — a downstream color operator, or the caller — can tell an sRGB triple from
 * an OKLCh one. Before this representation a color was a bare numeric array,
 * nothing at run time told the spaces apart, and a conversion result reaching
 * a second color operator was read as OKLCh and answered a different color.
 *
 * The channel meaning follows the space:
 *
 * | `space`  | `c0`             | `c1`            | `c2`            |
 * | -------- | ---------------- | --------------- | --------------- |
 * | `oklch`  | L (0-1)          | C (chroma)      | H (degrees)     |
 * | `rgb`    | r (0-1 sRGB)     | g (0-1 sRGB)    | b (0-1 sRGB)    |
 * | `hsv`    | h (degrees)      | s (0-1)         | v (0-1)         |
 * | `hsl`    | h (degrees)      | s (0-1)         | l (0-1)         |
 * | `oklab`  | L (0-1)          | a               | b               |
 *
 * `alpha` is `undefined` when the color carries no alpha, and the key is
 * always present so every color value has the same five keys in the same
 * order (one hidden class, so a property read stays monomorphic).
 *
 * A color whose channels are not all finite is this same object with `NaN`
 * channels: it is the numeric projection of the interpreter's
 * `incompatible-type` rejection of an infinite or `NaN` channel.
 *
 * A color STRING stays a JavaScript string until a helper consumes it, and a
 * LIST of colors is a JavaScript array of these objects (or of strings). A
 * bare numeric array is therefore never a color: a color helper handed one
 * throws a `TypeError` that names the expected shape.
 */
export interface CompiledColor {
  space: CompiledColorSpace;
  c0: number;
  c1: number;
  c2: number;
  alpha: number | undefined;
}

/**
 * Every value a compiled runner can hand back.
 *
 * Wider than the numeric case most callers have in mind, because the compiled
 * form of an expression returns whatever that expression denotes, and the
 * engine compiles more than arithmetic:
 *
 * - `number` — the ordinary case; a pole or an undefined result is `NaN`.
 * - `bigint` — in `mode: 'bigint'` only, every integer value. A `number`
 *   result of that mode (`NaN` or `Infinity`) means that a sub-expression
 *   had no finite value.
 * - {@link ComplexResult} — a complex-valued expression, `{ re, im }` with
 *   `im !== 0` (a value whose imaginary part is exactly zero comes back as a
 *   plain `number`).
 * - `boolean` — a predicate is NOT numericized: `Greater(x, 0)` runs to
 *   `true`, never to `1`.
 * - `string` — a string-valued expression compiles to a JavaScript string.
 * - {@link CompiledColor} — a color-valued expression, a flat object carrying
 *   its color space and its three channels (plus an optional alpha).
 * - a (possibly nested) array — a collection-valued expression, one element
 *   per entry, matrices nesting one array per row.
 * - a callable — a FUNCTION-valued expression compiles to a JavaScript
 *   function rather than to a value: `Derivative(Sin)` runs to
 *   `(x) => Math.cos(x)`, which the caller then applies. Its parameters and
 *   result are compiled values in turn.
 *
 * Those descriptions hold when compilation SUCCEEDED. On the interpreter
 * fallback (`success: false`), the runner reduces whatever the interpreter
 * returns to the numeric shapes above, so a declining string-valued
 * expression answers `NaN` rather than its string. The union still covers
 * what comes back; the mapping from expression to member is what changes.
 *
 * The array member is not `readonly`, although a result is read-only by
 * contract: the runner hands back the array the compiled code built, which
 * may be a value it keeps for every later call (a hoisted constant list, a
 * bound symbol value), and a caller that writes to it changes what the next
 * call answers. The contract is documented, not enforced by the type, because
 * a `readonly` member would block passing the result to code that expects an
 * ordinary array; a caller that needs to change a result copies it first.
 *
 * A caller that knows which of these its own expression produces can say so
 * with the `R` type parameter — `compile<'javascript', number>(expr)` — and
 * get a narrow result type back. That is a TYPE-level assertion only: it
 * changes nothing about the code that is generated or the value that is
 * returned, so it is the caller's job to be right about it.
 */
export type CompiledValue =
  | number
  | bigint
  | ComplexResult
  | CompiledColor
  | boolean
  | string
  | CompiledValue[]
  | ((...args: CompiledValue[]) => CompiledValue);

/**
 * The result type a runner has when the caller names a target but not an `R`.
 *
 * Target-dependent, because `interval-js` does not produce ordinary values at
 * all: its runner answers with an {@link IntervalResult} — a tagged union
 * (`{kind: 'interval', value: {lo, hi}}`, `{kind: 'empty'}`, …), a constant
 * included — or with an array of them for a collection. Neither is a number,
 * a boolean or an array of them. Folding them into
 * {@link CompiledValue} would force every ordinary caller to narrow past
 * interval shapes that a `javascript` runner can never return, so the default
 * selects on the target name instead.
 */
export type DefaultRunnerResult<T extends string> = T extends 'interval-js'
  ? IntervalValue
  : CompiledValue;

/**
 * The variable/argument value type a runner accepts when the caller names a
 * target but not a `V`, selected on the same target-dependent basis as
 * {@link DefaultRunnerResult}: `interval-js` binds variables to intervals (a
 * plain number is auto-converted to a point interval), while every other
 * executable target accepts a real, a complex domain-coloring input, a
 * boolean (for a symbol declared `boolean`), a string (for a symbol declared
 * `string`), or a list of these ({@link RunnerListInput}) for a symbol that
 * the compiled code reads as a list.
 *
 * The type does not relate a value to the declared type of its symbol: it
 * admits `true` for a symbol declared `real`. The host supplies every input
 * with a value of its declared type; the result for any other value is
 * undefined, and compiled code does not test it (`x + 1` gives `2` for
 * `x = true`).
 *
 * Deliberately keyed on the TARGET and not on the compilation MODE, even
 * though a complex variable is only meaningful under `mode: 'complex'`. On the
 * built-in `javascript` target — the one that both compiles a `run` and emits
 * entry guards — real-mode generated code rejects such a value at run time
 * under the default `entryChecks`, naming the variable ("x" was compiled as a
 * real number but received a complex {re, im} value…), so the mistake reports
 * itself precisely. Narrowing the type by mode would instead need the options
 * type to be generic over the mode literal, which degrades back to the
 * permissive reading whenever a caller builds their options object in a
 * variable, so it would buy a build-time error only for the callers who least
 * need one.
 *
 * Two limits on that runtime backstop, neither of which changes the choice
 * here but both of which a reader should know. `entryChecks: false` opts out
 * of the diagnosis along with every other entry guard: the complex object then
 * flows into real arithmetic and the call returns `NaN` rather than throwing.
 * And the guard is the `javascript` target's own: the shader target compiles
 * to source and exposes no `run` at all.
 */
export type DefaultRunnerVars<T extends string> = T extends 'interval-js'
  ? IntervalInput
  : number | bigint | boolean | string | ComplexResult | RunnerListInput;

/**
 * A list argument of a compiled runner: an array of numbers, of booleans,
 * of strings, of complex values or of such lists (a list of points is an
 * array of arrays). The `javascript` target reads it for a symbol that it
 * compiles as a list (`run({ S: [1, 2, 3] })` for `S: list<real>`,
 * `run({ B: [true, false] })` for `B: list<boolean>`). A typed array
 * (`Float64Array`) is refused at run time, with a message. The entries are
 * not checked at run time: an entry of the wrong type computes as it would
 * in plain JavaScript. The one exception is a `list<integer>` input of
 * `mode: 'bigint'`: with the entry checks on, its `number` entries are
 * converted to `bigint` values, and an entry that is not an integer is
 * refused.
 */
export type RunnerListInput = ReadonlyArray<
  number | bigint | boolean | string | ComplexResult | RunnerListInput
>;

/**
 * Runner for compiled expressions — called with a variables object.
 *
 * ```typescript
 * result.run({ x: 0.5, y: 1.0 })
 * ```
 */
export type ExpressionRunner<R = CompiledValue, V = number> = (
  vars: Record<string, V>
) => R;

/**
 * Runner for compiled lambda (`Function`) expressions — called with
 * positional arguments.
 *
 * ```typescript
 * result.run(0.5, 1.0)
 * ```
 */
export type LambdaRunner<R = CompiledValue, V = number> = (...args: V[]) => R;

/**
 * Overloaded callable that accepts both calling conventions.
 *
 * Supports two calling styles:
 * - **Expression**: `run({ x: 0.5 })` — pass a variables object
 * - **Lambda**: `run(0.5, 1.0)` — pass positional arguments
 *
 * Check `calling` on the `CompilationResult` to know which convention
 * the compiled expression actually uses.
 *
 * `V` is the type of the variable/argument values. It defaults to `number`
 * (the `javascript` target's real-valued convention). Non-`number` targets
 * bind it to their own value type — e.g. `interval-js` uses
 * `number | Interval` (a plain number is auto-converted to a point interval),
 * and the `javascript` runner uses
 * `number | boolean | string | ComplexResult | RunnerListInput` (a boolean or
 * a string for a symbol declared with that type, a complex domain-coloring
 * input, or a list for a symbol that the code reads as a list).
 */
export interface CompiledRunner<R = CompiledValue, V = number> {
  /** Call with a variables object (for compiled expressions) */
  (vars: Record<string, V>): R;
  /** Call with positional arguments (for compiled lambda expressions) */
  (...args: V[]): R;
}

/** The entry plan of a compiled JavaScript result, as plain data. */
export type StoredEntryPlan = {
  /** `vars`: keyed by symbol name; `args`: keyed by parameter index. */
  kind: 'vars' | 'args';
  real: (string | number)[];
  complex: (string | number)[];
  lists: (string | number)[];
  /** The bindings that refuse a string argument, each with the label of the
   * binding and its declared type that the error message shows. A binding
   * is here when its declared type is a collection type that compiled code
   * reads as an array and whose elements are not text. */
  strings?: [string | number, string][];
  /** The bindings of a value kind type, checked by a function of
   * the host. Stored data cannot carry that function, so a runtime refuses to
   * load a plan that lists one. */
  kinds?: (string | number)[];
  /** The symbols declared `boolean` (`vars` plans only). `broadcast()`
   * reads an empty array for one as an empty column. */
  booleans?: (string | number)[];
  /** `mode: 'bigint'`: the integer inputs. Each accepts a `bigint`, and a
   * `number` that is a safe integer, which the compiled code converts with
   * `BigInt(x)`; any other value is refused with a `TypeError`. */
  bigints?: (string | number)[];
  /** `mode: 'bigint'`: the `list<integer>` inputs (also in `lists`). The
   * check converts each `number` cell that is a safe integer to a `bigint`
   * in a copy, and refuses a cell that is neither such a `number` nor a
   * `bigint`. */
  bigintLists?: (string | number)[];
  /** `mode: 'bigint'`: the integer parameters (also in `bigints`) that have
   * a default value (`args` plans only). A call that leaves out one of them
   * does not check it: the compiled code fills the default value. */
  bigintDefaults?: number[];
};

/**
 * The inputs of `CompilationResult.broadcast()`: one `Float64Array` per free
 * variable (one value per cell; a `lo, hi` pair per cell for `interval-js`),
 * or one number, the same value for every cell. A shared input (a variable
 * that the compiled code reads as a list, or one that
 * `BroadcastOptions.shared` names) is bound once for the whole batch: for a
 * `javascript` result, a plain array of numbers or a `Float64Array`; for an
 * `interval-js` result, a plain array of numbers and `{ lo, hi }` objects
 * (a `Float64Array` throws, since it would be read as `lo, hi` pairs). A
 * variable declared
 * `boolean` of a `javascript` result takes a boolean (every cell) or a plain
 * array of booleans (one per cell), and so does one of an `interval-js`
 * result; an empty array is an empty column for such a variable, and a
 * `Uint8Array` is not accepted. See
 * `compilation/broadcast.ts` for the layouts and the output encoding.
 */
export type BroadcastInputs = Record<
  string,
  | Float64Array
  | number
  | readonly number[]
  | readonly (number | { lo: number; hi: number })[]
  | boolean
  | readonly boolean[]
>;

export interface BroadcastOptions {
  /**
   * `'cells'` (default): every array holds one entry per cell and all have
   * the same cell count. `'grid'`: the arrays are the axes of a regular grid,
   * in key order of `inputs`, the first varying fastest; the cell count is
   * the product of their lengths. A shared input is neither a column nor an
   * axis.
   */
  layout?: 'cells' | 'grid';
  /**
   * `grid` layout only. The inputs that are index axes: the input of each is
   * the axis length `n`, a non-negative integer, and the variable takes the
   * cell's position along that axis, `0, 1, …, n − 1` (for `interval-js`,
   * the point interval of that value). The axis has its place in key order
   * of `inputs`, as a column `0 … n − 1` would, and no column is sent or
   * read. Each name must be a key of `inputs` and not a shared input; with
   * the `cells` layout the option throws.
   */
  indexes?: readonly string[];
  /**
   * A caller-owned output array, filled and returned instead of a new one. It
   * must hold at least `outputs` values per cell (`javascript`) or three
   * (`interval-js`); a longer array is filled from the start.
   */
  out?: Float64Array;
  /**
   * The inputs that are bound once for the whole batch instead of one value
   * per cell: every cell reads the same list. A variable that the compiled
   * code reads as a list (`javascript`: its declared type is a list;
   * `interval-js`: the code iterates, reduces or indexes it) is shared
   * without being named here; this option is for a variable with no such
   * type. Each name must be a key of `inputs`.
   */
  shared?: readonly string[];
  /**
   * `javascript` only. The count of numbers written per cell, a positive
   * integer: cell `c` is at `[outputs·c, outputs·c + outputs)` of the output.
   * Default: the arity of the expression's type when it is a tuple of two
   * or more elements that can be numbers
   * (`CompilationResult.broadcastOutputs`), 1 otherwise. With more
   * than 1, a cell whose answer is an array writes its elements (a missing
   * element is `NaN`), and any other answer is `NaN` in every slot. An
   * `interval-js` result throws.
   */
  outputs?: number;
}

export interface BroadcastAsyncOptions extends BroadcastOptions {
  /** Stops the batch: the cells done so far are returned. */
  signal?: AbortSignal;
  /**
   * Wall-clock budget for the whole batch, in milliseconds from the call.
   * When it passes, the loops stop and the result reports the cells done.
   */
  deadline?: number;
  /**
   * Cells per task on a worker pool, or per slice between two yields to the
   * event loop inline. Default: the cell count divided by the pool size (at
   * least 1024), or 16 384 inline.
   */
  chunk?: number;
  /**
   * `false` refuses the calling thread: when the batch would not go to the
   * worker pool (see `BroadcastAsyncResult.reason`), the call resolves at
   * once with `done: 0` and evaluates no cell; when a worker fails during
   * the batch, the call resolves with the cells that the workers finished,
   * and does not complete the rest on the calling thread. A refused batch
   * does not change the inline threshold, which the engine measures only on
   * batches that run on the calling thread. `CompilationResult.willUsePool`
   * gives the decision before the call. Default: `true`.
   */
  inline?: boolean;
}

/**
 * Where `broadcastAsync()` evaluated a batch: `'pool'` when the workers of
 * the engine's pool (`ce.workers`) evaluated the cells, `'calling-thread'`
 * when the engine chose the calling thread for the batch, or completed it
 * there after a worker failed.
 */
export type BroadcastAsyncRoute = 'pool' | 'calling-thread';

/**
 * Why the worker pool did not take a batch of `broadcastAsync()`:
 * - `'no-pool'`: the engine has no pool (`ce.workers` is not set, or is not
 *   a pool from `createKernelPool()`).
 * - `'pool-unusable'`: the workers of the pool run another version of the
 *   compiled-code runtime than this engine, so the pool takes no task.
 * - `'not-shippable'`: the compiled result cannot run on a worker
 *   (`CompilationResult.shippable` is `false`).
 * - `'below-threshold'`: the batch has too few cells to pay for the
 *   transfer to the workers (`CompilationResult.willUsePool` is `false` for
 *   its cell count).
 * - `'pool-declined'`: the batch went to the pool, and a worker refused or
 *   failed a task (for example a disposed pool, or an input that cannot be
 *   copied to a worker).
 */
export type BroadcastAsyncReason =
  | 'no-pool'
  | 'pool-unusable'
  | 'not-shippable'
  | 'below-threshold'
  | 'pool-declined';

/**
 * Why `runAsync()` ran a `parallel for` on the calling thread and not on the
 * engine's worker pool:
 * - `'no-pool'`: the engine has no pool (`ce.workers` is not set, or is not
 *   a pool from `createKernelPool()`).
 * - `'pool-unusable'`: the workers of the pool run another version of the
 *   compiled-code runtime than this engine.
 * - `'step-budget'`: the call runs inside `ce.withStepBudget()`, whose steps
 *   the workers cannot charge.
 * - `'below-threshold'`: the loop has fewer passes than
 *   `RunAsyncOptions.minPasses`.
 * - `'too-large'`: the private lists of the workers (one copy of each list
 *   accumulator and of each list that the passes read, for each sub-range)
 *   would hold more than 16 million numbers together.
 * - `'pool-declined'`: the loop went to the pool, and a worker refused or
 *   failed a sub-range of the passes (or a pass threw there): the calling
 *   thread ran that sub-range again.
 */
export type ParallelLoopReason =
  | 'no-pool'
  | 'pool-unusable'
  | 'step-budget'
  | 'below-threshold'
  | 'too-large'
  | 'pool-declined';

/**
 * What `RunAsyncOptions.onLoop` receives for each run of a `parallel for`
 * that can run on the pool: the count of passes of this run, where the
 * passes ran, and with `route: 'calling-thread'`, why the pool did not run
 * them all.
 */
export interface ParallelLoopReport {
  passes: number;
  route: 'pool' | 'calling-thread';
  reason?: ParallelLoopReason;
}

/** The options of `runAsync()` (see `CompilationResult.runAsync`). */
export interface RunAsyncOptions {
  /**
   * Stops the run. A signal that is already aborted rejects the promise
   * with `signal.reason` before any statement runs. An abort while the
   * program waits for the workers rejects the promise with `signal.reason`:
   * the queued sub-ranges are dropped, and a worker that still runs one is
   * terminated and replaced after the grace period of the pool. An abort
   * while the calling thread runs statements is seen at the next loop that
   * can run on the pool.
   */
  signal?: AbortSignal;
  /**
   * The smallest count of passes of a `parallel for` that goes to the
   * pool. A positive integer, default 20 000; another value rejects the
   * promise with a `TypeError`.
   */
  minPasses?: number;
  /**
   * Called once for each run of a `parallel for` that can run on the pool,
   * when its route is known: `'pool'` when every sub-range was answered by
   * a worker, `'calling-thread'` with the reason when a condition at run
   * time kept the loop in order or a sub-range ran again on the calling
   * thread. A loop that the compiler keeps in order never calls it. It
   * runs with the caller's state (precision digits, deadline frame); a
   * throw from it rejects the promise.
   */
  onLoop?: (report: ParallelLoopReport) => void;
}

export interface BroadcastAsyncResult {
  /** The output array (`options.out` when given). */
  out: Float64Array;
  /**
   * The number of leading cells that are valid: every cell, or fewer when
   * `deadline` or `signal` stopped the batch, when `inline: false` refused
   * the calling thread, or when a worker failed under `inline: false`; the
   * cells after `done` are untouched.
   */
  done: number;
  /**
   * The number of cells among the first `done` whose evaluation threw. The
   * values of such a cell are `NaN` (an `interval-js` cell is an error
   * enclosure), as for a cell whose value is not a number; this count tells
   * the two apart. A cell throws, for example, when the compiled code calls
   * a function that does not exist on the thread that runs it. The cell
   * counts in `done`: it was evaluated.
   */
  failed: number;
  /**
   * Where the batch was evaluated. `'calling-thread'` with `inline: false`
   * means that no cell was evaluated on the calling thread: the batch was
   * refused (`done` is 0).
   */
  route: BroadcastAsyncRoute;
  /**
   * Present when the pool did not take the whole batch: the first reason
   * that applies, in the order of {@link BroadcastAsyncReason}. With
   * `route: 'pool'` it is always `'pool-declined'`: a worker failed, and
   * the rest of the batch was not completed on the calling thread
   * (`inline: false`, or the `signal` or `deadline` stopped it).
   */
  reason?: BroadcastAsyncReason;
}

/**
 * The batch body of a `javascript` result (`CompilationResult.batch`), as
 * plain data. `broadcast()` runs it in place of the ordinary body for a whole
 * batch when each shared input marked `direct` passes a check made once per
 * batch: a `Float64Array`, or a plain array whose elements are all numbers,
 * in both cases at least `minLength` long. Otherwise the batch runs the
 * ordinary body. The two bodies give the same value for every input that
 * respects its declared type.
 *
 * The body is the function `(<local>, …) => code`, with one parameter per
 * entry of `params`, in order, after the definitions of `preambleOnce`
 * (evaluated once, when the body is loaded) and before those of
 * `preamblePerCall` (evaluated on every call). It reads its inputs from its
 * parameters, not from a vars object. The helpers it calls are those of the
 * runtime of the same version.
 */
export type StoredBatchBody = {
  /** The body, an expression over the parameters. */
  code: string;
  /**
   * The parameters of the body. `name` is the input it receives and `local`
   * its spelling in `code`. With `direct`, the input is a shared list that
   * the body reads with no per-read test of the array, passed as it is given
   * (a `Float64Array` is not copied). Without it, the parameter receives the
   * value the ordinary body reads for `name`: a number, the complex value of
   * a complex input, a shared input as a plain array, or `undefined` when
   * the inputs do not name it.
   */
  params: {
    name: string;
    local: string;
    direct?: boolean;
    minLength?: number;
  }[];
  preambleOnce?: string;
  preamblePerCall?: string;
};

/**
 * Result of compiling an expression.
 *
 * Three type parameters control the shape:
 * - `T` — the target name. For executable targets (`'javascript'` |
 *   `'interval-js'`), `run` and `calling` are guaranteed present.
 * - `R` — the return type of `run`. Defaults to {@link CompiledValue}, which
 *   spans every value a runner can produce: a `number` (a complex value whose
 *   imaginary part is exactly zero comes back this way), a `ComplexResult`
 *   with `im !== 0`, a `boolean` from a predicate, a `string`, or a
 *   (possibly nested) array from a collection. Narrow it yourself when you
 *   know which one your expression yields — `compile<'javascript', number>()`
 *   — and see the arithmetic example below.
 * - `V` — the type of the variable/argument values `run` accepts. Defaults to
 *   `number`; `interval-js` binds it to `number | Interval`, the `javascript`
 *   runner to `number | boolean | string | ComplexResult | RunnerListInput`.
 *   (Positioned after `R` so existing `CompilationResult<T, R>` uses keep
 *   the `number` default.)
 *
 * The `calling` field indicates which convention `run` uses:
 * - `'expression'` — call with a vars object: `run({ x: 0.5 })`
 * - `'lambda'` — call with positional args: `run(0.5, 1.0)`
 *
 * @example
 * ```typescript
 * // run is guaranteed, may return complex
 * const js = compile(expr);
 * js.run({ x: 0.5 });
 *
 * // doing arithmetic on the result needs a narrower R than the default,
 * // because a runner can also hand back a boolean, a string or an array
 * const num = compile<'javascript', number>(expr);
 * num.run({ x: 0.5 }) * 2; // a type-level assertion, no runtime coercion
 *
 * // strict mode: today's real kernel, NaN for √(−1), lane mismatches decline
 * const strict = compile(expr, { mode: 'strict' });
 * strict.run({ x: 0.5 }); // number | ComplexResult (typed complex only)
 *
 * // check calling convention
 * if (result.calling === 'lambda') {
 *   result.run(0.5, 1.0);
 * }
 *
 * // no run (source-only target)
 * const glsl = compile(expr, { to: 'glsl' });
 * glsl.code; // string
 * ```
 */
export type CompilationResult<
  T extends string = string,
  R = DefaultRunnerResult<T>,
  V = DefaultRunnerVars<T>,
> = {
  /** Target language name */
  target: T;

  /** Whether compilation succeeded (vs falling back to interpretation) */
  success: boolean;

  /** Generated source code */
  code: string;

  /**
   * The version of the helper set the JavaScript `code` calls (`_SYS`). Run
   * stored code with `createJavaScriptRuntime()` from
   * `@cortex-js/compute-engine/runtime`, and compare this with the runtime's
   * `runtimeVersion`: a mismatch means the code was compiled by another
   * release. An `interval-js` result carries the version of the interval
   * library its `code` calls as `_IA`, for the same comparison. Set by the
   * JavaScript and interval-js targets only.
   */
  runtimeVersion?: string;

  /**
   * JavaScript only. How `run()` converts and checks its inputs before the
   * code reads them, at a constant cost per binding: a number bound to a
   * symbol read as complex is lifted to `{re, im: 0}`, the unsigned pole
   * `~oo` bound to a symbol read as real is projected to `Infinity`, any
   * other `{re, im}` value bound to a symbol read as real is refused, and a
   * string or a typed array bound to a symbol the code reads as an array is
   * refused. Each refusal is a `TypeError` that names the binding. The
   * entries of a list are never read. Any other value outside the declared
   * type of its binding gives an undefined result. A runtime that loads the
   * stored code applies the same plan. Absent when there is nothing to
   * convert or check.
   */
  entryPlan?: StoredEntryPlan;

  /**
   * `interval-js` only. The free variables declared `boolean` (or
   * `boolean | missing`). `broadcast()` reads an empty array for one as an
   * empty column, and a runtime that loads the stored code
   * (`createIntervalRuntime().loadBroadcast`) reads it the same way. Absent
   * when there is none.
   */
  booleanInputs?: string[];

  /**
   * `interval-js` only. The free variables that the code reads as lists:
   * those declared with a collection type that has no `missing` arm.
   * `broadcast()` binds each one once
   * for the whole batch, as a shared input, and a runtime that loads the
   * stored code (`createIntervalRuntime().loadBroadcast`) does the same.
   * Absent when there is none.
   */
  listInputs?: string[];

  /**
   * JavaScript only. The value kind types (`gf8`, a type declared by the
   * host) whose compiled
   * representation the code reads or makes. The value of `run()` is then
   * returned as the code makes it (a kind value is the representation of the
   * kind, not a number). Code compiled with a kind contract cannot be stored:
   * the runtime of `@cortex-js/compute-engine/runtime` refuses to load it,
   * because the run-time checks of the kind are functions of the host that
   * compiled it. Absent when no value kind is involved.
   */
  valueKinds?: string[];

  /**
   * JavaScript only. `true` when the code reads or returns a string: such
   * code has no batch form, and `broadcast()`, `broadcastAsync()` and the
   * batch loaders of the runtime throw. Absent otherwise.
   */
  strings?: boolean;

  /**
   * JavaScript only. `true` when the result is a list of lists whose rows
   * can have different lengths (`Chunk(L, k)` or `Partition(L, n)` of a list
   * of run-time length, `Partition(L, p)` of a predicate): `run()` returns
   * an array of plain arrays of numbers or booleans, and such code has no
   * batch form: `broadcast()`, `broadcastAsync()` and the batch loaders of
   * the runtime throw, and `shippable` is `false`. Absent otherwise.
   */
  rows?: boolean;

  /**
   * JavaScript only. The significant digits `run()` reads the float exponent
   * of a negative base to, to tell `(-8)^(1/3)` from an irrational power
   * (`realPowerReconstructionDigits()`), fixed when the code is compiled.
   * `run()` and a runtime that loads the stored code both use this number: a
   * change of the engine's precision after the compilation does not change
   * the value of the compiled code, and a runtime has its own number library,
   * so it cannot compute the number again.
   */
  reconstructionDigits?: number;

  /**
   * Identifiers the generated `code` references that the caller must supply at
   * run time (JS vars-object keys / GLSL uniforms) for the result to be
   * self-contained.
   *
   * These are the expression's free symbols *as the generated code sees them*:
   * symbols with no value in the engine, after assigned values and declared
   * constants are folded in (so an assigned symbol is **not** listed — its
   * value is inlined, matching `evaluate()`), and after bound variables (lambda
   * parameters, `Sum`/`Product`/`Integrate`/`Loop` indices, `Block` locals) are
   * excluded. A symbol supplied through the `vars` option is always listed —
   * the mapping makes it an external input.
   *
   * Populated by the built-in targets on a successful compile. Use it instead
   * of `expr.unknowns` when building a uniforms / vars mapping: unlike
   * `unknowns`, it is guaranteed consistent with what the code actually
   * references (including symbols reachable only through a folded value).
   */
  freeSymbols?: string[];

  /**
   * The type of each free symbol of `freeSymbols`, keyed by its name: its
   * engine type, the type the compiled code reads it as on this target
   * (`lowered`) and whether it was declared or inferred (`provenance`). See
   * `FreeSymbolType`.
   *
   * Use `lowered` to declare the inputs the code expects: on a shader target
   * it is the type of the uniform to declare and bind (`vec2` for a complex
   * input, `vec3` for a colour), on JavaScript the shape of the value to put
   * in the vars object. The engine type alone does not always say this: a
   * symbol used as a colour operand has the engine type
   * `color | string | tuple`, but the shader reads it as a `vec3`.
   *
   * Set by the built-in targets beside `freeSymbols`.
   */
  freeSymbolTypes?: Record<string, FreeSymbolType>;

  /**
   * JavaScript only. The variables of the engine that a compiled function
   * literal assigns, such as the state of an animation:
   * `(t: real) => do { s = s + t / 1000 }` with `let s = 0.5`.
   *
   * Each call of `run()` reads their values in the engine and writes their
   * new values back to the engine, as an evaluation of the call does. A call
   * that throws writes nothing.
   *
   * The `code` takes the value of each of these variables after the
   * arguments of the function, in this order, and returns an array: the
   * value of the function, then the new value of each variable. A host that
   * runs the code without the engine (`load()`) gives the values and keeps
   * the new ones itself.
   *
   * Absent when the function assigns no variable of the engine. Such a
   * result is not `shippable`.
   */
  assigns?: string[];

  /**
   * JavaScript only. The functions of the host that the compiled code
   * calls: functions declared with `ce.declare()` and an `evaluate`
   * function, such as `ce.declare("hostDraw", { signature: "(real) ->
   * nothing", evaluate })`.
   *
   * Each call in the code evaluates the call in the engine, as the
   * interpreter does, at each evaluation of the call and in the order of
   * the program. The code reads the engine for these calls, so `load()` and
   * the batch loaders refuse it, and such a result is not `shippable`.
   *
   * Absent when the code calls no function of the host.
   */
  hostCalls?: string[];

  /**
   * Operator heads in the expression that this target cannot lower — they have
   * no operator or function mapping and are not one of the structural forms the
   * compiler handles directly. An empty array means every operator was
   * lowerable.
   *
   * It is set on the result of `compile()`, including its `success: false`
   * fallback.
   *
   * The list of a result with `success: true` is always empty. A name that
   * the expression binds (a local function, a parameter of a function
   * literal, an index) is never in the list: when a call of such a name
   * declines (`(f) ↦ f(2)` calls a function value, which compiled code does
   * not do), the `error` and the `diagnostic` name it.
   *
   * On a decline, the interpreter fallback also adds to this list the names
   * of the inputs whose static type is `unknown` or `any` (diagnostic code
   * `'untyped-input'`), also when another reason declines first, so that the
   * host learns which inputs to declare. For the code `'unsettled-shape'`, it
   * adds the node that has no settled shape, as `toString()` writes it.
   */
  unsupported?: string[];

  /**
   * Facts about a SUCCESSFUL compilation that the caller may need to decide
   * whether to use the code, with the same shape as `diagnostic` (which is
   * set on a decline only). Nothing was withdrawn: the code is complete.
   * `kind: 'correctness'` here means that a value the code computes can
   * differ from the exact value.
   *
   * On the shader target, one code: `'float32-unsafe-argument'`. The code
   * has a `Mod` or `Fract` operand in which a constant of magnitude 1000 or
   * more multiplies a trigonometric call, so its float32 value can have no relation to the exact value: a sine hash such
   * as `fract(43758.5453·sin(12.9898·x))` draws noise of a different pattern
   * from the `javascript` target. `value` is the operand, as `toString()`
   * writes it. A caller that needs the value (a curve the hash positions)
   * computes the expression on the CPU; one that only needs a texture can
   * keep the shader. One entry per flagged operand; an operand in code that
   * the compilation emitted and then removed (a folded call, an unused
   * definition) is not reported.
   *
   * Absent when there is nothing to report.
   */
  warnings?: CompileDiagnostic[];

  /**
   * When `success` is `false`, a human-readable reason the expression could not
   * be compiled to the target (e.g. `Unknown operator \`SinIntegral\``).
   */
  error?: string;

  /**
   * When `success` is `false`, the structured form of `error`: a stable
   * `code`, the decline `kind` (`'capability'` — nothing compilable was lost
   * that was ever computed right; `'correctness'` — a value that would have
   * been computed wrongly is withdrawn) and, for a lane mismatch, the
   * boundary and a user-legible binding name. `error` stays a string. Set by
   * the built-in targets on every decline.
   */
  diagnostic?: CompileDiagnostic;

  /**
   * The arithmetic discipline the returned code was compiled under —
   * `'strict'`, `'complex'` or `'bigint'`: the requested mode, or `'strict'`
   * when none was requested. Set by the built-in targets on every result. See
   * `CompileMode`. A declined compilation reports `'strict'`, in every mode.
   *
   * **Not a lane oracle, and not a shader-portability test.** An operand that
   * is complex-typed — a `complex`/`imaginary`-typed symbol, a `Complex(…)`
   * literal, `ImaginaryUnit` — routes through the complex kernel in EVERY
   * discipline: compiling `3 + 2i` with `mode: 'strict'` emits
   * `({ re: 3, im: 2 })` and reports `'strict'`. `mode: 'strict'` therefore
   * does NOT guarantee the emitted code is free of `{re, im}` arithmetic.
   *
   * `mode` describes the EMISSION, not the shape of a returned value: a
   * compile that reports `'complex'` can still hand back a plain real number
   * whenever the imaginary part of the result is exactly zero. The only sound
   * per-sample test of a returned value's shape is `typeof v === 'number'`.
   */
  mode?: 'strict' | 'complex' | 'bigint';

  /**
   * Library/helper code that must be included before the compiled `code`.
   *
   * For targets like `interval-js`, this contains the interval arithmetic
   * library (helper functions, etc.) that the compiled expression references.
   */
  preamble?: string;

  /**
   * JavaScript only. The definitions of `preamble` that read nothing per call
   * (a constant list, a memo), which `run()` evaluates once. A runtime that
   * loads the stored code does the same: evaluating them on every call
   * rebuilds each constant on every sample.
   */
  preambleOnce?: string;

  /**
   * JavaScript only. The rest of `preamble`, evaluated on every call; set with
   * `preambleOnce`.
   */
  preamblePerCall?: string;

  /**
   * JavaScript lambdas only, with `preambleOnce`. `code` without the
   * once-only definitions: the function the runtime calls.
   */
  callCode?: string;

  /**
   * How `run` should be called (present only for executable targets).
   * - `'expression'` — call with a vars object: `run({ x: 0.5 })`
   * - `'lambda'` — call with positional args: `run(0.5, 1.0)`
   */
  calling?: 'expression' | 'lambda';

  /** Executable function (present for JS-executable targets only). */
  run?: CompiledRunner<R, V>;

  /**
   * JavaScript only, on a result called with a vars object. The count of
   * numbers `broadcast()` writes per cell by default: present when the
   * expression's type is a tuple of two or more elements that can be
   * numbers (`(i, 2i)` gives 2); an element typed `unknown` counts, so
   * `(x, y)` with undeclared `x` and `y` gives 2 too. Absent otherwise (one
   * number per cell). A runtime that rebuilds the
   * stored result (`loadBroadcast()`, a kernel worker) uses it as the same
   * default. `BroadcastOptions.outputs` overrides it.
   */
  broadcastOutputs?: number;

  /**
   * A second body that `broadcast()` runs in place of `code` when each
   * shared list it reads directly passes a check made once per batch. A
   * runtime that rebuilds a stored result (`loadBroadcast()`, a kernel
   * worker) runs it when the stored result has one. `compile()` does not
   * set it in this release. See {@link StoredBatchBody}.
   */
  batch?: StoredBatchBody;

  /**
   * Evaluate the compiled function at many points in one call. Present on a
   * `javascript` or `interval-js` result called with a vars object
   * (`calling: 'expression'`). `inputs` maps each free variable to a
   * `Float64Array` (one value per cell; a `lo, hi` pair per cell for
   * `interval-js`) or to one number for every cell, and a list input to a
   * shared input, bound once for the batch (`interval-js`: a plain array of
   * numbers and `{ lo, hi }` objects, not a `Float64Array`). The result is a
   * `Float64Array`: one value per cell (`outputs` values per cell for a
   * tuple), or a `lo, hi, kind` triple per cell with the `INTERVAL_KIND`
   * codes. Cell for cell, the value is the one `run()` gives. The input
   * layout, the output encoding and the error rules are in
   * `compilation/broadcast.ts`.
   */
  broadcast?: (
    inputs: BroadcastInputs,
    options?: BroadcastOptions
  ) => Float64Array;

  /**
   * `broadcast` through the engine's worker pool (`ce.workers`), or inline in
   * slices between yields to the event loop when there is no pool or the
   * batch is small. Takes the same inputs, plus a `signal`, a `deadline` and
   * a `chunk` size, and resolves to the output and the count of leading cells
   * that are valid. Present where `broadcast` is. See `kernel-pool.ts`.
   *
   * Every cell is evaluated after the call returns: on the calling thread,
   * the batch yields to the event loop (a macrotask turn) before its first
   * slice and between two slices. The result also says where the batch ran
   * (`route`) and, when the pool did not take it, why (`reason`). The
   * option `inline: false` refuses the calling thread.
   */
  broadcastAsync?: (
    inputs: BroadcastInputs,
    options?: BroadcastAsyncOptions
  ) => Promise<BroadcastAsyncResult>;

  /**
   * Whether the code of this result can run on a worker of the pool (a
   * kernel pool loads it): `false` when the code depends on the thread that
   * compiled it (a random draw, which follows the engine's random stream
   * and entropy handler; a `vars` entry that is not a read of the inputs
   * object; an input of a value kind on `interval-js`), and for code that
   * integrates. `broadcastAsync()` of a result that is not shippable runs
   * on the calling thread. Present on every successful `javascript` and
   * `interval-js` result, also on a function literal, which has no
   * `broadcastAsync`.
   */
  shippable?: boolean;

  /**
   * **Experimental.** `'ir'` on every successful compilation, with or
   * without the option `profile` (`CompilationOptions.profile`). Absent on
   * a decline.
   */
  profile?: 'ir';

  /**
   * Whether `broadcastAsync()` would send a batch of `cells` cells to the
   * engine's worker pool now, or keep it on the calling thread. It reads the
   * pool (`ce.workers`) and the inline threshold at the time of the call:
   * the threshold is 20 000 cells until the result has run a batch on the
   * calling thread, then the count of cells that take about 10 ms there. For
   * an `interval-js` result, `cells` is the count of intervals, not the
   * length of the input array. `true` is the decision for the batch, not a
   * promise of its route: a worker can still fail during it
   * (`reason: 'pool-declined'`). Present where `broadcastAsync` is.
   */
  willUsePool?: (cells: number) => boolean;

  /**
   * Run the program as `run(inputs)` does, and send each `parallel for`
   * that can run on the engine's worker pool (`ce.workers`) to the pool: the
   * passes of the loop are split into one sub-range of consecutive passes
   * for each worker, each worker adds the terms of its passes to zero, and
   * the calling thread adds these partial sums to the accumulators, in the
   * order of the sub-ranges. Present on a `javascript` result called with a
   * vars object (`calling: 'expression'`).
   *
   * The promise resolves to the value of `run(inputs)`, except that the
   * terms of an accumulator are added in another grouping: an accumulator
   * of integers whose values and partial sums stay within ±2^53 has the
   * value of `run()`; one of real numbers can differ from it, usually in the
   * last bits, by an amount that depends on the count of workers (for one
   * pool size, every run gives the same bits). The inputs are checked and
   * the value converted as `run()` does; an error of the program rejects the
   * promise (an error of a pass on a worker is the error that `run()` gives,
   * since the calling thread runs that sub-range again), and the call never
   * throws.
   *
   * A loop can run on the pool when the compiler finds, after its passes:
   * each value that the loop carries a number to which the passes only add
   * (`+=`, also under an `if`, in an inner `for`, or more than once in a
   * pass), and each list that they write a list of numbers declared outside
   * the loop to whose elements they only add (`L[i] += e`), with no other
   * read of these accumulators; the loop at a statement of the program, or
   * of a user function that the program calls outside a callback, a
   * comprehension or another `parallel for` (also inside an `if` or a
   * `for`); a body that reads no name of the `vars` option and
   * computes no numeric integral; the default mode and no
   * `iterationBudget`. Every other loop runs in order, as `run()` runs it.
   * At run time, the loop goes to the pool when the pool is usable, the call
   * is not inside `ce.withStepBudget()`, the count of passes is at least
   * `options.minPasses`, and the private lists of all workers together hold
   * at most 16 million numbers. A worker stops at the deadline of the frame
   * that is current at the call (`ce.withTimeLimit()`), and the promise then
   * rejects with that frame's `CancellationError`.
   *
   * The calling thread is free only while the program waits for the
   * workers. The host must not change `inputs`, or an array that it holds,
   * until the promise settles: the program reads them after a wait, and
   * the value is otherwise unspecified. A program with no loop that can run
   * on the pool runs `run(inputs)`.
   */
  runAsync?: (
    inputs?: Record<string, unknown>,
    options?: RunAsyncOptions
  ) => Promise<unknown>;

  /**
   * Whether `runAsync()` would send a `parallel for` of this program to the
   * pool now: the program has a loop that can run on the pool (also inside
   * a function that it calls), the engine has a usable pool (`ce.workers`),
   * the call is not inside `ce.withStepBudget()`, and `passes`, when it is
   * given, is at least `minPasses` (default 20 000; a value that is not a
   * positive integer throws a `TypeError`). It does not check the size limit
   * of the private lists, the signal or the deadline, and a worker can still
   * fail later. Present where `runAsync` is.
   */
  willParallelize?: (passes?: number, minPasses?: number) => boolean;
} & (T extends ExecutableTarget
  ? { calling: 'expression' | 'lambda'; run: CompiledRunner<R, V> }
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {});
