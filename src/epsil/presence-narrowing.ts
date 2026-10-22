import type { MathJsonExpression } from '../math-json/types.js';
import { operands, operator, symbol } from '../math-json/utils.js';

/**
 * Guard narrowing for the Epsil static check (slice S3 of
 * `docs/plans/2026-10-21-presence-contracts-and-assertion.md`, user
 * decision P3 of 2026-10-21).
 *
 * The static check reports a possibly absent argument (`xs[i]`, typed
 * `missing | string`) at a parameter that excludes absence. An author who
 * tests first should not be reported:
 *
 * ```text
 * let v = xs[i]
 * if isMissing(v) { "none" } else { f(v) }        f(v) is fine: v is present
 * if !isMissing(v) && v != "b" { f(v) }            same
 * ```
 *
 * The check boxes each statement to read the engine's own diagnostics, and
 * the engine's `If` does not narrow a symbol inside an arm. So, FOR THE
 * CHECK ONLY, every read of a symbol in a region where an `isMissing` test
 * proves it present is wrapped in `AssertPresent(v)`, whose type is the
 * present part of `v`'s type. The run time evaluates the program as written;
 * nothing here reaches it.
 *
 * The regions, for a symbol `v`:
 *
 * - the else arm of `If(IsMissing(v), a, b)` and the then arm of
 *   `If(Not(IsMissing(v)), a, b)`;
 * - the operands after `Not(IsMissing(v))` in an `And`, and after
 *   `IsMissing(v)` in an `Or` (short-circuit evaluation);
 * - a conjunction of such tests proves each of its symbols
 *   (`!isMissing(v) && !isMissing(w)`); a disjunction of `isMissing` tests
 *   proves each symbol in the false region.
 *
 * What stops a region, conservatively:
 *
 * - an assignment to `v` (`v := …`, `let v = …`) inside the region ends it
 *   for the statements that follow; the value assigned is evaluated before
 *   the write, so it is still in the region (`v := f(v)`);
 * - a loop (`while`, `for`, a comprehension) that assigns `v` anywhere in
 *   its body ends the region for the whole loop: on the next iteration the
 *   statements before the assignment read the new value;
 * - a function literal discards the enclosing proofs: its body may run
 *   after `v` changed. A guard written inside the body narrows as usual;
 * - a binder that rebinds `v` (a `for` index, a comprehension index, a sum
 *   index) hides the outer `v` in its body.
 *
 * A symbol in a binding position (the target of an assignment or
 * declaration, a binder's index, a function's parameter) is never wrapped,
 * and neither is the direct operand of `IsMissing`, `Coalesce` or
 * `AssertPresent`, which handle absence themselves.
 */
export function narrowGuardedReads(
  statement: MathJsonExpression
): MathJsonExpression {
  return rewrite(statement, new Set());
}

/** The symbols an `isMissing` test proves present when `cond` is true. */
function presentWhenTrue(cond: MathJsonExpression): Set<string> {
  const out = new Set<string>();
  if (!isApplication(cond)) return out;
  const h = operator(cond);
  if (h === 'Not') {
    const inner = operands(cond)[0];
    if (inner !== undefined) for (const s of presentWhenFalse(inner)) out.add(s);
  } else if (h === 'And') {
    for (const c of operands(cond)) for (const s of presentWhenTrue(c)) out.add(s);
  }
  return out;
}

/** The symbols an `isMissing` test proves present when `cond` is false. */
function presentWhenFalse(cond: MathJsonExpression): Set<string> {
  const out = new Set<string>();
  if (!isApplication(cond)) return out;
  const h = operator(cond);
  if (isMissingTest(h)) {
    const s = symbol(operands(cond)[0]);
    if (s !== null) out.add(s);
  } else if (h === 'Not') {
    const inner = operands(cond)[0];
    if (inner !== undefined) for (const s of presentWhenTrue(inner)) out.add(s);
  } else if (h === 'Or') {
    for (const c of operands(cond))
      for (const s of presentWhenFalse(c)) out.add(s);
  }
  return out;
}

/** Both the resolved library name and the Epsil spelling, in case the tree
 * reaching the check was not resolved. */
