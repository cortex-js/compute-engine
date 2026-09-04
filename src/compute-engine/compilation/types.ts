import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Type } from '../../common/type/types.js';
import type { Interval, IntervalResult } from '../interval/types.js';

/**
 * Source code in the target language
 */
export type TargetSource = string;

/**
 * A caller-supplied implementation for one operator, as accepted by the
 * `functions` compile option.
 *
 * The bare spellings — target source text, or a JavaScript function — remain
 * the common form and behave as they always have: whether the implementation
 * is pure is INFERRED from its source, never assumed. The descriptor form adds
 * an explicit declaration for the cases inference cannot reach.
 *
 * Purity here means "calling this has no observable effect beyond its return
 * value". It decides whether a compiled `Sum`/`Product` may stop early once
 * its accumulator has become NaN: the sum's value is settled at that point, so
 * the only thing running the remaining terms preserves is this function's side
 * effects. A declared `pure: true` is believed rather than checked, so
 * asserting it for a function that draws, logs or counts will drop calls to it.
 */
export type CompiledFunctionEntry =
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  | TargetSource
  | ((args: unknown[]) => unknown)
  | {
      /** The implementation: target source text, or a JavaScript function. */
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      source: TargetSource | ((args: unknown[]) => unknown);
      /**
       * Whether calling this has no observable effect beyond its return value.
       * Omitted, it is inferred from the source; asserted, it is believed.
       */
      pure?: boolean;
    };

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
 *   every target.
 * - `'complex'` — a wide numeric binding is complex-shaped and lifted at use;
 *   unknown-sign radicals/logarithms promote. Always sound, only slower.
 * - `'auto'` — `strict` plus promotion of the unknown-sign radicals, and on
 *   a `LaneMismatch` the compilation is redone once in `complex` mode.
 *
 * All three are implemented, and `'auto'` is the default of the `javascript`
 * and `python` targets: an unknown-sign radical promotes with no opt-in, a
 * lane mismatch declines, and that decline redoes the compilation once under
 * `'complex'`. Which discipline the returned code was compiled under is
 * reported on the result (`CompilationResult.mode`, never `'auto'`).
 */
export type CompileMode = 'strict' | 'complex' | 'auto';

/**
 * Which of the two kinds of compile decline a diagnostic reports:
 *
 * - `'capability'` — a compilable thing that this target or mode cannot
 *   lower (an unsupported operator, a mode the target does not offer, a
 *   comparison over a statically non-real operand). Nothing wrong was ever
 *   computed; the expression simply has no compiled value here.
 * - `'correctness'` — a value the compiler could have computed incorrectly is
 *   withdrawn instead (a complex-shaped value meeting a real-shaped binding).
 *
 * A consumer counting declines must keep the two apart: the second kind is
 * a fix, not a regression.
 */
export type CompileDiagnosticKind = 'capability' | 'correctness';

/**
 * A structured compile decline, carried on `CompilationResult.diagnostic`
 * beside the human-readable `error` string (which stays a string: it is
 * interpolated into warning messages).
 *
 * - `code` — a stable machine-readable identifier: `'lane-mismatch'`,
 *   `'unsupported-mode'`, `'compile-error'` (the generic fail-closed
 *   decline), ….
 * - `kind` — see `CompileDiagnosticKind`.
 * - `message` — the human-readable reason (same text as `error`).
 * - `boundary` — for a lane mismatch, the binding boundary that refused
 *   ("user-function parameter", "Block local", …).
 * - `binding` — a USER-LEGIBLE name for the binding: an authored identifier
 *   (the parameter `x` of `b`, the local `k`) or an honest description ("the
 *   accumulator of the `Reduce`") — never a compiler-internal temporary.
 * - `value` — the LaTeX of the complex-shaped expression that reached it.
 */
export type CompileDiagnostic = {
  code: string;
  kind: CompileDiagnosticKind;
  message: string;
  boundary?: string;
  binding?: string;
  value?: string;
};

/**
 * Compile a sub-expression of the construct a handler is lowering.
 *
 * `opIndex` is the operand index the sub-expression sits at in the construct's
 * own operand list. A handler lowering a construct with conditionally evaluated
 * operand positions (the `LAZY_OPERANDS` inventory in `cse.ts`) passes it for
 * those positions, so the CSE pass can push the matching region instance. It
 * is optional: a handler that omits it
 * the sub-expression simply inherits the enclosing region.
 */
export type OperandCompiler<Expr = unknown> = (
  expr: Expr,
  opIndex?: number
) => TargetSource;

/**
 * A compiled function that can be executed
 */
export type CompiledFunction<Expr = unknown> =
  | string
  | ((
      args: ReadonlyArray<Expr>,
      compile: OperandCompiler<Expr>,
      target: CompileTarget<Expr>
    ) => TargetSource);

/**
 * Mapping of operators to their target language representation and precedence
 */
export type CompiledOperators = Record<
  MathJsonSymbol,
  [op: string, prec: number]
>;

/**
 * Mapping of function names to their target language implementation
 */
export type CompiledFunctions<Expr = unknown> = {
  [id: MathJsonSymbol]: CompiledFunction<Expr>;
};

/**
 * Per-compilation state for names generated by `tempVar()`
 * temporaries `_tv1`, `_tv2`, …).
 *
 * Always present, on every target and every language: two `compile()` calls on
 * one expression must emit byte-identical source, which a random name cannot
 * give. Created at each root compilation boundary (each target's
 * `createTarget()`; `compile-expression.ts` for the direct custom-target
 * route) and held as a SHARED OBJECT REFERENCE on `CompileTarget.naming`, so
 * it survives the `{ ...target }` spreads used while recursing;
 * scalar fields would fork and two branches would then allocate the same name.
 */
export type NamingContext = {
  /** How many generated names have been allocated. Names are positional
   * (`_tv1`, `_tv2`, …), so a fresh context restarts at `_tv1`. */
  counter: number;

  /**
   * The names this compilation must not generate: every symbol name of the
   * compiled expression, plus any `_tv`/`_cse`-prefixed identifier token
   * appearing in caller-supplied source (`functions` strings, string-valued
   * `vars`, `preamble`). Neither prefix is reserved — MathJSON accepts
   * underscore-initial symbols, and a lambda parameter or `Block` local named
   * `_tv1` emits as a bare identifier — so a generated name that appears here
   * is skipped rather than assumed unique.
   *
   * Mutable: engine-internal per-compilation state, added to in place as
   * nested trees (a user-function definition body) join the artifact.
   */
  usedNames: Set<string>;
};

/**
 * One emission-time instance of a static CSE region.
 *
 * Static regions describe the tree; instances exist while code is emitted. The
 * distinction is load-bearing for every re-entrant emission of shared
 * structure: an unrolled `Sum` compiles the same body node objects once per
 * index value, so a bare node-keyed map would emit iteration 1's temporary for
 * every later iteration (silent wrong values). Each such emission pushes a
 * fresh instance, so bindings can never leak to a context where they are not
 * in scope.
 *
 * ## Why the analysis types are opaque here
 *
 * `region`, and the keys of `state`/`names`, are the `CseRegion` /
 * `CseCandidate` of `cse.ts`, kept structurally opaque (`object`) in this
 * module: `compilation/types.ts` is expression-type-free by design — an import
 * reaching `global-types` would close a module cycle (the zero-cycle invariant
 * in `ARCHITECTURE.md`) — and `cse.ts`'s types are built on
 * `Expression`. `BaseCompiler`, the only consumer, narrows them; nothing else
 * inspects these fields.
 */
export type CseRegionInstance = {
  /**
   * The static region this instance realizes (a `CseRegion`), or `undefined`
   * for a **blind** instance — one pushed because emission entered a binding
   * scope the CSE wiring does not know about (a binder body with no push/pop
   * site). A blind instance resolves no candidate, so the subtree simply
   * compiles without CSE: unknown territory degrades to the pre-CSE emission,
   * never to a capture.
   */
  readonly region: object | undefined;

  /** Temporaries bound at this instance, in dependency order. */
  readonly bindings: Array<[name: string, code: string]>;

  /** Per-candidate (`CseCandidate`) occurrence state (§6.1). */
  readonly state: Map<object, 'defining' | 'bound'>;

  /** The temp name allocated for each `'bound'` candidate. */
  readonly names: Map<object, string>;

  /**
   * The `boundVars` of the target this instance was pushed under. Emission
   * reaching a target with a DIFFERENT set has entered a binding scope this
   * instance does not describe, and pushes a blind instance instead.
   */
  readonly boundVars: ReadonlySet<string> | undefined;
};

/**
 * Per-compilation CSE state. Present on every compilation of a target that can
 * bind temporaries
 * (`cseBind`); `enabled: false` when the caller passed `cse: false`, when the
 * target has no `cseBind`, or on the direct custom-target route (which gets no
 * CSE).
 *
 * Like `NamingContext`, this is a SHARED OBJECT REFERENCE on the target
 * (`CompileTarget.cse`), so it survives the compiler's pervasive
 * `{ ...target }` spread copies; scalar fields would fork.
 */
