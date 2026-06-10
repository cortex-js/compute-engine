// Offline rule compiler for the Fungrim Phase-1 loader
// (FUNGRIM-PLAN-5-LOADER.md §2.2–§2.5, milestone M1).
//
// Reads the translated corpus (`data/fungrim/`), selects the Phase-1 slice
// (class ∈ {specific-value, identity} × guardLevel ∈ {none, real-simple}),
// and compiles each `["Equal", lhs, rhs]` entry into a declarative
// `CompiledFungrimRule` record:
//
//  1. wildcardize entry variables (`z` → `_z`),
//  2. orient (cost-function policy with a 10% margin; ties → `'expand'`
//     with the match on the special-function-headed side; the machine policy
//     never emits `'transform'`),
//  3. compile assumptions to a `GuardSpec[]` (fail-closed:
//     `guard-uncompilable` for anything outside the mapping table),
//  4. dedup undirected duplicates (`duplicate-undirected`),
//  5. self-test every candidate in a scratch engine (stock CE + pruned
//     shells, NO compat widening): reject `box-error`, `wildcard-loss`,
//     `compat-signature` and `no-fire` candidates,
//  6. merge `curation-overrides.json`, then emit the checked-in artifact
//     `src/compute-engine/fungrim/fungrim-core-data.json` (deterministic
//     ordering: byte-identical on re-run) and the compile ledger
//     `scripts/fungrim/rule-compile-report.json`.
//
// Run with: npx tsx scripts/fungrim/compile-rules.ts
//
// `scripts/fungrim/load.ts` is reused read-only (loadCorpus, inferType,
// variableTypes, COMPAT_OVERRIDES).

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

import {
  loadCorpus,
  inferType,
  variableTypes,
  COMPAT_OVERRIDES,
} from './load';
import type { Entry, Declarations } from './load';

// ---------------------------------------------------------------------------
// Types (artifact schema per FUNGRIM-PLAN-5-LOADER.md §2.2)
// ---------------------------------------------------------------------------

/** Raw MathJSON — the corpus is plain JSON. */
export type MathJSON = unknown;

export type GuardSpec =
  | { k: 'type'; wc: string; t: 'integer' | 'real' | 'rational' }
  | { k: 'cmp'; wc: string; op: 'gt' | 'ge' | 'lt' | 'le'; bound: MathJSON }
  | { k: 'ne'; lhs: MathJSON; rhs: MathJSON }
  | { k: 'eval'; pred: MathJSON };

export type RuleClass = 'specific-value' | 'identity';
export type RulePurpose = 'simplify' | 'transform' | 'expand';
export type RuleTarget = 'simplify' | 'solve' | 'harmonization';

export type CompiledFungrimRule = {
  id: string; // 'fungrim:<entryid>'
  match: MathJSON;
  replace: MathJSON;
  guards: GuardSpec[];
  purpose: RulePurpose;
  target: RuleTarget;
  class: RuleClass;
  heads: string[];
  topics: string[];
};

export type SkipRecord = { id: string; reason: SkipReason; detail?: string };

export type SkipReason =
  | 'not-equation' // formula root is not a plain binary Equal (EqualNearestDecimal, …)
  | 'lhs-not-value-form' // specific value whose LHS is a symbol/Set/Apply (Q3: all excluded)
  | 'curated-exclude' // excluded via curation-overrides.json
  | 'compat-signature' // relies on a widened COMPAT signature (2-arg LambertW/Digamma, …)
  | 'guard-uncompilable' // assumption outside the §2.2 mapping table (fail-closed)
  | 'unorientable' // no viable direction (match not a function expr / wildcard subset fails)
  | 'duplicate-undirected' // same undirected equality already emitted (§2.5)
  | 'box-error' // boxing the rule (or its sides) failed in the scratch engine
  | 'wildcard-loss' // canonicalizing the match pattern loses wildcards (mirrors applyRule)
  | 'no-fire'; // the boxed rule did not fire on its seeded instantiation

export type CurationOverride = {
  direction?: 'lhs-rhs' | 'rhs-lhs';
  purpose?: RulePurpose;
  target?: RuleTarget;
  exclude?: boolean;
  note?: string;
};

export type CurationOverrides = {
  overrides?: Record<string, CurationOverride>;
  transformAllowlist?: string[];
  solveSeeds?: Record<string, { target: 'solve'; note: string }>;
};

export type CompileResult = {
  rules: CompiledFungrimRule[];
  skips: SkipRecord[];
  /** Pruned shell-declaration table: heads referenced by emitted rules. */
  declarations: Record<
    string,
    { signature: string; description?: string; arity?: number | number[] }
  >;
  /** Sample kind used by the passing self-test, per rule id. */
  sampleKinds: Record<string, 'symbolic' | 'numeric'>;
};

// ---------------------------------------------------------------------------
// Slice selection
// ---------------------------------------------------------------------------

export function isSliceEntry(e: Entry): boolean {
  return (
    (e.class === 'specific-value' || e.class === 'identity') &&
    (e.guardLevel === 'none' || e.guardLevel === 'real-simple')
  );
}

// ---------------------------------------------------------------------------
// MathJSON tree utilities
// ---------------------------------------------------------------------------

/** Rename each entry variable `z` to the wildcard `_z` (pure tree rewrite). */
export function wildcardize(
  x: MathJSON,
  variables: ReadonlyArray<string>
): MathJSON {
  if (typeof x === 'string') return variables.includes(x) ? '_' + x : x;
  if (Array.isArray(x)) return x.map((y) => wildcardize(y, variables));
  return x;
}

/** Substitute wildcard symbols by MathJSON fragments. */
export function substituteWildcards(
  x: MathJSON,
  sub: Readonly<Record<string, MathJSON>>
): MathJSON {
  if (typeof x === 'string' && x in sub) return sub[x];
  if (Array.isArray(x)) return x.map((y) => substituteWildcards(y, sub));
  return x;
}

