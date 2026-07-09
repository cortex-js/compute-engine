// Rubi rule compiler — turns corpus rules (data/rubi) into match-ready
// CompiledRules (docs/rubi/RUBI.md §4A).
//
// **Skeleton boxing**: each rule LHS is boxed canonically with unique
// placeholder symbols standing in for the pattern variables (`RUBIPAT_a`
// for `a_`, `RUBIOPT_b` for `b_.`), then converted to the matcher IR.
// This bakes the engine's canonicalization (Divide→Power(-1) normal
// forms, Sqrt/Root forms, operand ordering) into the pattern, so patterns
// and runtime integrands live in the same normal form — the Fungrim
// "store patterns in canonical form" lesson.
//
// Optional-default patterns are NOT expanded into variants: the matcher
// handles them natively (optslot binds its default without consuming an
// operand; nodes collapse when all-but-one operand is optional). The
// default value (0 in Add, 1 in Multiply / as Power exponent) is derived
// from the placeholder's parent in the *canonical* skeleton.

import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import type {
  Expr as Expression,
  Json,
  RubiRule,
  RubiRuleDoc,
} from './types.js';

import { Pat, slotNames } from './match.js';
import { toTimesPower } from './normal-form.js';

export type CompiledRule = {
  id: string;
  priority: number;
  variable: string;
  pat: Pat;
  /** root operator the pattern requires, or null when it can match any
   * expression (root slot, or a collapsible node) — dispatch pre-screen */
  rootOp: string | null;
  /** Operator heads that MUST appear somewhere in ANY expression this
   * pattern can match — the second-level ("integrand-skeleton") dispatch
   * screen. Computed conservatively from the matcher's guarantees (see
   * `requiredHeads`): a rule is skipped for an integrand only when one of
   * these heads is provably absent from the integrand tree, so no rule that
   * could match is ever excluded. Empty ⇒ the rule is a candidate for every
   * integrand (root slot / fully-collapsible pattern). */
  requiredHeads: string[];
  bindings: RubiRule['bindings'];
  condition: Json | null;
  innerCondition: Json | null;
  rhs: Json;
  source: string;
};

export type CompileResult = {
  rules: CompiledRule[];
  skipped: { id: string; reason: string }[];
};

const SLOT = 'RUBIPAT_';
const OPT = 'RUBIOPT_';
const VAR = 'RUBIPATVARX';

function isCall(x: Json, op: string): x is Json[] {
  return Array.isArray(x) && x[0] === op;
}

/** Replace Blank/BlankOptional atoms with placeholder symbols. */
function skeletonize(expr: Json, variable: string): Json {
  if (isCall(expr, 'Blank') || isCall(expr, 'BlankOptional')) {
    const name = expr[1] as string;
    if (name === variable) return VAR;
    return (expr[0] === 'BlankOptional' ? OPT : SLOT) + name;
  }
  if (Array.isArray(expr))
    return expr.map((a, i) => (i === 0 ? a : skeletonize(a, variable))) as Json;
  return expr;
}

/**
 * Convert a canonically boxed skeleton to matcher IR. `parentOp` /
 * `argIndex` give the canonical context that determines optional defaults.
 */
function toPat(
  ce: ComputeEngine,
  expr: Expression,
  parentOp: string | null,
  _argIndex: number
): Pat {
  if (expr.symbol) {
    if (expr.symbol === VAR) return { kind: 'var' };
    if (expr.symbol.startsWith(SLOT))
      return { kind: 'slot', name: expr.symbol.slice(SLOT.length) };
    if (expr.symbol.startsWith(OPT)) {
      const dflt = parentOp === 'Add' ? ce.Zero : ce.One;
      return {
        kind: 'optslot',
        name: expr.symbol.slice(OPT.length),
        default: dflt,
      };
    }
    return { kind: 'const', value: expr };
  }
  if (!expr.ops || expr.ops.length === 0 || !hasPlaceholder(expr))
    return { kind: 'const', value: expr };
  return {
    kind: 'node',
    op: expr.operator,
    ops: expr.ops.map((op, i) => toPat(ce, op, expr.operator, i)),
    ac: expr.operator === 'Add' || expr.operator === 'Multiply',
  };
}