export type CseSession = {
  /** `false` ⇒ every CSE hook is inert and emission is unchanged. */
  enabled: boolean;

  /**
   * The static harvest of the tree currently being emitted (the `CseHarvest`
   * of `harvestCse`, opaque here — see `CseRegionInstance`). Swapped for a
   * nested harvest while a user-defined function's body is emitted —
   * own regions and candidates, same session and naming counter.
   */
  harvest?: object;

  /**
   * The provenance predicates used by this compilation's harvest. Kept on the
   * session because the nested harvest of a user-defined function's body runs
   * after the boundary that knew the caller's override
   * key sets. (Structurally a `CseHarvestOptions`; the thresholds it also
   * accepts are defaulted.)
   */
  harvestOptions?: {
    isOverriddenOperator?: (name: string) => boolean;
    isStringVar?: (name: string) => boolean;
    isVarsKey?: (name: string) => boolean;
    /** Names an admission decision may not resolve globally (enclosing
     * binder/parameter names). */
    shadowedNames?: ReadonlySet<string>;
  };

  /** The emission-time region instance stack, innermost last. */
  instances: CseRegionInstance[];

  /**
   * The lowest index of `instances` whose bound temporaries the code being
   * emitted can reference (default `0`). A user-defined function's body is
   * emitted as a module-level preamble definition, OUTSIDE the wrappers of
   * the instances that were on the stack when its emission began, so while
   * it is emitted the floor is raised to its own root instance: a temporary
   * bound below the floor is in scope for the call site, not for the
   * definition.
   */
  availabilityFloor?: number;
};

/**
 * Target language compilation configuration
 */
export interface CompileTarget<Expr = unknown> {
  /** Get operator representation for the target language */
  operators?: (op: MathJsonSymbol) => [op: string, prec: number] | undefined;

  /** Get function implementation for the target language */
  functions?: (id: MathJsonSymbol) => CompiledFunction<Expr> | undefined;

  /** Get variable representation for the target language */
  var: (id: MathJsonSymbol) => string | undefined;

  /**
   * Get the target's inlined spelling of a mathematical CONSTANT, or
   * `undefined` when the target has no constant by that name.
   *
   * This is deliberately narrower than `var`, and the two must not be
   * conflated. `var` is the general variable emitter: for a symbol it does not
   * recognize it falls back to a reference into the caller-supplied variables
   * object (`_.x` on the JavaScript target), so `var(id) !== undefined` is
   * true for EVERY symbol and says nothing about whether the symbol is an
   * input. This lookup answers only from the target's own constants table, so
   * a defined result means the symbol is baked into the emitted code and is
   * not an input the caller has to supply.
   *
   * That distinction is what the reference analysis behind
   * `CompilationResult.freeSymbols` needs: without it, a constant the target
   * inlines but the engine holds no value for is reported as a required input
   * (`Which(x > 0, 1, True, 2)` listed a phantom variable named `True`).
   *
   * Optional because `CompileTarget` is public: a target written outside this
   * repo keeps working without it, and simply does not get constants filtered
   * out of its free-symbol list.
   */
  constant?: (id: MathJsonSymbol) => string | undefined;

  /** Format string literals for the target language */
  string: (str: string) => string;

  /**
   * Format a CHARACTER literal (exactly one UAX #29 grapheme cluster) for the
   * target language, or `undefined` when the target cannot represent one.
   *
   * A character is not simply a short string: every operation that consumes one
   * — ordering by code-point sequence, segmenting a string into characters,
   * counting them — needs grapheme-cluster awareness the target may not have.
   * A target that omits this makes every character-valued expression fail
   * closed, which is why it is a separate capability from `string` rather
   * than a reuse of it: Python has string literals but no stdlib grapheme
   * segmentation, and GLSL/WGSL have no text at all.
   */
  character?: (str: string) => string;

  /** Format numeric literals for the target language */
  number: (n: number) => string;

  /** Format a complex numeric literal for the target language.
   *  Only called when the imaginary part is non-zero. */
  complex?: (re: number, im: number) => string;

  /** Format whitespace for the target language */
  ws: (s?: string) => string;

  /** Code to be inserted at the beginning of the compiled output */
  preamble: string;

  /** Current indentation level */
  indent: number;

  /** Format a variable declaration. Default: `let ${name}`.
   *  `typeHint` is an optional target-language type string (e.g. `'vec2'`)
   *  inferred from subsequent assignments. */
  declare?: (name: string, typeHint?: string) => string;

  /** Format a block expression. Receives compiled statements; the last
   *  element is the block's return value (without `return` prefix).
   *  Default: JavaScript IIFE. */
  block?: (statements: string[]) => string;

  /**
   * The infix operator used to conjoin the pairs of a chained relational
   * expression (e.g. `Less(a, b, c)` → `(a < b) && (b < c)`). Default: `'&&'`
   * (JavaScript / GLSL / WGSL). Word-operator targets set this to their
   * language keyword (e.g. Python `'and'`), so the emitted source is valid in
   * that language.
   */
  chainOp?: string;

  /**
   * Bind one or more values to fresh temporaries in expression position, then
   * evaluate `body` with those temporaries in scope, returning target source
   * that is itself an expression. Used to evaluate a sub-expression exactly
   * once when it would otherwise be spliced in multiple times — e.g. the shared
   * middle operand of a chained relation `Less(a, m, b)` → `(a < m) && (m < b)`,
   * where `m` must be drawn once (matching the interpreter) even if it is a
   * non-deterministic `Random()` call.
   *
   * Targets that cannot express a value binding in expression position (GPU
   * shaders) leave this undefined; the compiler then falls back to inlining the
   * sub-expression — safe when it is deterministic, the only case those targets
   * support (their `Random` requires an explicit deterministic seed).
   *
   * JavaScript emits an IIFE; Python a `lambda`.
   */
  bindExpr?: (
    bindings: Array<[name: string, value: string]>,
    body: string
  ) => string;

  /**
   * Bind a **dependency-ordered** list of temporaries around an
   * expression-position body: each temporary is evaluated exactly once, and
   * later right-hand sides — and the body — may reference earlier ones. The
   * compile-time common-subexpression elimination pass wraps each region's
   * compiled body with this. **Absent ⇒ CSE is inactive for this target** (the
   * GPU shader targets, whose driver compilers already CSE pure expressions).
   *
   * Deliberately NOT the existing `bindExpr`: that one's parallel-application
   * shape (`((a, b) => body)(x, y)`) cannot express a temporary whose value
   * depends on an earlier temporary, which is exactly what nested candidates
   * produce.
   *
   * - **javascript / interval-js** — a sequential-`const` IIFE:
   *   `(() => { const _cse1 = …; const _cse2 = …_cse1…; return body; })()`.
   * - **python** — a flat sequential binding comprehension,
   *   `[body for _cse1 in [rhs1] for _cse2 in [rhs2]][0]`: later `for` clauses
   *   see earlier names, the nesting depth is constant (nested lambdas would
   *   grow with the candidate count and could break a previously-compilable
   *   expression), and each right-hand side evaluates exactly once.
   *
   * ## Emitter-author contract
   *
   * A construct with **conditionally-evaluated operand positions** — a value
   * arm behind a ternary, a short-circuited connective operand, a coalescing
   * default — needs an entry in the `LAZY_OPERANDS` inventory (`cse.ts`) plus a
   * conditionality test, AND its emitter must compile those operands through
   * `BaseCompiler.compileOp` (or pass the operand index to the `compile`
   * callback it was handed — see `OperandCompiler`). A missing entry is a
   * soundness bug: a temporary could be hoisted out of an arm that never runs.
   * A spurious entry only costs an optimization.
   */
  cseBind?: (
    bindings: ReadonlyArray<[name: string, code: string]>,
    body: string
  ) => string;

  /**
   * Per-compilation common-subexpression-elimination state — the static
   * harvest plus the emission-time region-instance stack. See `CseSession`: a
   * shared object reference, created once per root compilation boundary, that
   * survives the compiler's `{ ...target }` spreads. Absent (or
   * `enabled: false`) ⇒ emission is exactly the pre-CSE emission.
   */
  cse?: CseSession;

  /**
   * Lower a `Which`/`If` whose condition may be an indexed collection at run
   * time to the target's element-wise selection form (`np.select` semantics).
   * The clauses
   * arrive in `Which` shape (condition, arm, condition, arm, …); an `If` is
   * normalized to `[cond, then, True, else]` by the caller.
   *
   * Returns `null` when every condition is provably scalar: the base compiler
   * then emits its ordinary ternary chain, byte for byte, so a scalar
   * conditional is unaffected by the hook's presence. Throws to fail closed
   * on a shape the target cannot render.
   *
   * Consulted BEFORE the target's `functions` entry for the operator, for both
   * `If` and `Which`, so a target that defines both gets the hook first.
   *
   * The JavaScript target lowers to its runtime `_SYS.select`; the GPU shader
   * targets lower a statically shaped (`vec2`–`vec4`) condition to
   * boolean-vector masks combined with `mix`/`select`, and decline anything
   * with no static shape; interval-js implements it as a clean decline (the
   * interval domain is scalar — one interval per quantity — so it has no
   * element-wise selection convention). Targets that leave it undefined keep
   * the fail-closed scalar-condition guard.
   */
  selection?: (
    args: ReadonlyArray<Expr>,
    compile: OperandCompiler<Expr>,
    target: CompileTarget<Expr>
  ) => TargetSource | null;