/** All wildcard symbols (`_…`) appearing in a MathJSON tree. */
export function collectWildcards(x: MathJSON, out = new Set<string>()): Set<string> {
  if (typeof x === 'string' && x.startsWith('_')) out.add(x);
  else if (Array.isArray(x)) for (const y of x) collectWildcards(y, out);
  return out;
}

/** All symbol-position strings appearing in a MathJSON tree. */
function collectSymbols(x: MathJSON, out = new Set<string>()): Set<string> {
  if (typeof x === 'string') out.add(x);
  else if (Array.isArray(x)) for (const y of x) collectSymbols(y, out);
  return out;
}

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** `collection` → `set` in shell signatures (same rewrite as load.ts). */
function setify(signature: string): string {
  return signature.replace(/\bcollection\b/g, 'set');
}

// ---------------------------------------------------------------------------
// Guard compilation (§2.2 mapping table, fail-closed)
// ---------------------------------------------------------------------------

const INFINITE_BOUNDS = new Set([
  'PositiveInfinity',
  'NegativeInfinity',
  'Infinity',
  'ComplexInfinity',
]);

function isInfiniteBound(b: MathJSON): boolean {
  if (typeof b === 'string') return INFINITE_BOUNDS.has(b);
  if (Array.isArray(b) && b[0] === 'Negate') return isInfiniteBound(b[1]);
  return false;
}

function flattenAnd(a: MathJSON): MathJSON[] {
  if (a === null || a === undefined) return [];
  if (Array.isArray(a) && a[0] === 'And')
    return a.slice(1).flatMap((x) => flattenAnd(x));
  return [a];
}

/**
 * Compile entry assumptions to a GuardSpec list. Fail-closed: any conjunct
 * outside the mapping table makes the whole entry uncompilable.
 */
export function compileGuards(
  assumptions: MathJSON,
  variables: ReadonlyArray<string>
): { guards: GuardSpec[] } | { error: string } {
  const guards: GuardSpec[] = [];
  const wc = (v: string) => '_' + v;
  const W = (x: MathJSON) => wildcardize(x, variables);

  const pushBound = (
    v: string,
    raw: MathJSON,
    openOp: 'gt' | 'lt',
    closedOp: 'ge' | 'le'
  ): void => {
    let bound = raw;
    let open = false;
    if (Array.isArray(bound) && bound[0] === 'Open') {
      open = true;
      bound = bound[1];
    }
    if (isInfiniteBound(bound)) return; // skip infinite bounds
    guards.push({ k: 'cmp', wc: wc(v), op: open ? openOp : closedOp, bound: W(bound) });
  };

  // Element(v, domain) for a bare entry variable v
  const element = (v: string, dom: MathJSON): string | null => {
    if (typeof dom === 'string') {
      switch (dom) {
        case 'Integers':
          guards.push({ k: 'type', wc: wc(v), t: 'integer' });
          return null;
        case 'NonNegativeIntegers':
          guards.push({ k: 'type', wc: wc(v), t: 'integer' });
          guards.push({ k: 'cmp', wc: wc(v), op: 'ge', bound: 0 });
          return null;
        case 'PositiveIntegers':
          guards.push({ k: 'type', wc: wc(v), t: 'integer' });
          guards.push({ k: 'cmp', wc: wc(v), op: 'gt', bound: 0 });
          return null;
        case 'NegativeIntegers':
          guards.push({ k: 'type', wc: wc(v), t: 'integer' });
          guards.push({ k: 'cmp', wc: wc(v), op: 'lt', bound: 0 });
          return null;
        case 'NonPositiveIntegers':
          guards.push({ k: 'type', wc: wc(v), t: 'integer' });
          guards.push({ k: 'cmp', wc: wc(v), op: 'le', bound: 0 });
          return null;
        case 'RealNumbers':
          guards.push({ k: 'type', wc: wc(v), t: 'real' });
          return null;
        case 'RationalNumbers':
          guards.push({ k: 'type', wc: wc(v), t: 'rational' });
          return null;
        case 'Primes':
          // CE's `Primes` is a shell with no membership evaluator; compile to
          // the built-in IsPrime predicate (still fail-closed: fires only on
          // a literal True).
          guards.push({ k: 'type', wc: wc(v), t: 'integer' });
          guards.push({ k: 'eval', pred: ['IsPrime', wc(v)] });
          return null;
        default:
          return `unsupported domain "${dom}"`;
      }
    }
    if (Array.isArray(dom)) {
      const op = dom[0];
      if (op === 'Interval' && dom.length === 3) {
        guards.push({ k: 'type', wc: wc(v), t: 'real' });
        pushBound(v, dom[1], 'gt', 'ge');
        pushBound(v, dom[2], 'lt', 'le');
        return null;
      }
      if (op === 'Range' && dom.length === 3) {
        guards.push({ k: 'type', wc: wc(v), t: 'integer' });
        pushBound(v, dom[1], 'gt', 'ge');
        pushBound(v, dom[2], 'lt', 'le');
        return null;
      }
      if (
        op === 'SetMinus' &&
        dom.length === 3 &&
        Array.isArray(dom[2]) &&
        dom[2][0] === 'Set'
      ) {
        const err = element(v, dom[1]);
        if (err) return err;
        for (const excluded of dom[2].slice(1))
          guards.push({ k: 'ne', lhs: wc(v), rhs: W(excluded) });
        return null;
      }
      return `unsupported domain ${JSON.stringify(op)}`;
    }
    return `unsupported domain ${JSON.stringify(dom)}`;
  };

  const CMP_OP: Record<string, 'gt' | 'ge' | 'lt' | 'le'> = {
    Greater: 'gt',
    GreaterEqual: 'ge',
    Less: 'lt',
    LessEqual: 'le',
  };
  const FLIP: Record<string, 'gt' | 'ge' | 'lt' | 'le'> = {
    gt: 'lt',
    ge: 'le',
    lt: 'gt',
    le: 'ge',
  };

  for (const cj of flattenAnd(assumptions)) {
    if (!Array.isArray(cj) || typeof cj[0] !== 'string')
      return { error: `unsupported conjunct ${JSON.stringify(cj)}` };
    const op = cj[0];

    if (op === 'Element' && cj.length === 3) {
      if (typeof cj[1] === 'string' && variables.includes(cj[1])) {
        const err = element(cj[1], cj[2]);
        if (err) return { error: err };
      } else {
        // Element over a non-variable expression: evaluate-fallback
        guards.push({ k: 'eval', pred: W(cj) });
      }
    } else if (op === 'NotEqual' && cj.length >= 3) {
      // pairwise distinctness
      for (let i = 1; i < cj.length; i++)
        for (let j = i + 1; j < cj.length; j++)
          guards.push({ k: 'ne', lhs: W(cj[i]), rhs: W(cj[j]) });
    } else if (op in CMP_OP && cj.length >= 3) {
      // decompose n-ary relational chains into consecutive pairs
      for (let i = 1; i < cj.length - 1; i++) {
        const a = cj[i];
        const b = cj[i + 1];
        if (typeof a === 'string' && variables.includes(a))
          guards.push({ k: 'cmp', wc: wc(a), op: CMP_OP[op], bound: W(b) });
        else if (typeof b === 'string' && variables.includes(b))
          guards.push({ k: 'cmp', wc: wc(b), op: FLIP[CMP_OP[op]], bound: W(a) });
        else guards.push({ k: 'eval', pred: [op, W(a), W(b)] });
      }
    } else if (op === 'Equal') {
      guards.push({ k: 'eval', pred: W(cj) });
    } else if (op === 'Divides' && cj.length === 3) {
      // CE's `Divides` is a shell with no evaluator; Divides(d, n) ⇔ n mod d = 0
      guards.push({ k: 'eval', pred: ['Equal', ['Mod', W(cj[2]), W(cj[1])], 0] });
    } else {
      // Not, NotElement, Or, quantifiers, … — fail-closed
      return { error: `unsupported conjunct "${op}"` };
    }
  }
  return { guards };
}