/**
 * The operator heads guaranteed to appear in the matched expression's tree
 * for EVERY successful match of `pat` — the conservative feature set backing
 * the second-level dispatch screen (`CompiledRule.requiredHeads`).
 *
 * Soundness rests entirely on the Rubi matcher's guarantees (`match.ts`),
 * which — unlike CE's general matcher — performs NO cross-head synthetic
 * rebuilds. The only structural flexibility is node *collapse* (a node whose
 * operands are all optional-default except one may match a non-node
 * expression by defaulting the optionals) and AC reordering (same operator).
 * Therefore:
 *
 *   - `slot` / `optslot` / `var` / `const` — bind arbitrary subexpressions;
 *     guarantee no head (a `const` DOES fix its subtree, but requiring its
 *     heads would only tighten the screen — we conservatively require none).
 *   - a NON-collapsible `node` with operator O — the matcher requires
 *     `expr.operator === O` on the only matching branch (`mCollapse` returns
 *     false for it), so O is guaranteed; each operand pattern is assigned to
 *     a distinct operand of `expr` (AC) or matched positionally (sequential),
 *     so every operand's guaranteed heads also appear (as a subtree). An
 *     `optslot` operand may default away — it contributes nothing regardless.
 *   - a COLLAPSIBLE `node` (≥1 optslot, exactly one non-optslot operand) —
 *     may match either structurally (op present) OR by collapsing to match
 *     its single non-optslot operand pattern against the whole expression.
 *     The node's own operator is therefore NOT guaranteed, but the surviving
 *     operand's guaranteed heads appear on BOTH branches, so they carry over.
 *
 * The result is a NECESSARY condition on any matching integrand; ANDing it
 * with the existing root-operator screen keeps both conservative.
 */
export function requiredHeads(pat: Pat): string[] {
  const out = new Set<string>();
  collectRequiredHeads(pat, out);
  return [...out];
}

function collectRequiredHeads(pat: Pat, out: Set<string>): void {
  if (pat.kind !== 'node') return;
  const nonOpt = pat.ops.filter((p) => p.kind !== 'optslot');
  const optionals = pat.ops.length - nonOpt.length;
  const collapsible = optionals >= 1 && nonOpt.length === 1;
  if (collapsible) {
    // Only the surviving (non-optional) operand's guarantees carry over; the
    // node's own operator can be defaulted away.
    collectRequiredHeads(nonOpt[0], out);
    return;
  }
  out.add(pat.op);
  for (const p of pat.ops) collectRequiredHeads(p, out);
}

function hasPlaceholder(expr: Expression): boolean {
  if (expr.symbol)
    return (
      expr.symbol === VAR ||
      expr.symbol.startsWith(SLOT) ||
      expr.symbol.startsWith(OPT)
    );
  if (!expr.ops) return false;
  return expr.ops.some(hasPlaceholder);
}

/** Pattern-variable names appearing in a rule LHS (excluding the variable). */
function lhsNames(
  lhs: Json,
  variable: string,
  out = new Set<string>()
): Set<string> {
  if (
    (isCall(lhs, 'Blank') || isCall(lhs, 'BlankOptional')) &&
    typeof lhs[1] === 'string'
  ) {
    if (lhs[1] !== variable) out.add(lhs[1]);
  } else if (Array.isArray(lhs))
    for (const a of lhs.slice(1)) lhsNames(a, variable, out);
  return out;
}

export function compileRule(
  ce: ComputeEngine,
  rule: RubiRule,
  id: string,
  priority: number
): { rule: CompiledRule | null; reason?: string } {
  const skeleton = skeletonize(rule.lhs, rule.variable);
  let boxed: Expression;
  try {
    boxed = ce.expr(skeleton as any);
  } catch (e) {
    return { rule: null, reason: `box error: ${e}` };
  }
  if (!boxed.isValid)
    return { rule: null, reason: 'boxes to invalid expression' };

  const pat = toPat(ce, toTimesPower(ce, boxed), null, 1);
  const expected = lhsNames(rule.lhs, rule.variable);
  const got = slotNames(pat);
  const missing = [...expected].filter((n) => !got.has(n));
  if (missing.length > 0)
    return {
      rule: null,
      reason: `slots folded away by canonicalization: ${missing.join(',')}`,
    };

  // dispatch pre-screen: a node pattern matches only its own root
  // operator — unless it can collapse (all operands but one optional)
  let rootOp: string | null = null;
  if (pat.kind === 'node') {
    const optionals = pat.ops.filter((p) => p.kind === 'optslot').length;
    const collapsible = optionals >= 1 && pat.ops.length - optionals === 1;
    if (!collapsible) rootOp = pat.op;
  }

  return {
    rule: {
      id,
      priority,
      variable: rule.variable,
      pat,
      rootOp,
      requiredHeads: requiredHeads(pat),
      bindings: rule.bindings,
      condition: rule.condition,
      innerCondition: rule.innerCondition,
      rhs: rule.rhs,
      source: rule.source ?? '', // stripped from the shipped bundle
    },
  };
}

/** Compile an ordered list of corpus rule-docs into match-ready rules,
 * preserving document/rule order as the dispatch priority. This is the
 * shippable, fs-free core consumed by both the bundled `loadIntegrationRules`
 * loader and the Node `compileSection` fs wrapper (`scripts/rubi/compile.ts`). */
export function compileRuleDocs(
  ce: ComputeEngine,
  docs: RubiRuleDoc[]
): CompileResult {
  const rules: CompiledRule[] = [];
  const skipped: CompileResult['skipped'] = [];
  let priority = 0;
  for (const doc of docs) {
    for (const r of doc.rules) {
      const id = `${doc.file}#${r.index}`;
      const { rule, reason } = compileRule(ce, r, id, priority++);
      if (rule) rules.push(rule);
      else skipped.push({ id, reason: reason! });
    }
  }
  return { rules, skipped };
}