  /**
   * Apply a `broadcastable` head's scalar element lowering across its single
   * collection operand (`Sin([1,2,3])`, `-[1,2,3]`, `1 + L`).
   *
   * `lowering.collection()` compiles the collection operand in the enclosing
   * target; `lowering.element(code)` re-invokes the head's OWN scalar codegen
   * with `code` spliced in as the (bare) element operand, so complex handling
   * and constant folding stay identical to the scalar path. The head need not
   * be unary: any SCALAR operand alongside the collection is spliced into the
   * element lowering at its own position, so a hook that fans out writes the
   * same spelling whatever the arity.
   *
   * Targets differ in KIND here, not just in syntax, which is why this is a
   * hook rather than a default: Python fans the scalar lowering out over the
   * elements (a list comprehension), while GLSL/WGSL do not fan out at all —
   * shader builtins and operators are already componentwise on a `vecN`, so
   * `lowering.element(lowering.collection())` (`sin(vec4(…))`, `-vec4(…)`) is
   * the correct lowering, gated on the operand having a static `vec2`–`vec4`
   * shape. (Before this hook the base compiler emitted a JavaScript
   * `.map((v) => …)` arrow into GLSL, WGSL and Python alike, behind
   * `success: true`.)
   *
   * Return `undefined` to decline; the base compiler then fails closed (D6)
   * naming the head and the target. A target may also throw to fail closed
   * with its own diagnostic (the GPU targets do, for a shape with no vector
   * lowering). The JavaScript target deliberately leaves this undefined: its
   * broadcasts are intercepted earlier by `_SYS.bcast`, and the only forms
   * that reach here are the complex-element operands its broadcast closure
   * documents as deferred.
   */
  broadcastUnary?: (
    head: MathJsonSymbol,
    operand: Expr,
    lowering: {
      /** The collection operand, compiled in the enclosing target. */
      collection: () => TargetSource;
      /** The head's own scalar codegen, applied to compiled source. */
      element: (code: TargetSource) => TargetSource;
    },
    target: CompileTarget<Expr>
  ) => TargetSource | undefined;

  /**
   * Inspect an emitted lowering — the head's own function codegen, or the
   * `name(args…)` call of a string-mapped helper — BEFORE it is spliced into
   * the output, and THROW to fail closed (D6) when the operand shapes are ones
   * that lowering cannot accept.
   *
   * The complement of `broadcastUnary`: that hook owns the single-collection
   * fan-out, this one covers every OTHER emission a non-scalar operand can
   * reach — a second operand (`Arctan2([1,2,3], 1)`), a matrix
   * (`Sin(Matrix(…))`), a head whose canonical form is not unary
   * (`Exp([1,2,3])` → `Power(e, […])`). The GPU targets implement it because
   * a shader has a static type system that such a lowering silently violates
   * (`atan(vec3, float)`, `pow(float, vec3)`, `sin(mat2)` are not valid source
   * in either language, but were emitted behind `success: true`); targets
   * whose runtime broadcasts or coerces leave it undefined and are unaffected.
   *
   * A hook, not a base-compiler rule, because the answer is a fact about the
   * target's TYPE SYSTEM: GLSL promotes a scalar into `max(genType, float)`
   * where WGSL does not, and the two disagree again on matrix arithmetic.
   */
  checkOperandShapes?: (
    head: MathJsonSymbol,
    args: ReadonlyArray<Expr>,
    code: TargetSource,
    target: CompileTarget<Expr>
  ) => void;

  /**
   * Wrap a compiled `Which`/`When` condition that is **not** provably boolean so
   * that a non-boolean value (notably `NaN`) fails closed at run time, matching
   * the interpreter — which throws `Condition must evaluate to "True" or
   * "False"` rather than silently taking the default branch. Only applied when
   * the source condition is not a relational/logical/boolean expression (the
   * common case emits a bare, unwrapped condition, so there is no overhead).
   *
   * Targets that cannot throw in expression position (GPU shaders) leave this
   * undefined; they instead keep the documented fail-closed value (the default
   * branch / NaN) — see the GPU `Which`/`When` handlers.
   */
  assertBoolean?: (code: string) => string;

  /**
   * Map a free (declarable) identifier to the source token emitted for it, or
   * **throw to fail closed (D6)** when the identifier cannot be represented in
   * the target — e.g. a GLSL/WGSL reserved keyword (`in`, `sample`, `filter`,
   * `texture`, …) used as a user variable name, which would emit a shader that
   * fails to compile. Applied by the base compiler only to the bare-symbol
   * fallback: a genuinely free symbol with no engine value and no `vars`
   * mapping. Default: identity.
   */
  mangleId?: (id: string) => string;

  /**
   * Called with the VALUE operand of every `Return` the base compiler emits
   * against this target. **Throw to fail closed (D6).**
   *
   * A target that bakes a STATIC return type into the signature it is emitting
   * (`userFunctions.lowering.staticReturnType` — the shader targets) needs the
   * value SHAPE of each `Return` to agree with that signature, and the shape of
   * a name is only knowable while the emitter's own local frames are pushed:
   * a `Return(z)` naming a `vec2` block-local reads as a scalar once
   * `compileBlock` has popped its frame. Hooking the emission is what puts the
   * check inside those frames.
   *
   * Absent on every other target: the JavaScript family declares no return
   * type, so a `Return` of any shape is valid there.
   */
  onReturn?: (value: Expr | undefined) => void;

  /**
   * When `true`, this target's multi-statement constructs (loop-form
   * `Sum`/`Product`, `Loop`, `Block`) are emitted as **bare statement
   * sequences** — valid only at statement position (a function body), never
   * as a sub-expression. GPU shader languages (GLSL/WGSL) set this: unlike the
   * JavaScript target, which wraps such constructs in an IIFE (a self-contained
   * expression), a shader has no expression-level loop or IIFE. The compiler
   * uses this flag to fail closed rather than splice a bare statement
   * block into the middle of an expression (which would emit invalid shader
   * source such as `return _acc; + 1.0`).
   */
  bareStatementBlocks?: boolean;

  /**
   * Statement-hoisting sink for a `bareStatementBlocks` target (GLSL/WGSL).
   *
   * A lowering that needs statements — the loop form of `Sum`/`Product` — can
   * push them here and return a plain expression naming the result, so the
   * construct composes: `1 + \sum_{k=0}^{n} kx` emits the loop ahead of the
   * `return` instead of failing closed. The emitter that owns
   * the enclosing statement position drains the sink — see
   * `BaseCompiler.compileStatementBody`.
   *
   * `boundVars` records the target's bound-variable set at the moment the sink
   * was installed. Hoisting a statement OUT of a binder scope would move code
   * that references the bound name (a loop body referencing its own index) to
   * where the name does not exist, so hoisting is legal only while
   * `target.boundVars === hoist.boundVars`. Every binder spreads a fresh
   * `boundVars` set into its inner target, which closes the sink automatically;
   * a binder that wants its body to hoist installs a fresh sink of its own
   * (`compileGPUBigOp` does, so nested loops compose too).
   *
   * Absent (`undefined`) on every other target: the JavaScript family wraps
   * multi-statement constructs in an IIFE, which is already an expression.
   *
   * One divergence to know about: a hoisted loop inside a conditional ARM runs
   * whichever branch is selected. That matches the GPU selection lowering,
   * which already computes every condition and arm (the domain is pure, so
   * this is a cost, not a semantic, difference) — and the alternative was
   * failing closed to the interpreter, which is slower still.
   */
  hoist?: {
    stmts: string[];
    boundVars: ReadonlySet<string> | undefined;
  };

  /**
   * When set, a cap on the trip count of emitted `Sum`/`Product` loops: a
   * loop whose iteration count would exceed the budget (including infinite
   * or `NaN` bounds) evaluates to `NaN` instead of running. Internal numeric
   * probes (the Richardson limit ladder) set this so a single compiled call
   * stays cheap enough for the engine deadline to be honored between calls;
   * it is never set on user-facing `compile()` paths, whose loops remain
   * unguarded (zero overhead).
   *
   * It also caps (floors, then truncates to) the `PointList` zip length on the
   * JavaScript target — a capped point list is truncated, not `NaN`-poisoned.
   */
  iterationBudget?: number;

  /**
   * Quadrature strategy for compiled definite integrals (`Integrate`).
   * `'adaptive'` (default) emits deterministic adaptive Gauss–Kronrod with an
   * automatic Monte-Carlo fallback on non-convergence; `'monte-carlo'` forces
   * the stochastic estimator. See `CompilationOptions.quadrature`.
   */
  quadrature?: 'adaptive' | 'monte-carlo';

  /**
   * The keys of the `vars` option (symbols the caller mapped to explicit
   * runtime inputs / uniforms). A `vars`-mapped symbol must never be folded to
   * a constant — it stays a live input. Consulted by the `Integrate` handler:
   * the antiderivative-first optimization resolves a definite integral to a
   * closed form via `evaluate()`, which *would* fold such a symbol, so it is
   * skipped when the integral references any `vars`-mapped symbol — and by
   * the compile-time constant folder (`BaseCompiler.tryConstantFold`), which
   * declines any subtree mentioning a `vars`-mapped symbol for the same
   * reason.
   */
  varsKeys?: ReadonlySet<string>;

