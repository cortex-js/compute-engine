// The closed form of a definite integral for compiled code: the
// antiderivative-first attempt, its budgets and its record of timeouts. The
// IR pipeline (`interval-quadrature.ts`) shares it.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import {
  isTimeoutCancellation,
  throwIfCallerCancellation,
  type StepBudget,
} from '../../common/interruptible.js';
import { multiClauseState } from '../multi-clause.js';
import { unstableClosedForms } from '../symbolic/antiderivative.js';
import { userFunctionLiteral } from './user-function-literal.js';

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
const ANTIDERIVATIVE_ATTEMPT_STEPS = 300_000;

/** The wall-clock guard of all the attempts of one compilation. An attempt
 *  that spends its time in code that does not count steps (a polynomial
 *  GCD on coefficients with thousands of digits) can use its whole hang
 *  limit while spending few steps, so the step pool alone would not keep
 *  a compilation with many such integrals short. This guard can decide
 *  which integrals get a closed form only when the attempts of one
 *  compilation spend 30 s in total, a case that does not reach the step
 *  pool first unless each step is slow: there the result can still depend
 *  on the machine. */
const ANTIDERIVATIVE_COMPILATION_HANG_MS = 30_000;

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
 * Reset at each DEPTH-0 entry of `withCompilationBudgets()`. Nested
 * compilations consume the outer pool rather than getting a fresh one, so
 * the aggregate is bounded by one pool per depth-0 entry. A caller that
 * deliberately issues several root compilations against one target — a
 * multi-statement shader body compiles each statement separately —
 * therefore gets one pool per statement, which
 * keeps each statement's compile time bounded exactly as one expression's
 * is.
 */
const ANTIDERIVATIVE_COMPILATION_STEPS = 600_000;

/** The wall-clock guard of one attempt: see
 *  {@link ANTIDERIVATIVE_ATTEMPT_STEPS}. */
const ANTIDERIVATIVE_ATTEMPT_HANG_MS = 30_000;

/**
 * The budgets of the antiderivative-first attempts, module state that both
 * compilers assign (`CompilerState` reads and writes its fields through
 * accessors). Module state is safe: compilation is synchronous and
 * single-threaded.
 */
const antiderivativeBudgets = {
  /** Remaining wall-clock guard of the current compilation — see
   *  {@link ANTIDERIVATIVE_COMPILATION_HANG_MS}. */
  hangMsLeft: ANTIDERIVATIVE_COMPILATION_HANG_MS,
  /** The per-attempt budget in force: the constant above, unless a test
   *  shortened it with {@link setAntiderivativeAttemptBudgetForTesting}. */
  attemptSteps: ANTIDERIVATIVE_ATTEMPT_STEPS,
  /** Remaining shared antiderivative budget for the current compilation —
   *  see {@link ANTIDERIVATIVE_COMPILATION_STEPS}. */
  stepsLeft: ANTIDERIVATIVE_COMPILATION_STEPS,
  /** The number of compilations of the IR pipeline in progress
   *  (`withCompilationBudgets()`): while one runs, a compilation that starts
   *  consumes its antiderivative pool. */
  irCompileDepth: 0,
  nextDefinitionId: 1,
  /** How many antiderivative-first attempts have RUN, as opposed to being
   *  skipped. Read by tests, before and after a compilation. */
  attemptCount: 0,
};

/**
 * Start a fresh compilation's shared budgets — today just the
 * antiderivative pool. Called from the depth-0 boundary of
 * `withCompilationBudgets()` (see {@link ANTIDERIVATIVE_COMPILATION_STEPS}
 * for why no shallower entry covers them all).
 */
function resetSharedCompilationBudgets(): void {
  antiderivativeBudgets.stepsLeft = ANTIDERIVATIVE_COMPILATION_STEPS;
  antiderivativeBudgets.hangMsLeft = ANTIDERIVATIVE_COMPILATION_HANG_MS;
}

