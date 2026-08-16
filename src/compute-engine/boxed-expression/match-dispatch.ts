import type {
  Expression,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { apply, canonicalFunctionLiteralArguments } from '../function-utils.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isObject,
  isString,
  isCharacter,
  isSymbol,
  sym,
} from './type-guards.js';
import { isWildcard, wildcardName, wildcardType } from './pattern-utils.js';
import { errorOpsWithoutTrace } from './error-value.js';

/**
 * `Match` dispatch — Epsil structural pattern matching
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
 * - `["Range", lo, hi]` (exactly two operands, both real non-NaN number
 *   literals) in **pattern position** is an inclusive numeric **membership
 *   test**, not a structural match: the case is selected iff the subject is a
 *   real number literal with `lo ≤ subject ≤ hi` (endpoints compared with the
 *   matcher's tolerant number semantics — see `leafEquals`). Consequence
 *   (a deliberate carve-out, the same kind the dedicated dictionary matcher
 *   has): a literal `Range` **value** can no longer be matched structurally in
 *   pattern position. Any other `Range` — a different arity, or a bound that is
 *   not a numeric literal — keeps its structural meaning.
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
  | { kind: 'pin'; expr: Expression } // resolve in scope, then compare
  | { kind: 'range'; lo: Expression; hi: Expression }; // inclusive membership

/** One positional element of a tier-2 `List`/`Tuple` shape (also the value slot
 * of a tier-2 `Dictionary` shape). */
export type ElementPlan =
  | { kind: 'bind'; key: string } // `_name` → capture at this position
  | { kind: 'ignore' } // `_` → consume one operand, capture nothing
  | { kind: 'literal'; value: Expression } // literal/constant → `leafEquals`
  | { kind: 'pin'; expr: Expression } // `Pin(e)` → resolve, then `leafEquals`
  | { kind: 'shape'; node: ShapeNode }; // nested fixed shape

/** A tier-2 sequence shape (`List`/`Tuple`): fixed prefix, optional single rest,
 * fixed suffix. */
export interface SeqShapeNode {
  kind: 'seq';
  operator: string; // 'List' | 'Tuple'
  prefix: ElementPlan[];
  rest: { key: string | null } | undefined; // `___name` (key) / `___` (null)
  suffix: ElementPlan[];
}

/** A tier-2 dictionary shape: an **open** match on a set of named keys, each
 * with an element-plan value. The subject must have (at least) every listed
 * key, with each value matching the corresponding value plan; extra subject
 * keys are ignored (open by default, per §2 pattern rule 7). */
export interface DictShapeNode {
  kind: 'dict';
  entries: { key: string; value: ElementPlan }[];
}

/** A tier-2 fixed shape: a sequence (`List`/`Tuple`) or a dictionary. */
export type ShapeNode = SeqShapeNode | DictShapeNode;

export interface CompiledCase {
  tier: Tier;
  captureKeys: string[]; // wildcard keys, in capture order
  captureNames: string[]; // bare parameter names, parallel to `captureKeys`
  hasGuard: boolean;
  // Raw (held) case operands. Both the interpreter and the compiler build
  // their guard/body closures from these — PER USE, never cached on the plan
  // (see `buildCaseClosure`): under the frame-is-scope model a closure
  // canonicalized inside a live invocation frame captures that frame's
  // bindings, so a plan-cached closure would replay the first caller's frame
  // on every later evaluation (silent stale results, unbounded recursion —
  // fixed 2026-08-01).
  guard: Expression | undefined; // raw guard operand (undefined if no guard)
  body: Expression; // raw body operand
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
 *
 * **Mutable-object disposition** (ruling B3's cache inventory). Nothing here
 * needs object-version dependencies. The payload is a classification PLAN —
 * per-arm shape and literal-kind tags, deliberately holding no closures and no
 * evaluated values (see the "never cache the result across evaluations" notes
 * below) — so it can neither retain an object nor go stale when one's fields
 * change; the plan describes the pattern's syntax, which a store cannot
 * touch. Matching itself still runs per evaluation, and an object matches
 * only itself by reference (`BoxedObject.match`).
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

    // Patterns stay RAW here — `matchPattern` resolves pins itself, so a range
    // pattern is recognized before a pin can resolve to a `Range` value.
    if (isFunction(patternRaw, 'Alternatives')) {
      for (const alt of patternRaw.ops) {
        if (collectCaptures(alt).length > 0)
          return ce._fn('Error', [ce.string('match-alternative-binding'), alt]);
        cases.push({ pattern: alt, guard, body });
      }
    } else {
      cases.push({ pattern: patternRaw, guard, body });
    }
  }