  /**
   * Per-level subdivision count chosen by the OUTERMOST `Integrate` lowering
   * of the interval target for every integral in its subtree — see the
   * sizing model in `compileIntervalIntegrate`
   * (`interval-javascript-target.ts`). The outermost node measures its whole
   * subtree (how many `Integrate` nodes, how deeply they nest inside each
   * other's integrands) and picks one uniform count that keeps the total
   * work inside the evaluation budget; inner lowerings must USE this count
   * rather than re-measure their own smaller subtree, which would pick a
   * larger count and break the product bound. Set only on the targets the
   * outermost lowering hands to its integrand and bound compiles — sibling
   * integrals outside that subtree size themselves.
   */
  intervalQuadraturePieces?: number;

  /**
   * Per-level starting-panel count chosen by the OUTERMOST `Integrate`
   * lowering of the scalar `javascript` target for every integral in its
   * subtree — see the sizing model in `compileIntegrate`
   * (`javascript-target.ts`). One full inner quadrature runs per outer panel
   * node, so the starting counts multiply across the levels of an iterated
   * integral; the outermost node measures how deeply the `Integrate` nodes in
   * its subtree nest and picks one count that keeps the product in hand, and
   * inner lowerings must USE it rather than re-measure their own shallower
   * subtree, which would pick a larger count. Set only on the targets the
   * outermost lowering hands to its integrand and bound compiles — sibling
   * integrals outside that subtree size themselves.
   */
  quadratureInitialPanels?: number;

  /**
   * When `false`, disables compile-time constant folding: a pure subtree with
   * no free variables is normally evaluated at compile time and emitted as a
   * number or boolean literal (`Sum(Take(Map(_ ↦ _^2, 1..20), 10))` → `385`).
   * Defaults to enabled. Turn it off to inspect the structural lowering of a
   * constant expression (codegen tests do this) or to keep compile time
   * strictly proportional to expression size.
   */
  constantFold?: boolean;

  /**
   * The promotion of an unknown-sign `Sqrt`/`Ln`/`Log`/`Power` through the
   * complex kernels is now a property of the compile MODE (`mode`: `auto`,
   * the default on JavaScript/Python, and `complex` promote; `strict` never
   * does). Both public routes into a compilation — the engine-level
   * `compile()` and a registered target's own `compile()` — map the
   * deprecated caller option onto `mode` and clear it, so they never set this
   * field.
   *
   * A target that sets it BY HAND still gets the promotion, and that is the
   * one remaining way the deprecated flag can outvote an explicit discipline:
   * `BaseCompiler.promotionActive` reads this latch with `||` against the
   * mode, so a hand-built target carrying `complexPromotion: true` promotes
   * even under `mode: 'strict'`. Set `mode` instead.
   *
   * @deprecated Superseded by `mode`. Use
   * `mode: 'complex'` — or the default `auto` — rather than this field.
   */
  complexPromotion?: boolean;

  /**
   * The compile mode requested for this compilation (`CompileMode`). Set by
   * the built-in targets from the caller's `mode` option, and by the direct
   * custom-target route (`compile(expr, { target })`), which records the
   * resolved effective mode here per call — like `constantFold` and
   * `complexPromotion`, an omitted option resets the field, so a reused
   * caller target never carries a previous call's choice. Read ONCE, at the
   * outermost compilation (`BaseCompiler.compile` at depth 0), where it is
   * validated against `supportedModes` — a requested mode the target does
   * not offer is a `capability` decline (`code: 'unsupported-mode'`), never a
   * silent coercion — and latched for the whole compilation as
   * `BaseCompiler.mode`. Absent ⇒ the target's default: `'auto'` when
   * `supportedModes` includes it, else `'strict'`.
   */
  mode?: CompileMode;

  /**
   * The compile modes this target offers (default `['strict']`). The built-in
   * `javascript` and `python` targets declare all three; `interval-js`,
   * `glsl` and `wgsl` declare `['strict']` (intervals are real; a shader has
   * one static shape per value). A custom target that declares `'complex'`
   * or `'auto'` must also provide `complexLift` and `complexIsReal` (checked
   * when the target is passed to `compile()`); a DIRECT target additionally
   * needs `reset()` for `'auto'` to be offered — without it a requested
   * `'auto'` resolves to `'strict'` (there is no fresh-state retry to run).
   */
  supportedModes?: readonly CompileMode[];

  /**
   * The idempotent number → complex lift, as target source: given code for a
   * value that may be a plain number or already complex, return code that
   * yields the complex representation (`_SYS.cplx(x)` on JavaScript,
   * `complex(x)` on Python). Required of a target that offers `'complex'` or
   * `'auto'`; complex mode lifts every wide numeric operand AT ITS USE
   * through this hook.
   */
  complexLift?: (code: TargetSource) => TargetSource;

  /**
   * The runtime realness test, as target source: given code for a value that
   * may be complex, return a boolean expression that is true when its
   * imaginary part is exactly zero. Required of a target that offers
   * `'complex'` or `'auto'`; the runtime rule for ordering comparisons and
   * integer-only heads over a maybe-complex operand is emitted through it.
   */
  complexIsReal?: (code: TargetSource) => TargetSource;

  /**
   * The real projection of a value that may be complex, as target source:
   * given code for a value that is a plain number or a `{re, im}` object,
   * return code yielding the number itself or the object's real part
   * (`_SYS.creal(x)` on JavaScript, `complex(x).real` on Python). Used with
   * `complexIsReal` by the D2/D6 runtime rule: under the guard that the
   * imaginary part is exactly zero, the real lowering runs on this
   * projection. Optional; a target without it keeps the compile-time
   * fail-closed decline for a maybe-complex operand of a real-only head.
   */
  complexReal?: (code: TargetSource) => TargetSource;

  /**
   * The ELEMENT-WISE real projection, as target source: given code for a
   * value that is a plain number, a `{re, im}` object, or a (possibly
   * nested) array of such values, return code yielding the same shape with
   * every exactly-real element replaced by its real part and every other
   * element by the target's NaN (`_SYS.crealElements(x)` on JavaScript,
   * `_ce_creal_elems(x)` on Python). Used by the element-wise form of the
   * D2/D6 runtime rule: a real-only head over an array operand whose
   * elements may be complex (`⌊√L⌋`, `min(√L)`, `√L < 1`) runs its real
   * lowering over this projection, so a complex element yields NaN (or
   * `false`, for an ordering) at its own position and nowhere else.
   * Optional; a target without it keeps the compile-time fail-closed
   * decline for such an operand.
   */
  complexRealElements?: (code: TargetSource) => TargetSource;

  /**
   * The conditional the D2/D6 runtime rule is emitted through, in the
   * target's own syntax: `guards` are boolean source expressions (each a
   * `complexIsReal` test; possibly empty — then the body is unconditional),
   * `body` the real lowering, and `kind` the shape of the value when a guard
   * fails: `'boolean'` → the target's `false`, `'number'` → its NaN.
   * JavaScript emits `((g1 && g2) ? (body) : NaN)`, Python `((body) if (g1
   * and g2) else float('nan'))`. Required, with the three hooks above, for a
   * target that offers `'complex'` or `'auto'`; a target without it keeps the
   * compile-time fail-closed decline for a maybe-complex operand of a
   * real-only head.
   */
  realGuard?: (
    guards: ReadonlyArray<TargetSource>,
    body: TargetSource,
    // The failing branch must have the SAME shape the head returns when the
    // guard passes — a caller destructuring the result must never see the
    // shape flip at runtime on data. `'number'` → the target's NaN,
    // `'boolean'` → the target's false, `{ array: n }` → an n-element
    // NaN-filled array (the color constructors return `[L, C, H]` /
    // `[L, C, H, a]`, so their guard emits `[NaN, NaN, NaN(, NaN)]`).
    kind: 'boolean' | 'number' | { array: number }
  ) => TargetSource;

  /**
   * Drop everything a failed compilation attempt wrote to this target
   * (helper preamble, emitted user-function definitions, temporaries, bound
   * frames). Required of a DIRECT (caller-owned, reusable) target for
   * `'auto'` to be offered: an escalation recompiles on fresh state, and a
   * target reused across the retry would otherwise carry the failed
   * attempt's output into the second emission. Registered targets are
   * constructed per compilation and need no hook.
   */
  reset?: () => void;

  /**
   * The most elements a constant COLLECTION may inline to when it is
   * constant-folded — an INCLUSIVE maximum, so a collection of exactly this
   * size still inlines. Defaults to 49, matching the JavaScript `Range`
   * handler's `len < 50`: a source-SIZE trade-off, appropriate where both
   * emissions exist.
   *
   * A target sets this when that trade-off does not describe it. On the
   * shader targets a dynamic collection has no lowering at all, so for a
   * constant one the inline literal is the only emission that can compile:
   * the number is a capability limit rather than a compactness choice, and
   * they set it to the same 256 their own `Range` handler already inlines to,
   * keeping one limit per target instead of two that can disagree. Stating
   * the field as an inclusive maximum is what lets each target reuse its own
   * number directly rather than translating it by one.
   */
  maxInlineElements?: number;