/** Wildcards referenced by a guard (its subject + any in bounds/operands). */
export function guardWildcards(g: GuardSpec): Set<string> {
  const out = new Set<string>();
  if (g.k === 'type') out.add(g.wc);
  else if (g.k === 'cmp') {
    out.add(g.wc);
    collectWildcards(g.bound, out);
  } else if (g.k === 'ne') {
    collectWildcards(g.lhs, out);
    collectWildcards(g.rhs, out);
  } else collectWildcards(g.pred, out);
  return out;
}

// ---------------------------------------------------------------------------
// Guard closures (same semantics the M2 runtime loader will use, §2.2:
// every predicate must return a definitive positive; unknown ⇒ false)
// ---------------------------------------------------------------------------

type Sub = Record<string, Expression>;

export function buildGuardClosures(
  ce: ComputeEngine,
  guards: ReadonlyArray<GuardSpec>
): ((sub: Sub) => boolean)[] {
  const boxGuardExpr = (x: MathJSON): Expression => {
    try {
      const b = ce.box(x as never);
      if (b.isValid) return b;
    } catch {
      /* fall through to raw boxing */
    }
    return ce.box(x as never, { form: 'raw' });
  };

  return guards.map((g) => {
    switch (g.k) {
      case 'type':
        return (sub: Sub) => {
          const v = sub[g.wc];
          if (v === undefined) return false;
          if (g.t === 'integer') return v.isInteger === true;
          if (g.t === 'real') return v.isReal === true;
          return v.isRational === true;
        };
      case 'cmp': {
        const bound = boxGuardExpr(g.bound);
        const compare = (
          v: Expression,
          b: Expression
        ): boolean | undefined =>
          g.op === 'gt'
            ? v.isGreater(b)
            : g.op === 'ge'
              ? v.isGreaterEqual(b)
              : g.op === 'lt'
                ? v.isLess(b)
                : v.isLessEqual(b);
        return (sub: Sub) => {
          const v = sub[g.wc];
          if (v === undefined) return false;
          try {
            let b = bound.subs(sub);
            if (!b.isCanonical) b = b.canonical;
            let r = compare(v, b);
            // Composite constant bounds (-π, π/2, 1/e …) are not directly
            // comparable; retry on the numeric evaluations. Still fail-closed:
            // an unknown remains `undefined` ⇒ false.
            if (r === undefined) r = compare(v.N(), b.N());
            return r === true;
          } catch {
            return false;
          }
        };
      }
      case 'ne': {
        const lhs = boxGuardExpr(g.lhs);
        const rhs = boxGuardExpr(g.rhs);
        return (sub: Sub) => {
          try {
            return lhs.subs(sub).isEqual(rhs.subs(sub)) === false;
          } catch {
            return false;
          }
        };
      }
      case 'eval': {
        const pred = boxGuardExpr(g.pred);
        return (sub: Sub) => {
          try {
            return pred.subs(sub).evaluate().json === 'True';
          } catch {
            return false;
          }
        };
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Orientation & curation policy (§2.3)
// ---------------------------------------------------------------------------

/**
 * Heads considered "core" (arithmetic/structural). A side whose root operator
 * is NOT in this set counts as special-function-headed for the tie-band
 * orientation of `'expand'` rules.
 */
const CORE_HEADS = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Sqrt',
  'Root',
  'Rational',
  'Complex',
  'Abs',
  'Max',
  'Min',
  'Floor',
  'Ceiling',
  'Round',
  'Sign',
  'Mod',
  'Sum',
  'Product',
  'List',
  'Set',
  'Tuple',
  'Hold',
]);

function isSpecialHeaded(side: MathJSON): boolean {
  return (
    Array.isArray(side) && typeof side[0] === 'string' && !CORE_HEADS.has(side[0])
  );
}

export type Orientation = {
  match: MathJSON;
  replace: MathJSON;
  direction: 'lhs-rhs' | 'rhs-lhs';
  purpose: RulePurpose;
  costs: { lhs: number; rhs: number };
};

/** The 10% static-shrink margin (§2.3). */
const MARGIN = 0.9;

/**
 * Orient an entry. `lhsW`/`rhsW` are the wildcardized sides; costs are
 * computed with the engine's real costFunction on the canonically-boxed
 * variable-named sides (entry variables declared with their inferred types).
 *
 * The machine policy never emits `'transform'` (override-only).
 */
export function orientEntry(
  ce: ComputeEngine,
  e: Entry,
  sides: { lhs: MathJSON; rhs: MathJSON },
  lhsW: MathJSON,
  rhsW: MathJSON,
  forcedDirection?: 'lhs-rhs' | 'rhs-lhs'
): Orientation | { error: 'box-error' | 'unorientable'; detail?: string } {
  // -- cost of the variable-named canonical sides
  let cLhs: number;
  let cRhs: number;
  ce.pushScope();
  try {
    const types = variableTypes(e);
    for (const v of e.variables) {
      try {
        ce.declare(v, types[v] ?? 'complex');
      } catch {
        /* name collides with a CE built-in — tolerate (same as load.ts) */
      }
    }
    const lhs = ce.box(sides.lhs as never);
    const rhs = ce.box(sides.rhs as never);
    if (!lhs.isValid)
      return { error: 'box-error', detail: `invalid lhs: ${lhs.toString()}` };
    if (!rhs.isValid)
      return { error: 'box-error', detail: `invalid rhs: ${rhs.toString()}` };
    cLhs = ce.costFunction(lhs);
    cRhs = ce.costFunction(rhs);
  } catch (err) {
    return { error: 'box-error', detail: String((err as Error)?.message).slice(0, 200) };
  } finally {
    ce.popScope();
  }

  const wLhs = collectWildcards(lhsW);
  const wRhs = collectWildcards(rhsW);
  // A direction is viable if the match side is a pattern-viable function
  // expression and the replace side introduces no new wildcards.
  const viableLR = Array.isArray(lhsW) && isSubset(wRhs, wLhs);
  const viableRL = Array.isArray(rhsW) && isSubset(wLhs, wRhs);

  const costs = { lhs: cLhs, rhs: cRhs };
  const LR: Orientation = {
    match: lhsW,
    replace: rhsW,
    direction: 'lhs-rhs',
    purpose: 'expand',
    costs,
  };
  const RL: Orientation = {
    match: rhsW,
    replace: lhsW,
    direction: 'rhs-lhs',
    purpose: 'expand',
    costs,
  };

  if (forcedDirection !== undefined) {
    const o = forcedDirection === 'lhs-rhs' ? LR : RL;
    const viable = forcedDirection === 'lhs-rhs' ? viableLR : viableRL;
    if (!viable)
      return { error: 'unorientable', detail: `forced ${forcedDirection} not viable` };
    const shrinks =
      forcedDirection === 'lhs-rhs' ? cRhs <= MARGIN * cLhs : cLhs <= MARGIN * cRhs;
    return { ...o, purpose: shrinks ? 'simplify' : 'expand' };
  }

  // Specific values: always value-form → closed-form, purpose 'simplify'
  if (e.class === 'specific-value') {
    if (!viableLR) return { error: 'unorientable', detail: 'lhs not pattern-viable' };
    return { ...LR, purpose: 'simplify' };
  }

  if (cRhs <= MARGIN * cLhs && viableLR) return { ...LR, purpose: 'simplify' };
  if (cLhs <= MARGIN * cRhs && viableRL) return { ...RL, purpose: 'simplify' };

  // Tie band (or the cheap side is un-patternable): orient the match toward
  // the side rooted in a named special-function head, tag 'expand'
  const sLhs = isSpecialHeaded(lhsW);
  const sRhs = isSpecialHeaded(rhsW);
  if (sLhs && !sRhs && viableLR) return LR;
  if (sRhs && !sLhs && viableRL) return RL;
  if (viableLR) return LR; // both/neither special: keep corpus orientation
  if (viableRL) return RL;
  return { error: 'unorientable', detail: 'no viable direction' };
}

// ---------------------------------------------------------------------------
// Compile-time dedup of undirected duplicates (§2.5)
// ---------------------------------------------------------------------------

/**
 * Key an entry by the unordered pair of canonical side forms, with wildcards
 * jointly renamed by order of first appearance — so an equality and its swap
 * (possibly with renamed variables) map to the same key.
 */
export function undirectedKey(
  ce: ComputeEngine,
  lhsW: MathJSON,
  rhsW: MathJSON
): string {
  const side = (s: MathJSON): string => {
    // Box in a throwaway scope: canonical boxing auto-declares the wildcard
    // symbols, and those inferred types must not leak across entries.
    ce.pushScope();
    try {
      const b = ce.box(s as never);
      return JSON.stringify(b.json);
    } catch {
      return JSON.stringify(s);
    } finally {
      ce.popScope();
    }
  };
  let a = side(lhsW);
  let b = side(rhsW);
  if (b < a) [a, b] = [b, a];
  const joined = a + '' + b;
  const renames = new Map<string, string>();
  return joined.replace(/"(_{1,3}[^"\\]*)"/g, (_m, name: string) => {
    if (!renames.has(name)) renames.set(name, `"_w${renames.size + 1}"`);
    return renames.get(name)!;
  });
}

