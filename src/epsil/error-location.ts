import type { MathJsonExpression } from '../math-json/types.js';
import {
  machineValue,
  operand,
  operands,
  operator,
  stringValue,
} from '../math-json/utils.js';

/**
 * A call an error can be attributed to: the operator being applied and the
 * 1-based index of the argument at fault.
 *
 * The two tiers obtain one differently — at run time it is read from the
 * error's `ErrorTrace` breadcrumb ({@link traceFrames}); at canonicalization
 * time there is no breadcrumb yet, so it comes from where the error node sits
 * in the canonical tree ({@link enclosingFrame}) — but it means the same
 * thing, so everything downstream is shared.
 */
export type ErrorFrameRef = { name: string; index: number };

/**
 * The frames of an error's `ErrorTrace` breadcrumb (engine design §2a),
 * innermost first: `["ErrorTrace", ["ErrorFrame", "'Ln'", 1], ["ErrorFrame",
 * "'Add'", 2]]`. The breadcrumb is the LAST operand of the `["Error", …]`
 * value and is identified by its head, never by position.
 *
 * `ErrorBroadcast` entries are skipped: they locate an ELEMENT of a broadcast,
 * not a call in the source.
 */
export function traceFrames(error: MathJsonExpression): ErrorFrameRef[] {
  const ops = [...operands(error)];
  const trace = ops[ops.length - 1];
  if (trace === undefined || operator(trace) !== 'ErrorTrace') return [];

  const frames: ErrorFrameRef[] = [];
  for (const frame of operands(trace)) {
    if (operator(frame) !== 'ErrorFrame') continue;
    const name = stringValue(operand(frame, 1));
    const index = machineValue(operand(frame, 2));
    if (name === null || index === null) continue;
    frames.push({ name, index });
  }
  return frames;
}

/**
 * The call an error node sits inside — `(operator, 1-based operand index)` of
 * its parent — found by identity in the tree the error was collected from.
 *
 * This is the breadcrumb's stand-in for a **canonicalization-time** error,
 * which has none: the `ErrorTrace` frames are recorded as an error BUBBLES
 * during evaluation, so an error still embedded in the canonical tree —
 * `["Ln", ["Error", "'missing'"]]` — carries only its position. That position
 * says the same thing for an argument-validation error, because such an error
 * is minted while checking the arguments of the node it is embedded in.
 *
 * `undefined` when the node is not found, or is the root (no enclosing call).
 */
export function enclosingFrame(
  root: MathJsonExpression,
  error: MathJsonExpression
): ErrorFrameRef | undefined {
  const head = operator(root);
  if (head === '') return undefined;
  let index = 0;
  for (const op of operands(root)) {
    index += 1;
    if (op === error) return { name: head, index };
    const nested = enclosingFrame(op, error);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * Narrow an error's source anchor from the whole statement down to the
 * innermost frame that still maps onto the parsed source — the difference
 * between underlining all of `s |> Map(_, _ |-> Length(Characters(s)))` and
 * underlining the `s` inside `Characters(s)`, or between underlining a
 * 40-line function definition and underlining the one extra argument inside
 * it.
 *
 * The frames were recorded against a tree that is structurally different from
 * the raw AST (canonicalization applies pipe sugar, inserts `Block` wrappers,
 * rewrites operators), so they cannot be walked positionally. Instead they are
 * matched by operator NAME: innermost first, the first frame whose operator
 * occurs exactly ONCE in the statement subtree wins, and the frame's operand
 * (or, when that operand carries no offsets, the matched call) supplies the
 * range. An ambiguous name (two `Characters` calls) or a vanished one (a
 * canonicalization-minted wrapper) falls through to the next outer frame; the
 * fallback is the statement range.
 */
export function locateError(
  frames: readonly ErrorFrameRef[],
  stmt: MathJsonExpression,
  fallback: [number, number]
): { range: [number, number]; call?: MathJsonExpression } {
  for (const { name, index } of frames) {
    const matches: MathJsonExpression[] = [];
    findByOperator(stmt, name, matches);
    if (matches.length !== 1) continue;

    const arg = [...operands(matches[0])][index - 1] ?? null;
    const range = nodeOffsets(arg) ?? nodeOffsets(matches[0]);
    // The matched CALL travels with the range: a caller quoting the error's
    // surroundings wants `IndexOf(digits, cs[i], 23)`, not the one argument
    // the range underlines and not the whole enclosing statement.
    if (range !== undefined) return { range, call: matches[0] };
  }
  return { range: fallback };
}

/** {@link locateError}'s range alone, for a caller that only needs to point. */
export function narrowToFrames(
  frames: readonly ErrorFrameRef[],
  stmt: MathJsonExpression,
  fallback: [number, number]
): [number, number] {
  return locateError(frames, stmt, fallback).range;
}

/** Collect every node of `expr` whose operator is `name` (early-exits once
 * ambiguous — two matches decide {@link narrowToFrames} as surely as ten). */
function findByOperator(
  expr: MathJsonExpression | null,
  name: string,
  matches: MathJsonExpression[]
): void {
  if (expr === null || matches.length > 1) return;
  if (operator(expr) === '') return;
  if (operator(expr) === name) matches.push(expr);
  for (const op of operands(expr)) findByOperator(op, name, matches);
}

/** The `sourceOffsets` of a raw AST node, when it carries them. */
function nodeOffsets(
  node: MathJsonExpression | null
): [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}
