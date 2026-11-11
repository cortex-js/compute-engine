import type {
  BoxedDefinition,
  Expression,
  IComputeEngine,
} from './global-types.js';
import { CancellationError } from '../common/interruptible.js';
import {
  isFunction,
  isSymbol,
  freeBinding,
} from './boxed-expression/type-guards.js';
import {
  boundVariableNames,
  callableBindingInContext,
} from './boxed-expression/binders.js';
import { isForwardCallReference } from './boxed-expression/forward-call-reference.js';
import {
  compileDiagnosticOf,
  isCompileDeclineError,
} from './compilation/diagnostics.js';
import {
  markImplicitCompileOptions,
  recordJsProfileAttempt,
  type JsProfileSwitch,
} from './js-profile-switch.js';

/**
 * Compile `expr` for an **implicit** (engine-initiated) code-generation path —
 * the auto-compiled `Map` drains, the numeric quadrature/derivative/limit
 * kernels (`NIntegrate`, `ND`, `NLimit`, the `Integrate`/`Limit` numeric
 * fallbacks), the `NDSolve` right-hand sides, the solve-domain enumeration
 * sieve, the stochastic-equality probes, and the compiled `Reduce` fast path —
 * honoring the `ce.jit` flag (D7 of the Map auto-compile design):
 *
 * - `ce.jit === 'off'` → no attempt, return `undefined`: a strict-CSP host
 *   that sets the flag up front generates zero violation reports.
 * - An environment-level failure to *construct* a function (a CSP
 *   `EvalError` — distinct from an ordinary compile failure) **latches
 *   `ce.jit = 'off'` engine-wide** — detect once, not per call site — so all
 *   subsequent implicit paths interpret silently, capping violation reports
 *   at one.
 * - A `CancellationError` (deadline expiry during the compile) propagates: it
 *   reflects the moment's budget, not the expression.
 * - Any other compile failure returns `undefined` **silently** (no
 *   "Compilation fallback" warning): the caller interprets instead.
 *
 * Explicit `compile()` calls must NOT go through this helper — a direct user
 * request keeps failing loudly with the environment's own error, regardless
 * of the flag.
 *
 * `consumer` names the caller (`map`, `integrand`, `nd`, …). With the
 * internal switch `ce._jsProfile` on for this consumer, the compilation is
 * tried with the `numeric-kernel` profile first, and the existing compiler
 * runs when the profile does not give code (`tryProfile()`).
 *
 * With the shadow measure `ce._jsProfileShadow` on, the compilation of the
 * existing compiler is counted under `implicit:<consumer>`
 * (`js-profile-switch.ts`), unless the switch tried the profile first.
 *
 * The compile mode is the target's default, `'strict'`, unless `options`
 * names one: an operation whose value is complex (`Sqrt(x)` at `x = -4`)
 * gives `NaN`. Each caller either reads only real values and treats a `NaN`
 * or a non-number as "no value here" (`implicitCompileNumeric` and the limit
 * probes), or computes such an element again: with the interpreter (the
 * `Map` drain, the `Reduce` fast path and the stochastic-equality probes), or
 * with the integrand compiled in `mode: 'complex'` (the quadrature kernels,
 * `withComplexAtNaN()` in `library/calculus.ts`), so it gets the
 * interpreter's value. A quadrature integrand that is not pure keeps the
 * `NaN`, because it cannot be evaluated a second time
 * (`withLogSpaceFallback()`).
 */
export function implicitCompile(
  ce: IComputeEngine,
  expr: Expression,
  consumer: string,
  options?: Record<string, unknown>
): ReturnType<IComputeEngine['_compile']> | undefined {
  if (ce.jit === 'off') return undefined;
  const profile = ce._jsProfile;
  try {
    // `entryChecks: false`: an implicit caller owns its argument contract and
    // validates the runner's result itself (see `CompilationOptions.entryChecks`).
    return withCapturedCallBindings(ce, expr, () => {
      const tried =
        profile !== undefined && profileApplies(profile, consumer, options);
      if (tried) {
        const result = tryProfile(ce, expr, consumer, options);
        if (result !== undefined) return result;
      }
      const existingOptions = {
        ...options,
        fallback: false,
        entryChecks: false,
      };
      markImplicitCompileOptions(existingOptions, tried ? null : consumer);
      return ce._compile(expr, existingOptions);
    });
  } catch (e) {
    if (e instanceof EvalError) {
      ce.jit = 'off';
      return undefined;
    }
    if (e instanceof CancellationError) throw e;
    return undefined;
  }
}

