// Pattern matching: case tests, constructor patterns, match statements,
// switches and ternaries.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  isWildcard,
  wildcardName,
  wildcardType,
} from '../boxed-expression/pattern-utils.js';
import type { SumBucket } from '../sum-representation.js';
import {
  buildCaseClosure,
  getMatchPlan,
  type CompiledCase,
  type LeafTest,
  type Segment,
  type ElementPlan,
} from '../boxed-expression/match-dispatch.js';
import type { CompileTarget, TargetSource } from './types.js';
import { core } from './compiler-core-hooks.js';
import {
  _compileParents,
  canHoist,
  hoistStatement,
} from './compile-statements.js';
import { tempVar, withBoundScope } from './compiler-naming.js';
import { withCseBlind } from './compile-cse.js';
import type { MatchStatementClause } from './compiler-types.js';

// ───────────────────────────────────────────────────────────────────────
// `Match` compilation (Epsil structural pattern matching, Phase 4 —
// docs/LANGUAGE-MODEL.md §5).
//
// Compilation reuses the classification ladder from `match-dispatch.ts`
// (`getMatchPlan`): tier 0/1 (constant / literal / pin-of-constant) dispatch,
// tier 2 fixed-shape `List`/`Tuple` destructuring, and fail-closed for
// tier 3 and anything a target cannot express. The subject is evaluated once
// (an IIFE parameter on JS; inlined where the target has no binding form).
//
// Compiled-vs-interpreted seam (accepted, §4 Phase-2 note): number leaves are
// compared with the target's native `===`/`==`, not the interpreter's
// tolerant `isEqual` — the same float-equality seam compiled `Which` already
// has. A range pattern (§8) carries the same seam on its endpoints: compiled
// it is `s >= lo && s <= hi` (exact), interpreted an endpoint match is
// tolerant, so a subject within `engine.tolerance` *outside* an endpoint
// selects the case interpreted but not compiled. No-match falls through to
// `NaN` (matching compiled `Which`), not the interpreter's
// `["Error", "match-no-case", …]` value.
// ───────────────────────────────────────────────────────────────────────

/** Above this many integer-constant tier-0 cases, a dispatch run is emitted
 * as a `switch` (JS engines jump-table dense integer switches) instead of a
 * chain of `if (s === k)` comparisons. Below it, comparisons are simpler and
 * JIT-equivalent. */
export const MATCH_SWITCH_THRESHOLD = 8;

/** True when `cc` is an irrefutable tier-3 case — a bare wildcard (`_` or a
 * single binding `_n`) with no guard. It matches anything, so it compiles to
 * the final unconditional branch (binding the subject to the capture). */
export function isIrrefutableCase(cc: CompiledCase): boolean {
  return (
    cc.tier === 3 &&
    !cc.hasGuard &&
    cc.rawPatterns !== undefined &&
    cc.rawPatterns.length === 1 &&
    isWildcard(cc.rawPatterns[0])
  );
}

/** The ordered comparison targets of a tier-0/1 case: a constant to compare
 * the subject against (`{kind:'literal'}`) or a pin to resolve (`{kind:'pin'}`).
 * Unifies tier-0 (`dispatchKeys`) and tier-1 (`tests`). */
export function matchCaseComparisons(cc: CompiledCase): LeafTest[] {
  if (cc.tier === 0)
    return (cc.dispatchKeys ?? []).map((d) => ({
      kind: 'literal' as const,
      value: d.value,
    }));
  return cc.tests ?? [];
}

/** Compile one comparison constant/pin of a tier-0/1 case to target source,
 * throwing (fail closed, D6) when it cannot be represented: a pin of a runtime
 * value (only `isConstant` symbols and literals fold), or a string on a target
 * with no string type. */
export function compileMatchConstant(
  engine: ComputeEngine,
  cmp:
    { kind: 'literal'; value: Expression } | { kind: 'pin'; expr: Expression },
  allowStrings: boolean,
  target: CompileTarget<Expression>
): string {
  const expr = cmp.kind === 'literal' ? cmp.value : cmp.expr;
  if (isString(expr)) {
    if (!allowStrings)
      throw new Error(
        `Could not compile \`Match\`: a string constant is not compilable to "${target.language ?? 'this'}" (no string type).`
      );
    return core.compile(expr, target);
  }
  if (cmp.kind === 'pin') {
    // A pin folds only when its value is fixed at compile time: a literal, or
    // a symbol declared `isConstant` (`== Pi` → `Math.PI`). A pin of a runtime
    // variable (`== limit`) has no compile-time value → fail closed.
    const ok =
      isNumber(expr) ||
      isString(expr) ||
      (isSymbol(expr) && engine.box(expr.symbol).isConstant);
    if (!ok)
      throw new Error(
        `Could not compile \`Match\`: pin '== ${expr.toString()}' references a runtime value; not compilable.`
      );
  }
  return core.compile(expr, target);
}