/**
 * `f()`, a compilation, with a fresh antiderivative pool when no
 * compilation is in progress; a compilation that starts inside it consumes
 * its pool.
 */
export function withCompilationBudgets<T>(f: () => T): T {
  if (antiderivativeBudgets.irCompileDepth === 0)
    resetSharedCompilationBudgets();
  antiderivativeBudgets.irCompileDepth += 1;
  try {
    return f();
  } finally {
    antiderivativeBudgets.irCompileDepth -= 1;
  }
}

/**
 * The integrals whose antiderivative-first attempt TIMED OUT, per engine,
 * and the engine state they timed out in.
 *
 * One document compiles the same integral several times: once per target,
 * and again inside each helper that holds it. The Tycho corpus document
 * `thpezd39zq` issues five compilations over two integrands, and each one
 * ran the symbolic search to its two-second limit before emitting numeric
 * integration. A search that ran out of time once will run out of time
 * again while nothing it reads has changed, so the next compilation of that
 * integral goes to the numeric emitter at once.
 *
 * A timeout is not proof that no closed form exists: it depends on the
 * load of the machine. So the record is kept only while the engine state
 * the search reads is the one the attempt ran in, and only for an attempt
 * that was granted its full budget and used it — one shortened by a nearly
 * empty compilation pool says little. The state has two parts. `stamp` is the engine's
 * `semantic` invalidation version, which every assignment, assumption and
 * configuration change (angular unit, precision) advances; a changed stamp
 * drops every record. A DECLARATION does not advance that version, so the
 * key of a record carries the declared type of every symbol of the
 * integral beside its MathJSON (`antiderivativeKey`), with the value the
 * symbol holds and, for a function, which definition the name resolves to:
 * a declaration in a nested scope that shadows a symbol or a function of
 * the integrand changes one of them. The integration provider is compared too
 * (`provider`): loading another rule set replaces it without an engine
 * state event. The `any` and `callable` versions are not usable: a
 * parse and a compilation advance it, and one search advances it more than
 * a thousand times. Closed forms and searches that completed without one
 * are not recorded: they are quick to repeat.
 *
 * The declared TYPES are compared by inclusion, not for equality. A record
 * made with narrower declared types answers a lookup with wider ones
 * (`k: real<0..>` answers `k: real`, `x: real` answers `x: number`): a
 * search that ran out of time knowing more about its symbols is not
 * expected to finish knowing less. A host declares other types for another
 * target — Tycho declares `k: real<0..>, x: real` for the JavaScript target
 * and `k: real, x: number` for the interval target — and the second target
 * of a row then skips the search. The other direction does not hold: a
 * narrower type can be what lets a search finish. This is a judgment about
 * the search, which the user approved, and not a property that is proved.
 * So `integrals` maps the key of an integral to the lists of declared types
 * it timed out under, in the order of the key's names.
 */
const antiderivativeTimeouts = new WeakMap<
  object,
  {
    stamp: string;
    provider: unknown;
    integrals: Map<string, Type[][]>;
  }
>();

/** A number for each definition object met by {@link antiderivativeKey},
 *  so that a key can say WHICH definition a name resolved to. */
const definitionIds = new WeakMap<object, number>();

/** The most lists of types {@link antiderivativeTimeouts} holds for one
 *  engine; the record is emptied when it would grow past this. */
const MAX_ANTIDERIVATIVE_TIMEOUT_RECORDS = 256;

/** How many lists of types a record holds, over all its integrals. */
function recordedTypeLists(integrals: Map<string, Type[][]>): number {
  let count = 0;
  for (const lists of integrals.values()) count += lists.length;
  return count;
}

/** The engine state a record of {@link antiderivativeTimeouts} is valid
 *  in. */
function antiderivativeStateStamp(engine: ComputeEngine): string {
  return String(engine._semanticVersion);
}

