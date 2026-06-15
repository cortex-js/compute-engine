// Backtracking pattern matcher for compiled Rubi rules, operating directly
// on canonical BoxedExpressions (docs/rubi/RUBI.md §4A).
//
// Pattern IR (produced by compile.ts from skeleton-boxed rule LHSs):
//   var     — the integration variable (driver-supplied, pre-bound)
//   slot    — a pattern variable (`a_`), binds any subexpression,
//             consistent across multiple occurrences
//   optslot — an optional-default pattern variable (`b_.`): matches like a
//             slot, or binds its operator-derived default (0 in Add,
//             1 in Multiply/Power-exponent) without consuming anything
//   const   — a literal subexpression, compared with isSame()
//   node    — an operator node; Add/Multiply match orderless ("AC") with
//             flat absorption (the last slot may absorb the remaining
//             operands as a new Add/Multiply)
//
// Optionals also drive node *collapse*: a node whose operands are all
// optional except one may match a non-node expression by defaulting the
// optionals — this is how `(a_.+b_.*x_)^m_.` matches bare `x`.

import type { Expr as Expression } from './types';
import { checkDeadline } from '../../common/interruptible';

// Deadline plumbing. The backtracking AC matcher (mAC) can blow up
// combinatorially on products with many factors — this is the dominant
// source of RubiDriver.int overrunning its timeLimitMs (the dispatch loop
// only checks the deadline between rules, not inside a single rule's match).
// matchAll publishes an absolute deadline (ms) here; every match step
// strided-checks it and throws CancellationError when exceeded, which the
// driver's int() catches → the problem becomes a bounded `unsolved`.
// Module-level state is safe: the matcher is single-threaded and each
// matchAll call runs to completion (or throws) before the next, and the
// previous value is restored in a finally.
let _matchDeadline: number | undefined = undefined;
let _matchTick = 0;
function tickDeadline(): void {
  // amortize Date.now() over 1024 steps (same stride as the engine loops)
  if ((++_matchTick & 0x3ff) === 0) checkDeadline(_matchDeadline);
}

export type Pat =
  | { kind: 'var' }
  | { kind: 'slot'; name: string }
  | { kind: 'optslot'; name: string; default: Expression }
  | { kind: 'const'; value: Expression }
  | { kind: 'node'; op: string; ops: Pat[]; ac: boolean };

export type Env = Map<string, Expression>;

/**
 * Match `expr` against `pat`. Returns a binding environment or null.
 * `x` is the integration variable (matches `var` patterns exactly).
 */
export function matchPattern(
  pat: Pat,
  expr: Expression,
  x: Expression
): Env | null {
  const env: Env = new Map();
  return m(pat, expr, x, env, () => true) ? env : null;
}

/**
 * Enumerate ALL binding environments (up to `cap`). Rule conditions
 * participate in matching à la Mathematica: when a condition rejects one
 * assignment, the next assignment must be tried — e.g.
 * `(a+bx)^m (c+dx)^n` factor roles are interchangeable and conditions
 * often hold for only one orientation.
 */
export function matchAll(
  pat: Pat,
  expr: Expression,
  x: Expression,
  cap = 8,
  deadline?: number
): Env[] {
  const envs: Env[] = [];
  const env: Env = new Map();
  const saved = _matchDeadline;
  _matchDeadline = deadline;
  try {
    m(pat, expr, x, env, () => {
      envs.push(new Map(env));
      return envs.length >= cap; // false ⇒ keep backtracking for more
    });
  } finally {
    _matchDeadline = saved;
  }
  return envs;
}

function bindIn(
  env: Env,
  name: string,
  value: Expression,
  k: () => boolean
): boolean {
  const bound = env.get(name);
  if (bound !== undefined) return bound.isSame(value) && k();
  env.set(name, value);
  if (k()) return true;
  env.delete(name);
  return false;
}

function m(
  pat: Pat,
  expr: Expression,
  x: Expression,
  env: Env,
  k: () => boolean
): boolean {
  tickDeadline(); // every backtracking step funnels through here
  switch (pat.kind) {
    case 'var':
      return expr.isSame(x) && k();
    case 'const':
      return pat.value.isSame(expr) && k();
    case 'slot':
    case 'optslot':
      return bindIn(env, pat.name, expr, k);
    case 'node': {
      if (expr.operator === pat.op && expr.ops) {
        if (pat.ac) {
          if (mAC(pat, expr, x, env, k)) return true;
        } else if (expr.ops.length === pat.ops.length) {
          if (mSeq(pat.ops, expr.ops, x, env, k)) return true;
        }
      }
      // Collapse: default away the optional operands and match the single
      // remaining operand against the whole expression.
      return mCollapse(pat, expr, x, env, k);
    }
  }
}