/** The OR-chain condition for a tier-0/1 case: `s === c1 || s === c2 || …`,
 * with a range pattern contributing `(s >= lo && s <= hi)`. */
export function matchLeafCondition(
  engine: ComputeEngine,
  cc: CompiledCase,
  subject: string,
  eq: string,
  allowStrings: boolean,
  target: CompileTarget<Expression>
): string {
  const parts = matchCaseComparisons(cc).map((cmp) => {
    // A range pattern is a pair of native comparisons on the subject — the
    // same float seam as the `===` leaf comparisons around it (the
    // interpreter compares the endpoints tolerantly). `Infinity` bounds emit
    // the target's own infinity literal (`Infinity`, `_gpu_inf()`, …).
    if (cmp.kind === 'range')
      return (
        `(${subject} >= ${core.compile(cmp.lo, target)} && ` +
        `${subject} <= ${core.compile(cmp.hi, target)})`
      );
    return `${subject} ${eq} ${compileMatchConstant(engine, cmp, allowStrings, target)}`;
  });
  if (parts.length === 0) return 'false';
  return parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`;
}

/** Run `f` in the scope of the innermost expression being compiled that
 * has a scope of its own (a `Block`, a function literal, a scoped loop),
 * or in the current scope when there is none.
 *
 * The guards and bodies of a `Match` case are held raw, and they are
 * canonicalized when they are emitted. Without the enclosing scope, a name
 * in a case body does not resolve to the local of the block that holds the
 * `Match`: `xs = Rest(xs)` in a case body of
 * `let xs = [1, 2, 3]; while let [h, ...] = xs { …; xs = Rest(xs) }`
 * created a second binding `xs` whose type came from that body alone, and
 * the compiled code was gated on that type, not on the type of the local.
 * The interpreter canonicalizes the case bodies in the scope of the
 * running block (`buildCaseClosure`, `match-dispatch.ts`). */
export function inCompiledScope<T>(
  engine: Expression['engine'],
  f: () => T
): T {
  const parents = _compileParents;
  for (let i = parents.length - 1; i >= 0; i--) {
    const scope = parents[i].localScope;
    if (scope !== undefined) return engine._inScope(scope, f);
  }
  return f();
}

/** The canonical form of a raw `Match` case body or guard, made in the
 * scope of the expression being compiled (`inCompiledScope`). */
export function canonicalInCompiledScope(expr: Expression): Expression {
  return inCompiledScope(expr.engine, () => expr.canonical);
}

/** Compile a case body, substituting each captured name with its target
 * accessor code. Bodies with no captures compile directly (the common
 * tier-0/1 case); bodies with captures compile the shadow-correct canonical
 * body of a closure built at EMISSION time (`buildCaseClosure` — the plan no
 * longer caches closures; only the value-safe canonical structure `.op1` is
 * consumed here), with the capture names rebound to their accessors. */
export function compileMatchBody(
  cc: CompiledCase,
  accessors: Map<string, string> | undefined,
  target: CompileTarget<Expression>,
  sequenceNames?: ReadonlySet<string>
): string {
  if (cc.captureNames.length === 0)
    return core.compile(canonicalInCompiledScope(cc.body), target);
  const bodyClosure = inCompiledScope(cc.body.engine, () =>
    buildCaseClosure(cc.body.engine, cc.body, cc.captureNames)
  );
  if (bodyClosure === undefined || !isFunction(bodyClosure))
    throw new Error('Could not compile `Match`: case body is not compilable.');
  return core.compile(
    bodyClosure.op1,
    matchCaptureTarget(accessors, target, sequenceNames)
  );
}

/** Compile a case guard the same way as its body (captures rebound to
 * accessors), or `undefined` when the case has no guard. */
export function compileMatchGuard(
  cc: CompiledCase,
  accessors: Map<string, string> | undefined,
  target: CompileTarget<Expression>,
  sequenceNames?: ReadonlySet<string>
): string | undefined {
  if (!cc.hasGuard || cc.guard === undefined) return undefined;
  if (cc.captureNames.length === 0)
    return core.compile(canonicalInCompiledScope(cc.guard), target);
  const guard = cc.guard;
  const guardClosure = inCompiledScope(guard.engine, () =>
    buildCaseClosure(guard.engine, guard, cc.captureNames)
  );
  if (guardClosure === undefined || !isFunction(guardClosure))
    throw new Error('Could not compile `Match`: case guard is not compilable.');
  return core.compile(
    guardClosure.op1,
    matchCaptureTarget(accessors, target, sequenceNames)
  );
}

/** A target that resolves each captured name to its accessor code (e.g.
 * `a → s[0]`), delegating everything else to the base target. */
export function matchCaptureTarget(
  accessors: Map<string, string> | undefined,
  target: CompileTarget<Expression>,
  sequenceNames?: ReadonlySet<string>
): CompileTarget<Expression> {
  if (accessors === undefined || accessors.size === 0) return target;
  // A `...rest` capture holds a run of elements (`CompileTarget.
  // sequenceVars`, name → accessor): the list and tuple emitters spread it
  // while the name still resolves to that accessor.
  let sequenceVars = target.sequenceVars;
  if (sequenceNames !== undefined && sequenceNames.size > 0) {
    const merged = new Map(target.sequenceVars ?? []);
    for (const name of sequenceNames) {
      const accessor = accessors.get(name);
      if (accessor !== undefined) merged.set(name, accessor);
    }
    sequenceVars = merged;
  }
  return {
    ...target,
    var: (id) => accessors.get(id) ?? target.var(id),
    ...withBoundScope(target, [...accessors.keys()]),
    sequenceVars,
  };
}

