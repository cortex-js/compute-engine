import type {
  Expression,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { apply, canonicalFunctionLiteralArguments } from '../function-utils.js';
import { isFunction, isNumber, isString, isSymbol, sym } from './type-guards.js';
import { isWildcard, wildcardName, wildcardType } from './pattern-utils.js';

/**
 * `Match` dispatch — Cortex structural pattern matching
 * (see `docs/plans/2026-07-12-cortex-match-design.md`).
 *
 * `["Match", subject, case₁, …, caseₙ]` where each `caseᵢ` is
 * `["MatchCase", pattern, body]` or `["MatchCase", pattern, guard, body]`.
 *
 * Semantics:
 * - The subject is evaluated **once** (always exactly, even under
 *   `numericApproximation` — matching is structural), then matched against each
 *   case pattern in order (first-match-wins).
 * - Patterns hold engine wildcards (`_x`, `__x`, `___x`, anonymous `_`), matched
 *   with the generic matcher (`expr.match`).
 * - `["Pin", expr]` nodes inside a pattern are resolved once per match
 *   evaluation: `expr` is evaluated in the current lexical scope and its value
 *   is compared verbatim to the subject.
 * - `["Alternatives", p₁, …, pₙ]` at the top level of a case pattern behaves
 *   like `n` consecutive virtual cases sharing the case's guard and body.
 *   Alternatives are binding-free by contract; a named wildcard inside an
 *   alternative makes the whole `Match` an error value.
 * - Each case body (and guard) is canonicalized as a `Function` closure over
 *   the pattern's capture names and applied to the captured values on
 *   selection — giving correct lexical shadowing (`e`/`i` bindings) and
 *   hold-until-selected.
 * - Guards must evaluate to `True` to select; `False` or undecidable falls
 *   through to the next case (preserving totality).
 * - No case matches → `["Error", "'match-no-case'", subject]`.
 *
 * ## The classification ladder (§4)
 *
 * A `match` whose cases are trivial must never pay for the generic matcher.
 * Each case is classified **once**, at first evaluation of a canonical `Match`,
 * into a tier, and the resulting dispatch plan is cached (see `getMatchPlan`):
 *
 * - **Tier 0 — constant dispatch.** Integer / string / boolean-or-constant
 *   symbol literals (and pins of those), no guard, no bindings. A run of
 *   consecutive tier-0 cases becomes one `Map<string, caseIndex>` probed in
 *   O(1) on the evaluated subject.
 * - **Tier 1 — literal chain.** Any literal (incl. floats/rationals), a pin of
 *   any expression, optionally with a guard. Compared with the matcher's leaf
 *   equality (`isEqual` for numbers) — see `leafEquals`.
 * - **Tier 2 — fixed-shape destructuring.** `List`/`Tuple` patterns whose
 *   elements are bindings, `_`, literals, pins, or nested fixed shapes, with at
 *   most one `___rest`. Compiled into a flat positional extraction plan.
 * - **Tier 3 — general.** Everything else falls back to the generic matcher —
 *   the semantic reference implementation. Tiers 0–2 are observationally
 *   identical to it (property-tested).
 *
 * Cases classify individually; consecutive same-tier cases group into segments
 * executed in order, so first-match-wins holds across mixed tiers and a single
 * tier-3 case in the middle never degrades the fast cases before it.
 */

type HandlerOptions = Partial<EvaluateOptions> & { engine: ComputeEngine };

type Substitution = Record<string, Expression>;

/** A capture: the wildcard substitution key (`_a`, `__terms`, `___rest`) and
 * the bare parameter name it lowers to in a case body (`a`, `terms`, `rest`). */
interface Capture {
  key: string;
  name: string;
}

//
// ─── Compiled plan types ──────────────────────────────────────────────────
//

export type Tier = 0 | 1 | 2 | 3;

/** A tier-0/1 leaf comparison target. */
export type LeafTest =
  | { kind: 'literal'; value: Expression } // compare with `leafEquals`
  | { kind: 'pin'; expr: Expression }; // resolve in scope, then compare

/** One positional element of a tier-2 `List`/`Tuple` shape. */
export type ElementPlan =
  | { kind: 'bind'; key: string } // `_name` → capture at this position
  | { kind: 'ignore' } // `_` → consume one operand, capture nothing
  | { kind: 'literal'; value: Expression } // literal/constant → `leafEquals`
  | { kind: 'pin'; expr: Expression } // `Pin(e)` → resolve, then `leafEquals`
  | { kind: 'shape'; node: ShapeNode }; // nested fixed shape

/** A tier-2 fixed shape: fixed prefix, optional single rest, fixed suffix. */
export interface ShapeNode {
  operator: string; // 'List' | 'Tuple'
  prefix: ElementPlan[];
  rest: { key: string | null } | undefined; // `___name` (key) / `___` (null)
  suffix: ElementPlan[];
}

export interface CompiledCase {
  tier: Tier;
  captureKeys: string[]; // wildcard keys, in capture order
  captureNames: string[]; // bare parameter names, parallel to `captureKeys`
  hasGuard: boolean;
  // Raw (held) case operands — used by the compiler (`compile()`), which emits
  // the guard/body directly rather than applying the interpreted closures. The
  // closures below stay the interpreted path's beta-reduction machinery.
  guard: Expression | undefined; // raw guard operand (undefined if no guard)
  body: Expression; // raw body operand
  guardClosure: Expression | undefined; // built once (undefined if build failed)
  bodyClosure: Expression | undefined; // built once (undefined ⇒ Nothing)
  // Tier 0: dispatch keys (also used to seed the segment table/fallback scan).
  dispatchKeys?: { key: string; value: Expression }[];
  // Tier 1: any-of leaf tests.
  tests?: LeafTest[];
  // Tier 2: extraction shape.
  shape?: ShapeNode;
  // Tier 3: raw pattern(s), pins resolved per evaluation.
  rawPatterns?: Expression[];
}

export type Segment =
  | {
      kind: 'dispatch';
      table: Map<string, number>; // key → index into `cases`
      constants: { value: Expression; index: number }[]; // fallback scan order
      cases: CompiledCase[];
    }
  | { kind: 'chain'; cases: CompiledCase[] };

export interface MatchPlan {
  /** Offending alternative if a binding appears inside an `Alternatives`; the
   * whole `Match` is then an error value regardless of the subject. */
  errorAlt: Expression | undefined;
  segments: Segment[];
}

/**
 * Classification is cached per canonical `Match` on a module-level `WeakMap`.
 *
 * **Key choice.** The evaluate handler receives the `Match`'s operand array
 * (`ops`). `Match` is a `holdAll`/lazy operator, so `holdMap` returns the
 * boxed function's own `.ops` array unchanged — the *same* array object on
 * every evaluation of a given canonical `Match`, and unique per `Match` (each
 * `BoxedFunction` owns its `ops`). Boxed expressions are immutable, so no
 * invalidation is needed. (Empirically verified: `canonical.ops === canonical.ops`
 * is stable across reads and across `.evaluate()` calls, and differs between two
 * independently-boxed but structurally-identical `Match`es.)
 */
const planCache = new WeakMap<ReadonlyArray<Expression>, MatchPlan>();

//
// ─── Entry point ──────────────────────────────────────────────────────────
//

/** Evaluate a `["Match", subject, …cases]` expression. */
export function evaluateMatch(
  ops: ReadonlyArray<Expression>,
  options: HandlerOptions
): Expression {
  const ce = options.engine;

  const subjectRaw = ops[0];
  if (!subjectRaw) return noCaseError(ce, ce.Nothing);

  // The subject is evaluated exactly once — always exactly, even under
  // `numericApproximation`: matching is structural, and numericizing the
  // subject first would unmatch exact patterns (`Match(Pi, MatchCase(Pi, …))`
  // must select the same case under `.N()` as under `evaluate()`; only the
  // selected body is numericized, via `apply(…, options)`).
  const subject = subjectRaw.evaluate({
    ...options,
    numericApproximation: false,
  });

  const plan = getMatchPlan(ce, ops);

  // A binding inside an or-alternative is a hard error for the whole Match.
  if (plan.errorAlt !== undefined)
    return ce._fn('Error', [
      ce.string('match-alternative-binding'),
      plan.errorAlt,
    ]);

  for (const seg of plan.segments) {
    if (seg.kind === 'dispatch') {
      const idx = dispatchIndex(ce, seg, subject);
      if (idx !== undefined) {
        const r = runCase(ce, seg.cases[idx], subject, options);
        if (r !== undefined) return r;
      }
    } else {
      for (const cc of seg.cases) {
        const r = runCase(ce, cc, subject, options);
        if (r !== undefined) return r;
      }
    }
  }

  return noCaseError(ce, subject);
}

/**
 * The pure tier-3 reference path: classify nothing, run every case through the
 * generic matcher (the semantic reference implementation). Exported for the
 * property test that asserts the laddered result equals the tier-3 result.
 */
export function evaluateMatchReference(
  ops: ReadonlyArray<Expression>,
  options: HandlerOptions
): Expression {
  const ce = options.engine;

  const subjectRaw = ops[0];
  if (!subjectRaw) return noCaseError(ce, ce.Nothing);

  const subject = subjectRaw.evaluate({
    ...options,
    numericApproximation: false,
  });

  // Flatten cases (resolving Pins and expanding Alternatives). A named wildcard
  // inside an alternative is a hard error for the whole Match.
  const cases: { pattern: Expression; guard?: Expression; body: Expression }[] =
    [];
  for (const caseExpr of ops.slice(1)) {
    if (!isFunction(caseExpr, 'MatchCase')) continue;
    const cops = caseExpr.ops;
    if (cops.length < 2) continue;
    const patternRaw = cops[0];
    const guard = cops.length >= 3 ? cops[1] : undefined;
    const body = cops[cops.length - 1];

    if (isFunction(patternRaw, 'Alternatives')) {
      for (const alt of patternRaw.ops) {
        const resolved = resolvePins(ce, alt);
        if (collectCaptures(resolved).length > 0)
          return ce._fn('Error', [
            ce.string('match-alternative-binding'),
            alt,
          ]);
        cases.push({ pattern: resolved, guard, body });
      }
    } else {
      cases.push({ pattern: resolvePins(ce, patternRaw), guard, body });
    }
  }

  for (const vc of cases) {
    const sub = subject.match(vc.pattern);
    if (sub === null) continue;

    const captures = collectCaptures(vc.pattern);
    const names = captures.map((c) => c.name);
    const args = captures.map((c) => sub[c.key] ?? ce.Nothing);

    if (vc.guard !== undefined) {
      const guardClosure = canonicalFunctionLiteralArguments(ce, [
        vc.guard,
        ...names.map((n) => ce.symbol(n, { canonical: false })),
      ]);
      if (guardClosure === undefined) continue;
      if (sym(apply(guardClosure, args)) !== 'True') continue;
    }

    const bodyClosure = canonicalFunctionLiteralArguments(ce, [
      vc.body,
      ...names.map((n) => ce.symbol(n, { canonical: false })),
    ]);
    if (bodyClosure === undefined) return ce.Nothing;
    return apply(bodyClosure, args, options);
  }

  return noCaseError(ce, subject);
}

//
// ─── Case execution ───────────────────────────────────────────────────────
//

/** Run a compiled case against `subject`; return the body value if the case is
 * selected, or `undefined` to fall through to the next case. */
function runCase(
  ce: ComputeEngine,
  cc: CompiledCase,
  subject: Expression,
  options: HandlerOptions
): Expression | undefined {
  const sub = matchCompiled(ce, cc, subject, options);
  if (sub === null) return undefined;

  const args = cc.captureKeys.map((k) => sub[k] ?? ce.Nothing);

  if (cc.hasGuard) {
    if (cc.guardClosure === undefined) return undefined;
    if (sym(apply(cc.guardClosure, args)) !== 'True') return undefined;
  }

  if (cc.bodyClosure === undefined) return ce.Nothing;
  return apply(cc.bodyClosure, args, options);
}

/** Attempt to match a compiled case; return the capture substitution (possibly
 * empty) on success, or `null` on failure. Tier-0 cases are only reached via a
 * confirmed dispatch hit, so they always succeed with no captures. */
function matchCompiled(
  ce: ComputeEngine,
  cc: CompiledCase,
  subject: Expression,
  _options: HandlerOptions
): Substitution | null {
  switch (cc.tier) {
    case 0:
      return {};
    case 1: {
      for (const t of cc.tests!) {
        if (t.kind === 'literal') {
          if (leafEquals(subject, t.value)) return {};
        } else if (subject.match(resolvePin(t.expr)) !== null) return {};
      }
      return null;
    }
    case 2: {
      const sub: Substitution = {};
      return matchShape(ce, cc.shape!, subject, sub) ? sub : null;
    }
    default: {
      // Tier 3: resolve pins per evaluation, then the generic matcher.
      for (const raw of cc.rawPatterns!) {
        const s = subject.match(resolvePins(ce, raw));
        if (s !== null) return s as Substitution;
      }
      return null;
    }
  }
}

/** Tier-0 dispatch: hash the subject for an O(1) probe; if the subject is not a
 * hashable-exact value, fall back to a faithful linear `leafEquals` scan (this
 * covers e.g. an inexact float subject that `isEqual`-matches an integer
 * constant within tolerance — the matcher's own semantics). */
function dispatchIndex(
  ce: ComputeEngine,
  seg: Extract<Segment, { kind: 'dispatch' }>,
  subject: Expression
): number | undefined {
  const key = hashableSubjectKey(subject);
  if (key !== undefined) return seg.table.get(key);
  for (const c of seg.constants)
    if (leafEquals(subject, c.value)) return c.index;
  return undefined;
}

/** Match a fixed-shape (`List`/`Tuple`) pattern positionally. */
function matchShape(
  ce: ComputeEngine,
  node: ShapeNode,
  subject: Expression,
  sub: Substitution
): boolean {
  if (!isFunction(subject) || subject.operator !== node.operator) return false;

  const ops = subject.ops;
  const fixed = node.prefix.length + node.suffix.length;
  if (node.rest === undefined) {
    if (ops.length !== fixed) return false;
  } else if (ops.length < fixed) return false;

  for (let i = 0; i < node.prefix.length; i++)
    if (!matchElement(ce, node.prefix[i], ops[i], sub)) return false;

  const sLen = node.suffix.length;
  for (let j = 0; j < sLen; j++)
    if (!matchElement(ce, node.suffix[j], ops[ops.length - sLen + j], sub))
      return false;

  if (node.rest !== undefined && node.rest.key !== null) {
    const middle = ops.slice(node.prefix.length, ops.length - sLen);
    sub[node.rest.key] = wrapRest(ce, middle);
  }

  return true;
}

function matchElement(
  ce: ComputeEngine,
  el: ElementPlan,
  op: Expression,
  sub: Substitution
): boolean {
  switch (el.kind) {
    case 'ignore':
      return true;
    case 'bind':
      sub[el.key] = op;
      return true;
    case 'literal':
      return leafEquals(op, el.value);
    case 'pin':
      return op.match(resolvePin(el.expr)) !== null;
    case 'shape':
      return matchShape(ce, el.node, op, sub);
  }
}

/** Wrap a captured `___rest` sequence the way the generic matcher does for a
 * non-associative operand (`List`/`Tuple`): empty → `Nothing`, one → the
 * element itself, many → `Sequence(…)`. */
function wrapRest(ce: ComputeEngine, ops: ReadonlyArray<Expression>): Expression {
  if (ops.length === 0) return ce.Nothing;
  if (ops.length === 1) return ops[0];
  return ce.function('Sequence', ops, { form: 'raw' });
}

/**
 * Leaf equality reproducing the generic matcher's `matchOnce` leaf branches:
 * numbers by `isEqual` (mathematical equality, with tolerance — *not* `isSame`,
 * because the matcher itself uses `isEqual` and `isSame` would diverge for
 * float-vs-exact), strings by content, symbols by name. Non-leaf values (e.g. a
 * pin resolving to a list) defer to the matcher for safety.
 */
function leafEquals(subject: Expression, value: Expression): boolean {
  // The matcher treats an undecidable `isEqual` (undefined) as no-match.
  if (isNumber(value)) return isNumber(subject) && value.isEqual(subject) === true;
  if (isString(value)) return isString(subject) && subject.string === value.string;
  if (isSymbol(value)) return isSymbol(subject) && subject.symbol === value.symbol;
  return subject.match(value) !== null;
}

//
// ─── Plan construction (cached) ───────────────────────────────────────────
//

/** Build (or fetch from cache) the classification plan for a `Match`'s ops. */
export function getMatchPlan(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): MatchPlan {
  const cached = planCache.get(ops);
  if (cached !== undefined) return cached;
  const plan = buildMatchPlan(ce, ops);
  planCache.set(ops, plan);
  return plan;
}

function buildMatchPlan(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): MatchPlan {
  const compiled: CompiledCase[] = [];
  let errorAlt: Expression | undefined;

  for (const caseExpr of ops.slice(1)) {
    if (!isFunction(caseExpr, 'MatchCase')) continue;
    const cops = caseExpr.ops;
    if (cops.length < 2) continue;
    const patternRaw = cops[0];
    const hasGuard = cops.length >= 3;
    const guard = hasGuard ? cops[1] : undefined;
    const body = cops[cops.length - 1];

    // Capture names/keys come from the raw pattern (Pin content never binds,
    // Alternatives are binding-free); pin resolution and alternative expansion
    // never introduce new wildcards, so these are stable.
    const captures = collectCaptures(patternRaw);
    const names = captures.map((c) => c.name);
    const captureKeys = captures.map((c) => c.key);

    const guardClosure =
      guard !== undefined
        ? canonicalFunctionLiteralArguments(ce, [
            guard,
            ...names.map((n) => ce.symbol(n, { canonical: false })),
          ])
        : undefined;
    const bodyClosure = canonicalFunctionLiteralArguments(ce, [
      body,
      ...names.map((n) => ce.symbol(n, { canonical: false })),
    ]);

    const base: Omit<CompiledCase, 'tier'> = {
      captureKeys,
      captureNames: names,
      hasGuard,
      guard,
      body,
      guardClosure,
      bodyClosure,
    };

    // Alternatives: binding check + weakest-tier classification.
    if (isFunction(patternRaw, 'Alternatives')) {
      const alts = patternRaw.ops;
      let bindingAlt: Expression | undefined;
      for (const alt of alts)
        if (collectCaptures(alt).length > 0) {
          bindingAlt = alt;
          break;
        }
      if (bindingAlt !== undefined) {
        if (errorAlt === undefined) errorAlt = bindingAlt;
        // Still push a (never-selected) tier-3 case so indices stay sane; the
        // whole Match short-circuits to the error before any case runs.
        compiled.push({ ...base, tier: 3, rawPatterns: [...alts] });
        continue;
      }

      const dispatchKeys: { key: string; value: Expression }[] = [];
      const tests: LeafTest[] = [];
      let everyDispatchable = !hasGuard;
      let everyLeaf = true;
      for (const alt of alts) {
        const leaf = classifyLeaf(ce, alt);
        if (leaf.dispatch !== undefined) {
          dispatchKeys.push(leaf.dispatch);
          tests.push(leaf.test!);
        } else if (leaf.test !== undefined) {
          everyDispatchable = false;
          tests.push(leaf.test);
        } else {
          everyLeaf = false;
          break;
        }
      }

      if (everyLeaf && everyDispatchable)
        compiled.push({ ...base, tier: 0, dispatchKeys });
      else if (everyLeaf) compiled.push({ ...base, tier: 1, tests });
      else compiled.push({ ...base, tier: 3, rawPatterns: [...alts] });
      continue;
    }

    // Single pattern.
    const leaf = classifyLeaf(ce, patternRaw);
    if (leaf.dispatch !== undefined && !hasGuard) {
      compiled.push({ ...base, tier: 0, dispatchKeys: [leaf.dispatch] });
      continue;
    }
    if (leaf.test !== undefined) {
      compiled.push({ ...base, tier: 1, tests: [leaf.test] });
      continue;
    }
    const shape = classifyShape(patternRaw);
    if (shape !== undefined && !hasRepeatedKeys(shape)) {
      compiled.push({ ...base, tier: 2, shape });
      continue;
    }
    compiled.push({ ...base, tier: 3, rawPatterns: [patternRaw] });
  }

  return { errorAlt, segments: buildSegments(compiled) };
}

/** Group consecutive same-tier cases into segments (tier-0 runs become one
 * dispatch table; everything else is an ordered chain). */
function buildSegments(compiled: CompiledCase[]): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  while (i < compiled.length) {
    if (compiled[i].tier === 0) {
      const cases: CompiledCase[] = [];
      const table = new Map<string, number>();
      const constants: { value: Expression; index: number }[] = [];
      while (i < compiled.length && compiled[i].tier === 0) {
        const index = cases.length;
        cases.push(compiled[i]);
        for (const { key, value } of compiled[i].dispatchKeys!) {
          if (!table.has(key)) table.set(key, index); // first-match-wins
          constants.push({ value, index });
        }
        i++;
      }
      segments.push({ kind: 'dispatch', table, constants, cases });
    } else {
      const cases: CompiledCase[] = [];
      while (i < compiled.length && compiled[i].tier !== 0)
        cases.push(compiled[i++]);
      segments.push({ kind: 'chain', cases });
    }
  }
  return segments;
}