/**
 * Whether `implicitCompile()` with the switch `profile` on tries the
 * profile for `consumer` with `options` (`tryProfile()`).
 *
 * The profile is tried when `consumer` is in the list of the switch (or the
 * list is absent) and the options do not select another target (`to` other
 * than `javascript`, `target`) or a profile. The other options are passed:
 * the profile declines those it does not have, and that decline is counted.
 * The `vars` of the series walk (`_["k"]`, `compiledSeriesTerm()`) is the
 * read of an input under another name, which the profile admits.
 */
function profileApplies(
  profile: JsProfileSwitch,
  consumer: string,
  options: Record<string, unknown> | undefined
): boolean {
  if (profile.consumers !== undefined && !profile.consumers.has(consumer))
    return false;
  return !(
    options !== undefined &&
    ((options.to !== undefined && options.to !== 'javascript') ||
      options.target !== undefined ||
      options.profile !== undefined)
  );
}

/**
 * The compilation of `expr` with the `numeric-kernel` profile, for
 * `implicitCompile()` with the switch on, when `profileApplies()`, or
 * `undefined` when the profile does not give code; the existing compiler
 * then runs, with the options of the caller.
 *
 * The sets that the compiler fills (`symbolDeps`, `varsObjectRefs`) are
 * replaced by fresh sets for the attempt, and their contents are added to
 * the sets of the caller only when the profile gives code: an attempt that
 * does not leaves no trace.
 *
 * A decline with the code `outside-profile` is counted `declined`; another
 * failure is counted `failed`. An `EvalError` or a `CancellationError` is
 * thrown again, for `implicitCompile()` to handle as for the existing
 * compiler.
 */
function tryProfile(
  ce: IComputeEngine,
  expr: Expression,
  consumer: string,
  options: Record<string, unknown> | undefined
): ReturnType<IComputeEngine['_compile']> | undefined {
  const symbolDeps = options?.symbolDeps as Set<string> | undefined;
  const varsObjectRefs = options?.varsObjectRefs as Set<string> | undefined;
  const attemptDeps = symbolDeps === undefined ? undefined : new Set<string>();
  const attemptRefs =
    varsObjectRefs === undefined ? undefined : new Set<string>();
  let result: ReturnType<IComputeEngine['_compile']>;
  try {
    result = ce._compile(expr, {
      ...options,
      ...(attemptDeps === undefined ? {} : { symbolDeps: attemptDeps }),
      ...(attemptRefs === undefined ? {} : { varsObjectRefs: attemptRefs }),
      profile: 'numeric-kernel',
      fallback: false,
      entryChecks: false,
    });
  } catch (e) {
    if (e instanceof EvalError || e instanceof CancellationError) throw e;
    const diagnostic = compileDiagnosticOf(e);
    recordJsProfileAttempt(
      ce,
      consumer,
      isCompileDeclineError(e) && diagnostic.code === 'outside-profile'
        ? 'declined'
        : 'failed',
      diagnostic.message
    );
    return undefined;
  }
  if (result.success !== true) {
    const diagnostic = result.diagnostic;
    recordJsProfileAttempt(
      ce,
      consumer,
      diagnostic?.code === 'outside-profile' ? 'declined' : 'failed',
      diagnostic?.message ?? result.error
    );
    return undefined;
  }
  recordJsProfileAttempt(ce, consumer, 'admitted');
  if (attemptDeps !== undefined)
    for (const name of attemptDeps) symbolDeps!.add(name);
  if (attemptRefs !== undefined)
    for (const name of attemptRefs) varsObjectRefs!.add(name);
  return result;
}

