import type { MathJsonExpression } from '../../math-json/types.js';

/**
 * The parsed MathJSON `json` with each spacing command removed from the
 * operands of an `InvisibleOperator`, for the structural form of
 * `ce.parse()`.
 *
 * A spacing command (`\,`, `\;`, `\quad`, …) parses to a `HorizontalSpacing`
 * with one operand. It has no meaning, and the canonical form drops it
 * (`canonicalInvisibleOperator()`), but the structural form kept it as an
 * operand of the juxtaposition, so the shape depended on where the space
 * was: `\,d=2` was
 * `["Equal", ["InvisibleOperator", ["HorizontalSpacing", 3], "d"], 2]`, a
 * product on the left side, while `d=\,2` was `["Equal", "d", 2]`. Here
 * `\,d=2` is `["Equal", "d", 2]`. An `InvisibleOperator` left with one
 * operand is replaced by it, and the operand takes the metadata of the
 * juxtaposition (its `latex`, for `preserveLatex`); one left with no operand
 * is kept as it was. The raw form is not changed, so the LaTeX can be read
 * back as written. The operands of `Hold`, `Error` and `ErrorCode` are not
 * entered: boxing keeps them as written in every form.
 * (ROADMAP CE-403, Tycho row 431.)
 *
 * `json` is not changed: a dictionary entry can return the same MathJSON on
 * every parse. When `json` has a spacing command to remove, the function
 * nodes are copied first. Both walks are iterative, so a deep tree (a long
 * `1-2-3-…` chain) does not grow the stack.
 */
export function dropSpacingOperands(
  json: MathJsonExpression
): MathJsonExpression {
  if (!hasSpacingOperand(json)) return json;
  // The copy is owned here, so it is changed in place.
  const root: unknown[] = [copyFunctionNodes(json)];
  // Each entry is a function node whose operands are still to be visited.
  // The operands of an `InvisibleOperator` are filtered before they are
  // visited, so the walk never enters a removed spacing node.
  const stack: unknown[][] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    // `root` holds the whole expression at index 0; any other node holds its
    // operator at index 0 and its operands after it.
    for (let i = node === root ? 0 : 1; i < node.length; i++) {
      const child = operandList(node[i]);
      if (child === undefined || isOpaque(child)) continue;
      if (child[0] === 'InvisibleOperator') {
        const kept = child.filter((x, k) => k === 0 || !isSpacing(x));
        if (kept.length === 2) {
          // One operand is left: it replaces the juxtaposition, and is
          // visited in its place.
          node[i] = withMetadataOf(node[i], kept[1]);
          i -= 1;
          continue;
        }
        if (kept.length > 2 && kept.length < child.length) {
          child.length = 0;
          child.push(...kept);
        }
      }
      stack.push(child);
    }
  }
  return root[0] as MathJsonExpression;
}

/** Whether `json` has a spacing command among the operands of an
 * `InvisibleOperator`, outside the operands of `Hold`, `Error` and
 * `ErrorCode`. */
function hasSpacingOperand(json: unknown): boolean {
  const stack: unknown[] = [json];
  while (stack.length > 0) {
    const list = operandList(stack.pop());
    if (list === undefined || isOpaque(list)) continue;
    if (list[0] === 'InvisibleOperator' && list.some(isSpacing)) return true;
    for (let i = 1; i < list.length; i++) stack.push(list[i]);
  }
  return false;
}

/** A copy of `json` in which every function node (a list, or an object with
 * a `fn` field) is a new list or object. Other values are shared: they are
 * not changed. */
function copyFunctionNodes(json: unknown): unknown {
  const copyNode = (x: unknown): unknown => {
    if (Array.isArray(x)) return [...x];
    if (typeof x === 'object' && x !== null && 'fn' in x) {
      const fn = (x as { fn: unknown }).fn;
      if (Array.isArray(fn)) return { ...x, fn: [...fn] };
    }
    return x;
  };
  const root = copyNode(json);
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const list = operandList(stack.pop());
    if (list === undefined) continue;
    for (let i = 1; i < list.length; i++) {
      list[i] = copyNode(list[i]);
      stack.push(list[i]);
    }
  }
  return root;
}

/** `operand`, with the metadata of the function node `node` (every field of
 * an object node but `fn`) when it has any. A symbol, a number or a string
 * operand is written as an object to hold it. */
function withMetadataOf(node: unknown, operand: unknown): unknown {
  if (typeof node !== 'object' || node === null || Array.isArray(node))
    return operand;
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node))
    if (key !== 'fn') metadata[key] = value;
  if (Object.keys(metadata).length === 0) return operand;
  if (Array.isArray(operand)) return { fn: operand, ...metadata };
  // A string literal is written `'text'` in the short form of MathJSON; any
  // other string is a symbol.
  if (typeof operand === 'string')
    return operand.length >= 2 &&
      operand.startsWith("'") &&
      operand.endsWith("'")
      ? { str: operand.slice(1, -1), ...metadata }
      : { sym: operand, ...metadata };
  if (typeof operand === 'number') return { num: String(operand), ...metadata };
  if (typeof operand === 'object' && operand !== null)
    return { ...operand, ...metadata };
  return operand;
}

/** The list that holds the operator and the operands of the function node
 * `x`: `x` itself, or the `fn` field of an object; `undefined` when `x` is
 * not a function node. */
function operandList(x: unknown): unknown[] | undefined {
  if (Array.isArray(x)) return x;
  if (typeof x === 'object' && x !== null && 'fn' in x) {
    const fn = (x as { fn: unknown }).fn;
    if (Array.isArray(fn)) return fn;
  }
  return undefined;
}

/** Whether the function node `list` keeps its operands as written: `Hold`,
 * `Error` and `ErrorCode` (`PREBOX_OPAQUE_HEADS` in `box.ts`). */
function isOpaque(list: unknown[]): boolean {
  return list[0] === 'Hold' || list[0] === 'Error' || list[0] === 'ErrorCode';
}

/** Whether `x` is a spacing command: a `HorizontalSpacing` with one
 * operand. */
function isSpacing(x: unknown): boolean {
  const list = operandList(x);
  return (
    list !== undefined && list.length === 2 && list[0] === 'HorizontalSpacing'
  );
}