/**
 * One integral as {@link antiderivativeTimeouts} records it. `key` is its
 * operands as MathJSON, and for each symbol and each function head in them,
 * what the name resolves to — the value of a symbol, the definition of a
 * function. `types` is the DECLARED type of each symbol the key names by
 * its content, in the order of the names; the types are kept out of the key
 * because they are compared by inclusion.
 *
 * An INFERRED type is left out. The engine narrows the type of a symbol
 * that has no declaration each time the symbol is used, so that type goes
 * on changing through the search itself and through the rest of the
 * compilation, and a key that carried it would not be found again. It is
 * also not an input: it follows from the uses, which are the same the next
 * time. A declaration replaces the inferred type with a stated one, and
 * that does change the key.
 */
function antiderivativeKey(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  ops: ReadonlyArray<unknown>,
  shadowed: ReadonlyMap<string, Type>
): { key: string; types: Type[] } {
  const types: Type[] = [];
  const names = new Set(args.flatMap((a) => a.symbols));
  const addHeads = (e: Expression): void => {
    if (!isFunction(e)) return;
    names.add(e.operator);
    e.ops.forEach(addHeads);
  };
  args.forEach(addHeads);
  const bindings = [...names].sort().map((n) => {
    // A name that the attempt declares again in its isolation scope
    // (`shadowedOperandSymbols`) reads as that declaration: a fresh
    // symbol of the type below, whatever the caller's scope binds the
    // name to.
    const local = shadowed.get(n);
    if (local !== undefined) {
      types.push(local);
      return `${n}:local`;
    }
    const def = engine.lookupDefinition(n);
    // A name with no definition gets an INFERRED one the first time it is
    // used, which can be during the search itself. Both read as the bare
    // name, for the reason given above for an inferred type.
    const inferred =
      def === undefined ||
      (isValueDef(def) && def.value.inferredType) ||
      (isOperatorDef(def) && def.operator.inferredSignature);
    if (inferred) return n;
    // A VALUE definition reads as its content: its declared type, whether
    // it is a constant, when its value is substituted (`holdUntil`: the
    // search evaluates, so a value held until `N` stays a bare symbol in
    // it), and the digest of the value it holds. A host that declares the
    // symbols of a row in a scope of its own for every compilation makes a
    // new definition object each time, so the object's identity would
    // never be met again, while the content is what the search reads.
    //
    // The digest of a held value names a symbol inside it by NAME only,
    // whatever that symbol is bound to. So the content stands for the
    // definition only when the held value mentions no symbol; any other
    // value definition reads as which definition object it is, as an
    // operator definition does.
    if (isValueDef(def)) {
      const held = def.value.value;
      if (held === undefined || held.symbols.length === 0) {
        const policy = `${def.value.isConstant ? 'const' : 'var'}/${def.value.holdUntil}`;
        types.push(def.value.type.type);
        return `${n}:${policy}=${held?.digest ?? ''}`;
      }
    }
    let id = definitionIds.get(def);
    if (id === undefined) {
      id = antiderivativeBudgets.nextDefinitionId++;
      definitionIds.set(def, id);
    }
    return `${n}#${id}`;
  });
  return { key: `${JSON.stringify(ops)}|${bindings.join(',')}`, types };
}

/**
 * The symbols of the integral's operands that the caller's scope resolves,
 * by name, to a definition other than their own, with their types.
 *
 * `closedFormIntegral` boxes the operands again from MathJSON, and the
 * boxing resolves each symbol by NAME in the caller's scope. A symbol bound
 * by a scope that is not visible there — a parameter of the function body
 * being compiled — then becomes whatever the name means in that scope: a
 * parameter `e` becomes Euler's number, `i` the imaginary unit, `Pi` the
 * constant π, and a parameter `y` the global `y` with its value. With
 * `q(y, e) := ∫₀¹ e·x dx`, the compiled `q(y, 2)` gave e/2 in place of 1.
 * The attempt declares each of these names again in its isolation scope,
 * so that the boxed operands read a plain symbol of the same type, which
 * the caller's `compile()` then resolves by name against the target's
 * bindings, as it does for every other free symbol of the closed form.
 *
 * A name the caller's scope does not define is not included: the boxing
 * declares it in the isolation scope anyway. Only value bindings are
 * checked; the head of a call is not a symbol operand.
 *
 * The table is keyed by name, and it also holds an index bound inside the
 * operands (the `e` of `\sum_{e=1}^{3} e x`). A free use of the same name in
 * the same integrand then reads as that index while the closed form is
 * searched. This does not change a value: the binder declares its index
 * again in its own scope, and the caller's `compile()` resolves the free
 * symbols of a closed form by name.
 */
