import type { MathJsonExpression } from '../math-json/types.js';
import {
  machineValue,
  operand,
  operands,
  operator,
  stringValue,
  symbol,
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
 * between underlining all of `s |> Map(_ => Length(Characters(s)), _)` and
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
 * range. A vanished name (a canonicalization-minted wrapper) falls through to
 * the next outer frame; the fallback is the statement range.
 *
 * An ambiguous name (two `If` calls in `if a { 0 } else if b { g("x") } else
 * { 1 }`, whose frames are `If argument 2, If argument 3`) is first resolved
 * by walking the frames from the outermost one down from the statement node
 * ({@link walkToFrame}): each frame selects its call inside the argument that
 * the next outer frame selected. Only when that walk cannot decide does the
 * frame fall through to the next outer frame.
 */
export function locateError(
  frames: readonly ErrorFrameRef[],
  stmt: MathJsonExpression,
  fallback: [number, number],
  /** The declared slot names of a callee, for anchoring inside a NAMED call
   * (`calleeSlotNames`, boxed-expression/named-arguments.ts, partially
   * applied to the engine). A frame's argument index counts DECLARATION
   * slots — the seam permutes a named call into declaration order before
   * anything downstream runs — while the raw call node here still lists the
   * arguments AS WRITTEN, wrapped in `NamedArgument` carriers. Without the
   * names the two orders cannot be reconciled, so the anchor stays on the
   * whole call rather than guessing an argument. `undefined` (or a resolver
   * answering `undefined`) only affects calls that contain a carrier;
   * all-positional calls index directly, as they always did. */
  slotNamesFor?: (
    operatorName: string
  ) => readonly (string | undefined)[] | undefined,
  /** Which order the frames' argument indexes count in. `'declaration'` (the
   * default) is every error of a successfully normalized call — the seam
   * permuted the operands before the error was minted, and `slotNamesFor`
   * maps the slot back to the written argument. `'written'` is the seam's own
   * normalization FAILURES (`errorIndexCountsWrittenArguments`,
   * boxed-expression/named-arguments.ts): the call was never permuted, so
   * the index already counts written positions and is used directly. */
  frameIndexOrder: 'declaration' | 'written' = 'declaration'
): { range: [number, number]; call?: MathJsonExpression } {
  for (let k = 0; k < frames.length; k++) {
    const { name, index } = frames[k];
    const matches: MathJsonExpression[] = [];
    findByOperator(stmt, name, matches);
    let found: { call: MathJsonExpression; arg: MathJsonExpression | null };
    if (matches.length === 1) {
      // When the argument is not sure, the whole call is the range: it
      // contains the error.
      found = frameArgument(
        frames,
        k,
        matches[0],
        stmt,
        stmt,
        frameIndexOrder,
        slotNamesFor
      ) ?? {
        call: clusterTop(stmt, matches[0], name),
        arg: null,
      };
    } else if (matches.length > 1) {
      const walked = walkToFrame(
        frames,
        k,
        stmt,
        frameIndexOrder,
        slotNamesFor
      );
      if (walked === undefined) continue;
      found = walked;
    } else continue;

    const range = nodeOffsets(found.arg) ?? nodeOffsets(found.call);
    // The matched CALL travels with the range: a caller quoting the error's
    // surroundings wants `IndexOf(digits, cs[i], 23)`, not the one argument
    // the range underlines and not the whole enclosing statement.
    if (range !== undefined) return { range, call: found.call };
  }
  return { range: fallback };
}

/**
 * Find the call of frame `k` when its operator occurs more than once in the
 * statement, by walking the frames from the OUTERMOST one down to frame `k`.
 *
 * The walk starts with the whole statement as its scope. Each frame selects
 * the one call of its operator in the scope that is not inside another call
 * of the same operator in the scope (the shallowest call), and the argument
 * that the frame's index names becomes the scope of the next inner frame.
 * The shallowest call is the correct one because the frames of a runtime
 * error record each call that the error passes through: when an `If` on the
 * error's way is inside another `If`, the outer `If` is also on the way and
 * has the next outer frame. In `if a { 0 } else if b { g("x") } else { 1 }`
 * the frame `If argument 3` selects the outer `if` and its `else` argument,
 * and in that argument the frame `If argument 2` selects the inner `if` and
 * its `{ g("x") }` argument.
 *
 * A frame whose operator does not occur in the statement at all is a call
 * that canonicalization made (such as a `Block` wrapper), and the walk skips
 * it. The walk stops with `undefined` when a frame has no call or two
 * shallowest calls in its scope, and when an argument cannot be identified
 * (a named call whose declared slot names are not known).
 *
 * The frames can be incomplete: a call that does not record a frame is not in
 * the list, and the static check gives only the innermost frame. When no
 * outer frame selected a call, the shallowest call for frame `k` (the frame
 * whose argument is the result) can thus be an outer call of the same
 * operator, not the call that made the error. In that case the walk also
 * requires that every other call of the operator inside the selected call is
 * inside the selected argument, so that the result always contains the call
 * that made the error. For example, the static check reports
 * `Arctan2(1, Arctan2("a", 1))` with the one frame `Arctan2 argument 1`: the
 * outer call's argument 1 is `1`, which does not contain the inner call, so
 * the walk gives `undefined`. When an outer frame selected a call, its
 * argument holds the error, and this condition does not apply: in
 * `if a { 0 } else if b { g("x") } else if c { 1 } else { 2 }` the `if b`
 * that frame `If argument 2` selects has another `if` in its argument 3.
 */
function walkToFrame(
  frames: readonly ErrorFrameRef[],
  k: number,
  stmt: MathJsonExpression,
  frameIndexOrder: 'declaration' | 'written',
  slotNamesFor?: (
    operatorName: string
  ) => readonly (string | undefined)[] | undefined
): { call: MathJsonExpression; arg: MathJsonExpression | null } | undefined {
  let scope = stmt;
  // Whether an outer frame selected a call (and its argument is `scope`).
  let narrowed = false;
  for (let j = frames.length - 1; j >= k; j--) {
    const { name } = frames[j];
    if (j > k) {
      const inStatement: MathJsonExpression[] = [];
      findByOperator(stmt, name, inStatement);
      if (inStatement.length === 0) continue;
    }

    const shallowest: MathJsonExpression[] = [];
    findShallowestByOperator(scope, name, shallowest);
    if (shallowest.length !== 1) return undefined;
    const selected = frameArgument(
      frames,
      j,
      shallowest[0],
      scope,
      stmt,
      frameIndexOrder,
      slotNamesFor
    );
    if (selected === undefined) return undefined;
    const { call, arg } = selected;

    if (j === k) {
      // Without an argument the result is the whole call, which contains
      // every call inside it.
      if (!narrowed && arg !== null) {
        for (const op of operands(call)) {
          // The operand that holds the argument (the argument itself, or a
          // nested call that canonicalization merges with `call`).
          if (pathTo(op, arg, [])) continue;
          const other: MathJsonExpression[] = [];
          findByOperator(op, name, other);
          if (other.length > 0) return undefined;
        }
      }
      return { call, arg };
    }

    if (arg === null) return undefined;
    scope = arg;
    narrowed = true;
  }
  return undefined;
}

/**
 * The operators whose canonical form does not keep the written order of the
 * operands. `Add` and `Multiply` sort their operands, fold their number
 * operands, and flatten nested sums and products (`p + q - r` is written as
 * `Subtract(Add(p, q), r)` and is `Add(p, q, Negate(r))` in canonical form).
 * `Xor` and `Set` sort their operands. The argument index of a frame of
 * these operators counts the operands of the CANONICAL call, so it cannot
 * select an argument of the written call.
 */
const REORDERED_OPERATORS = new Set(['Add', 'Multiply', 'Xor', 'Set']);

/** The written operators that canonicalization merges into one call of a
 * reordered operator: a written subtraction is part of the canonical sum. */
function clusterOperators(name: string): readonly string[] {
  if (name === 'Add') return ['Add', 'Subtract'];
  return [name];
}

/**
 * The written call and the written argument that frame `j` names, with
 * `call` the written call that the frame selected in `scope`. `undefined`
 * when the argument is not sure.
 *
 * For most operators the frame's argument index selects the argument. For
 * an operator in {@link REORDERED_OPERATORS}, the index counts the operands
 * of the canonical call. When an inner frame names an operator of the
 * statement, the error went through a call of that operator, so the
 * argument is the one written operand of the call that holds such a call.
 * The written operands are read through the nested calls that
 * canonicalization merges into one (`clusterLeaves`), and the selected call
 * is the outermost of them. Example: in
 * `(if n == 1 { g("a") } else { 0 }) + (if n == 2 { 2 } else { 3 })` the
 * frame `Add argument 2` can name the first written operand, and when both
 * operands hold an `if` the argument is not sure. When no inner frame names
 * an operator of the statement, the call made the error for its own operand:
 * `"a" + 1` gives `Add argument 1`. Such an operand keeps its written
 * position, and the index is used.
 *
 * When frame `j` is not the innermost frame, the error came from a call
 * inside the argument. An argument that cannot fail when it is evaluated
 * (a number, a string, a block or a list of them) is then not the argument
 * at fault, and the result is `undefined`.
 */
function frameArgument(
  frames: readonly ErrorFrameRef[],
  j: number,
  call: MathJsonExpression,
  scope: MathJsonExpression,
  stmt: MathJsonExpression,
  frameIndexOrder: 'declaration' | 'written',
  slotNamesFor?: (
    operatorName: string
  ) => readonly (string | undefined)[] | undefined
): { call: MathJsonExpression; arg: MathJsonExpression | null } | undefined {
  const { name, index } = frames[j];
  let inner: string | undefined;
  for (let i = j - 1; i >= 0 && inner === undefined; i--) {
    const found: MathJsonExpression[] = [];
    findByOperator(stmt, frames[i].name, found);
    if (found.length > 0) inner = frames[i].name;
  }

  let result: { call: MathJsonExpression; arg: MathJsonExpression | null };
  if (REORDERED_OPERATORS.has(name) && inner !== undefined) {
    const top = clusterTop(scope, call, name);
    const holders = clusterLeaves(top, name).filter((leaf) => {
      const found: MathJsonExpression[] = [];
      findByOperator(leaf, inner, found);
      return found.length > 0;
    });
    if (holders.length !== 1) return undefined;
    result = { call: top, arg: holders[0] };
  } else {
    result = {
      call,
      arg: argumentAtSlot(
        [...operands(call)],
        index - 1,
        name,
        frameIndexOrder,
        slotNamesFor
      ),
    };
  }

  if (j > 0 && result.arg !== null && !mayFail(result.arg)) return undefined;
  return result;
}

/** The outermost call that contains `node` in `root` through a chain of the
 * calls that canonicalization merges with `node` (see
 * {@link clusterOperators}): `Subtract(Add(p, q), r)` for the `Add`. */
function clusterTop(
  root: MathJsonExpression,
  node: MathJsonExpression,
  name: string
): MathJsonExpression {
  const merged = clusterOperators(name);
  const path: MathJsonExpression[] = [];
  if (!pathTo(root, node, path)) return node;
  // `path` goes from `root` down to `node`.
  let top = path.length - 1;
  while (top > 0 && merged.includes(operator(path[top - 1]))) top -= 1;
  return path[top];
}

/** The operands of `top`, read through the nested calls that
 * canonicalization merges with it (see {@link clusterOperators}). */
function clusterLeaves(
  top: MathJsonExpression,
  name: string
): MathJsonExpression[] {
  const merged = clusterOperators(name);
  const leaves: MathJsonExpression[] = [];
  const visit = (node: MathJsonExpression): void => {
    for (const op of operands(node))
      if (merged.includes(operator(op))) visit(op);
      else leaves.push(op);
  };
  visit(top);
  return leaves;
}

/** Fill `path` with the nodes from `root` down to `node` (found by
 * identity). `false` when `node` is not in `root`. */
function pathTo(
  root: MathJsonExpression,
  node: MathJsonExpression,
  path: MathJsonExpression[]
): boolean {
  path.push(root);
  if (root === node) return true;
  for (const op of operands(root)) if (pathTo(op, node, path)) return true;
  path.pop();
  return false;
}

/** Whether evaluating `node` can make an error: `false` for a number, a
 * string, and a block, a list or a tuple of them. A symbol can hold an error
 * value, and any other call can make one. */
function mayFail(node: MathJsonExpression): boolean {
  const head = operator(node);
  if (head === '') return symbol(node) !== null;
  if (['Block', 'List', 'Tuple'].includes(head))
    return operands(node).some(mayFail);
  return true;
}

/** Collect the nodes of `expr` whose operator is `name` and that are not
 * inside another such node (early-exits once there are two). */
function findShallowestByOperator(
  expr: MathJsonExpression | null,
  name: string,
  matches: MathJsonExpression[]
): void {
  if (expr === null || matches.length > 1) return;
  if (operator(expr) === '') return;
  if (operator(expr) === name) {
    matches.push(expr);
    return;
  }
  for (const op of operands(expr)) findShallowestByOperator(op, name, matches);
}

/**
 * The written argument that fills declaration slot `slot` (0-based) of the
 * call whose raw operands are `rawOps`.
 *
 * An all-positional call is the identity mapping. A call containing a
 * `NamedArgument` carrier was permuted by the normalization seam, and the
 * permutation is reconstructed here from the same two facts the seam used: a
 * positional argument fills the next unfilled slot left to right (positional
 * arguments always precede named ones — the seam rejects the other order, so
 * a call that produced an ARGUMENT-indexed error has them as a prefix), and
 * a carrier fills the slot its written name selects among the declared
 * `slotNames`. When the slot names are not knowable, or nothing matches,
 * `null` — the caller then anchors on the whole call, which is wide but
 * never underlines the WRONG argument.
 */
function argumentAtSlot(
  rawOps: readonly MathJsonExpression[],
  slot: number,
  calleeName: string,
  frameIndexOrder: 'declaration' | 'written',
  slotNamesFor?: (
    operatorName: string
  ) => readonly (string | undefined)[] | undefined
): MathJsonExpression | null {
  // A written-order index needs no reconciliation — and neither does a call
  // with no carrier, whose written order IS declaration order.
  if (
    frameIndexOrder === 'written' ||
    !rawOps.some((op) => operator(op) === 'NamedArgument')
  )
    return rawOps[slot] ?? null;

  const names = slotNamesFor?.(calleeName);
  if (names === undefined) return null;

  let nextPositionalSlot = 0;
  for (const op of rawOps) {
    if (operator(op) !== 'NamedArgument') {
      if (nextPositionalSlot === slot) return op;
      nextPositionalSlot += 1;
      continue;
    }
    const written = stringValue(operand(op, 1));
    // Return the whole carrier (`x: "bad"`), not just its value: the name is
    // part of what the author wrote at that spot, and the in-order underline
    // covers it too.
    if (written !== null && names.indexOf(written) === slot) return op;
  }
  return null;
}

/** {@link locateError}'s range alone, for a caller that only needs to point. */
export function narrowToFrames(
  frames: readonly ErrorFrameRef[],
  stmt: MathJsonExpression,
  fallback: [number, number],
  slotNamesFor?: (
    operatorName: string
  ) => readonly (string | undefined)[] | undefined,
  frameIndexOrder: 'declaration' | 'written' = 'declaration'
): [number, number] {
  return locateError(frames, stmt, fallback, slotNamesFor, frameIndexOrder)
    .range;
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
