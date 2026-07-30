import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Interval, IntervalResult } from '../interval/types.js';

/**
 * Source code in the target language
 */
export type TargetSource = string;

/**
 * Compile a sub-expression of the construct a handler is lowering.
 *
 * `opIndex` is the operand index the sub-expression sits at in the construct's
 * OWN operand list. A handler lowering a construct with
 * conditionally-evaluated operand positions (the `LAZY_OPERANDS` inventory,
 * `cse.ts`) passes it for those positions, so the CSE pass can push the
 * matching region instance (`docs/plans/2026-07-28-compile-cse-design.md`
 * §5.1). It is OPTIONAL: a handler that omits it compiles exactly as before —
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
 * Per-compilation state for the names the compiler GENERATES (the `tempVar()`
 * temporaries `_tv1`, `_tv2`, …).
 *
 * Always present, on every target and every language: two `compile()` calls on
 * one expression must emit byte-identical source, which a random name cannot
 * give. Created at each root compilation boundary (each target's
 * `createTarget()`; `compile-expression.ts` for the direct custom-target
 * route) and held as a SHARED OBJECT REFERENCE on `CompileTarget.naming`, so
 * it survives the `{ ...target }` spreads the compiler makes while recursing —
 * scalar fields would fork and two branches would then allocate the same name.
 */
export type NamingContext = {
  /** How many generated names have been allocated. Names are positional
   * (`_tv1`, `_tv2`, …), so a fresh context restarts at `_tv1`. */
  counter: number;

  /**
   * The names this compilation must NOT generate: every symbol name of the
   * compiled expression, plus any `_tv`/`_cse`-prefixed identifier token
   * appearing in caller-supplied source (`functions` strings, string-valued
   * `vars`, `preamble`). Neither prefix is reserved — MathJSON accepts
   * underscore-initial symbols, and a lambda parameter or `Block` local named
   * `_tv1` emits as a bare identifier — so a generated name that appears here
   * is SKIPPED rather than assumed unique.
   *
   * Mutable: engine-internal per-compilation state, added to in place as
   * nested trees (a user-function definition body) join the artifact.
   */
  usedNames: Set<string>;
};