// ---------------------------------------------------------------------------
// Scratch-engine self-test (§2.2 step 4)
// ---------------------------------------------------------------------------

// Numeric seed candidates, ordered to satisfy the common guard shapes early.
const INTEGER_CANDIDATES: MathJSON[] = [
  1, 2, 3, 5, 0, 4, 7, 6, -1, 11, 8, 12, 9, 13, -2, 30,
];
const REAL_CANDIDATES: MathJSON[] = [
  ['Rational', 1, 2],
  2,
  ['Rational', 1, 3],
  1,
  ['Rational', 3, 2],
  3,
  ['Rational', 2, 3],
  ['Rational', 1, 4],
  ['Rational', -1, 2],
  -1,
  -2,
  ['Rational', 5, 2],
  ['Rational', 1, 10],
  ['Rational', 7, 2],
  5,
  ['Rational', -3, 2],
];

const CMP_TO_OPERATOR: Record<string, string> = {
  gt: 'Greater',
  ge: 'GreaterEqual',
  lt: 'Less',
  le: 'LessEqual',
};

/** Per-variable type implied by the compiled guards (else inferred). */
function variableSeedTypes(
  e: Entry,
  guards: ReadonlyArray<GuardSpec>
): Record<string, string> {
  const inferred = variableTypes(e);
  const types: Record<string, string> = {};
  for (const v of e.variables) {
    const g = guards.find(
      (g): g is Extract<GuardSpec, { k: 'type' }> => g.k === 'type' && g.wc === '_' + v
    );
    types[v] = g?.t ?? inferred[v] ?? 'complex';
  }
  return types;
}