//
// ─── Leaf / shape classification ──────────────────────────────────────────
//

/**
 * Classify a single (non-Alternatives) pattern as a dispatch constant and/or a
 * leaf test.
 * - `dispatch`: present when the pattern is a *dispatch-safe* constant — a safe
 *   machine integer, a string, a boolean/constant symbol, or a `Pin` of one of
 *   those. Its `value` is the comparison target for the fallback scan.
 * - `test`: present when the pattern is any literal (incl. floats/rationals),
 *   any symbol, or a `Pin`. Used by tier 1.
 */
function classifyLeaf(
  ce: ComputeEngine,
  p: Expression
): {
  dispatch?: { key: string; value: Expression };
  test?: LeafTest;
} {
  if (isFunction(p, 'Pin')) {
    const inner = p.op1;
    const innerClass = classifyLeaf(ce, inner);
    // A pin of a constant/dispatch-safe literal dispatches statically (its
    // value is fixed at canonicalization); its scan value is the inner expr.
    if (innerClass.dispatch !== undefined)
      return {
        dispatch: innerClass.dispatch,
        test: { kind: 'pin', expr: inner },
      };
    return { test: { kind: 'pin', expr: inner } };
  }

  if (isWildcard(p)) return {}; // a binding, never a leaf constant

  if (isNumber(p)) {
    const key = integerKey(p);
    if (key !== undefined)
      return { dispatch: { key, value: p }, test: { kind: 'literal', value: p } };
    // Float / rational / radical: tier-1 only (exactness contract).
    return { test: { kind: 'literal', value: p } };
  }

  if (isString(p))
    return {
      dispatch: { key: 's:' + p.string, value: p },
      test: { kind: 'literal', value: p },
    };

  if (isSymbol(p)) {
    // Constant/boolean symbols (`Pi`, `True`) key by name — exactly their
    // `isSame` class; the matcher compares symbols by name regardless of
    // value, so this is faithful. Non-constant symbols stay tier 1.
    //
    // The pattern is held raw (unbound), so `p.isConstant` is `false` even for
    // `Pi`; resolve the symbol's binding in isolation to query its constness.
    // This is a metadata lookup on a single symbol, not a re-canonicalization
    // of the pattern (which would mangle wildcards).
    if (ce.box(p.symbol).isConstant)
      return {
        dispatch: { key: 'sym:' + p.symbol, value: p },
        test: { kind: 'literal', value: p },
      };
    return { test: { kind: 'literal', value: p } };
  }

  return {};
}