/**
 * One EMISSION-TIME instance of a static CSE region
 * (`docs/plans/2026-07-28-compile-cse-design.md` §6.1).
 *
 * Static regions describe the tree; instances exist while code is emitted. The
 * distinction is load-bearing for every re-entrant emission of shared
 * structure — an unrolled `Sum` compiles the SAME body node objects once per
 * index value, so a bare node-keyed map would emit iteration 1's temporary for
 * every later iteration (silent wrong values). Each such emission pushes a
 * fresh instance, so bindings can never leak to a context where they are not
 * in scope.
 *
 * ## Why the analysis types are opaque here
 *
 * `region`, and the keys of `state`/`names`, are the `CseRegion` /
 * `CseCandidate` of `cse.ts`, kept **structurally opaque** (`object`) in this
 * module: `compilation/types.ts` is expression-type-free by design — an import
 * reaching `global-types` would close a module cycle (the zero-cycle budget,
 * `docs/architecture/ZERO-CYCLES-PLAN.md`) — and `cse.ts`'s types are built on
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
 * Per-compilation CSE state (`docs/plans/2026-07-28-compile-cse-design.md`
 * §4.1). Present on every compilation of a target that can bind temporaries
 * (`cseBind`); `enabled: false` when the caller passed `cse: false`, when the
 * target has no `cseBind`, or on the direct custom-target route (which gets no
 * CSE in Phase 1 — §4.2).
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
   * NESTED harvest while a user-defined function's body is emitted (§5.4) —
   * own regions and candidates, same session and naming counter.
   */
  harvest?: object;

  /**
   * The provenance predicates this compilation harvests with (§5.2 G1b). Kept
   * on the session because the NESTED harvest of a user-defined function's
   * body (§5.4) runs long after the boundary that knew the caller's override
   * key sets. (Structurally a `CseHarvestOptions`; the thresholds it also
   * accepts are defaulted.)
   */
  harvestOptions?: {
    isOverriddenOperator?: (name: string) => boolean;
    isStringVar?: (name: string) => boolean;
  };

  /** The emission-time region instance stack, innermost last. */
  instances: CseRegionInstance[];
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

  /** Format string literals for the target language */
  string: (str: string) => string;

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
   * compile-time common-subexpression elimination pass
   * (`docs/plans/2026-07-28-compile-cse-design.md` §6.2) wraps each region's
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
   * - **python** — a FLAT sequential binding comprehension,
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
   * time to the target's ELEMENT-WISE selection form (`np.select` semantics —
   * `docs/plans/2026-07-27-elementwise-which-design.md`, R1–R4). The clauses
   * arrive in `Which` shape (condition, arm, condition, arm, …); an `If` is
   * normalized to `[cond, then, True, else]` by the caller.
   *
   * Returns `null` when every condition is provably scalar: the base compiler
   * then emits its ordinary ternary chain, byte for byte, so a scalar
   * conditional is unaffected by the hook's presence. Throws to fail closed
   * (D6) on a shape the target cannot render.
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
   * When `true`, this target's multi-statement constructs (loop-form
   * `Sum`/`Product`, `Loop`, `Block`) are emitted as **bare statement
   * sequences** — valid only at statement position (a function body), never
   * as a sub-expression. GPU shader languages (GLSL/WGSL) set this: unlike the
   * JavaScript target, which wraps such constructs in an IIFE (a self-contained
   * expression), a shader has no expression-level loop or IIFE. The compiler
   * uses this flag to **fail closed** (D6) rather than splice a bare statement
   * block into the middle of an expression (which would emit invalid shader
   * source such as `return _acc; + 1.0`).
   */
  bareStatementBlocks?: boolean;

  /**
   * Statement-hoisting sink for a `bareStatementBlocks` target (GLSL/WGSL).
   *
   * A lowering that needs statements — the loop form of `Sum`/`Product` — can
   * push them here and return a plain expression naming the result, so the
   * construct COMPOSES: `1 + \sum_{k=0}^{n} kx` emits the loop ahead of the
   * `return` instead of failing closed (Tycho item 110). The emitter that owns
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
   */
  iterationBudget?: number;

  /**
   * Quadrature strategy for compiled definite integrals (`Integrate`).
   * `'adaptive'` (default) emits deterministic adaptive Gauss–Kronrod with an
   * automatic Monte-Carlo fallback on non-convergence; `'monte-carlo'` forces
   * the legacy stochastic estimator. See `CompilationOptions.quadrature`.
   */
  quadrature?: 'adaptive' | 'monte-carlo';

  /**
   * The keys of the `vars` option (symbols the caller mapped to explicit
   * runtime inputs / uniforms). A `vars`-mapped symbol must never be folded to
   * a constant — it stays a live input. Consulted by the `Integrate` handler:
   * the antiderivative-first optimization resolves a definite integral to a
   * closed form via `evaluate()`, which *would* fold such a symbol, so it is
   * skipped when the integral references any `vars`-mapped symbol.
   */
  varsKeys?: ReadonlySet<string>;

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
   * Target-supplied absence capability (§3.F of the missing-value typing
   * design, `docs/plans/2026-07-22-missing-value-typing-design.md`). Because
   * the interpreter domain-normalizes at construction (I6), numeric absence
   * reaches the compile boundary already as `NaN` — no conversion shim is
   * needed. The capability lets the discharge primitives (`IsMissing`,
   * `Coalesce`; the consumers land in P3) and Kleene `Equal` lower uniformly:
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
   * target that leaves it undefined keeps the historic `Unknown operator` throw
   * for a user-function head (raw direct-target / source-only paths). `defs` is
   * keyed by the generated local name, in insertion order, so a dependency
   * (`f`) is emitted before a dependent (`g(x) := f(x)+1`) — which is also what
   * GLSL's declaration-before-use rule requires. `compiling` is the in-progress
   * stack: a re-entrant name is a (mutually) recursive reference, compiled as a
   * call by name on the JS targets and failed closed (D6) where the language
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
    /** Symbols proven (this compile) NOT to name a user-defined function, so a
     * repeated bare free symbol in value position doesn't re-hit
     * `lookupDefinition` on every occurrence. Populated lazily. */
    misses?: Set<string>;
    /**
     * Language hooks for a target whose user-defined functions are NOT JS
     * arrow functions — the GLSL/WGSL shader targets, where a definition is a
     * statically typed function declaration. Absent ⇒ the historic JS
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
       * must fail closed on (D6).
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
       * such as `Map(xs, f)`). The shader languages have no function values,
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
 * (see the `getCompilationTarget` overloads on the engine) so a caller gets a
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
 * The `interval-js` target, typed concretely: its compiled `run` accepts
 * `number | Interval` variables (a plain number is auto-converted to a point
 * interval) and returns an `IntervalResult`. Returned by
 * `getCompilationTarget("interval-js")` so callers get this without a cast.
 *
 * Defined here (not in a `types-*.ts` file) because the layering rules forbid
 * the type-definition layer from importing `interval/`; `compilation/` may.
 */