export type SelfTestResult =
  | { ok: true; sampleKind: 'symbolic' | 'numeric' }
  | { ok: false; reason: 'box-error' | 'wildcard-loss' | 'no-fire'; detail?: string };

/**
 * Box the candidate rule and require it to fire on a seeded instantiation
 * satisfying the guards (symbolic seed first, numeric backtracking fallback).
 */
export function selfTest(
  ce: ComputeEngine,
  e: Entry,
  matchW: MathJSON,
  replaceW: MathJSON,
  guards: ReadonlyArray<GuardSpec>
): SelfTestResult {
  // All boxing happens inside a per-entry scope where the wildcards carry
  // their guard-implied types: strict validation of typed slots
  // (Totient(_n), Fibonacci(_n), …) passes, and inferred wildcard types
  // never leak across entries.
  const seedTypes = variableSeedTypes(e, guards);
  ce.pushScope();
  try {
    for (const v of e.variables) {
      try {
        ce.declare('_' + v, seedTypes[v]);
      } catch {
        /* tolerate */
      }
    }
    return selfTestScoped(ce, e, matchW, replaceW, guards, seedTypes);
  } finally {
    ce.popScope();
  }
}

function selfTestScoped(
  ce: ComputeEngine,
  e: Entry,
  matchW: MathJSON,
  replaceW: MathJSON,
  guards: ReadonlyArray<GuardSpec>,
  seedTypes: Record<string, string>
): SelfTestResult {
  const closures = buildGuardClosures(ce, guards);
  const condition =
    guards.length === 0 ? undefined : (sub: Sub) => closures.every((f) => f(sub));

  // 1. Box the rule (reject: box-error). The match/replace MathJSON is
  //    pre-boxed: a bare-string side ('ComplexInfinity', '_x') passed
  //    directly to ce.rules would be parsed as a LaTeX rule string. The
  //    replace is pre-boxed *canonically* with the typed wildcards in scope
  //    — the M2 loader replicates this using the artifact's guard specs.
  let ruleSet: ReturnType<ComputeEngine['rules']>;
  try {
    const replaceExpr = ce.box(replaceW as never);
    if (!replaceExpr.isValid)
      return {
        ok: false,
        reason: 'box-error',
        detail: `invalid replace: ${replaceExpr.toString()}`.slice(0, 160),
      };
    // The match is pre-boxed CANONICALLY (not raw): raw boxing leaves
    // literals as structural function expressions (['Rational',1,2] stays a
    // Rational function, not a number) and loses ~100 rules to literal
    // mismatches. Canonicalization is safe here: the match MathJSON is
    // already in canonical shape and step 6 of the pipeline verified that
    // canonicalizing it preserves every wildcard. The M2 runtime loader must
    // do the same (box artifact matches canonically before ce.rules).
    ruleSet = ce.rules(
      [
        {
          match: ce.box(matchW as never) as never,
          replace: replaceExpr as never,
          condition,
          id: 'fungrim:' + e.id,
        },
      ],
      { canonical: true }
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'box-error',
      detail: String((err as Error)?.message)
        .replace(/\s+/g, ' ')
        .slice(0, 160),
    };
  }

  // 2. Wildcard-loss under canonicalization (mirrors applyRule's check)
  const boxedMatch = ruleSet.rules[0].match;
  if (boxedMatch !== undefined) {
    try {
      const before = collectWildcards(boxedMatch.json);
      const after = collectWildcards(boxedMatch.canonical.json);
      if (!isSubset(before, after)) return { ok: false, reason: 'wildcard-loss' };
    } catch (err) {
      return {
        ok: false,
        reason: 'box-error',
        detail: String((err as Error)?.message)
          .replace(/\s+/g, ' ')
          .slice(0, 160),
      };
    }
  }

  const fireTest = (subJson: Record<string, MathJSON>): { ok: boolean; detail?: string } => {
    try {
      const inst = ce.box(substituteWildcards(matchW, subJson) as never);
      if (!inst.isValid) return { ok: false, detail: 'invalid instantiated match' };
      const expected = ce.box(substituteWildcards(replaceW, subJson) as never);
      if (!expected.isValid)
        return { ok: false, detail: 'invalid instantiated replace' };
      const result = inst.replace(ruleSet);
      if (result === null) return { ok: false, detail: 'rule did not fire' };
      // Structural identity, with a provable-equality fallback: canonical
      // form is not perfectly confluent (e.g. `pi * sqrt(2) / 2` vs
      // `sqrt(2)/2 * pi`), and the fired result and the independently boxed
      // expectation may settle in different but equal canonical shapes.
      if (!result.isSame(expected) && result.isEqual(expected) !== true)
        return {
          ok: false,
          detail: `fired but produced ${result.toString()} ≠ ${expected.toString()}`.slice(
            0,
            160
          ),
        };
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        detail: String((err as Error)?.message)
          .replace(/\s+/g, ' ')
          .slice(0, 160),
      };
    }
  };

  // 3a. Symbolic seed: typed symbols + assumed cmp constraints
  let symbolicDetail: string | undefined;
  ce.pushScope();
  try {
    for (const v of e.variables) {
      try {
        ce.declare(v, seedTypes[v]);
      } catch {
        /* collides with a built-in — tolerate */
      }
    }
    const dewild: Record<string, MathJSON> = {};
    for (const v of e.variables) dewild['_' + v] = v;
    for (const g of guards) {
      if (g.k !== 'cmp') continue;
      try {
        ce.assume(
          ce.box([
            CMP_TO_OPERATOR[g.op],
            substituteWildcards(g.wc, dewild),
            substituteWildcards(g.bound, dewild),
          ] as never)
        );
      } catch {
        /* unsupported assumption — the guard check below decides */
      }
    }
    const sub: Sub = {};
    for (const v of e.variables) sub['_' + v] = ce.box(v);
    if (closures.every((f) => f(sub))) {
      const r = fireTest(dewild);
      if (r.ok) return { ok: true, sampleKind: 'symbolic' };
      symbolicDetail = r.detail;
    }
  } finally {
    ce.popScope();
  }

  // 3b. Numeric seed: backtracking search over small typed candidates
  let numeric: Record<string, MathJSON> | null;
  ce.pushScope();
  try {
    numeric = findNumericSeed(ce, e, guards, closures, seedTypes);
    if (numeric === null)
      return {
        ok: false,
        reason: 'no-fire',
        detail: symbolicDetail ?? 'no seed satisfying the guards',
      };
    const r = fireTest(numeric);
    if (r.ok) return { ok: true, sampleKind: 'numeric' };
    symbolicDetail = r.detail ?? symbolicDetail;
  } finally {
    ce.popScope();
  }

  // 3c. Valued-symbol seed: same numeric values, but assigned to declared
  //     symbols. The instantiated match stays structurally symbolic (no
  //     literal folding) while the guards see through the value bindings —
  //     this is the fold-proof seeding for ne/eval-guarded entries.
  ce.pushScope();
  try {
    const dewild: Record<string, MathJSON> = {};
    for (const v of e.variables) {
      dewild['_' + v] = v;
      try {
        ce.declare(v, seedTypes[v]);
      } catch {
        /* collides with a built-in — tolerate */
      }
      try {
        const value = numeric['_' + v];
        if (value !== undefined) ce.assign(v, ce.box(value as never));
      } catch {
        /* unassignable — the guard check at match time decides */
      }
    }
    const r = fireTest(dewild);
    if (r.ok) return { ok: true, sampleKind: 'numeric' };
    return { ok: false, reason: 'no-fire', detail: r.detail ?? symbolicDetail };
  } finally {
    ce.popScope();
  }
}