  /**
   * Operator/function names whose emission the CALLER overrode (the `functions`
   * and record-form `operators` compilation options). A constant subtree that
   * mentions such a name — as an application head or as a value-position
   * symbol — must not be constant-folded: folding evaluates through the
   * ENGINE's definition, which may disagree with the caller's custom runtime
   * implementation. A caller-supplied `operators` FUNCTION is opaque (its
   * covered names cannot be enumerated), so targets disable folding outright
   * (`constantFold: false`) in that case rather than populate this set.
   */
  foldExcludedOps?: ReadonlySet<MathJsonSymbol>;

  /**
   * The set of names currently **bound** by an enclosing binding form — lambda
   * parameters, `Sum`/`Product`/`Loop` indices, `Block` locals, comprehension
   * variables, `Match` captures. A bound name shadows any same-named engine
   * symbol (including a user-defined function), so a value-position reference to
   * it must NOT be captured as a free user-function reference (`_fn_f`). This is
   * tracked EXPLICITLY (rather than inferred from whether the name resolves to
   * its own identifier) because a binding form may resolve a bound name to
   * non-identity code — a numeric literal in an unrolled `Sum`, an
   * `_IA.point(i)` wrap in the interval target, a `subject[i]` accessor in a
   * `Match` case. See `BaseCompiler.withBoundNames` and finding A2.
   */
  boundVars?: ReadonlySet<string>;

  /**
   * The bound names that hold a SEQUENCE rather than a single value, each
   * mapped to the accessor code it resolves to: the `...rest` a list or tuple
   * pattern binds, which the interpreter wraps as a `Sequence` that splices
   * into whatever holds it (`[h, ...t] => [t]` is the tail as a list, not a
   * list holding the tail). A compiled rest is a JavaScript array, so an
   * emitter that places such a name as an element of a list or tuple literal
   * spreads it (`[...t]`) — but only while `var(name)` still returns the
   * recorded accessor: a nested binder (a lambda parameter, a block local, an
   * inner capture) that shadows the name resolves it elsewhere, and its value
   * is not a sequence. Set by the match compiler's capture target; absent
   * everywhere else.
   */
  sequenceVars?: ReadonlyMap<string, string>;

  /**
   * Block locals whose declared value is a function literal, keyed by the
   * local's name: `const g = (k) => …` inside a compiled `Block`. The
   * declaration lowers to a value binding (`let g = ((k) => …)`), so a later
   * `g(3)` in the same block is an ordinary call of that binding — but head
   * resolution otherwise looks a user-defined function up in the ENGINE's
   * definitions only (`BaseCompiler.userFunctionLiteral`), which a block-local
   * declaration never reaches, and the call fell through to the fail-closed
   * throw as ``Unknown operator `g` ``. Populated by `BaseCompiler.compileBlock`
   * on the target it compiles its statements under; an inner block's entry
   * shadows an outer one's, and a local whose value is NOT a function literal
   * REMOVES the entry it shadows.
   *
   * Only set for targets that lower a `Declare` as a value binding — i.e.
   * those with no `declare` hook (the JavaScript family). Python and the GPU
   * targets declare a local separately from its assignment and have no
   * function-valued local at all, so they keep failing closed.
   */
  localFunctions?: ReadonlyMap<string, Expr>;

  /**
   * The same block locals as {@link localFunctions}, but the WHOLE enclosing
   * statement list rather than the part of it already emitted — the scope for
   * compiling a function-literal BODY.
   *
   * The two differ because a reference resolves at a different moment in each
   * position. A statement-position expression runs where it is written, so a
   * name declared later is genuinely not bound yet (`let a = g(3)` before
   * `const g = …` must fail closed, not read a JavaScript temporal dead
   * zone) — that is `localFunctions`, filled progressively. A function
   * literal's body does not run until the function is CALLED, by which point
   * every lexical declaration of the block has initialized, so it may name
   * any of them: mutually recursive definitions (`isEven`/`isOdd`) and a
   * lambda whose body calls a later sibling are ordinary programs the
   * interpreter resolves, and compiling a body against the progressive map
   * rejected both. Whether a given CALL is early enough remains JavaScript's
   * own temporal-dead-zone question, and the emitted `let` bindings answer it
   * exactly as the interpreter does.
   */
  lexicalFunctions?: ReadonlyMap<string, Expr>;

  /**
   * The identifier this target binds its VARS OBJECT to, when it reads free
   * symbols through one. The JavaScript family compiles a free `k` to the
   * member access `_.k` and binds the caller's `vars` argument to `_`, so it
   * sets `'_'`; targets that spell a free symbol as a bare identifier (Python,
   * the shader languages) leave this undefined.
   *
   * Declared so a function literal can avoid SHADOWING it. `_` is also the
   * spelling of an implicit lambda parameter, and `_ => _ + k` therefore
   * emitted `((_) => _ + _.k)`: inside the arrow, `_` is the parameter, so
   * `_.k` read a property off a number and the whole call answered
   * `NaN`/`false` behind `success: true` — `Map(_ => _ + k, [1,2,3])` with
   * `k = 10` gave `[null, null, null]` instead of `[11, 12, 13]`. A parameter
   * that collides with this name is renamed at emission
   * (`BaseCompiler.lambdaParamBinding`).
   */
  varsObjectName?: string;

  /**
   * Identifiers this target bakes into emitted code as LITERAL tokens — the
   * runtime helper namespaces (`_SYS` on JavaScript, `_IA` on the interval
   * target). A function parameter spelled like one shadows it for that
   * function's whole body: a parameter named `_SYS` turned every `_SYS.…`
   * lowering inside the body into `TypeError: _SYS.rangeIter is not a
   * function` at run time, for a program the interpreter evaluates fine.
   *
   * Distinct from {@link varsObjectName}, which is renamed only when the body
   * actually reads the vars object — `_` is the ordinary spelling of an
   * implicit parameter, so renaming it unconditionally would rewrite every
   * `_ ↦ …` literal in every artifact. These names are renamed
   * unconditionally instead: no source spells a parameter this way, so the
   * rename costs nothing and does not have to predict which helpers the body
   * will emit.
   */
  reservedEmittedNames?: ReadonlySet<string>;

  /**
   * Target-supplied absence capability. Because the interpreter normalizes
   * domains at construction, numeric absence
   * reaches the compile boundary already as `NaN` — no conversion shim is
   * needed. The capability lets the discharge primitives (`IsMissing`,
   * `Coalesce`) and Kleene `Equal` lower uniformly:
   *
   * - `numeric` — the absent-element operations for a numeric-domain position.
   *   `make()` emits the target's `NaN`; `isAbsent(x)` tests it; `coalesce(x,
   *   d)` returns `x` unless absent, else `d`. `isAbsent` is **omitted** on a
   *   target that cannot guarantee `isnan` survives (GPU fast-math) — then
   *   discharge on that target is a compile error (fail closed).
   * - `object` — the analogous operations for an object-domain (non-numeric)
   *   position, keyed on the target's null literal. A target without this axis
   *   rejects (compile error) any `missing`-typed object-domain position.
   */
  absence?: {
    numeric: {
      make: () => TargetSource;
      isAbsent?: (x: TargetSource) => TargetSource;
      coalesce?: (x: TargetSource, d: TargetSource) => TargetSource;
    };
    object?: {
      nullLiteral: TargetSource;
      isAbsent: (x: TargetSource) => TargetSource;
      coalesce: (x: TargetSource, d: TargetSource) => TargetSource;
    };
  };

  /**
   * Compilation-boundary hook: invoked **once**, at the root of each
   * compilation (`BaseCompiler.compileRoot`), before any code is emitted.
   *
   * A target that allocates per-compilation NUMBERING (the GPU targets number
   * their invocation-local random counters `_gpu_rnd_n0`, `_gpu_rnd_n1`, …)
   * resets that numbering here, so compiling the same expression twice with
   * one target object emits identical source — the recompile-replay
   * determinism the engine-created targets get for free by being fresh. Only
   * numbering is reset, never the compilation CONTEXT (shader stage, host-frame
   * flag) the target was created with, and never module-level state a
   * previously compiled function still references.
   *
   * The receiving target is passed explicitly rather than captured: the
   * compiler recurses through `{ ...target }` spreads, and a caller may reuse
   * such a copy as a root target of its own.
   */
  beginCompilation?: (target: CompileTarget<Expr>) => void;

  /**
   * Per-compilation naming state for the temporaries the compiler generates
   * (`BaseCompiler.tempVar`). See `NamingContext`: a shared object reference,
   * created once per root compilation boundary, that survives the compiler's
   * `{ ...target }` spreads. A target reaching `tempVar()` without one gets a
   * fresh context installed on the spot (a hand-rolled target driven through
   * `BaseCompiler.compile` directly); the built-in targets always have one.
   */
  naming?: NamingContext;

  /** Target language identifier (for debugging/logging) */
  language?: string;

  /**
   * When provided, the compiler records into this set the id of every symbol
   * whose engine **value or function-literal definition it actually consults**
   * while emitting code — the constant-baking folds (`tryFoldKnownSymbol`) and
   * the user-defined function emissions (`ensureUserFunctionEmitted`), both of
   * which recurse, so transitively referenced symbols are recorded too. This is
   * the capture set of the generated code: a later change to any recorded
   * symbol's definition can invalidate the compiled result. Consumed by the
   * implicit (auto-)compilation paths to know when a cached compiled function
   * must be revalidated. Survives the compiler's `{ ...target }` spreads by
   * reference.
   */
  symbolDeps?: Set<MathJsonSymbol>;