  for (const vc of cases) {
    const sub = matchPattern(ce, subject, vc.pattern);
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
      if (sym(apply(guardClosure, args, undefined, 'bind')) !== 'True')
        continue;
    }

    const bodyClosure = canonicalFunctionLiteralArguments(ce, [
      vc.body,
      ...names.map((n) => ce.symbol(n, { canonical: false })),
    ]);
    if (bodyClosure === undefined) return ce.Nothing;
    return apply(bodyClosure, args, options, 'bind');
  }

  return noCaseError(ce, subject);
}

//
// ─── Case execution ───────────────────────────────────────────────────────
//

/** Build the closure for a case's guard or body: a canonical function literal
 * over the case's capture names, canonicalized in the CURRENT scope.
 *
 * Never cache the result across evaluations. Under the frame-is-scope model,
 * canonicalizing inside a live invocation frame captures that frame's
 * bindings — a cached closure replays the first caller's frame on every later
 * call (silent stale results for `match` bodies referencing an enclosing
 * parameter; unbounded recursion when the first call only hit the base case —
 * regression fixed 2026-08-01). The reference path (`evaluateMatchReference`)
 * has always built per evaluation; this helper mirrors it, and the compiler
 * uses it at emission time (only the value-safe canonical STRUCTURE, `.op1`,
 * is consumed there). */