/** The tier-0 integer key for a number literal, or `undefined` if it is not a
 * safe exact integer (floats/rationals/radicals and out-of-safe-range integers
 * fall to tier 1, which compares with `isEqual` and is faithful). */
function integerKey(p: Expression): string | undefined {
  if (!isNumber(p) || !p.isExact || p.isInteger !== true) return undefined;
  const r = p.re;
  if (!Number.isSafeInteger(r)) return undefined;
  return 'n:' + String(r);
}

/** The hashable dispatch key of an evaluated subject, or `undefined` if the
 * subject is not a hashable-exact value (in which case a dispatch segment falls
 * back to a faithful `leafEquals` scan). */
function hashableSubjectKey(subject: Expression): string | undefined {
  if (isString(subject)) return 's:' + subject.string;
  if (isSymbol(subject)) return 'sym:' + subject.symbol;
  return integerKey(subject);
}

/** Classify a `List`/`Tuple` pattern as a fixed shape, or `undefined` if any
 * element is not shape-compatible (operator patterns, `__` sequences, or more
 * than one `___rest`). */
function classifyShape(p: Expression): ShapeNode | undefined {
  if (!isFunction(p)) return undefined;
  if (p.operator !== 'List' && p.operator !== 'Tuple') return undefined;

  const prefix: ElementPlan[] = [];
  const suffix: ElementPlan[] = [];
  let rest: { key: string | null } | undefined;

  for (const el of p.ops) {
    if (isWildcard(el)) {
      const wt = wildcardType(el);
      const name = wildcardName(el)!;
      if (wt === 'OptionalSequence') {
        if (rest !== undefined) return undefined; // more than one rest
        const bare = name.replace(/^_+/, '');
        rest = { key: bare.length ? name : null };
        continue;
      }
      if (wt === 'Sequence') return undefined; // `__` not allowed in tier 2
      const bare = name.replace(/^_+/, '');
      const ep: ElementPlan =
        bare.length ? { kind: 'bind', key: name } : { kind: 'ignore' };
      (rest === undefined ? prefix : suffix).push(ep);
      continue;
    }

    const ep = classifyElement(el);
    if (ep === undefined) return undefined;
    (rest === undefined ? prefix : suffix).push(ep);
  }

  return { operator: p.operator, prefix, rest, suffix };
}