  /**
   * The DECLARED types of the enclosing emitted definition's parameters, by
   * name. `Assign` keeps its LHS raw — the root symbol of `p.name = v` types
   * `unknown` inside a canonical function body, where the interpreter
   * re-resolves the binding at evaluation time — so the protocol-property
   * SET lowering reads the receiver's static type here instead. Installed
   * fresh (parameters only) by `prepareUserFunctionBody` — an emitted
   * definition is module-level and must not inherit the requester's locals —
   * and REPLACED per nested definition.
   */
  declaredVarTypes?: Readonly<Record<string, Type>>;

  /**
   * When provided, the compiler records into this set the id of every free
   * symbol it emits as a **vars-object lookup** (`_.<id>` in the JS targets).
   * That lookup only resolves in a wrapper that actually takes the vars object
   * as a parameter — `ComputeEngineFunction`, whose compiled expression is
   * called as `f({ x: 1 })`. A `ComputeEngineFunctionLiteral` (a compiled
   * `["Function", …]` lambda) is called with its declared parameters ONLY, so
   * any `_.<id>` in its body or preamble is a dangling reference that throws
   * `ReferenceError: _ is not defined` at call time. The quadrature path can
   * expose this because it compiles the integrand as a lambda.
   *
   * Emission-time recording rather than a pre-pass over `expr.unknowns`: a
   * free symbol can be reachable only through a folded value (`c` in
   * `b = c + 1`), which a surface scan misses.
   *
   * Survives the compiler's `{ ...target }` spreads by reference.
   */
  varsObjectRefs?: Set<MathJsonSymbol>;

  /**
   * Mutable per-compile registry for user-defined functions — a symbol whose
   * engine definition is a `Function` literal (`f(x) := …`, `x ↦ …`, or an
   * `ce.assign(name, lambda)`) encountered as an *operator* (`f(2)`). Each such
   * function is emitted **once** as a named local function
   * (`const _fn_f = (x) => …;`), collected here and prepended to the compiled
   * preamble; its call sites compile to `_fn_f(arg)`. Stored as an object so it
   * survives the `{ ...target }` spreads the compiler makes while recursing.
   *
   * A target opts in by providing this registry (the executable JS targets and
   * the GPU shader targets do, in their `compile()` / `createTargetFor()`); a
   * target that leaves it undefined keeps the `Unknown operator` throw
   * for a user-function head (raw direct-target / source-only paths). `defs` is
   * keyed by the generated local name, in insertion order, so a dependency
   * (`f`) is emitted before a dependent (`g(x) := f(x)+1`) — which is also what
   * GLSL's declaration-before-use rule requires. `compiling` is the in-progress
   * stack: a re-entrant name is a (mutually) recursive reference, compiled as a
   * call by name on the JS targets and failed closed where the language
   * forbids recursion (`lowering.noRecursion`).
   */
  userFunctions?: {
    defs: Map<string, string>;
    compiling: Set<string>;
    /**
     * The target this registry was INSTALLED on — the root of the compilation.
     *
     * An emitted definition is a module-level (preamble) function: it sees the
     * compilation's own `var`/fold rules plus its own parameters, and nothing
     * else. Without this, a definition emitted *while another definition's
     * body was compiling* inherited the requesting target — that caller's
     * parameter shadowing, its `Sum` index substitution, its hoist sink — so a
     * global the nested body references could resolve to the caller's
     * parameter. `ensureUserFunctionEmitted` compiles every body against this
     * target instead of the requesting one.
     */
    root?: CompileTarget<Expr>;
    /**
     * The target whose bound names are in scope where the preamble is
     * EMITTED, when that is not `root`. The `Function`-literal route places
     * the preamble inside the lambda body, so the lambda's own parameters are
     * visible there; a folded symbol value (`const _val_a = …;`, see
     * `BaseCompiler.ensureFoldedValueEmitted`) that mentions a parameter can
     * then be bound in that preamble. User-function DEFINITIONS keep
     * compiling against `root`: their bodies must not capture an enclosing
     * lambda's parameter. Defaults to `root`.
     */
    valueRoot?: CompileTarget<Expr>;
    /**
     * Emitted local names by prefixed symbol id (`_fn_` + id, `_val_` + id)
     * and the set of names already handed out, so two distinct symbols never
     * share one local: the sanitizer that maps a symbol to an identifier is
     * not injective (`α` and `β` both sanitize to `_`), and a second symbol
     * landing on an emitted name would silently reuse the first symbol's
     * definition. See `BaseCompiler.registryLocalName`.
     */
    names?: Map<string, string>;
    taken?: Set<string>;
    /** Symbols proven (this compile) NOT to name a user-defined function, so a
     * repeated bare free symbol in value position doesn't re-hit
     * `lookupDefinition` on every occurrence. Populated lazily. */
    misses?: Set<string>;
    /**
     * User functions whose call is currently being compiled INLINED — the
     * body beta-reduced at the call site because the target could not emit
     * the definition (`BaseCompiler.tryInlineUserFunctionCall`). A call to a
     * function already on this set is a cycle (mutual recursion through an
     * inlined body) and declines instead of inlining again. Populated lazily.
     */
    inlining?: Set<string>;
    /**
     * Language hooks for a target whose user-defined functions are NOT JS
     * arrow functions — the GLSL/WGSL shader targets, where a definition is a
     * statically typed function declaration. Absent means the default JS
     * lowering (`const _fn_f = (x) => …;`, call `_fn_f(a)`, value position
     * `_fn_f`, recursion by name).
     *
     * The hooks own everything language-specific: `define` synthesizes the
     * signature and compiles the body, `call` emits (and shape-checks) a call
     * site, `value` decides what a user function used as a VALUE means. They
     * live on the registry rather than on the target so they travel with the
     * `defs` map they populate.
     */
    lowering?: {
      /**
       * Emit the complete definition of `name` — declaration syntax plus the
       * compiled body. Called once per function, with the body's parameters
       * already shadowed on `target`. Anything it cannot type statically it
       * must fail closed on.
       */
      define: (ctx: {
        /** The engine symbol being emitted (`f`). */
        id: MathJsonSymbol;
        /** The generated definition name (`_fn_f`). */
        name: string;
        /** Formal parameter names, in order. */
        params: ReadonlyArray<string>;
        /** The body to compile (canonical, angular-unit rewritten). */
        body: Expr;
        /** The whole `["Function", body, …params]` literal. */
        literal: Expr;
        /** Target with the parameters shadowed and bound. */
        target: CompileTarget<Expr>;
      }) => string;

      /**
       * Emit a call site. Also the place to fail closed on an argument whose
       * static shape does not match the synthesized parameter type — a shader
       * has no runtime broadcast dispatch to fall back on.
       */
      call: (ctx: {
        id: MathJsonSymbol;
        name: string;
        args: ReadonlyArray<Expr>;
        target: CompileTarget<Expr>;
      }) => string;

      /**
       * A user function referenced in VALUE position (a higher-order operand
       * such as `Map(f, xs)`). The shader languages have no function values,
       * so their implementation fails closed (D6).
       */
      value: (ctx: {
        id: MathJsonSymbol;
        name: string;
        target: CompileTarget<Expr>;
      }) => string;

      /**
       * The target language forbids recursion (GLSL and WGSL both do): a
       * re-entrant reference fails closed (D6) instead of emitting a call to a
       * name that is not yet declared. The JS stack-exhaustion contract
       * deliberately does NOT carry over.
       */
      noRecursion?: boolean;

      /**
       * `define` synthesizes a STATIC return type for the declaration it emits,
       * and takes it from the body's declared/ascribed type (GLSL and WGSL both
       * do — a shader function declaration must be fully typed).
       *
       * Such a lowering cannot survive a function whose declared scalar result
       * type is contradicted by a collection-constructing body: the declaration
       * would say `float`/`f32` while the `return` statement emits a `vecN`.
       * `emitFunctionLiteralDefinition` fails closed (D6) on that pair, after
       * `define` has had its own (more specific) chance to decline — see
       * `isContradictedScalarFunctionBody`.
       *
       * Absent ⇒ the emitted definition carries no return type (the JS arrow
       * form, and any future dynamically-typed lowering such as a Python
       * `def`), so there is nothing for the body to contradict and the
       * definition keeps compiling. Only the CONSUMING positions are gated
       * there, by `assertNoContradictedScalarOperand`.
       */
      staticReturnType?: boolean;
    };
  };
}

/**
 * Base interface for language-specific compilation targets.
 *
 * `T`/`R`/`V` describe the shape of this target's `compile()` result — its
 * target name, `run` return type, and `run` variable/argument value type. They
 * default to the generic `string`/`unknown`/`number`, so `LanguageTarget<Expr>`
 * keeps its historical meaning; the executable targets bind them concretely
 * (see the `_getCompilationTarget` overloads on the engine) so a caller gets a
 * precisely-typed runner without a cast — e.g. the `interval-js` target's
 * `run` is `(vars: Record<string, number | Interval>) => IntervalResult`.
 */
export interface LanguageTarget<
  Expr = unknown,
  T extends string = string,
  R = unknown,
  V = number,
