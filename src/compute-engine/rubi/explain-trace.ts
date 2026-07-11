// Replay of a recorded Rubi integration trace into a curated, whole-state
// step chain for `expr.explain('Integrate')`. The driver records each step as
// `{ node, replacement, because }` (see `IntStepRecord` in driver.ts): `node`
// is the inert `Integrate(g, x)` placeholder the step replaces, `replacement`
// is what takes its place (a template with further inert placeholders, or a
// final sub-result). Threading them in order, replacing the first matching
// placeholder each time, rebuilds the evolving antiderivative — the textbook
// presentation — as a sequence of whole-expression states.

import type {
  IComputeEngine as ComputeEngine,
  RuleSteps,
} from '../global-types.js';
import type { Expr as Expression } from './types.js';

// Structural shape of a driver step record. Declared inline (not imported from
// driver.ts) to avoid a module cycle — driver.ts imports `replayIntRecords`
// from here at runtime; a back-import (even type-only) would close the loop.
type IntStepRecord = {
  node: Expression;
  replacement: Expression | null;
  because: string;
};

/**
 * Replay `records` into whole-state steps. `activate` re-activates inert trig
 * heads (and tidies the form) for display; it is applied to each state as it
 * is emitted and must NOT mutate the ongoing `state` tree, which keeps its
 * inert `Integrate` placeholders so later records can still match them.
 *
 * Records whose placeholder is not found in the current state are skipped
 * (graceful degradation — the chain stays sound, just less detailed).
 */
export function replayIntRecords(
  ce: ComputeEngine,
  records: readonly IntStepRecord[],
  activate: (e: Expression) => Expression
): RuleSteps {
  const steps: RuleSteps = [];
  if (records.length === 0) return steps;

  // Seed with the top-level placeholder; the first record replaces it.
  let state: Expression = records[0].node;
  for (const rec of records) {
    if (rec.replacement === null) continue;
    const next = replaceFirst(ce, state, rec.node, rec.replacement);
    if (next === null) continue; // placeholder gone — degrade gracefully
    state = next;
    steps.push({ value: activate(state), because: rec.because });
  }
  return steps;
}

/** Replace the first (pre-order) subexpression of `e` structurally equal to
 * `needle` with `replacement`; `null` when `needle` does not occur. Rebuilds
 * ancestors with `_fn` (no canonicalization) so the surviving inert `Integrate`
 * placeholders keep their raw shape for subsequent matches. */
function replaceFirst(
  ce: ComputeEngine,
  e: Expression,
  needle: Expression,
  replacement: Expression
): Expression | null {
  if (e.isSame(needle)) return replacement;
  const ops = e.ops;
  if (!ops) return null;
  const newOps = [...ops];
  for (let i = 0; i < newOps.length; i++) {
    const r = replaceFirst(ce, newOps[i], needle, replacement);
    if (r !== null) {
      newOps[i] = r;
      return ce._fn(e.operator, newOps);
    }
  }
  return null;
}