/** Classify a non-wildcard tier-2 element (literal / pin / nested shape). */
function classifyElement(el: Expression): ElementPlan | undefined {
  if (isFunction(el, 'Pin')) return { kind: 'pin', expr: el.op1 };
  if (isNumber(el) || isString(el)) return { kind: 'literal', value: el };
  if (isSymbol(el)) return { kind: 'literal', value: el }; // constant/symbol
  const nested = classifyShape(el);
  if (nested !== undefined) return { kind: 'shape', node: nested };
  return undefined;
}

/** True if a shape binds the same name twice (a non-linear pattern — excluded
 * from tier 2). */
function hasRepeatedKeys(node: ShapeNode): boolean {
  const seen = new Set<string>();
  let dup = false;
  const add = (k: string): void => {
    if (seen.has(k)) dup = true;
    else seen.add(k);
  };
  const walk = (n: ShapeNode): void => {
    if (n.rest?.key) add(n.rest.key);
    for (const el of [...n.prefix, ...n.suffix]) {
      if (el.kind === 'bind') add(el.key);
      else if (el.kind === 'shape') walk(el.node);
    }
  };
  walk(node);
  return dup;
}

//
// ─── Shared helpers (also used by the tier-3 reference path) ──────────────
//

/** `["Error", "'match-no-case'", subject]`. */
function noCaseError(ce: ComputeEngine, subject: Expression): Expression {
  return ce._fn('Error', [ce.string('match-no-case'), subject]);
}