> {
  /** Get the default operators for this language */
  getOperators(): CompiledOperators;

  /** Get the default functions for this language */
  getFunctions(): CompiledFunctions<Expr>;

  /** Create a CompileTarget for this language */
  createTarget(options?: Partial<CompileTarget<Expr>>): CompileTarget<Expr>;

  /** Compile an expression to this language */
  compile(
    expr: Expr,
    options?: CompilationOptions<Expr>
  ): CompilationResult<T, R, V>;
}

/**
 * What a compiled `interval-js` runner returns: an `IntervalResult` — or a
 * bare `Interval`, which is what a constant-valued expression produces — for
 * a scalar expression, and for a collection-valued one (a comprehension, a
 * list of points) an ARRAY of these, nested as the collection is. The
 * interval domain is "one interval per quantity"; a collection is that many
 * quantities, so it is an array of them rather than one interval (user
 * ruling 2026-08-22, confirming what comprehension roots already produced).
 *
 * Defined here (not in a `types-*.ts` file) because the layering rules forbid
 * the type-definition layer from importing `interval/`; `compilation/` may.
 */
export type IntervalValue = IntervalResult | Interval | IntervalValue[];

/**
 * What a compiled `interval-js` runner accepts for each variable: a plain
 * number (auto-converted to a point interval), an `Interval`, or — for a
 * collection-valued variable, read by `At`/`Length`/`PointX`… — an array of
 * these, nested as the collection is; every number in it is converted to a
 * point interval on the way in.
 */
export type IntervalInput = number | Interval | IntervalInput[];

/**
 * The `interval-js` target, typed concretely: its compiled `run` accepts
 * {@link IntervalInput} variables and returns an {@link IntervalValue}.
 * Returned by `_getCompilationTarget("interval-js")` so callers get this
 * without a cast.
 */
export type IntervalJsCompilationTarget<Expr = unknown> = LanguageTarget<
  Expr,
  'interval-js',
  IntervalValue,
  IntervalInput
>;

/**
 * The `javascript` target, typed concretely: its compiled `run` accepts
 * `number | ComplexResult` variables (plain reals or complex domain-coloring
 * inputs) and returns `number | ComplexResult`. Returned by
 * `_getCompilationTarget("javascript")`.
 */
export type JavaScriptCompilationTarget<Expr = unknown> = LanguageTarget<
  Expr,
  'javascript',
  CompiledValue,
  number | ComplexResult
>;

/**
 * Options for compilation
 */
export interface CompilationOptions<Expr = unknown> {
  /**
   * Target language for compilation.
   *
   * Built-in targets:
   * - `'javascript'` (default) - Compile to JavaScript
   * - `'glsl'` - Compile to GLSL (OpenGL Shading Language)
   * - `'wgsl'` - Compile to WGSL (WebGPU Shading Language)
   * - `'interval-js'` - Compile to JavaScript with interval arithmetic
   *
   * Custom targets can be registered using `ce._registerCompilationTarget()`.
   *
   * @example
   * ```typescript
   * // Compile to GLSL
   * const glslCode = expr.compile({ to: 'glsl' });
   *
   * // Compile to custom target
   * ce._registerCompilationTarget('python', new PythonTarget());
   * const pythonCode = expr.compile({ to: 'python' });
   * ```
   */
  to?: string;

  /**
   * Direct compilation target override.
   *
   * When provided, this takes precedence over the `to` option.
   * Useful for one-off custom targets without registration.
   *
   * @example
   * ```typescript
   * const customTarget: CompileTarget = {
   *   language: 'custom',
   *   operators: (op) => ...,
   *   functions: (id) => ...,
   *   // ... other methods
   * };
   *
   * const code = expr.compile({ target: customTarget });
   * ```
   */
  target?: CompileTarget<Expr>;

  /**
   * Custom operator mappings. Can be:
   * - A partial object mapping operator names to [operator, precedence] tuples
   * - A function that returns the operator mapping for a given symbol
   *
   * When an operator is overridden, it will be compiled using the specified
   * string and precedence instead of the default for the target language.
   *
   * @example
   * ```typescript
   * // Override operators as object
   * { operators: { Add: ['add', 11], Multiply: ['mul', 12] } }
   *
   * // Override operators as function
   * { operators: (op) => op === 'Add' ? ['add', 11] : undefined }
   * ```
   */
  operators?:
    | Partial<CompiledOperators>
    | ((op: MathJsonSymbol) => [op: string, prec: number] | undefined);

  /**
   * Custom function implementations.
   *
   * The value is the implementation — target source text or a JavaScript
   * function — or a descriptor that adds a purity declaration:
   *
   * ```typescript
   * { functions: { s: '((t) => t * t)' } }                       // inferred
   * { functions: { s: { source: mySpline, pure: true } } }       // asserted
   * ```
   *
   * Purity matters because a compiled `Sum`/`Product` stops as soon as its
   * accumulator becomes NaN, and that early exit is suppressed for a body
   * that splices caller-supplied source: such code may count its own calls or
   * mutate shared state, so running it fewer times would change behavior. An
   * entry known to have no such effect keeps the exit. See
   * {@link CompiledFunctionEntry}.
   */
  functions?: Record<MathJsonSymbol, CompiledFunctionEntry>;

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
  vars?: Record<MathJsonSymbol, TargetSource>;

  /** Additional imports/libraries to include */
  imports?: unknown[];

  /** Additional preamble code */
  preamble?: string;

  /**
   * The arithmetic discipline to compile under — `'strict'`, `'complex'` or
   * `'auto'` (see `CompileMode`). Effective mode = this option ?? the
   * target's `mode` ?? the target's default (`'auto'` if its `supportedModes`
   * includes it, else `'strict'`). The `javascript` and `python` targets
   * offer all three, so their default is `'auto'`; `interval-js`, `glsl` and
   * `wgsl` offer `'strict'` only. Requesting a mode the target does not offer
   * is a `capability` decline (`success: false`, `diagnostic.code ===
   * 'unsupported-mode'`), never a silent coercion.
   *
   * The result reports what was used: `CompilationResult.mode` is the
   * discipline the returned code was compiled under, `promoted` whether an
   * unknown-sign radical was lowered through a complex kernel, and
   * `escalation` (under `'auto'`) why the compilation was redone in complex
   * mode.
   *
   * The disciplines are live, not merely reported: a default (`'auto'`)
   * compilation promotes an unknown-sign `Sqrt`/`Ln`/`Log`/`Power` with no
   * opt-in, a complex-shaped value reaching a binding the strict attempt
   * shaped real declines with a lane mismatch, and that decline redoes the
   * compilation ONCE under `'complex'`. That redo is each registered
   * target's own responsibility — the built-in targets apply the shared
   * `compileWithAutoEscalation` helper (`compilation/auto-escalation.ts`)
   * inside their `compile()`, and a CUSTOM registered target that declares
   * `'auto'` support must do the same, or its callers get the raw
   * `LaneMismatchError` instead of the retry. The older `complexPromotion` flag
   * is deprecated and subordinate to this option: `true` maps to
   * `mode: 'complex'` only when no `mode` is given. See `CompileMode` for the
   * disciplines.
   */
  mode?: CompileMode;

  /**
   * Whether the JavaScript runner performs the D3 ENTRY CHECK on each call
   * (default `true`): a `{re, im}` value bound to a free symbol or lambda
   * parameter the compilation shaped REAL throws a `TypeError` naming it, and
   * a plain number bound to a `complex`-typed one is lifted to `{re, im: 0}`.
   * One `typeof` per checked binding per call — which is one READ of each
   * checked free symbol on the vars object, whether or not the compiled code
   * would read it on that call (a getter-backed vars object sees the read).
   *
   * `false` is for ENGINE-INITIATED (implicit) compilations — the auto-
   * compiled `Map` drains, the numeric kernels, the compiled `Reduce` fast
   * path — whose callers own their argument contract and validate the result
   * themselves (a `NaN` or malformed result re-runs the element through the
   * interpreter); a thrown entry check would turn that self-healing fallback
   * into an evaluation error. `implicitCompile` passes it.
   */
  entryChecks?: boolean;

  /**
   * Deprecated compatibility option superseded by `mode`. Consulted only when
   * `mode` is absent: `true` maps to `mode: 'complex'` (a one-time console
   * warning), and is dropped on a target that does not offer complex mode
   * (the shader targets keep the real kernel, as this flag was always
   * documented to do there); `false` is ignored; beside an explicit `mode`
   * it is ignored with a warning. The default `auto` mode already promotes an
   * unknown-sign `Sqrt`/`Ln`/`Log`/`Power`, so most callers can drop this flag.
   * @deprecated
   */
  complexPromotion?: boolean;

  /**
   * Cap the trip count of emitted `Sum`/`Product` loops: a loop whose
   * iteration count would exceed the budget (including infinite bounds)
   * evaluates to `NaN` instead of running. It also caps (floors, then
   * truncates to) the `PointList` zip length on the JavaScript target — a
   * capped point list is truncated, not `NaN`-poisoned. See
   * `CompileTarget.iterationBudget`.
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
   */
  constantFold?: boolean;

  /**
   * When provided, the compiler records the id of every symbol whose engine
   * value or function-literal definition it consults while emitting code (the
   * generated code's capture set). See `CompileTarget.symbolDeps`.
   */
  symbolDeps?: Set<MathJsonSymbol>;