/**
 * Run `build` (a compilation of `expr`) with each callable name of `expr`
 * resolving to the binding that its occurrence in `expr` was made with.
 *
 * A call keeps the binding of the function it was written with, not the
 * binding that its name has where it is evaluated (`docs/SCOPING-MODEL.md`,
 * "Callable resolution"). The compiler reads every name in the current scope,
 * and it declines a call whose function differs from the function of its
 * name there (`assertCapturedCallableBindings()`, `base-compiler.ts`). So
 * with `c(y, D, e) := ∫ n(x, y, e) dx`, the numeric value of
 * `∫₀¹ y·c(y, L, 0.001) dy` was not computed in a scope that declares
 * another `c`: the compiled kernel was declined, and the interpreter could
 * not compute the nested integral.
 *
 * The compiler also reads, by name, the functions that the bodies of these
 * functions call, at any depth: with `c(t) := n(t) + 1`, a compilation of
 * `c(x)` compiles the body of `c`, and its call of `n` reads the `n` of the
 * current scope. So the bodies of the functions reached are walked too, and
 * each callable name found there is resolved in the same way.
 *
 * The names are put, with the bindings of their occurrences, in a scope that
 * exists only while the compilation runs, as `withCallableBinding()` does for
 * one call. The compiler then reads the same functions as the interpreter.
 * A name bound by a binder (a parameter of a function literal, in `expr` or
 * in a body) is not resolved there. When one name denotes two different
 * functions in the occurrences reached (a call of the outer `n` in the body
 * of `c`, and a call of the inner `n` in `expr`), no single scope gives each
 * occurrence its function, and the compilation is declined: it throws, and
 * `implicitCompile()` returns `undefined`.
 *
 * Only the operator of a call is resolved this way. The interpreter reads a
 * symbol by its name, also a symbol that names a function and is passed as
 * an argument (`h(g, x)` with `h := (p, a) ↦ p(a)`). When a name that the
 * scope would change is also read as a symbol, the compilation is declined
 * too.
 */
function withCapturedCallBindings<T>(
  ce: IComputeEngine,
  expr: Expression,
  build: () => T
): T {
  const engine = expr.engine;
  // For each name, the functions that its occurrences denote, keyed by the
  // half of the binding (the value or the operator definition): two binding
  // objects can hold the same definition.
  const reached = new Map<string, Map<object, BoxedDefinition>>();
  const seen = new Set<Expression>();
  const walkedBodies = new Set<Expression>();
  const dataNames = new Set<string>();
  const walkedValues = new Set<Expression>();
  const halfOf = (b: BoxedDefinition): object =>
    'value' in b ? b.value : b.operator;
  const walk = (node: Expression, bound: ReadonlySet<string>): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const name = isSymbol(node)
      ? node.symbol
      : isFunction(node)
        ? node.operator
        : undefined;
    // A call made before its function was defined, in the body of a node
    // that owns a local scope (the `Block` of an integrand), is bound to a
    // placeholder declared in that scope (`markForwardCallReference()`). The
    // scope lists the name as one it binds, but the placeholder holds no
    // function: the call reads the definition of the enclosing scope, and is
    // resolved here as an unbound call. A symbol bound to the same
    // placeholder (the callback `g` of `h(g, 2)` beside the call `g(2)`) is
    // not a local either: it is recorded as a name read as a value, so a
    // scope that would change the function it reads declines the
    // compilation (`dataNames` below).
    const forwardPlaceholder =
      node.valueDefinition !== undefined &&
      isForwardCallReference(node.valueDefinition);
    if (name !== undefined && (!bound.has(name) || forwardPlaceholder)) {
      // A free name or a free call head (`binding-unit.ts`) has no
      // definition of its own: it reads the definition that its name
      // resolves to now (`freeBinding()`).
      const free = freeBinding(node);
      const value =
        node.valueDefinition ??
        (free !== undefined && 'value' in free ? free.value : undefined);
      const operator =
        node.operatorDefinition ??
        (free !== undefined && 'operator' in free ? free.operator : undefined);
      // The definition that a call reads: the value definition when it holds
      // a function literal, otherwise the operator definition (a node can
      // have both, a value definition with no value beside the operator
      // definition that `ce.assign()` makes).
      const own: BoxedDefinition | undefined = isFunction(
        value?.value,
        'Function'
      )
        ? { value: value! }
        : operator !== undefined
          ? { operator }
          : value !== undefined
            ? { value }
            : undefined;
      // Only the operator of a call is resolved as a callable. A symbol is
      // read by name by the interpreter, a symbol passed as an argument too
      // (`h(g, x)` with `h := (p, a) ↦ p(a)`): its name is recorded, and a
      // name that is also a call of another function is not put in the
      // scope (`dataNames` below).
      if (isSymbol(node)) {
        dataNames.add(name);
        // The compiler reads the value of a symbol by its name and can
        // compile that value in place of the symbol (a constant fold). The
        // calls in the value are compiled with the same scope, so they are
        // walked too: with `a := g(x)` made in the scope of an inner `g`,
        // a compilation of `g_outer(x) + a` must not compile both calls of
        // `g` with one function.
        const ambient = engine.lookupDefinition(name);
        const stored =
          ambient !== undefined && 'value' in ambient
            ? ambient.value.value
            : undefined;
        if (stored !== undefined && !walkedValues.has(stored)) {
          walkedValues.add(stored);
          walk(stored, new Set());
        }
      } else if (own !== undefined) {
        // The binding is resolved before its function is read: a call
        // parsed before its function was defined is bound to a
        // forward-call placeholder that holds no function, and the binding
        // it resolves to does.
        const binding = callableBindingInContext(engine, name, own) ?? own;
        let functions = reached.get(name);
        if (functions === undefined) reached.set(name, (functions = new Map()));
        functions.set(halfOf(binding), binding);
        const literal =
          'value' in binding
            ? binding.value.value
            : binding.operator._lambdaLiteral;
        if (isFunction(literal, 'Function') && !walkedBodies.has(literal)) {
          walkedBodies.add(literal);
          // The literal binds its own parameters (`boundVariableNames()`).
          walk(literal, new Set());
        }
      }
    }
    if (!isFunction(node) || node._numericStore !== undefined) return;
    const names = boundVariableNames(node);
    const inner = names.length === 0 ? bound : new Set([...bound, ...names]);
    for (const op of node.ops) walk(op, inner);
  };
  walk(expr, new Set());

  const captured = new Map<string, BoxedDefinition>();
  for (const [name, functions] of reached) {
    if (functions.size > 1)
      throw new Error(
        `Could not compile \`${name}\`: the expression calls two different functions with this name.`
      );
    const binding = [...functions.values()][0];
    const ambient = engine.lookupDefinition(name);
    if (ambient !== undefined && halfOf(ambient) === halfOf(binding)) continue;
    // A name that is also read as a symbol: the scope would change the
    // symbol too, which the interpreter reads by name.
    if (dataNames.has(name))
      throw new Error(
        `Could not compile \`${name}\`: the expression calls a function with this name that is not the function the name reads in this scope, and also reads the name as a value.`
      );
    captured.set(name, binding);
  }
  if (captured.size === 0) return build();
  ce.pushScope({ parent: ce.context.lexicalScope, bindings: captured });
  try {
    return build();
  } finally {
    // The scope borrows definitions; popping it must not dispose their facts.
    captured.clear();
    ce.popScope();
  }
}