/** Resolve a single pinned expression: canonicalize (so a bare symbol resolves
 * its lexical binding) then evaluate in the current scope. */
function resolvePin(expr: Expression): Expression {
  return expr.canonical.evaluate();
}

/** True if `expr` contains a `["Pin", …]` node anywhere. */
function hasPin(expr: Expression): boolean {
  if (isFunction(expr, 'Pin')) return true;
  if (isFunction(expr)) return expr.ops.some(hasPin);
  return false;
}

/**
 * Replace every `["Pin", e]` node in `pattern` with the value of `e`,
 * evaluated in the current lexical scope. The rest of the pattern (wildcards,
 * literals, operators) is preserved verbatim (raw, non-canonical) so the
 * matcher is not fed a canonicalized pattern.
 */
function resolvePins(ce: ComputeEngine, pattern: Expression): Expression {
  if (!hasPin(pattern)) return pattern;
  if (isFunction(pattern, 'Pin')) return resolvePin(pattern.op1);
  if (isFunction(pattern))
    return ce._fn(
      pattern.operator,
      pattern.ops.map((op) => resolvePins(ce, op)),
      { canonical: false }
    );
  return pattern;
}

/**
 * Collect the named wildcards of `pattern` in first-occurrence order, deduped
 * by bare name. Anonymous wildcards (`_`, `__`, `___`) capture nothing and are
 * skipped. An operator-position wildcard (`["_f", …]`) is captured too.
 */