function shadowedOperandSymbols(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>
): Map<string, Type> {
  const result = new Map<string, Type>();
  const visit = (e: Expression): void => {
    if (isSymbol(e)) {
      const own = e.valueDefinition;
      if (own === undefined || result.has(e.symbol)) return;
      const def = engine.lookupDefinition(e.symbol);
      if (def === undefined) return;
      if (isValueDef(def) && def.value === own) return;
      result.set(e.symbol, e.type.type);
      return;
    }
    if (isFunction(e)) e.ops.forEach(visit);
  };
  args.forEach(visit);
  return result;
}

/** The names that a fold must not read the value of
 *  (`reachesExcludedName()`): the `vars`-mapped symbols, the operators
 *  that the caller overrides, and the memo of the answers per name. */
type FoldExclusions = {
  varsKeys?: ReadonlySet<string>;
  foldExcludedOps?: ReadonlySet<string>;
  foldReachMemo?: Map<string, boolean>;
};

/** What `closedFormIntegral()` reads of a target: its `vars` rule. */
export type ClosedFormTarget = FoldExclusions & {
  var: (id: string) => string | undefined;
};

/**
 * Whether any operand of the integral reaches a `vars`-mapped symbol — one
 * the caller pinned to a runtime input — directly or through an assigned
 * value or a user-function body (`reachesExcludedName`), when that symbol
 * still has an engine value. Such a value must not be baked into the
 * code, so the antiderivative-first path, which resolves the integral
 * through `evaluate()`, is skipped when the integral touches one.
 *
 * A `vars`-mapped symbol with NO value whose mapping is a plain read of
 * an input (an identifier `u_a`, or a member read `_.a`) does not block the
 * closed form: `evaluate()` keeps it as a symbol, and the closed form
 * compiles it as that read, as it does for a free symbol. This is the usual
 * case for a declared input, whose value the target's `compile()` hides for
 * the compilation (`withVarsValuesHidden`): `∫₀ˣ a·t dt` with `a` mapped to
 * `_.a` compiles to `0.5·a·x²`, as it does for an `a` with no value. A
 * mapping to other source still blocks it (the source may not be a pure
 * read), and so does a caller-overridden operator: `evaluate()` would not
 * run the caller's implementation.
 */
function referencesVarsSymbol(
  args: ReadonlyArray<Expression>,
  target: ClosedFormTarget
): boolean {
  const vars = target.varsKeys;
  if (vars !== undefined && vars.size > 0) {
    const engine = args[0].engine;
    let valued: Set<string> | undefined;
    for (const s of vars) {
      const source = target.var?.(s);
      const plainRead =
        typeof source === 'string' &&
        /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/.test(source);
      if (!plainRead || engine._getSymbolValue(s) !== undefined)
        (valued ??= new Set()).add(s);
    }
    if ((valued?.size ?? 0) < vars.size) {
      // A reduced exclusion set: the memo on `target` belongs to the full
      // set, so the walk gets a target record of its own.
      const reduced = {
        varsKeys: valued,
        foldExcludedOps: target.foldExcludedOps,
      } as FoldExclusions;
      return args.some((a) => reachesExcludedName(a, reduced));
    }
  }
  return args.some((a) => reachesExcludedName(a, target));
}