  /**
   * When provided, the compiler records the id of every free symbol it emitted
   * as a vars-object lookup. See `CompileTarget.varsObjectRefs`.
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
   * `false` disables CSE, but generated temporary names remain deterministic
   * (`_tv1`, `_tv2`, …) regardless of this option.
   *
   * Consumed at each root compilation boundary. A target with no `cseBind`
   * capability (the GPU shader targets), and the direct custom-target route
   * (`compile({ target })`), behave as `false`.
   */
  cse?: boolean;

  /**
   * How a `LanguageTarget.compile()` call reports an expression it cannot lower
   * to the target, such as an unsupported operator or a correctness guard.
   *
   * - **Unset / `false`** (default) — **throw** the compile error. This is the
   *   low-level contract the built-in targets have always had, so the engine
   *   can decide whether to fall back to interpretation.
   * - **`true`** — instead of throwing, return the documented failure shape
   *   `{ success: false, error, run }`, where `run` is an interpreter-backed
   *   evaluator (the "fall back to interpretation" contract). Use this when
   *   calling a target directly and you want to branch on `success` rather than
   *   catch an exception. The engine-level free-function `compile()` already
   *   behaves this way by default (pass `fallback: false` there to throw).
   */
  fallback?: boolean;
}

/**
 * Built-in targets that produce an executable `run` function.
 */
export type ExecutableTarget = 'javascript' | 'interval-js';

/**
 * Result of a complex number computation: `{ re, im }`.
 */
export type ComplexResult = { re: number; im: number };

/**
 * Every value a compiled runner can hand back.
 *
 * Wider than the numeric case most callers have in mind, because the compiled
 * form of an expression returns whatever that expression denotes, and the
 * engine compiles more than arithmetic:
 *
 * - `number` — the ordinary case; a pole or an undefined result is `NaN`.
 * - {@link ComplexResult} — a complex-valued expression, `{ re, im }` with
 *   `im !== 0` (a value whose imaginary part is exactly zero comes back as a
 *   plain `number`).
 * - `boolean` — a predicate is NOT numericized: `Greater(x, 0)` runs to
 *   `true`, never to `1`.
 * - `string` — a string-valued expression compiles to a JavaScript string.
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
 * The array member is mutable on purpose: the runner builds a fresh array per
 * call and hands ownership to the caller, so there is nothing for a `readonly`
 * to protect and it would only block passing the result to code that expects
 * an ordinary array.
 *
 * A caller that knows which of these its own expression produces can say so
 * with the `R` type parameter — `compile<'javascript', number>(expr)` — and
 * get a narrow result type back. That is a TYPE-level assertion only: it
 * changes nothing about the code that is generated or the value that is
 * returned, so it is the caller's job to be right about it.
 */
export type CompiledValue =
  | number
  | ComplexResult
  | boolean
  | string
  | CompiledValue[]
  | ((...args: CompiledValue[]) => CompiledValue);

/**
 * The result type a runner has when the caller names a target but not an `R`.
 *
 * Target-dependent, because `interval-js` does not produce ordinary values at
 * all: its runner answers with an {@link IntervalResult} — a tagged union
 * (`{kind: 'interval', value: {lo, hi}}`, `{kind: 'empty'}`, …) — or with a
 * BARE {@link Interval} (`{lo, hi}`), which is what a constant-valued
 * expression comes back as, since it is built directly as a point interval.
 * Neither is a number, a boolean or an array of them. Folding them into
 * {@link CompiledValue} would force every ordinary caller to narrow past
 * interval shapes that a `javascript` runner can never return, so the default
 * selects on the target name instead. This mirrors the concrete typing
 * `_getCompilationTarget('interval-js')` already provides
 * ({@link IntervalJsCompilationTarget}).
 */
export type DefaultRunnerResult<T extends string> = T extends 'interval-js'
  ? IntervalValue
  : CompiledValue;

/**
 * The variable/argument value type a runner accepts when the caller names a
 * target but not a `V`, selected on the same target-dependent basis as
 * {@link DefaultRunnerResult}: `interval-js` binds variables to intervals (a
 * plain number is auto-converted to a point interval), while every other
 * executable target accepts a real or a complex domain-coloring input.
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
 * need one. This spelling also matches the concrete
 * {@link JavaScriptCompilationTarget}, so the two routes into the same
 * machinery agree.
 *
 * Two limits on that runtime backstop, neither of which changes the choice
 * here but both of which a reader should know. `entryChecks: false` opts out
 * of the diagnosis along with every other entry guard: the complex object then
 * flows into real arithmetic and the call returns `NaN` rather than throwing.
 * And the guard is the `javascript` target's own — the shader targets compile
 * to source and expose no `run` at all, while a target registered through
 * `ce._registerCompilationTarget()` gets whatever guard its author writes.
 */
export type DefaultRunnerVars<T extends string> = T extends 'interval-js'
  ? IntervalInput
  : number | ComplexResult;

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
 * and a complex domain-coloring runner uses `number | ComplexResult`.
 */
export interface CompiledRunner<R = CompiledValue, V = number> {
  /** Call with a variables object (for compiled expressions) */
  (vars: Record<string, V>): R;
  /** Call with positional arguments (for compiled lambda expressions) */
  (...args: V[]): R;
}

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
 *   `number`; `interval-js` binds it to `number | Interval`, a complex runner
 *   to `number | ComplexResult`. (Positioned after `R` so existing
 *   `CompilationResult<T, R>` uses keep the `number` default.)
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
 * const py = compile(expr, { to: 'python' });
 * py.code; // string
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
   * Operator heads in the expression that this target cannot lower — they have
   * no operator or function mapping and are not one of the structural forms the
   * compiler handles directly. An empty array means every operator was
   * lowerable.
   *
   * On the built-in `LanguageTarget.compile` paths a genuinely unsupported
   * operator throws (so the engine-level `compile()` can fall back to
   * interpretation); this field lets a caller detect the condition
   * **declaratively** — it is populated on the engine-level `compile()` result
   * (including its `success: false` fallback) and on successful direct-target
   * compiles (where it is `[]`).
   */
  unsupported?: string[];

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
   * `'strict'` or `'complex'` (never `'auto'`, which is a policy over the
   * two disciplines, not one code can be compiled under). Set by the built-in
   * targets on every result. See `CompileMode`.
   *
   * `'complex'` is reported whenever the complex discipline was latched (it
   * was requested, or `'auto'` escalated to it after a lane mismatch — see
   * `escalation`) OR a promotable head (an unknown-sign `Sqrt`/`Ln`/`Log`, or
   * a `Power` with a non-integer exponent) was promoted through the complex
   * kernel; `'strict'` otherwise. So `promoted === true` implies
   * `mode === 'complex'`. The two fields still differ: an explicitly
   * requested `'complex'` compile that contains no promotable head reports
   * `mode: 'complex'` with `promoted: false`.
   *
   * **Not a lane oracle, and not a shader-portability test.** An operand that
   * is ALREADY complex-typed — a `complex`/`imaginary`-typed symbol, a
   * `Complex(…)` literal, `ImaginaryUnit` — routes through the complex kernel
   * in EVERY discipline, so it is deliberately not counted as a promotion:
   * compiling `3 + 2i` with `mode: 'strict'` emits `({ re: 3, im: 2 })` and
   * reports `('strict', false)`. `mode: 'strict'` therefore does NOT
   * guarantee the emitted code is free of `{re, im}` arithmetic. (The
   * exclusion is the `!isNonRealNumber(a.type.type)` conjunct guarding the
   * `notePromoted()` call in `BaseCompiler.promotesRadicalToComplex`.)
   *
   * `mode` describes the EMISSION, not the shape of a returned value: a
   * compile that reports `'complex'` can still hand back a plain real number
   * whenever the imaginary part of the result is exactly zero. The only sound
   * per-sample test of a returned value's shape is `typeof v === 'number'`.
   */
  mode?: 'strict' | 'complex';

  /**
   * Whether any promotable head (an unknown-sign `Sqrt`/`Ln`/`Log`, …) was
   * lowered through a complex kernel — the signal that this compiled unit
   * would NOT compute the same value on a shader target's real kernel, even
   * when no escalation happened. Set by the built-in targets on every result.
   */
  promoted?: boolean;

  /**
   * Under `mode: 'auto'`, present when the strict-mode attempt declined with a
   * lane mismatch and the compilation was redone in complex mode: the
   * diagnostic of the FAILED strict attempt (its `boundary` and `binding` say
   * why the slow way was taken).
   */
  escalation?: CompileDiagnostic;

  /**
   * Library/helper code that must be included before the compiled `code`.
   *
   * For targets like `interval-js`, this contains the interval arithmetic
   * library (helper functions, etc.) that the compiled expression references.
   */
  preamble?: string;

  /**
   * How `run` should be called (present only for executable targets).
   * - `'expression'` — call with a vars object: `run({ x: 0.5 })`
   * - `'lambda'` — call with positional args: `run(0.5, 1.0)`
   */
  calling?: 'expression' | 'lambda';

  /** Executable function (present for JS-executable targets only). */
  run?: CompiledRunner<R, V>;
} & (T extends ExecutableTarget
  ? { calling: 'expression' | 'lambda'; run: CompiledRunner<R, V> }
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {});