export type IntervalJsCompilationTarget<Expr = unknown> = LanguageTarget<
  Expr,
  'interval-js',
  IntervalResult,
  number | Interval
>;

/**
 * The `javascript` target, typed concretely: its compiled `run` accepts
 * `number | ComplexResult` variables (plain reals or complex domain-coloring
 * inputs) and returns `number | ComplexResult`. Returned by
 * `getCompilationTarget("javascript")`.
 */
export type JavaScriptCompilationTarget<Expr = unknown> = LanguageTarget<
  Expr,
  'javascript',
  number | ComplexResult,
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
   * Custom targets can be registered using `ce.registerCompilationTarget()`.
   *
   * @example
   * ```typescript
   * // Compile to GLSL
   * const glslCode = expr.compile({ to: 'glsl' });
   *
   * // Compile to custom target
   * ce.registerCompilationTarget('python', new PythonTarget());
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

  /** Custom function implementations */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  functions?: Record<MathJsonSymbol, TargetSource | Function>;

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
   * When true, complex results (`{ re, im }`) are converted to real numbers:
   * - If the imaginary part is zero, the real part is returned
   * - Otherwise, `NaN` is returned
   *
   * This avoids object allocations for callers that only need real-valued
   * results (e.g., plotting).
   */
  realOnly?: boolean;

  /**
   * Cap the trip count of emitted `Sum`/`Product` loops: a loop whose
   * iteration count would exceed the budget (including infinite bounds)
   * evaluates to `NaN` instead of running. See `CompileTarget.iterationBudget`.
   */
  iterationBudget?: number;

  /**
   * Quadrature strategy for compiled definite integrals (`Integrate`).
   *
   * - `'adaptive'` (default) — deterministic adaptive Gauss–Kronrod (GK15):
   *   near machine precision on smooth integrands, µs-scale, with automatic
   *   Monte-Carlo fallback on non-convergence.
   * - `'monte-carlo'` — force the legacy stochastic Monte-Carlo estimator
   *   (~1e-4 typical error, different result each call).
   */
  quadrature?: 'adaptive' | 'monte-carlo';

  /**
   * When provided, the compiler records the id of every symbol whose engine
   * value or function-literal definition it consults while emitting code (the
   * generated code's capture set). See `CompileTarget.symbolDeps`.
   */
  symbolDeps?: Set<MathJsonSymbol>;

  /**
   * Common-subexpression elimination (default `true`).
   *
   * A repeated **pure** subtree inside one compiled expression is evaluated
   * once and referenced by a temporary, instead of being emitted — and
   * executed — at every occurrence
   * (`docs/plans/2026-07-28-compile-cse-design.md`). Values are unchanged
   * (same operations, no reassociation), selection laziness is preserved (no
   * binding crosses a conditional arm, a short-circuited connective tail, or a
   * binder body), and draw streams are unchanged (only pure subtrees, never a
   * user-defined function application, are candidates).
   *
   * `false` restores the pre-CSE emission. Note this is NOT byte-identical to
   * output from before the CSE change-set: generated temporary names are
   * deterministic (`_tv1`, `_tv2`, …) regardless of this option.
   *
   * Consumed at each root compilation boundary. A target with no `cseBind`
   * capability (the GPU shader targets), and the direct custom-target route
   * (`compile({ target })`), behave as `false` in Phase 1.
   */
  cse?: boolean;

  /**
   * How a `LanguageTarget.compile()` call reports an expression it cannot lower
   * to the target (an unsupported operator, or a `Fail closed (D6)` guard).
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
 * Runner for compiled expressions — called with a variables object.
 *
 * ```typescript
 * result.run({ x: 0.5, y: 1.0 })
 * ```
 */
export type ExpressionRunner<R = number | ComplexResult, V = number> = (
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
export type LambdaRunner<R = number | ComplexResult, V = number> = (
  ...args: V[]
) => R;

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
export interface CompiledRunner<R = number | ComplexResult, V = number> {
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
 * - `R` — the return type of `run`. Defaults to `number | ComplexResult`.
 *   Pass `number` when `realOnly: true`.
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
 * // run is guaranteed, returns number only
 * const real = compile(expr, { realOnly: true });
 * real.run({ x: 0.5 }); // number
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
  R = number | ComplexResult,
  V = number,
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