/**
 * Compile a `["Match", subject, …cases]` to JavaScript: an arrow-IIFE that
 * binds the subject once, then a chain of `if (cond) return body;` statements
 * (tier 0/1 constant comparisons, tier 2 fixed-shape destructuring),
 * optionally a `switch` for a large integer-constant dispatch run, ending in
 * a trailing irrefutable case or `return NaN`.
 */
export function compileMatchJS(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource {
  const plan = getMatchPlan(engine, args);
  if (plan.errorAlt !== undefined)
    throw new Error(
      `Could not compile \`Match\`: an or-alternative binds the name '${plan.errorAlt.toString()}'; not compilable.`
    );

  // The emission below is an arrow function, so a `break`/`continue` (or a
  // `Return`) in a case body cannot reach the loop or function that
  // encloses the `Match`: the interpreter lets a `match` arm inside a loop
  // body `break` (Epsil's `while let` lowers to exactly that shape), but
  // emitted inside the arrow it is a syntax error that would surface only
  // when the whole unit is instantiated. Decline here, naming the cause.
  for (const caseExpr of args.slice(1)) {
    if (!isFunction(caseExpr, 'MatchCase') || caseExpr.ops.length < 2) continue;
    const body = caseExpr.ops[caseExpr.ops.length - 1];
    const control = escapingControl(body);
    if (control !== undefined)
      throw new Error(
        `Could not compile \`Match\`: a case body contains \`${control}\`, which cannot leave the ` +
          `compiled match (an arrow function).`
      );
  }

  const s = tempVar(target);
  const nl = target.ws('\n');
  const stmts: string[] = [];
  let done = false;

  for (const seg of plan.segments) {
    if (done) break;
    if (seg.kind === 'dispatch' && matchSwitchable(seg)) {
      stmts.push(emitMatchSwitch(engine, seg, s, target));
      continue;
    }
    for (const cc of seg.cases) {
      if (done) break;
      if (isIrrefutableCase(cc)) {
        const acc =
          cc.captureNames.length === 1
            ? new Map([[cc.captureNames[0], s]])
            : undefined;
        stmts.push(`return ${compileMatchBody(cc, acc, target)};`);
        done = true;
        break;
      }
      stmts.push(emitMatchCaseJS(engine, cc, s, target));
    }
  }

  if (!done) stmts.push('return NaN;');

  const subjCode = core.compile(args[0], target);
  return `((${s}) => {${nl}${stmts.join(nl)}${nl}})(${subjCode})`;
}

/** The head of the first `Break`, `Continue` or `Return` in `expr` that
 * would leave the expression, or `undefined` when there is none. A `Loop`
 * owns the `Break`/`Continue` inside it but passes a `Return` through (the
 * interpreter's `Loop` propagates a `Return` unchanged), so the walk keeps
 * looking for a `Return` under a nested loop; a `Function` literal owns
 * all three. */
/**
 * Refuse a `Loop` over SEVERAL `Element` clauses whose body can `break`:
 * the interpreter runs the clauses as one loop and a `Break` stops the
 * whole traversal, while the nested `for` statements every target emits
 * would leave only the innermost one and go on with the outer turns. A
 * `Continue` resumes the innermost turn on both, so it is fine; a `Break`
 * inside a nested `Loop` or a function literal belongs to that construct
 * (`escapingControl`).
 */
export function assertBreakLeavesWholeLoop(
  elements: ReadonlyArray<Expression>,
  body: Expression
): void {
  if (elements.length > 1 && escapingControl(body) === 'Break')
    throw new Error(
      'Could not compile `Loop`: a `break` inside a loop over several Element clauses stops ' +
        'the whole loop in the interpreter, but would leave only the ' +
        'innermost emitted loop. The interpreter evaluates it instead.'
    );
}

export function escapingControl(
  expr: Expression,
  inLoop = false
): string | undefined {
  if (!isFunction(expr)) return undefined;
  const h = expr.operator;
  if (h === 'Return') return h;
  if ((h === 'Break' || h === 'Continue') && !inLoop) return h;
  if (h === 'Function') return undefined;
  const nested = inLoop || h === 'Loop';
  for (const op of expr.ops) {
    const found = escapingControl(op, nested);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Emit one non-irrefutable case as a guarded early-return `if`. */
export function emitMatchCaseJS(
  engine: ComputeEngine,
  cc: CompiledCase,
  s: string,
  target: CompileTarget<Expression>
): string {
  const { cond, accessors, sequenceNames } = matchCaseTest(
    engine,
    cc,
    s,
    target
  );
  const body = compileMatchBody(cc, accessors, target, sequenceNames);
  return `if (${cond}) return ${body};`;
}

/**
 * The JS test that a non-irrefutable case matches the subject bound to
 * `s` — its pattern test and its guard, conjoined — with the accessor of
 * each name the pattern binds. Shared by the value form (`emitMatchCaseJS`)
 * and the statement form (`compileMatchStatement`), which differ only in
 * what they emit under the test. A refutable tier-3 pattern has no compiled
 * matcher and fails closed here.
 */
export function matchCaseTest(
  engine: ComputeEngine,
  cc: CompiledCase,
  s: string,
  target: CompileTarget<Expression>
): {
  cond: string;
  accessors: Map<string, string> | undefined;
  sequenceNames?: ReadonlySet<string>;
} {
  if (cc.tier === 0 || cc.tier === 1) {
    const cond = matchLeafCondition(engine, cc, s, '===', true, target);
    const guard = compileMatchGuard(cc, undefined, target);
    return {
      cond: guard === undefined ? cond : `(${cond}) && (${guard})`,
      accessors: undefined,
    };
  }

  if (cc.tier === 2) {
    const conds: string[] = [];
    const accessors = new Map<string, string>();
    const sequenceNames = new Set<string>();
    core.walkMatchShape(
      engine,
      cc.shape!,
      s,
      conds,
      accessors,
      target,
      sequenceNames
    );
    const guard = compileMatchGuard(cc, accessors, target, sequenceNames);
    if (guard !== undefined) conds.push(`(${guard})`);
    return { cond: conds.join(' && '), accessors, sequenceNames };
  }

  // A bare binding or `_` WITH a guard (`x: integer`, `n if n > 0`) is
  // classified tier 3 by the ladder — the generic matcher binds it — but
  // its test is the guard alone, with the name bound to the subject.
  if (
    cc.tier === 3 &&
    cc.hasGuard &&
    cc.rawPatterns?.length === 1 &&
    isWildcard(cc.rawPatterns[0]) &&
    cc.captureNames.length <= 1
  ) {
    const accessors =
      cc.captureNames.length === 1
        ? new Map([[cc.captureNames[0], s]])
        : undefined;
    const guard = compileMatchGuard(cc, accessors, target);
    return { cond: guard ?? 'true', accessors };
  }

  // The SUM-CONSTRUCTOR tier (`docs/plans/2026-08-12-sum-type-sugar-and-
  // compilation.md` §B3): a pattern whose head names a variant of a
  // sugar-declared sum. It is classified tier 3 by the interpreter's ladder
  // (which reaches it with the generic matcher), but the compiler CAN lower
  // it — against the same per-sum representation policy the constructors
  // emit under.
  const ctor = matchConstructorTest(engine, cc, s, target);
  if (ctor !== undefined) return ctor;

  // Tier 3, refutable: no compiled reference implementation of the generic
  // matcher — fail closed, naming the offending pattern so the caller can
  // rewrite it with destructuring or guards.
  const p = cc.rawPatterns?.[0];
  throw new Error(
    `Could not compile \`Match\`: pattern '${p?.toString() ?? '?'}' is not compilable; ` +
      `rewrite with destructuring or guards.`
  );
}

/**
 * Compile a `Match` that stands as a STATEMENT in a loop body (or in a
 * branch of a statement-form `If` inside one) to a chain of `if`/`else`
 * statements, or `undefined` when the `Match` is not that shape and the
 * value form (`compileMatchJS`) must take it.
 *
 * The value form is an arrow function, so a `break` or `continue` in a
 * case body cannot reach the enclosing loop — which is exactly what a
 * `match` arm inside a `for` body does, and what Epsil's `while let` lowers
 * to: `Loop(Match(subject, MatchCase(pattern, body), MatchCase(_,
 * Break())))`. Emitted as statements the control flow is native:
 *
 *   { const _s = subject;
 *     if (Array.isArray(_s) && _s.length >= 1) { <body with h → _s[0]> }
 *     else { break } }
 *
 * The case tests and capture accessors are the value form's
 * (`matchCaseTest`); the bodies go through `compileLoopBody`, so a `Block`
 * body is a statement list and its `break`/`continue`/`Return` are
 * statements. The subject is bound once to a block-scoped constant.
 *
 * Statement position has no value to hold a `match-no-case` error, so only
 * a `Match` with an irrefutable case takes this form; the first such case
 * is the `else` and the cases after it are dead, as in the value form. Any
 * other `Match` keeps the value form, which reports its shortfall. A large
 * integer-constant
 * dispatch is emitted as an `if` chain here, not the value form's
 * `switch`: a `break` inside a `switch` would end the `switch`, not the
 * loop. JavaScript only — the GPU targets override `Match` wholesale, and
 * the interval and Python targets decline the head.
 */
export function compileMatchStatement(
  expr: Expression & FunctionInterface,
  target: CompileTarget<Expression>
): string | undefined {
  if ((target.language ?? 'javascript') !== 'javascript') return undefined;
  const engine = expr.engine;
  const args = expr.ops;
  const plan = getMatchPlan(engine, args);
  if (plan.errorAlt !== undefined) return undefined;
  const cases = plan.segments.flatMap((seg) => seg.cases);
  const lastIndex = cases.findIndex((cc) => isIrrefutableCase(cc));
  if (lastIndex < 0) return undefined;
  const last = cases[lastIndex];

  // As in the value form, emission runs under a blind CSE instance: the
  // guards and bodies are compiled from closure trees the plan builds, not
  // from the `Match` operands a region could have indexed.
  return withCseBlind(target, () => {
    const s = tempVar(target);
    const nl = target.ws('\n');
    const branches: string[] = [];
    for (const cc of cases.slice(0, lastIndex)) {
      const { cond, accessors, sequenceNames } = matchCaseTest(
        engine,
        cc,
        s,
        target
      );
      const body = compileMatchStatementBody(
        cc,
        accessors,
        target,
        sequenceNames
      );
      branches.push(`if (${cond}) {${nl}${body}${nl}}`);
    }
    const acc =
      last.captureNames.length === 1
        ? new Map([[last.captureNames[0], s]])
        : undefined;
    const fallback = compileMatchStatementBody(last, acc, target);
    const chain =
      branches.length === 0
        ? fallback
        : `${branches.join(' else ')} else {${nl}${fallback}${nl}}`;
    const subjCode = core.compile(args[0], target);
    return `{ const ${s} = ${subjCode};${nl}${chain}${nl}}`;
  });
}

/** A case body in statement position (`compileMatchStatement`): the same
 * closure-rebound body `compileMatchBody` compiles as a value, handed to
 * the loop-body compiler instead. */
export function compileMatchStatementBody(
  cc: CompiledCase,
  accessors: Map<string, string> | undefined,
  target: CompileTarget<Expression>,
  sequenceNames?: ReadonlySet<string>
): string {
  if (cc.captureNames.length === 0)
    return core.compileLoopBody(canonicalInCompiledScope(cc.body), target);
  const bodyClosure = inCompiledScope(cc.body.engine, () =>
    buildCaseClosure(cc.body.engine, cc.body, cc.captureNames)
  );
  if (bodyClosure === undefined || !isFunction(bodyClosure))
    throw new Error('Could not compile `Match`: case body is not compilable.');
  return core.compileLoopBody(
    bodyClosure.op1,
    matchCaptureTarget(accessors, target, sequenceNames)
  );
}

/**
 * Lower a tier-3 case whose pattern(s) are sum-type CONSTRUCTOR patterns
 * (`lit(v)`, `plus(a, b)`, `red()`) to a guarded early-return `if`, or return
 * `undefined` to leave the case to the tier-3 fail-closed throw.
 *
 * The test emitted follows the sum's representation policy (§B1), which is
 * the same policy the constructors emitted under, so a value built and
 * matched inside one compiled unit always agrees with itself:
 *
 * - TAGGED — `s?._tag === 'plus'`, payload captures read `s._ops[i]`. The
 *   optional chaining is what makes a tag test TOTAL: the scrutinee may be a
 *   `null`/`undefined`/primitive value from another sum, and a mixed-sum
 *   match must fall through, not throw.
 * - ERASED — a representation test on the variant's bucket (`s === null`,
 *   `typeof s === 'number'`, `Array.isArray(s)`, …); captures read the value
 *   itself (unary payload) or `s[i]` (tuple payload).
 *
 * JS only. The GPU targets override `Match` wholesale and keep throwing on
 * tier 3; Python and interval-js decline the head outright (§B2).
 */
export function emitMatchConstructorCaseJS(
  engine: ComputeEngine,
  cc: CompiledCase,
  s: string,
  target: CompileTarget<Expression>
): string | undefined {
  const test = matchConstructorTest(engine, cc, s, target);
  if (test === undefined) return undefined;
  const body = compileMatchBody(cc, test.accessors, target);
  return `if (${test.cond}) return ${body};`;
}

/** The test and accessors of a sum-constructor case (see
 * `emitMatchConstructorCaseJS`), or `undefined` when the case is not one
 * the constructor tier can lower. */
export function matchConstructorTest(
  engine: ComputeEngine,
  cc: CompiledCase,
  s: string,
  target: CompileTarget<Expression>
): { cond: string; accessors: Map<string, string> } | undefined {
  if ((target.language ?? 'javascript') !== 'javascript') return undefined;
  const pats = cc.rawPatterns;
  if (pats === undefined || pats.length === 0) return undefined;

  const accessors = new Map<string, string>();
  const alts: string[] = [];
  for (const p of pats) {
    const conds: string[] = [];
    // Fresh per ALTERNATIVE: a name bound once in each arm of
    // `plus(a, _) | times(a, _)` is linear (only one arm ever matches),
    // while a name bound twice in the SAME arm is the non-linear pattern
    // `walkConstructorElement` fails closed on.
    if (
      !core.walkConstructorPattern(
        engine,
        p,
        s,
        conds,
        accessors,
        new Set<string>(),
        target
      )
    )
      return undefined;
    alts.push(conds.join(' && '));
  }

  // Every name the case's body may reference must have an accessor: a
  // capture the walk did not bind would compile in the body as a free
  // symbol (a `_.v` vars-object lookup) and read `undefined` at run time.
  for (const n of cc.captureNames) if (!accessors.has(n)) return undefined;

  const cond =
    alts.length === 1 ? alts[0] : alts.map((a) => `(${a})`).join(' || ');
  const conds = [`(${cond})`];
  const guard = compileMatchGuard(cc, accessors, target);
  if (guard !== undefined) conds.push(`(${guard})`);
  return { cond: conds.join(' && '), accessors };
}

/** The total JS test that `base` holds a value of the given erased
 * representation bucket. `complexNumber` widens the `number` test to the
 * `{re, im}` object a complex-admitting payload may carry. */
export function sumBucketTest(
  bucket: SumBucket,
  base: string,
  complexNumber: boolean
): string {
  switch (bucket) {
    case 'null':
      return `${base} === null`;
    case 'boolean':
      return `typeof ${base} === 'boolean'`;
    case 'number':
      return complexNumber
        ? `(typeof ${base} === 'number' || (${base} !== null && typeof ${base} === 'object' && ${base}.im !== undefined))`
        : `typeof ${base} === 'number'`;
    case 'string':
      return `typeof ${base} === 'string'`;
    case 'array':
      return `Array.isArray(${base})`;
  }
}

/** One payload slot of a constructor pattern: a binding / `_`, a literal or
 * pin (compared with `===`, the same seam tier 2 carries), or a NESTED
 * constructor pattern (`plus(lit(v), _)`) — which falls out of the recursion.
 * A `List`/`Tuple` sub-pattern is NOT supported in v1: it would need the
 * interpreter's shape classifier, which does not descend through an operator
 * pattern. Fails closed by returning `false`. */
export function walkConstructorElement(
  engine: ComputeEngine,
  el: Expression,
  access: string,
  conds: string[],
  accessors: Map<string, string>,
  bound: Set<string>,
  target: CompileTarget<Expression>
): boolean {
  if (isWildcard(el)) {
    const wt = wildcardType(el);
    if (wt === 'Sequence' || wt === 'OptionalSequence') return false;
    const name = wildcardName(el);
    if (name === undefined || name === null) return false;
    const bare = name.replace(/^_+/, '');
    if (bare.length > 0) {
      // NON-LINEAR pattern (`plus(a, a)`): the interpreter's generic matcher
      // UNIFIES the two occurrences, so the arm is taken only when the two
      // payloads are equal. Overwriting the accessor would drop that
      // condition entirely and match `plus(1, 2)`. There is no
      // representation-independent equality to emit here — a payload may be
      // a machine number, a string, a JS array (tuple/list erasure), a
      // `{re, im}` complex or a `{_tag, _ops}` tagged value, and `===` is
      // wrong for all but the first two — so FAIL CLOSED, matching the
      // fixed-shape precedent (`hasRepeatedKeys` in `match-dispatch.ts`
      // excludes a repeated binding from tier 2, sending it to the tier-3
      // throw).
      if (bound.has(bare)) return false;
      // Across ALTERNATIVES the name is linear, but the body has a single
      // accessor for it: the arms must agree on where to read it from, or
      // whichever arm matched, the body would read the other's slot. (Belt
      // and braces — `getMatchPlan` already refuses a name-binding
      // alternative upstream, so only capture-free arms reach here today.)
      const prior = accessors.get(bare);
      if (prior !== undefined && prior !== access) return false;
      bound.add(bare);
      accessors.set(bare, access);
    }
    return true;
  }
  if (isFunction(el, 'Pin')) {
    conds.push(
      `${access} === ${compileMatchConstant(
        engine,
        { kind: 'pin', expr: el.op1 },
        true,
        target
      )}`
    );
    return true;
  }
  if (isNumber(el) || isString(el) || isSymbol(el)) {
    conds.push(
      `${access} === ${compileMatchConstant(
        engine,
        { kind: 'literal', value: el },
        true,
        target
      )}`
    );
    return true;
  }
  return core.walkConstructorPattern(
    engine,
    el,
    access,
    conds,
    accessors,
    bound,
    target
  );
}

/** Handle one positional element of a tier-2 shape (see `walkMatchShape`). */
export function walkMatchElement(
  engine: ComputeEngine,
  el: ElementPlan,
  access: string,
  conds: string[],
  accessors: Map<string, string>,
  target: CompileTarget<Expression>,
  sequenceNames?: Set<string>
): void {
  switch (el.kind) {
    case 'ignore':
      return;
    case 'bind':
      accessors.set(el.key.replace(/^_+/, ''), access);
      return;
    case 'literal':
      conds.push(
        `${access} === ${compileMatchConstant(engine, { kind: 'literal', value: el.value }, true, target)}`
      );
      return;
    case 'pin':
      conds.push(
        `${access} === ${compileMatchConstant(engine, { kind: 'pin', expr: el.expr }, true, target)}`
      );
      return;
    case 'shape':
      core.walkMatchShape(
        engine,
        el.node,
        access,
        conds,
        accessors,
        target,
        sequenceNames
      );
      return;
  }
}

/** True when a tier-0 dispatch segment qualifies for `switch` emission: every
 * case dispatches only on safe machine integers (`n:` keys) and there are at
 * least `MATCH_SWITCH_THRESHOLD` of them. */
export function matchSwitchable(
  seg: Extract<Segment, { kind: 'dispatch' }>
): boolean {
  let count = 0;
  for (const cc of seg.cases) {
    for (const d of cc.dispatchKeys ?? []) {
      if (!d.key.startsWith('n:')) return false;
      count++;
    }
  }
  return count >= MATCH_SWITCH_THRESHOLD;
}

/** Emit an integer dispatch run as a `switch (s) { case k: … }` (no default —
 * a non-match falls through to the following statements, preserving
 * first-match order across segments). Or-alternatives share one body via
 * `case`-fallthrough; a constant already claimed by an earlier (first-match)
 * case is skipped to avoid a duplicate `case` label. */
export function emitMatchSwitch(
  engine: ComputeEngine,
  seg: Extract<Segment, { kind: 'dispatch' }>,
  s: string,
  target: CompileTarget<Expression>
): string {
  const nl = target.ws('\n');
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const cc of seg.cases) {
    const labels: string[] = [];
    for (const d of cc.dispatchKeys ?? []) {
      const n = Number(d.key.slice(2));
      if (seen.has(n)) continue; // first-match-wins: earlier case owns it
      seen.add(n);
      labels.push(`case ${n}:`);
    }
    if (labels.length === 0) continue; // wholly shadowed → unreachable
    parts.push(
      `${labels.join(' ')} return ${compileMatchBody(cc, undefined, target)};`
    );
  }
  return `switch (${s}) {${nl}${parts.join(nl)}${nl}}`;
}

/**
 * Compile a `["Match", …]` to a nested ternary via a target-provided
 * `ternary` primitive — the path GPU targets use (they have no statement-level
 * IIFE or `switch`). Only tier 0/1 constant dispatch and a trailing
 * irrefutable case compile; tier 2 destructuring and refutable tier 3 fail
 * closed. The subject is compiled once and inlined into each comparison
 * — once per leaf comparison, twice for a range pattern. That is safe for a
 * PURE subject only: `_gpu_rnd_draw` advances a runtime counter, so an
 * impure (Random-family) subject would be re-drawn per comparison. Such a
 * subject is bound to a hoisted temporary instead (it is evaluated
 * unconditionally, before any case, so hoisting it is sound); with no
 * statement sink to hoist into, this declines (D6).
 */
export function compileMatchTernary(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  opts: {
    ternary: (cond: string, whenTrue: string, whenFalse: string) => string;
    eq: string;
    noMatch: string;
    allowStrings: boolean;
    /**
     * Wrap a CONDITIONALLY-evaluated piece — a case body, a case guard, or a
     * condition past the first — so a target that forbids hoisting out of a
     * branch can fail closed on exactly those pieces. The SUBJECT is compiled
     * outside it: it is evaluated unconditionally, before any case. Defaults
     * to running the piece unwrapped.
     */
    arm?: (compiled: () => string) => string;
    /**
     * A STATEMENT form of the selection, for a target that can place
     * statements (an `if … else` chain that stores the selected value in a
     * temporary). It receives the reachable cases in order, up to and
     * including an irrefutable case, and returns the code of the value, or
     * `undefined` to keep the ternary form. It is not called when a case
     * has no compiled form (tier-2 destructuring, a refutable tier-3
     * pattern): the ternary form then declines with its own message.
     */
    statement?: (
      clauses: ReadonlyArray<MatchStatementClause>
    ) => string | undefined;
  }
): TargetSource {
  const plan = getMatchPlan(engine, args);
  if (plan.errorAlt !== undefined)
    throw new Error(
      `Could not compile \`Match\`: an or-alternative binds the name '${plan.errorAlt.toString()}'; not compilable.`
    );

  // The subject is UNCONDITIONAL — compiled once, before any case — so it is
  // deliberately outside `opts.arm`: whatever it hoists runs on every path.
  let subj = core.compile(args[0], target);
  // …but it is SPLICED once per comparison (twice for a range pattern), so
  // an impure (Random-family) subject has to be bound to a temporary first.
  if (args[0].isPure === false) {
    if (!canHoist(target))
      throw new Error(
        'Could not compile `Match`: an impure (Random) subject cannot be bound to a temporary ' +
          'at this position — the subject is spliced into every case ' +
          'comparison, and a repeated draw would shift every later value ' +
          'in the shader.'
      );
    const t = tempVar(target);
    const decl = target.language === 'wgsl' ? `var ${t}: f32` : `float ${t}`;
    hoistStatement(target, `${decl} = ${subj};`);
    subj = t;
  }
  const cases = plan.segments.flatMap((seg) => seg.cases);
  const run = opts.arm ?? ((f: () => string) => f());

  if (opts.statement !== undefined) {
    const clauses: MatchStatementClause[] = [];
    let compilable = true;
    for (const cc of cases) {
      if (isIrrefutableCase(cc)) {
        const acc =
          cc.captureNames.length === 1
            ? new Map([[cc.captureNames[0], subj]])
            : undefined;
        clauses.push({
          body: cc.body,
          compileBody: () => compileMatchBody(cc, acc, target),
        });
        // The cases after an irrefutable case are never reached.
        break;
      }
      if (cc.tier !== 0 && cc.tier !== 1) {
        compilable = false;
        break;
      }
      const guard =
        cc.hasGuard && cc.guard !== undefined ? cc.guard : undefined;
      clauses.push({
        body: cc.body,
        guard,
        test: () => {
          const cond = matchLeafCondition(
            engine,
            cc,
            subj,
            opts.eq,
            opts.allowStrings,
            target
          );
          if (guard === undefined) return cond;
          const g = run(() => compileMatchGuard(cc, undefined, target)!);
          return `(${cond}) && (${g})`;
        },
        compileBody: () => compileMatchBody(cc, undefined, target),
      });
    }
    if (compilable && clauses.length > 0) {
      const statement = opts.statement(clauses);
      if (statement !== undefined) return statement;
    }
  }

  const build = (i: number): string => {
    if (i >= cases.length) return opts.noMatch;
    const cc = cases[i];
    // Only a leading irrefutable case is unconditional; anything reached past
    // an earlier condition sits behind a branch.
    const armed = i === 0 ? (f: () => string) => f() : run;
    if (isIrrefutableCase(cc)) {
      const acc =
        cc.captureNames.length === 1
          ? new Map([[cc.captureNames[0], subj]])
          : undefined;
      return armed(() => compileMatchBody(cc, acc, target));
    }
    if (cc.tier === 0 || cc.tier === 1) {
      const cond = armed(() =>
        matchLeafCondition(engine, cc, subj, opts.eq, opts.allowStrings, target)
      );
      // The guard sits behind `&&` (short-circuiting) and the body behind the
      // branch, so both are conditional even in the FIRST case.
      const guard =
        cc.hasGuard && cc.guard !== undefined
          ? run(() => compileMatchGuard(cc, undefined, target)!)
          : undefined;
      const full = guard === undefined ? cond : `(${cond}) && (${guard})`;
      return opts.ternary(
        full,
        run(() => compileMatchBody(cc, undefined, target)),
        build(i + 1)
      );
    }
    if (cc.tier === 2)
      throw new Error(
        `Could not compile \`Match\`: list/tuple destructuring is not compilable to "${target.language ?? 'this'}".`
      );
    const p = cc.rawPatterns?.[0];
    throw new Error(
      `Could not compile \`Match\`: pattern '${p?.toString() ?? '?'}' is not compilable; ` +
        `rewrite with destructuring or guards.`
    );
  };

  return build(0);
}