/**
 * Whether evaluating `expr` at compile time would bake in something that
 * must stay live at run time: `expr` mentions a `vars`-mapped input or a
 * caller-overridden operator (see `mentionsExcludedName`) either directly,
 * or through the assigned value of a symbol it reads, or through the body
 * of a user-defined function it calls or passes as a value — at any depth.
 *
 * The compile-time folder evaluates a subtree through the engine, and the
 * engine reads every assigned value and applies every user function it
 * reaches. With `a := sin(y_0)` and `y_0` a `vars`-mapped input that also
 * holds a value, `cos(a)` mentions no mapped name itself, yet folding it
 * bakes `y_0`'s current value into the code, and a later write to the input
 * has no effect: a slider-dependent document definition drew outdated
 * geometry (Tycho item 328). The same holds for the body of `u := L ↦ 2L −
 * a` under the call `u(1)`, and for a caller-overridden function reached
 * through a value, which the fold would evaluate through the engine
 * instead of running the caller's implementation.
 *
 * The answer for a name depends only on the engine's definitions, which do
 * not change while one expression compiles, so it is memoized per name in
 * `target.foldReachMemo`, and a function node already walked in this call
 * is not walked again. A name whose walk is in progress (a value that
 * refers to itself) answers `false` at the re-entry, and that answer is
 * provisional: a walk that met such a re-entry may have been cut short by
 * the cycle, so its `false` is not memoized, while a walk that met none is
 * complete and is. A `true` is memoized from any depth. Definitions rarely
 * form a cycle (the engine cannot evaluate one), so in practice every name
 * is walked once and a tower of definitions sharing dependencies costs
 * linear work.
 *
 * A parameter or binder index that shadows a same-named engine symbol is
 * not tracked: its engine value is walked too, which can only report a
 * mention that is not there, and a spurious mention costs one fold, never
 * a wrong value.
 */
function reachesExcludedName(
  expr: Expression,
  target: FoldExclusions
): boolean {
  const vars = target.varsKeys;
  const ops = target.foldExcludedOps;
  if (
    (vars === undefined || vars.size === 0) &&
    (ops === undefined || ops.size === 0)
  )
    return false;
  const memo = (target.foldReachMemo ??= new Map());
  const engine = expr.engine;
  const walking = new Set<string>();
  const seen = new Set<Expression>();
  // How many times a walk short-circuited on a name already in progress.
  // A name's walk compares the count before and after: unchanged means no
  // cycle cut it short and its `false` is final.
  let reentries = 0;
  const viaName = (s: string): boolean => {
    const known = memo.get(s);
    if (known !== undefined) return known;
    if (walking.has(s)) {
      reentries += 1;
      return false;
    }
    walking.add(s);
    const before = reentries;
    let hit = false;
    try {
      const value = engine._getSymbolValue(s);
      if (value !== undefined) hit = visit(value);
      if (!hit) {
        const literal = userFunctionLiteral(engine, s);
        if (literal !== undefined && literal !== value) hit = visit(literal);
      }
      // A multi-clause function has no single literal: each clause's body
      // is read, as `foldValueImpure` reads them.
      if (!hit) {
        const clauses = multiClauseState(engine.lookupDefinition(s))?.clauses;
        if (clauses !== undefined) hit = clauses.some((c) => visit(c.literal));
      }
    } finally {
      walking.delete(s);
    }
    if (hit || reentries === before) memo.set(s, hit);
    return hit;
  };
  const visit = (e: Expression): boolean => {
    if (isSymbol(e)) {
      const s = e.symbol;
      if (vars?.has(s) === true || ops?.has(s) === true) return true;
      return viaName(s);
    }
    if (isDictionary(e)) return e.values.some(visit);
    if (isFunction(e)) {
      if (seen.has(e)) return false;
      seen.add(e);
      const h = e.operator;
      if (ops?.has(h) === true) return true;
      if (e.ops.some(visit)) return true;
      return viaName(h);
    }
    return false;
  };
  return visit(expr);
}