// Power(base, m_.) vs a non-Power expression matches base with m → 1;
// Add/Multiply nodes with exactly one non-optional operand match a
// non-matching expression by defaulting the optionals.
function mCollapse(
  pat: { op: string; ops: Pat[]; ac: boolean },
  expr: Expression,
  x: Expression,
  env: Env,
  k: () => boolean
): boolean {
  const optionals = pat.ops.filter((p) => p.kind === 'optslot');
  const others = pat.ops.filter((p) => p.kind !== 'optslot');
  // collapsing is only justified when at least one optional defaults away;
  // a node with no optionals must match its operator structurally
  if (
    optionals.length === 0 ||
    others.length !== 1 ||
    optionals.length !== pat.ops.length - 1
  )
    return false;

  const defaults = (i: number, kk: () => boolean): boolean => {
    if (i === optionals.length) return kk();
    const o = optionals[i] as { name: string; default: Expression };
    return bindIn(env, o.name, o.default, () => defaults(i + 1, kk));
  };
  return defaults(0, () => m(others[0], expr, x, env, k));
}

function mSeq(
  pats: Pat[],
  exprs: ReadonlyArray<Expression>,
  x: Expression,
  env: Env,
  k: () => boolean
): boolean {
  if (pats.length === 0) return k();
  return m(pats[0], exprs[0], x, env, () =>
    mSeq(pats.slice(1), exprs.slice(1), x, env, k)
  );
}

// Orderless + flat matching for Add/Multiply.
//
// Pattern operands are ordered deterministic-first (var, const, node,
// slots last) and assigned to expression operands by backtracking.
// Optional slots may bind their default instead of consuming an operand.
// The FINAL pattern operand, when it is a slot, absorbs all remaining
// expression operands ("u_. absorbs the rest of the product").
function mAC(
  pat: { op: string; ops: Pat[] },
  expr: Expression,
  x: Expression,
  env: Env,
  k: () => boolean
): boolean {
  const exprOps = expr.ops!;
  const rank = (p: Pat): number =>
    p.kind === 'var'
      ? 0
      : p.kind === 'const'
        ? 1
        : p.kind === 'node'
          ? 2
          : p.kind === 'slot'
            ? 3
            : 4;
  const ordered = [...pat.ops].sort((a, b) => rank(a) - rank(b));

  const used = new Array<boolean>(exprOps.length).fill(false);
  const ce = expr.engine;

  const assign = (i: number): boolean => {
    if (i === ordered.length) return used.every(Boolean) && k();
    const p = ordered[i];
    const isLast = i === ordered.length - 1;

    // Final slot absorbs the rest (flat matching)
    if (isLast && (p.kind === 'slot' || p.kind === 'optslot')) {
      const rest = exprOps.filter((_, j) => !used[j]);
      if (rest.length === 0)
        return p.kind === 'optslot'
          ? bindIn(env, p.name, p.default, k)
          : false;
      const value =
        rest.length === 1 ? rest[0] : ce.function(pat.op, [...rest]);
      if (bindIn(env, p.name, value, k)) return true;
      // an optional absorber may also default out, leaving the rest
      // for nobody — only valid if no operands remain, handled above
      return false;
    }

    for (let j = 0; j < exprOps.length; j++) {
      if (used[j]) continue;
      used[j] = true;
      if (m(p, exprOps[j], x, env, () => assign(i + 1))) return true;
      used[j] = false;
    }
    // optional slot: bind default without consuming an operand
    if (p.kind === 'optslot')
      return bindIn(env, p.name, p.default, () => assign(i + 1));
    return false;
  };

  return assign(0);
}

/** Names of all slots in a pattern (for compile-time sanity checks). */
export function slotNames(pat: Pat, out = new Set<string>()): Set<string> {
  if (pat.kind === 'slot' || pat.kind === 'optslot') out.add(pat.name);
  else if (pat.kind === 'node') for (const p of pat.ops) slotNames(p, out);
  return out;
}