/**
 * `implicitCompile` for a caller that needs a NUMERIC function of its
 * variables (`NDSolve` right-hand sides, the nonlinear-fit model): the
 * compiled `run` projected to a real number — a plain `number` passes;
 * anything else (a `{re, im}` `ComplexResult` with a non-zero imaginary part,
 * a boolean, a collection) is `NaN`. No chop: the compiled runner's result
 * convention already returns a value whose imaginary part is exactly zero as
 * a `number` (the transcendental kernels chop their own roundoff dust), so a
 * `{re, im}` here is a genuine domain escape.
 *
 * Returns `undefined` when the expression does not compile (same contract as
 * `implicitCompile`). It replaced the former `realOnly: true` compile option
 * at these call sites, which has since been removed
 * (`docs/COMPILATION-MODEL.md`).
 *
 * `consumer` and `options` are passed to `implicitCompile()`; `options`
 * are compile options, such as `vars`.
 */
export function implicitCompileNumeric(
  ce: IComputeEngine,
  expr: Expression,
  consumer: string,
  options?: Record<string, unknown>
): ((vars: Record<string, number>) => number) | undefined {
  return implicitCompileNumericResult(ce, expr, consumer, options)?.fn;
}

/**
 * `implicitCompileNumeric`, with the compilation result the function comes
 * from: a caller that ships the stored code to a worker (the `FindFit` scan
 * on a kernel pool) reads its `code`, preambles and `runtimeVersion`.
 */
export function implicitCompileNumericResult(
  ce: IComputeEngine,
  expr: Expression,
  consumer: string,
  options?: Record<string, unknown>
):
  | {
      fn: (vars: Record<string, number>) => number;
      result: ReturnType<IComputeEngine['_compile']>;
    }
  | undefined {
  const compiled = implicitCompile(ce, expr, consumer, options);
  if (!compiled?.success || typeof compiled.run !== 'function')
    return undefined;
  const run = compiled.run as (vars: Record<string, number>) => unknown;
  return {
    fn: (vars) => {
      const v = run(vars);
      return typeof v === 'number' ? v : NaN;
    },
    result: compiled,
  };
}