/**
 * The closed form of `Integrate(f, (x, a, b))`, or `undefined` when the
 * integral does not resolve symbolically and the caller must emit its own
 * numeric integration.
 *
 * **Antiderivative-first.** The integral is resolved symbolically via
 * `evaluate()` (the provider/Rubi + built-in antiderivative + FTC). If it
 * closes to a form free of any residual `Integrate` — e.g. a plotted
 * `∫₀ˣ f(t) dt` whose closed form is a function of the free bound `x` — that
 * straight-line expression is returned, so each sample costs ~µs instead of a
 * full numeric integration. The symbolic attempt runs under its own
 * {@link ANTIDERIVATIVE_ATTEMPT_STEPS} span (tightened further by an
 * enclosing span, never extended), so a non-elementary integrand degrades to
 * the caller's numeric emitter rather than hanging.
 *
 * **`vars` inputs.** A `vars`-mapped symbol must survive to run time as a
 * live input (the vars contract): its value must never be baked into the
 * code. The attempt is skipped when the integral reaches, directly or
 * through an assigned value or a user-function body, a `vars`-mapped symbol
 * that still has a visible engine value, or whose mapping is not a plain
 * read of an input (an identifier `u_a` or a member read `_.a`: other
 * source may not be a pure read), or a caller-overridden operator (which
 * `evaluate()` would not run). A `vars`-mapped symbol with no visible value
 * and a plain-read mapping does NOT skip it: `evaluate()` keeps the symbol,
 * and the closed form compiles it as the mapped read, so the input stays
 * live — `∫₀ˣ a·t dt` with `a` mapped to `_.a` compiles to `0.5·a·x²`. A
 * declared input that holds a value is in that case too, since the
 * target's `compile()` hides its value for the compilation
 * (`withVarsValuesHidden`). See `referencesVarsSymbol`.
 *
 * The returned expression is accepted only when it is valid, free of any
 * residual `Integrate`, and not NaN — but it can still contain a head the
 * CALLER's target has no lowering for, so callers must compile it inside a
 * `try` and fall through to their numeric emitter when that throws.
 *
 * `readsAngularDefinition`: a test needed only in an angular unit other
 * than radians; without it there is no closed form in such a unit.
 */