function isMissingTest(head: string | null): boolean {
  return head === 'IsMissing' || head === 'isMissing';
}

const union = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> =>
  b.size === 0 ? new Set(a) : new Set([...a, ...b]);

const without = (a: ReadonlySet<string>, s: string): Set<string> => {
  const out = new Set(a);
  out.delete(s);
  return out;
};

/** The symbols `stmt` assigns or declares, at any depth outside a function
 * literal: after such a statement a proof about the name is stale. */
function assignedNames(stmt: MathJsonExpression, into: Set<string>): void {
  if (!isApplication(stmt)) return;
  const h = operator(stmt);
  if (h === null) return;
  if (h === 'Function' || h === 'DefineFunction') return;
  if (h === 'Assign' || h === 'Declare' || h === 'Let' || h === 'Const') {
    const target = symbol(operands(stmt)[0]);
    if (target !== null) into.add(target);
  }
  for (const op of operands(stmt)) assignedNames(op, into);
}

/** Whether `node` is a function application (the object form `{fn: […]}`
 * the Epsil parser builds, or the array form); a symbol, a number, a string
 * or a dictionary has no operands to rewrite. `operator()` answers a string
 * for a non-application too, so it cannot be the test. */
function isApplication(node: MathJsonExpression): boolean {
  if (Array.isArray(node)) return node.length > 0;
  return typeof node === 'object' && node !== null && 'fn' in node;
}

/** `AssertPresent(node)`. The wrapper takes the wrapped node's source
 * offsets, so a diagnostic anchored on the wrapper points at the author's
 * symbol. */
function wrap(node: MathJsonExpression): MathJsonExpression {
  const offsets =
    typeof node === 'object' && node !== null && !Array.isArray(node)
      ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined;
  if (offsets === undefined)
    return { fn: ['AssertPresent', node] } as MathJsonExpression;
  return {
    fn: ['AssertPresent', node],
    sourceOffsets: offsets,
  } as MathJsonExpression;
}

/** `node` with its operands replaced, keeping the node's own fields (the
 * source offsets the diagnostics read). When no operand changed, `node`
 * itself: `narrowGuardedReads` returns the same object when nothing was
 * wrapped, and the static check reads that identity. */
function withOperands(
  node: MathJsonExpression,
  ops: ReadonlyArray<MathJsonExpression>
): MathJsonExpression {
  const before = operands(node);
  if (ops.length === before.length && ops.every((op, k) => op === before[k]))
    return node;
  const head = operator(node)!;
  if (typeof node === 'object' && node !== null && 'fn' in node)
    return { ...node, fn: [head, ...ops] } as MathJsonExpression;
  return [head, ...ops] as MathJsonExpression;
}