function collectCaptures(pattern: Expression): Capture[] {
  const seen = new Set<string>();
  const result: Capture[] = [];

  const push = (key: string | null): void => {
    if (key === null) return;
    const name = key.replace(/^_+/, '');
    if (name.length === 0 || seen.has(name)) return;
    seen.add(name);
    result.push({ key, name });
  };

  const walk = (expr: Expression): void => {
    if (isWildcard(expr)) {
      push(wildcardName(expr));
      return;
    }
    if (isFunction(expr)) {
      // Pinned expressions are resolved values by now, but be defensive and do
      // not descend into a Pin marker (its content never binds).
      if (expr.operator === 'Pin') return;
      if (expr.operator.startsWith('_')) push(expr.operator);
      for (const op of expr.ops) walk(op);
    }
  };

  walk(pattern);
  return result;
}

/**
 * The external references a `Match` case pattern contributes, for the compiler's
 * reference analysis (`analyzeReferences`):
 * - `captures`: bare names the pattern binds (they shadow the guard/body's free
 *   symbols; not themselves free).
 * - `pinExprs`: the operand of every `["Pin", e]` node — `e` is evaluated in the
 *   enclosing scope at match time, so its free symbols ARE external references.
 */
export function matchPatternReferences(pattern: Expression): {
  captures: string[];
  pinExprs: Expression[];
} {
  const captures = collectCaptures(pattern).map((c) => c.name);
  const pinExprs: Expression[] = [];
  const walk = (e: Expression): void => {
    if (isFunction(e, 'Pin')) {
      if (e.op1 !== undefined) pinExprs.push(e.op1);
      return;
    }
    if (isFunction(e)) for (const op of e.ops) walk(op);
  };
  walk(pattern);
  return { captures, pinExprs };
}

/** Testing hooks (not part of the public API). */
export const _forTesting = {
  getMatchPlan,
  evaluateMatchReference,
};