function findNumericSeed(
  ce: ComputeEngine,
  e: Entry,
  guards: ReadonlyArray<GuardSpec>,
  closures: ReadonlyArray<(sub: Sub) => boolean>,
  seedTypes: Record<string, string>
): Record<string, MathJSON> | null {
  const vars = e.variables;
  const sub: Sub = {};

  // Guards are checked at the depth where their last referenced variable is
  // assigned (massive pruning for multi-variable entries).
  const wcIndex = new Map<string, number>(vars.map((v, i) => ['_' + v, i]));
  const guardDepth = guards.map((g) => {
    let depth = -1;
    for (const w of guardWildcards(g)) depth = Math.max(depth, wcIndex.get(w) ?? vars.length - 1);
    return depth;
  });

  // Variable-free guards must hold outright
  for (let i = 0; i < guards.length; i++)
    if (guardDepth[i] === -1 && !closures[i](sub)) return null;
  if (vars.length === 0) return {};

  const candidates = vars.map((v) =>
    seedTypes[v] === 'integer' ? INTEGER_CANDIDATES : REAL_CANDIDATES
  );
  const boxed = candidates.map((list) => list.map((c) => ce.box(c as never)));

  let budget = 50_000; // guard-evaluation budget
  const seed: Record<string, MathJSON> = {};

  const dfs = (depth: number): boolean => {
    if (depth === vars.length) return true;
    const wc = '_' + vars[depth];
    for (let c = 0; c < candidates[depth].length; c++) {
      sub[wc] = boxed[depth][c];
      seed[wc] = candidates[depth][c];
      let ok = true;
      for (let i = 0; i < guards.length && ok; i++) {
        if (guardDepth[i] !== depth) continue;
        if (budget-- <= 0) return false;
        ok = closures[i](sub);
      }
      if (ok && dfs(depth + 1)) return true;
      if (budget <= 0) return false;
    }
    delete sub[wc];
    delete seed[wc];
    return false;
  };

  return dfs(0) ? seed : null;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Static detection of widened-compat-signature usage (§2.2: `compat-signature`). */
export function usesWidenedCompatSignature(formula: MathJSON): boolean {
  // CE's LambertW and Digamma are 1-arg; the corpus' 2-arg forms (branch /
  // polygamma order) require the COMPAT widening that the loader never applies.
  const walk = (x: MathJSON): boolean => {
    if (!Array.isArray(x)) return false;
    if ((x[0] === 'LambertW' || x[0] === 'Digamma') && x.length > 2) return true;
    return x.some((y) => walk(y));
  };
  return walk(formula);
}

function referencesCompatHead(formula: MathJSON): boolean {
  const symbols = collectSymbols(formula);
  return Object.keys(COMPAT_OVERRIDES).some((h) => symbols.has(h));
}

/** Create the scratch engine: stock CE + shells referenced by the entries (no compat widening). */
export function createScratchEngine(
  entries: ReadonlyArray<Entry>,
  declarations: Declarations
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.pushScope(undefined, 'fungrim-shells');
  const referenced = new Set<string>();
  for (const e of entries) {
    collectSymbols(e.formula, referenced);
    collectSymbols(e.assumptions, referenced);
  }
  for (const name of Object.keys(declarations.declarations).sort()) {
    if (!referenced.has(name)) continue;
    try {
      ce.declare(name, setify(declarations.declarations[name].signature));
    } catch {
      /* already defined (built-in) — never widen */
    }
  }
  return ce;
}

export function compileEntries(
  entries: ReadonlyArray<Entry>,
  declarations: Declarations,
  overrides: CurationOverrides = {}
): CompileResult {
  const ce = createScratchEngine(entries, declarations);

  const rules: CompiledFungrimRule[] = [];
  const skips: SkipRecord[] = [];
  const sampleKinds: Record<string, 'symbolic' | 'numeric'> = {};
  const seenUndirected = new Map<string, string>();
  const transformAllowlist = new Set(overrides.transformAllowlist ?? []);

  const skip = (e: Entry, reason: SkipReason, detail?: string): void => {
    skips.push(detail === undefined ? { id: e.id, reason } : { id: e.id, reason, detail });
  };

  for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    const override = overrides.overrides?.[e.id];

    // 0. Curated exclusion
    if (override?.exclude === true) {
      skip(e, 'curated-exclude', override.note);
      continue;
    }

    // 1. Must be an equality with at least two operands. Chained equalities
    //    `Equal(a, b, c)` compile as first = last (sound by transitivity;
    //    the most-reduced closed form is the final element).
    const formula = e.formula as MathJSON[];
    if (!Array.isArray(formula) || formula[0] !== 'Equal' || formula.length < 3) {
      skip(e, 'not-equation', Array.isArray(formula) ? String(formula[0]) : undefined);
      continue;
    }
    const lhs = formula[1];
    const rhs = formula[formula.length - 1];

    // 2. Q3: specific values must be Head(args) = closed form; the 95
    //    symbol/Set/Apply-LHS entries are excluded (no recognition rules).
    if (e.class === 'specific-value') {
      const head = Array.isArray(lhs) ? lhs[0] : undefined;
      if (!Array.isArray(lhs) || head === 'Set' || head === 'Apply') {
        skip(e, 'lhs-not-value-form', Array.isArray(lhs) ? String(head) : 'symbol');
        continue;
      }
    }

    // 3. Static compat-signature check (2-arg LambertW/Digamma)
    if (usesWidenedCompatSignature(formula)) {
      skip(e, 'compat-signature', '2-arg LambertW/Digamma');
      continue;
    }

    // 4. Compile assumptions to guards (fail-closed)
    const compiled = compileGuards(e.assumptions, e.variables);
    if ('error' in compiled) {
      skip(e, 'guard-uncompilable', compiled.error);
      continue;
    }
    const guards = compiled.guards;

    // 5. Wildcardize + orient
    const lhsW = wildcardize(lhs, e.variables);
    const rhsW = wildcardize(rhs, e.variables);
    const oriented = orientEntry(ce, e, { lhs, rhs }, lhsW, rhsW, override?.direction);
    if ('error' in oriented) {
      skip(e, oriented.error, oriented.detail);
      continue;
    }

    // 6. Canonicalize the match pattern. The artifact stores the match in
    //    canonical shape so that the raw-boxed pattern (boxRule never
    //    canonicalizes match patterns) aligns structurally with canonical
    //    expressions at runtime. Canonicalization that loses wildcards is
    //    rejected (mirrors applyRule's canonicalMatchLosesWildcards skip).
    let matchJson: MathJSON;
    ce.pushScope();
    try {
      // Declare the wildcards with their guard-implied types so that strict
      // validation of typed slots (Fibonacci(_n), Totient(_n), …) passes.
      const seedTypes = variableSeedTypes(e, guards);
      for (const v of e.variables) {
        try {
          ce.declare('_' + v, seedTypes[v]);
        } catch {
          /* tolerate */
        }
      }
      const mc = ce.box(oriented.match as never);
      if (!mc.isValid) {
        skip(e, 'box-error', `invalid canonical match: ${mc.toString()}`.slice(0, 160));
        continue;
      }
      matchJson = mc.json;
    } catch (err) {
      skip(
        e,
        'box-error',
        String((err as Error)?.message)
          .replace(/\s+/g, ' ')
          .slice(0, 160)
      );
      continue;
    } finally {
      ce.popScope();
    }
    if (!isSubset(collectWildcards(oriented.match), collectWildcards(matchJson))) {
      skip(e, 'wildcard-loss');
      continue;
    }

    // 7. Dedup undirected duplicates
    const key = undirectedKey(ce, lhsW, rhsW);
    const prior = seenUndirected.get(key);
    if (prior !== undefined) {
      skip(e, 'duplicate-undirected', `same equality as ${prior}`);
      continue;
    }

    // 8. Self-test in the scratch engine
    const tested = selfTest(ce, e, matchJson, oriented.replace, guards);
    if (!tested.ok) {
      // A failure on an entry that leans on a COMPAT head (complex Binomial,
      // complex Fibonacci, …) is a compat-signature loss, not a generic one.
      if (referencesCompatHead(formula))
        skip(e, 'compat-signature', `${tested.reason}: ${tested.detail ?? ''}`);
      else skip(e, tested.reason, tested.detail);
      continue;
    }

    seenUndirected.set(key, e.id);

    // 9. Merge curation overrides (purpose/target), then emit
    let purpose = oriented.purpose;
    if (transformAllowlist.has(e.id)) purpose = 'transform';
    if (override?.purpose !== undefined) purpose = override.purpose;
    const target: RuleTarget = override?.target ?? 'simplify';

    const shellRefs = new Set<string>();
    collectSymbols(matchJson, shellRefs);
    collectSymbols(oriented.replace, shellRefs);
    for (const g of guards)
      collectSymbols(g.k === 'cmp' ? g.bound : g.k === 'ne' ? [g.lhs, g.rhs] : g.k === 'eval' ? g.pred : null, shellRefs);
    const shellHeads = [...shellRefs].filter((s) => s in declarations.declarations);

    const id = 'fungrim:' + e.id;
    sampleKinds[id] = tested.sampleKind;
    rules.push({
      id,
      match: matchJson,
      replace: oriented.replace,
      guards,
      purpose,
      target,
      class: e.class as RuleClass,
      heads: [...new Set([...e.heads, ...shellHeads])].sort(),
      topics: [...e.topics].sort(),
    });
  }

  rules.sort((a, b) => a.id.localeCompare(b.id));
  skips.sort((a, b) => a.id.localeCompare(b.id));

  // Pruned shell-declaration table: heads referenced by emitted rules
  const pruned: CompileResult['declarations'] = {};
  const usedShells = new Set<string>();
  for (const r of rules) {
    collectSymbols(r.match, usedShells);
    collectSymbols(r.replace, usedShells);
    for (const g of r.guards)
      collectSymbols(
        g.k === 'cmp' ? g.bound : g.k === 'ne' ? [g.lhs, g.rhs] : g.k === 'eval' ? g.pred : null,
        usedShells
      );
  }
  for (const name of Object.keys(declarations.declarations).sort()) {
    if (!usedShells.has(name)) continue;
    const rec = declarations.declarations[name];
    pruned[name] = {
      signature: setify(rec.signature),
      ...(rec.description !== undefined ? { description: rec.description } : {}),
      ...(rec.arity !== undefined && rec.arity !== null ? { arity: rec.arity } : {}),
    };
  }

  return { rules, skips, declarations: pruned, sampleKinds };
}