function rewrite(
  node: MathJsonExpression,
  present: ReadonlySet<string>
): MathJsonExpression {
  if (present.size === 0 && !containsGuard(node)) return node;
  const s = symbol(node);
  if (s !== null) return present.has(s) ? wrap(node) : node;
  if (!isApplication(node)) return node;
  const h = operator(node);
  if (h === null) return node;
  const ops = operands(node);

  // A function literal may run after the symbol changed, so the enclosing
  // proofs do not hold in its body: the body is entered with an empty proof
  // set, and only a guard written inside it narrows. The parameters are
  // symbols in binding positions; with an empty set nothing wraps them.
  if (h === 'Function') {
    const [body, ...params] = ops;
    if (body === undefined) return node;
    return withOperands(node, [rewrite(body, new Set()), ...params]);
  }
  // `DefineFunction(name, Function(…))`: the name is a binding position.
  if (h === 'DefineFunction') {
    const [name, fn, ...rest] = ops;
    if (fn === undefined) return node;
    return withOperands(node, [name, rewrite(fn, new Set()), ...rest]);
  }

  if (h === 'If') {
    const [cond, a, b] = ops;
    if (cond === undefined) return node;
    const out: MathJsonExpression[] = [rewrite(cond, present)];
    if (a !== undefined)
      out.push(rewrite(a, union(present, presentWhenTrue(cond))));
    if (b !== undefined)
      out.push(rewrite(b, union(present, presentWhenFalse(cond))));
    return withOperands(node, out);
  }

  if (h === 'And' || h === 'Or') {
    let known: ReadonlySet<string> = present;
    const out: MathJsonExpression[] = [];
    for (const op of ops) {
      out.push(rewrite(op, known));
      known = union(
        known,
        h === 'And' ? presentWhenTrue(op) : presentWhenFalse(op)
      );
    }
    return withOperands(node, out);
  }

  // A sequence: a proof about a name ends at a statement that assigns it.
  if (h === 'Block') {
    let known: ReadonlySet<string> = present;
    const out: MathJsonExpression[] = [];
    for (const stmt of ops) {
      out.push(rewrite(stmt, known));
      const assigned = new Set<string>();
      assignedNames(stmt, assigned);
      for (const name of assigned) known = without(known, name);
    }
    return withOperands(node, out);
  }

  // The target of an assignment or a declaration is a binding position and
  // is never wrapped. The right side is evaluated before the write, so the
  // proofs still hold in it (`v := f(v)`); the Block rule ends the proof
  // after the statement.
  if (h === 'Assign' || h === 'Declare' || h === 'Let' || h === 'Const') {
    const [target, ...rest] = ops;
    if (target === undefined) return node;
    return withOperands(node, [
      target,
      ...rest.map((op) => rewrite(op, present)),
    ]);
  }

  // A binder: `Loop(body, Element(v, xs))` (a `for` loop; a `while` loop is
  // `Loop(body)`), `Comprehension(body, Element(v, xs, cond…), …)`,
  // `Sum(body, Limits(i, a, b))`, `Product(…)`. The bound name is a binding
  // position, never wrapped, and it hides the outer name in the body and in
  // the clauses that run inside the binding (a condition of `Element`, a
  // later clause); the collection and the bounds are evaluated outside it.
  // A repeating node (`Loop`, `Comprehension`) also has a back edge: a
  // reassignment anywhere in it invalidates, on the next iteration, the
  // proof for the statements before it. So every name the node assigns
  // leaves the proof set before the node is entered.
  if (
    h === 'Loop' ||
    h === 'Comprehension' ||
    h === 'Sum' ||
    h === 'Product'
  ) {
    let known: ReadonlySet<string> = present;
    if (h === 'Loop' || h === 'Comprehension') {
      const assigned = new Set<string>();
      assignedNames(node, assigned);
      for (const name of assigned) known = without(known, name);
    }
    const [body, ...clauses] = ops;
    if (body === undefined) return node;
    const outClauses: MathJsonExpression[] = [];
    for (const clause of clauses) {
      const ch = operator(clause);
      const [index, ...rest] = operands(clause);
      if ((ch !== 'Element' && ch !== 'Limits') || index === undefined) {
        outClauses.push(rewrite(clause, known));
        continue;
      }
      const name = symbol(index);
      const inside = name === null ? known : without(known, name);
      outClauses.push(
        withOperands(clause, [
          index,
          ...rest.map((op, k) =>
            rewrite(op, ch === 'Element' && k > 0 ? inside : known)
          ),
        ])
      );
      known = inside;
    }
    return withOperands(node, [rewrite(body, known), ...outClauses]);
  }

  // The operators that handle absence themselves read the symbol as it is.
  if (isMissingTest(h) || h === 'Coalesce' || h === 'AssertPresent') {
    const [first, ...rest] = ops;
    if (first === undefined) return node;
    const firstOut = symbol(first) !== null ? first : rewrite(first, present);
    return withOperands(node, [
      firstOut,
      ...rest.map((op) => rewrite(op, present)),
    ]);
  }

  return withOperands(
    node,
    ops.map((op) => rewrite(op, present))
  );
}

/** Whether `node` holds an `isMissing` test anywhere: a statement without
 * one needs no rewrite, and is returned as the same object. */
function containsGuard(node: MathJsonExpression): boolean {
  if (!isApplication(node)) return false;
  const h = operator(node);
  if (h === null) return false;
  if (isMissingTest(h)) return true;
  return operands(node).some((op) => containsGuard(op));
}