export function closedFormIntegral(
  args: ReadonlyArray<Expression>,
  target: ClosedFormTarget,
  readsAngularDefinition?: (expr: Expression) => boolean
): Expression | undefined {
  const engine = args[0].engine;
  // A bound that is a name with no
  // type (`x` in `\int_x^\infty f(y) dy`) is required to be a number here:
  // the compiled code reads it as one. The requirement is written in the
  // environment of the compilation in progress, so a compilation that makes
  // no search (a recorded timeout, an empty pool) must write it too.
  for (const limit of args.slice(1)) {
    if (!isFunction(limit, 'Limits')) continue;
    for (const bound of limit.ops.slice(1))
      if (isSymbol(bound) && bound.type.type === 'unknown')
        bound._infer(() => 'number');
  }
  if (referencesVarsSymbol(args, target)) return undefined;

  // The attempt evaluates in radian mode (see below), but the value of an
  // assigned symbol and the body of a user function that the integrand
  // reads are stored in the engine's unit, and were not rewritten: in
  // degree mode `∫₀ˣ k dt` with `k := Sin(30)` compiled to `x·sin(30 rad)`,
  // -1.976 at x = 2 instead of 1. Such an integral is not attempted, and
  // compiles by its numeric route, where the integrand compiles
  // structurally with each stored value rewritten for the unit
  // (`foldedValueInRadians()`). The test is the one of the constant
  // folder (`readsAngularDefinition()`).
  if (
    engine.angularUnit !== 'rad' &&
    (readsAngularDefinition === undefined ||
      args.some((a) => readsAngularDefinition(a)))
  )
    return undefined;
  let closed: Expression | undefined;
  // Isolation scope — a child of the caller's scope, so everything the
  // caller declared stays visible; only what this attempt declares is
  // confined, and discarded on the way out. Without it, an integrand with a
  // free single-uppercase-letter symbol (`∫ D x² dx`) devolves the unapplied
  // operator into a variable and shadows the builtin in the caller's engine
  // for good. The node must be BUILT inside the scope, not merely evaluated:
  // `Integrate` is a binder, and its evaluate handler re-enters the parent of
  // the scope its integrand literal owns — the scope fixed when that literal
  // was canonicalized (`rebindEscapingCurrentScope`). Re-boxing the operands
  // from MathJSON is what re-roots them here; `_fn` of the already-canonical
  // operands would keep the caller's scope. The closed form outlives the
  // scope: the caller's `compile()` resolves its free symbols by name against
  // the target's bindings.
  // The compilation-wide pool is consumed by the steps actually spent, so
  // hundreds of nodes cannot each arm a fresh full span — once the pool is
  // dry, remaining integrals go straight to their numeric emitter.
  if (
    antiderivativeBudgets.stepsLeft <= 0 ||
    antiderivativeBudgets.hangMsLeft <= 0
  )
    return undefined;

  // An attempt that timed out in this engine state is not repeated — see
  // `antiderivativeTimeouts`.
  const ops = args.map((x) => x.json);
  const shadowed = shadowedOperandSymbols(engine, args);
  const integral = antiderivativeKey(engine, args, ops, shadowed);
  const timeouts = antiderivativeTimeouts.get(engine);
  if (timeouts !== undefined) {
    if (
      timeouts.stamp !== antiderivativeStateStamp(engine) ||
      timeouts.provider !== engine._integrationProvider
    )
      antiderivativeTimeouts.delete(engine);
    else if (
      // Every recorded type is included in the type declared now — see
      // `antiderivativeTimeouts` for why inclusion is enough.
      timeouts.integrals
        .get(integral.key)
        ?.some(
          (recorded) =>
            recorded.length === integral.types.length &&
            recorded.every((t, i) => isSubtype(t, integral.types[i]))
        ) === true
    )
      return undefined;
  }

  const grantedSteps = Math.min(
    antiderivativeBudgets.attemptSteps,
    antiderivativeBudgets.stepsLeft
  );
  antiderivativeBudgets.attemptCount += 1;
  // The budget object of this attempt's span, read inside the span: after
  // the attempt, `left` tells how many steps it spent and whether it ran
  // out.
  let budget: StepBudget | undefined;
  const grantedMs = Math.min(
    ANTIDERIVATIVE_ATTEMPT_HANG_MS,
    antiderivativeBudgets.hangMsLeft
  );
  let elapsedMs = 0;
  // eslint-disable-next-line no-restricted-globals
  const attemptStart = performance.now();
  const unstableBefore = unstableClosedForms.count;
  engine.pushScope();
  try {
    // A local binding in the operands (a function parameter named `e`, `i`
    // or `Pi`, or one that hides a global of the same name) is declared
    // again in the isolation scope, so the operands boxed from MathJSON
    // read it as the local, not as the constant or global of that name.
    for (const [name, type] of shadowed) engine.declare(name, type);
    closed = engine._withBudget(
      {
        ms: grantedMs,
        steps: grantedSteps,
        label: 'compile:antiderivative',
      },
      () => {
        budget = engine._deadlineFrame?.budgets?.at(-1);
        // The operands are in the radian convention (`rewriteAngularUnit`
        // runs at the compile entry), so the attempt evaluates in radian
        // mode: the interpreter's `Integrate` would otherwise rewrite them
        // for the engine's unit a second time (`withRadianConvention`),
        // and the closed form is handed to a radian-based code generator.
        return engine._withTransientAngularUnit('rad', () =>
          engine.function('Integrate', ops).evaluate()
        );
      }
    );
  } catch (e) {
    // Non-elementary / deadline: the caller falls back to numeric
    // integration.
    //
    // Only a timeout of the `compile:antiderivative` span itself allows the
    // fallback. A timeout labelled by a different span belongs to an
    // enclosing span, and is thrown again. An unlabelled enclosing span
    // gives no attribution, so `throwIfCallerCancellation` also examines
    // the enclosing frame (the frame in effect after `withTimeLimit`
    // returns) and throws its cancellation when it has expired. A
    // cancellation that is not a timeout (an abort, an iteration or
    // recursion limit) is thrown again too.
    if (isTimeoutCancellation(e)) {
      const attribution = (e as { attribution?: string }).attribution;
      if (attribution !== undefined && attribution !== 'compile:antiderivative')
        throw e;
    }
    throwIfCallerCancellation(e, engine._deadlineFrame);
  } finally {
    engine.popScope();
    const spent = grantedSteps - Math.max(0, budget?.left ?? 0);
    antiderivativeBudgets.stepsLeft -= spent;
    // eslint-disable-next-line no-restricted-globals
    elapsedMs = performance.now() - attemptStart;
    antiderivativeBudgets.hangMsLeft -= elapsedMs;
  }
  // The attempt ran out of steps, or used its whole wall-clock guard. The
  // second case is read from the clock, as the only record of a search that
  // spends its time in code that counts few steps: without it, every later
  // compilation of the integral would repeat a 30 s search. Nine tenths
  // count as the whole, because the deadline is kept on a millisecond clock
  // and can fire before this finer clock reads the full guard. A guard
  // shortened by the compilation pool is not a record: it says little about
  // the integral.
  const ranOut =
    (budget !== undefined && budget.left < 0) ||
    (grantedMs === ANTIDERIVATIVE_ATTEMPT_HANG_MS &&
      elapsedMs >= 0.9 * grantedMs);

  // A closed form that cancels in double precision is not compiled: the
  // numeric route gives the value (`unstableClosedForms`).
  const usable =
    unstableClosedForms.count === unstableBefore &&
    closed !== undefined &&
    !closed.has('Integrate') &&
    closed.isValid &&
    closed.isNaN !== true;

  // A spent budget is read from the budget object, not from the error: the
  // search does not always end by throwing the cancellation of this span.
  // A step can be counted inside code that catches the error and goes on
  // (a rule that fails is skipped), so an attempt can spend its whole
  // budget and still return an unevaluated integral. A budget stays spent
  // once spent, so `left` below zero is exact.
  if (
    !usable &&
    ranOut &&
    grantedSteps === antiderivativeBudgets.attemptSteps
  ) {
    const stamp = antiderivativeStateStamp(engine);
    let record = antiderivativeTimeouts.get(engine);
    const provider = engine._integrationProvider;
    if (
      record === undefined ||
      record.stamp !== stamp ||
      record.provider !== provider ||
      recordedTypeLists(record.integrals) >= MAX_ANTIDERIVATIVE_TIMEOUT_RECORDS
    ) {
      record = { stamp, provider, integrals: new Map() };
      antiderivativeTimeouts.set(engine, record);
    }
    // The record keeps a COPY of each type. A host can hand the engine a
    // type object of its own, change it later and declare with it again;
    // the recorded type must stay the one the search ran under.
    const types = integral.types.map((t) => structuredClone(t));
    // A recorded list that includes the new one is dropped: the new list
    // answers every lookup the old one answered. One integral therefore
    // keeps only its narrowest lists, none of which includes another.
    const kept = (record.integrals.get(integral.key) ?? []).filter(
      (recorded) =>
        !(
          recorded.length === types.length &&
          types.every((t, i) => isSubtype(t, recorded[i]))
        )
    );
    kept.push(types);
    record.integrals.set(integral.key, kept);
  }

  return usable ? closed : undefined;
}