// ---------------------------------------------------------------------------
// Deterministic emit
// ---------------------------------------------------------------------------

function countBy<T>(xs: ReadonlyArray<T>, key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function emitArtifact(
  manifest: unknown,
  declarations: CompileResult['declarations'],
  rules: ReadonlyArray<CompiledFungrimRule>
): string {
  const lines: string[] = ['{'];
  lines.push(`"manifest": ${JSON.stringify(manifest, undefined, 2)},`);
  lines.push('"declarations": {');
  const declLines = Object.entries(declarations).map(
    ([name, rec]) => `${JSON.stringify(name)}: ${JSON.stringify(rec)}`
  );
  lines.push(declLines.join(',\n'));
  lines.push('},');
  lines.push('"rules": [');
  lines.push(rules.map((r) => JSON.stringify(r)).join(',\n'));
  lines.push(']');
  lines.push('}');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // argv[1] is this script (guaranteed by the guard below)
  const scriptDir = path.dirname(path.resolve(process.argv[1]));
  const rootDir = path.resolve(scriptDir, '../..');
  const corpusDir = path.join(rootDir, 'data/fungrim');
  const overridesPath = path.join(scriptDir, 'curation-overrides.json');
  const artifactPath = path.join(
    rootDir,
    'src/compute-engine/fungrim/fungrim-core-data.json'
  );
  const reportPath = path.join(scriptDir, 'rule-compile-report.json');

  const corpus = loadCorpus(corpusDir);
  const slice = corpus.entries.filter(isSliceEntry);
  const overrides: CurationOverrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : {};

  const started = Date.now();
  const result = compileEntries(slice, corpus.declarations, overrides);
  const elapsed = Date.now() - started;

  const upstream = JSON.parse(
    fs.readFileSync(path.join(corpusDir, 'MANIFEST.json'), 'utf8')
  );

  const ledger = countBy(result.skips, (s) => s.reason);
  const byPurpose = countBy(result.rules, (r) => r.purpose);
  const byClass = countBy(result.rules, (r) => r.class);
  const byTarget = countBy(result.rules, (r) => r.target);
  const headBuckets = countBy(result.rules, (r) =>
    Array.isArray(r.match) ? String((r.match as MathJSON[])[0]) : 'symbol'
  );

  const manifest = {
    schemaVersion: 1,
    generator: 'scripts/fungrim/compile-rules.ts',
    upstream: {
      name: 'fungrim',
      snapshotSha256: upstream?.upstream?.pin?.sha256 ?? null,
      translator: upstream?.generator ?? null,
    },
    slice: {
      classes: ['specific-value', 'identity'],
      guardLevels: ['none', 'real-simple'],
      entries: slice.length,
    },
    counts: {
      rules: result.rules.length,
      byPurpose,
      byClass,
      byTarget,
    },
    ledger,
  };

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(
    artifactPath,
    emitArtifact(manifest, result.declarations, result.rules)
  );

  const report = {
    generator: 'scripts/fungrim/compile-rules.ts',
    sliceEntries: slice.length,
    emitted: result.rules.length,
    ledger,
    byPurpose,
    byClass,
    byTarget,
    sampleKinds: countBy(Object.values(result.sampleKinds), (k) => k),
    headBuckets: Object.fromEntries(
      Object.entries(headBuckets).sort(([, a], [, b]) => b - a)
    ),
    declaredShells: Object.keys(result.declarations).length,
    solveSeeds: Object.keys(overrides.solveSeeds ?? {}).sort(),
    skips: result.skips,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, undefined, 2) + '\n');

  // -- console summary
  console.log(`Fungrim Phase-1 rule compiler (${elapsed} ms)`);
  console.log(`  slice entries:   ${slice.length}`);
  console.log(`  rules emitted:   ${result.rules.length}`);
  console.log(`  shells declared: ${Object.keys(result.declarations).length}`);
  console.log('  purpose split:  ', byPurpose);
  console.log('  class split:    ', byClass);
  console.log('  self-test seeds:', report.sampleKinds);
  console.log('  skip ledger:');
  for (const [reason, n] of Object.entries(ledger))
    console.log(`    ${reason.padEnd(22)} ${n}`);
  const accounted =
    result.rules.length + result.skips.length;
  console.log(
    `  accounted: ${accounted}/${slice.length} ${accounted === slice.length ? 'OK' : 'MISMATCH'}`
  );
  console.log(`  artifact: ${path.relative(rootDir, artifactPath)}`);
  console.log(`  report:   ${path.relative(rootDir, reportPath)}`);
}

// Run only as a script (not when imported by the tests — no `import.meta`
// here: the jest transform compiles this module to CJS)
if (
  process.argv[1] !== undefined &&
  /compile-rules\.(ts|js|mjs|cjs)$/.test(process.argv[1])
) {
  main();
}