export function buildCaseClosure(
  ce: ComputeEngine,
  operand: Expression,
  names: ReadonlyArray<string>
): Expression | undefined {
  return canonicalFunctionLiteralArguments(ce, [
    operand,
    ...names.map((n) => ce.symbol(n, { canonical: false })),
  ]);
}

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

  // Closures are built per evaluation (see `buildCaseClosure`) — only after
  // the pattern has matched, so non-selected cases pay nothing.
  if (cc.hasGuard) {
    if (cc.guard === undefined) return undefined;
    const guardClosure = buildCaseClosure(ce, cc.guard, cc.captureNames);
    if (guardClosure === undefined) return undefined;
    if (sym(apply(guardClosure, args, undefined, 'bind')) !== 'True')
      return undefined;
  }

  const bodyClosure = buildCaseClosure(ce, cc.body, cc.captureNames);
  if (bodyClosure === undefined) return ce.Nothing;
  return apply(bodyClosure, args, options, 'bind');
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
  // Rung 1 (error-propagation design §2): an error subject may only match a
  // wildcard or an explicitly `Error`-headed pattern (see
  // `errorSubjectMayMatch`). Both classify as tier 3, so tiers 0–2 — literal,
  // pin, range and fixed-shape tests — reject it outright; the tier-3 gate is
  // in `matchPattern`, shared with the reference path.
  if (cc.tier !== 3 && isErrorSubject(subject)) return null;

  switch (cc.tier) {
    case 0:
      return {};
    case 1: {
      for (const t of cc.tests!) {
        if (t.kind === 'literal') {
          if (leafEquals(subject, t.value)) return {};
        } else if (t.kind === 'range') {
          if (rangeContains(subject, t.lo, t.hi)) return {};
        } else if (subject.match(resolvePin(t.expr)) !== null) return {};
      }
      return null;
    }
    case 2: {
      const sub: Substitution = {};
      return matchShape(ce, cc.shape!, subject, sub) ? sub : null;
    }
    default: {
      // Tier 3: the range-aware, dict-aware matcher (which resolves pins per
      // evaluation and delegates plain patterns to the generic matcher).
      for (const raw of cc.rawPatterns!) {
        const s = matchPattern(ce, subject, raw);
        if (s !== null) return s;
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

/** Match a fixed shape — a `List`/`Tuple` sequence positionally, or a
 * `Dictionary` by key (open match). */
function matchShape(
  ce: ComputeEngine,
  node: ShapeNode,
  subject: Expression,
  sub: Substitution
): boolean {
  if (node.kind === 'dict') return matchDictShape(ce, node, subject, sub);
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

/** Match a tier-2 `Dictionary` shape: **open** — every listed key must be
 * present in the subject with a matching value; extra subject keys are ignored.
 * Reads the subject via the `DictionaryInterface` (`isDictionary` guard: the
 * evaluated subject is the engine's native compact dictionary, not a
 * function-form `Dictionary`). */
function matchDictShape(
  ce: ComputeEngine,
  node: DictShapeNode,
  subject: Expression,
  sub: Substitution
): boolean {
  if (!isDictionary(subject)) return false;
  for (const { key, value } of node.entries) {
    const v = subject.get(key);
    if (v === undefined) return false; // missing key → fall through
    if (!matchElement(ce, value, v, sub)) return false;
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
function wrapRest(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
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
  // An OBJECT on either side compares by reference identity — the same answer
  // every equality tier gives, and the reason a pinned object value selects
  // its case only for the very object it pins. Decided before the leaf
  // branches so neither side can be read as content.
  if (isObject(value) || isObject(subject)) return subject === value;
  // The matcher treats an undecidable `isEqual` (undefined) as no-match.
  if (isNumber(value))
    return isNumber(subject) && value.isEqual(subject) === true;
  // Text compares by CONTENT across the string/character kind boundary, the
  // same bridge `isSame` implements: a one-cluster string literal in pattern
  // position must select a character subject (`match c { "[" => … }` over a
  // character from `Characters(s)`), and vice versa.
  if (isString(value) || isCharacter(value))
    return (
      (isString(subject) || isCharacter(subject)) &&
      subject.string === value.string
    );
  if (isSymbol(value))
    return isSymbol(subject) && subject.symbol === value.symbol;
  return subject.match(value) !== null;
}

/**
 * The bounds of a **range pattern** — a `["Range", lo, hi]` node whose two
 * operands are both real, non-`NaN` number literals — or `undefined` when the
 * node is not one (a different arity, or a bound that is not a numeric literal:
 * such a `Range` keeps its ordinary structural meaning in a pattern).
 *
 * Note this is deliberately checked on the **raw held pattern**, before any
 * `Pin` resolution: `== Range(1, 10)` pins the range *value* and must keep
 * comparing values, not become a membership test.
 */
export function rangePatternBounds(
  p: Expression
): { lo: Expression; hi: Expression } | undefined {
  if (!isFunction(p, 'Range') || p.nops !== 2) return undefined;
  const [lo, hi] = p.ops;
  if (!isRangeBound(lo) || !isRangeBound(hi)) return undefined;
  return { lo, hi };
}

/** A usable range-pattern bound: a real, non-`NaN` number literal (`Infinity`
 * and `-Infinity` qualify — `0..Infinity` is "any nonnegative number"). */
function isRangeBound(e: Expression | undefined): boolean {
  return e !== undefined && isNumber(e) && e.isReal === true && !e.isNaN;
}

/**
 * The range-pattern membership test: `true` iff `subject` is a real, non-`NaN`
 * number literal within `[lo, hi]`. Non-number subjects (symbols, operator
 * expressions, collections — including actual `Range` values — complex numbers,
 * `NaN`) never match and fall through to the next case.
 *
 * The endpoints use the matcher's number semantics (tolerant `isEqual`, via
 * `leafEquals`), so a subject within `engine.tolerance` of an endpoint selects
 * the case — consistent with how tiers 0–2 compare number leaves.
 */
function rangeContains(
  subject: Expression,
  lo: Expression,
  hi: Expression
): boolean {
  if (!isNumber(subject) || subject.isReal !== true || subject.isNaN)
    return false;
  if (leafEquals(subject, lo) || leafEquals(subject, hi)) return true;
  return (
    subject.isGreaterEqual(lo) === true && subject.isLessEqual(hi) === true
  );
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

    // NOTE: no closures are built here. The plan is cached for the lifetime
    // of the Match expression, but closure canonicalization is scope-sensitive
    // (frame-is-scope) — closures are built per use by `buildCaseClosure`.
    const base: Omit<CompiledCase, 'tier'> = {
      captureKeys,
      captureNames: names,
      hasGuard,
      guard,
      body,
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

  // A range pattern is a binding-free two-comparison predicate: tier 1 (never
  // dispatch-safe — it covers a span of values, not one key).
  const range = rangePatternBounds(p);
  if (range !== undefined)
    return { test: { kind: 'range', lo: range.lo, hi: range.hi } };

  if (isWildcard(p)) return {}; // a binding, never a leaf constant

  if (isNumber(p)) {
    const key = integerKey(p);
    if (key !== undefined)
      return {
        dispatch: { key, value: p },
        test: { kind: 'literal', value: p },
      };
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

/** Classify a `List`/`Tuple`/`Dictionary` pattern as a fixed shape, or
 * `undefined` if any element is not shape-compatible (operator patterns, `__`
 * sequences, more than one `___rest`, or — for dictionaries — a non-literal key
 * or a value that is not itself a fixed shape). */
function classifyShape(p: Expression): ShapeNode | undefined {
  if (!isFunction(p)) return undefined;
  if (p.operator === 'Dictionary') return classifyDictShape(p);
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
      const ep = classifyValueElement(el);
      if (ep === undefined) return undefined;
      (rest === undefined ? prefix : suffix).push(ep);
      continue;
    }

    const ep = classifyElement(el);
    if (ep === undefined) return undefined;
    (rest === undefined ? prefix : suffix).push(ep);
  }

  return { kind: 'seq', operator: p.operator, prefix, rest, suffix };
}

/** Classify a `Dictionary` pattern as a fixed dict shape, or `undefined` if a
 * key is not a literal string/symbol, a key is repeated, or a value is not a
 * fixed-shape element (binding / `_` / literal / pin / nested fixed shape — a
 * sequence/rest wildcard value falls to tier 3). Keys are literal (not
 * patternized), per §2 pattern rule 7. */
function classifyDictShape(p: Expression): DictShapeNode | undefined {
  if (!isFunction(p)) return undefined;
  const entries: { key: string; value: ElementPlan }[] = [];
  const seen = new Set<string>();
  for (const kv of p.ops) {
    const entry = dictEntry(kv);
    if (entry === undefined) return undefined;
    if (seen.has(entry.key)) return undefined; // repeated pattern key
    seen.add(entry.key);
    const value = classifyValueElement(entry.value);
    if (value === undefined) return undefined;
    entries.push({ key: entry.key, value });
  }
  return { kind: 'dict', entries };
}

/** Classify a value slot (a dict value, or a non-rest list element) as an
 * `ElementPlan`: a binding, `_`, or a non-wildcard fixed-shape element.
 * Sequence / optional-sequence wildcards are rejected (they are not valid in a
 * value position — the single list rest is handled by `classifyShape`). */
function classifyValueElement(el: Expression): ElementPlan | undefined {
  if (isWildcard(el)) {
    const wt = wildcardType(el);
    if (wt === 'Sequence' || wt === 'OptionalSequence') return undefined;
    const name = wildcardName(el)!;
    const bare = name.replace(/^_+/, '');
    return bare.length ? { kind: 'bind', key: name } : { kind: 'ignore' };
  }
  return classifyElement(el);
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

/** Destructure a dictionary-entry pattern (`KeyValuePair`/`Pair`/`Tuple` of a
 * string- or symbol-literal key and a value) into its literal key and value
 * expression, or `undefined` if the entry is not a well-formed literal-keyed
 * pair. Mirrors the entry forms `BoxedDictionary` accepts. */
function dictEntry(
  kv: Expression
): { key: string; value: Expression } | undefined {
  if (!isFunction(kv)) return undefined;
  const op = kv.operator;
  if (op !== 'KeyValuePair' && op !== 'Pair' && op !== 'Tuple')
    return undefined;
  if (kv.nops < 2) return undefined;
  const key = kv.ops[0];
  const value = kv.ops[1];
  if (isString(key)) return { key: key.string, value };
  if (isSymbol(key)) return { key: key.symbol, value };
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
  const walkElement = (el: ElementPlan): void => {
    if (el.kind === 'bind') add(el.key);
    else if (el.kind === 'shape') walk(el.node);
  };
  const walk = (n: ShapeNode): void => {
    if (n.kind === 'dict') {
      for (const { value } of n.entries) walkElement(value);
      return;
    }
    if (n.rest?.key) add(n.rest.key);
    for (const el of [...n.prefix, ...n.suffix]) walkElement(el);
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

/**
 * An **error subject**: an `Error`-headed value, or an invalid tree — one that
 * embeds an `Error` node anywhere (`isValid` is false exactly then, and it is
 * cached per boxed function).
 */
function isErrorSubject(subject: Expression): boolean {
  return !subject.isValid || isFunction(subject, 'Error');
}

/**
 * Whether an error subject is allowed to match `pattern` at all.
 *
 * `Match` is the rescue construct and must DECIDE on an error subject (rung 1
 * of the error-propagation design), but it must not pretend the failure has
 * the shape a pattern asks for: the canonical form of `"a" + 1` is an `Add`,
 * so `match "a" + 1 { a + b => … }` would otherwise hand the case a
 * "successful" destructuring of a failure. Only these patterns may match:
 *
 * - a wildcard — `_`, a bare binding `_x`, a sequence wildcard. A typed
 *   pattern (`v: number`) lowers to a bare binding plus an `Element` guard, so
 *   it is admitted here and decided by its guard (an error subject has type
 *   `error`, which no simple named type admits);
 * - an explicitly `Error`-headed pattern — `Error(c) => c` is deliberate error
 *   destructuring, and it binds the payload through the generic matcher.
 *
 * Literal, operator/algebraic and collection-shape patterns fail.
 */
function errorSubjectMayMatch(pattern: Expression): boolean {
  return isWildcard(pattern) || isFunction(pattern, 'Error');
}

/** An `Error` subject normalized for pattern matching: the `ErrorTrace`
 * breadcrumb removed (§2a), and — when the pattern asks for fewer operands
 * than remain — the WHERE operand removed too. The where slot covers both
 * shapes it can hold: the faulted-operand SITE attached at mint time (since
 * 2026-08-13) and the older string context some minters wrote — they are
 * the same slot, so `Error(c)` uniformly ignores it, deliberately. Both
 * trace and where are provenance, not payload: `Error(c)` must destructure
 * a sited or bubbled error exactly as it destructures a hand-written
 * `Error(c)`, while `Error(c, w)` still reaches the where for a case that
 * wants it — and a SEQUENCE wildcard (`Error(__all)`) asks for the whole
 * operand list, so nothing is removed for it despite its syntactic arity
 * of one.
 *
 * Root-only, matching the trace-stripping that preceded it: a sited error
 * NESTED as another error's cause is not normalized, so `Error(Error(c))`
 * does not see through the inner error's where (recorded in ROADMAP.md).
 * Any non-`Error` value is returned unchanged. */
function normalizeErrorSubject(
  subject: Expression,
  pattern: Expression
): Expression {
  if (!isFunction(subject, 'Error')) return subject;
  let ops = errorOpsWithoutTrace(subject);
  if (isFunction(pattern, 'Error')) {
    const wantsAll = pattern.ops.some(
      (p) =>
        wildcardType(p) === 'Sequence' || wildcardType(p) === 'OptionalSequence'
    );
    if (!wantsAll && ops.length === 2 && ops.length > pattern.ops.length)
      ops = ops.slice(0, 1);
  }
  if (ops.length === subject.ops!.length) return subject;
  return subject.engine._fn('Error', [...ops]);
}

/**
 * The reference-path matcher, range- and dict-aware. Takes the **raw** (held)
 * pattern and resolves its `Pin` nodes itself, so a top-level range pattern is
 * recognized before pin resolution could turn a pinned `Range` *value* into one.
 *
 * The generic matcher (`subject.match`) cannot align a **function-form**
 * `Dictionary(...)` pattern with a **native** dictionary value: a `Dictionary`
 * subject collapses to the engine's compact representation at canonicalization,
 * so there is no `Dictionary(...)` node for the generic matcher to walk. So when
 * the pattern contains a `Dictionary` node anywhere, descend structurally,
 * matching each dictionary against the native subject by key (open match) and
 * delegating every non-dict subtree back to the fully-capable generic matcher.
 *
 * **Depth.** Dictionaries are handled at any nesting inside `List`/`Tuple`
 * patterns and inside other dictionary values (dict-in-list, dict-in-dict,
 * list-in-dict, …). A `Dictionary` appearing as an operand of a *non-structural*
 * operator pattern (e.g. `Add(dict, x)`) is not supported — no such pattern is
 * reachable from Epsil surface syntax — and fails to match.
 */
function matchPattern(
  ce: ComputeEngine,
  subject: Expression,
  raw: Expression
): Substitution | null {
  // Rung 1: the error-subject gate. Applied here so the laddered tier-3 path
  // and the tier-3 reference path (`evaluateMatchReference`, which routes
  // EVERY case through this function) stay observationally identical.
  if (isErrorSubject(subject)) {
    if (!errorSubjectMayMatch(raw)) return null;
    // Rung 3: an error that BUBBLED carries a breadcrumb operand (design
    // §2a), and a validation error carries its SITE operand. Both are
    // provenance, not payload — `Error(c) => c` must destructure a sited or
    // bubbled error exactly as it destructures a hand-written one, so the
    // subject is normalized against the pattern's arity.
    subject = normalizeErrorSubject(subject, raw);
  }

  // Range membership is decided on the raw pattern (v1: at the top level of a
  // case pattern / of an or-alternative; a `Range` nested inside a list, tuple
  // or dictionary pattern keeps its structural meaning).
  const range = rangePatternBounds(raw);
  if (range !== undefined)
    return rangeContains(subject, range.lo, range.hi) ? {} : null;

  const pattern = resolvePins(ce, raw);
  if (!patternHasDict(pattern))
    return subject.match(pattern) as Substitution | null;
  const sub: Substitution = {};
  return matchInto(ce, subject, pattern, sub) ? sub : null;
}

/** Match `pattern` against `subject`, accumulating captures into `sub`.
 * Structurally descends `Dictionary`/`List`/`Tuple` patterns that contain a
 * dictionary; hands every dict-free subtree to the generic matcher. */
function matchInto(
  ce: ComputeEngine,
  subject: Expression,
  pattern: Expression,
  sub: Substitution
): boolean {
  if (!patternHasDict(pattern)) {
    const s = subject.match(pattern);
    if (s === null) return false;
    for (const k of Object.keys(s)) sub[k] = s[k];
    return true;
  }
  if (isFunction(pattern, 'Dictionary'))
    return matchDictInto(ce, subject, pattern, sub);
  if (isFunction(pattern, 'List') || isFunction(pattern, 'Tuple'))
    return matchSeqInto(ce, subject, pattern, sub);
  // A dictionary nested under an operator we do not structurally descend.
  return false;
}

/** Open dict match against a native dictionary subject (reference path). */
function matchDictInto(
  ce: ComputeEngine,
  subject: Expression,
  pattern: Expression,
  sub: Substitution
): boolean {
  if (!isDictionary(subject) || !isFunction(pattern)) return false;
  for (const kv of pattern.ops) {
    const entry = dictEntry(kv);
    if (entry === undefined) return false;
    const v = subject.get(entry.key);
    if (v === undefined) return false; // missing key → no match
    if (!matchInto(ce, v, entry.value, sub)) return false;
  }
  return true;
}

/** Positional `List`/`Tuple` match with a single optional `___rest`, recursing
 * through `matchInto` so nested dictionaries are handled (reference path). */
function matchSeqInto(
  ce: ComputeEngine,
  subject: Expression,
  pattern: Expression,
  sub: Substitution
): boolean {
  if (!isFunction(pattern) || !isFunction(subject)) return false;
  if (subject.operator !== pattern.operator) return false;
  const els = pattern.ops;
  let restIdx = -1;
  for (let i = 0; i < els.length; i++) {
    if (!isWildcard(els[i])) continue;
    const wt = wildcardType(els[i]);
    if (wt === 'Sequence') return false; // `__` handled only by the generic path
    if (wt === 'OptionalSequence') {
      if (restIdx !== -1) return false; // >1 rest not handled here
      restIdx = i;
    }
  }

  const sOps = subject.ops;
  if (restIdx === -1) {
    if (sOps.length !== els.length) return false;
    for (let i = 0; i < els.length; i++)
      if (!matchInto(ce, sOps[i], els[i], sub)) return false;
    return true;
  }

  const prefix = els.slice(0, restIdx);
  const suffix = els.slice(restIdx + 1);
  if (sOps.length < prefix.length + suffix.length) return false;
  for (let i = 0; i < prefix.length; i++)
    if (!matchInto(ce, sOps[i], prefix[i], sub)) return false;
  for (let j = 0; j < suffix.length; j++)
    if (!matchInto(ce, sOps[sOps.length - suffix.length + j], suffix[j], sub))
      return false;

  const restName = wildcardName(els[restIdx])!;
  if (restName.replace(/^_+/, '').length)
    sub[restName] = wrapRest(
      ce,
      sOps.slice(prefix.length, sOps.length - suffix.length)
    );
  return true;
}

/** True if `expr` contains a `["Dictionary", …]` node anywhere. */
function patternHasDict(expr: Expression): boolean {
  if (isFunction(expr, 'Dictionary')) return true;
  if (isFunction(expr)) return expr.ops.some(patternHasDict);
  return false;
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
