import type { Expression } from '../compute-engine/types-expression.js';
import {
  assignmentLocalsOf,
  isFunctionBodyBlock,
} from '../compute-engine/assignment-locals.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';

//
// The static half of the `read-before-declaration` error. Two kinds of
// local of a block have no value when a run of the block starts:
//
// - an assignment local: a name that a block in a function body assigns,
//   with no declaration visible where the function is written
//   (`declareAssignmentLocals()`, `src/compute-engine/function-utils.ts`);
// - a `let` or `const` local, in any block, until its `let` or `const`
//   statement runs (`createBlockLocals()`, the same file).
//
// A use of such a local before the run gives it a value (a read of the
// symbol, a call of the function it holds, the collection of a `for` loop)
// is the error at run time (`readBeforeDeclarationError()`,
// `src/compute-engine/boxed-expression/read-before-declaration.ts`).
//
// This module finds the uses for which the order is certain from the
// source: when the use runs, the local has no value yet in the same run. A
// use that is uncertain is not reported, and the run reports it when it
// happens. The analysis reads the canonical tree, where the
// canonicalization recorded the assignment locals of each block
// (`assignmentLocalsOf()`, `src/compute-engine/assignment-locals.ts`).
//

/** A use of a local that is certain to come before the local has a
 * value. */
export type ReadBeforeAssignment = {
  /** The name of the local. */
  name: string;
  /** `'assignment'` for an assignment local, `'let'` for a `let` or
   * `const` local. */
  kind: 'assignment' | 'let';
  /** The source range of the symbol that reads the local, when the
   * canonical tree has it. */
  read: [number, number] | undefined;
  /** The source range of the statement of the block that holds the read,
   * when the canonical tree has it. */
  statement: [number, number] | undefined;
};

/**
 * The operators whose operands are each evaluated at most once when the
 * operator is evaluated once, and that the analysis goes through: a block
 * in such an operand runs at most once for each run of the enclosing block.
 * Any other operator (a loop, a big operator, a comprehension, an operator
 * that the analysis does not know) can run a block in its operands more than
 * once in one run of the enclosing block.
 */
const RUN_ONCE_OPERATORS = new Set([
  'Block',
  'If',
  'Assign',
  'Declare',
  'Typed',
  'And',
  'Or',
  'Not',
  'Return',
  'DefineFunction',
]);

/**
 * The operators with a `lazy` definition that evaluate each of their
 * operands when they are evaluated. An operator with a definition that is
 * not lazy evaluates its operands too. A read in an operand of any other
 * operator may not be evaluated (`Hold(t)`), and is not reported.
 */
const STRICT_LAZY_OPERATORS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Sqrt',
  'Root',
  'List',
  'Tuple',
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Not',
  'Return',
  'N',
]);

function evaluatesOperands(expr: Expression): boolean {
  if (STRICT_LAZY_OPERATORS.has(expr.operator)) return true;
  const def = expr.operatorDefinition;
  return def !== undefined && def.lazy !== true;
}

/**
 * The uses of a local, in the canonical expression `root`, that are certain
 * to come before the local has a value in a run of its block. A use is a
 * read of the symbol, or a call of the function it holds (`h(1)`). At most
 * one use is returned for each local of each block: the first one, in the
 * order of evaluation.
 *
 * The assignment locals of a block are read only when the block is written
 * in the body of a function literal (`isFunctionBodyBlock()`): in a block
 * outside every function literal, a read before the first assignment is the
 * bare symbol, and is not an error. The `let` and `const` locals of every
 * block are read.
 *
 * For each local of a block, the statements of the block are read in order,
 * until the `let` of the local, or the first statement that assigns the
 * local (anywhere in the statement, in a branch or in a loop too):
 *
 * - A statement that does not assign the local: each use of the local in
 *   it comes before the local has a value.
 * - The first assignment of an assignment local, `t = …`: a use in its
 *   value comes before the assignment (`t = t + 1`).
 *
 * A read in a function literal is not counted: it runs when the function is
 * called, maybe after the assignment (`f = () => t; t = 1; f()`). When a
 * function literal of the block assigns the local, the local is not read at
 * all: the function can be called before the read.
 *
 * A block can run more than once with the same bindings: the body of a
 * loop keeps its locals from one iteration to the next, so the second
 * iteration reads the assignment of the first one. In such a block (a block
 * in an operand of an operator that is not in `RUN_ONCE_OPERATORS`, between
 * the block and the nearest function literal) only a read that runs on each
 * run of the block is counted: not a read in a branch of an `If`, in the
 * second operand of an `And` or `Or`, or in a nested loop. In a block that
 * runs at most once for each call, such a read comes before every assignment
 * also, when it runs. A `let` local has a new binding with no value on each
 * run of its block, so such a read before the `let` is counted in every
 * block.
 */
export function readsBeforeAssignment(
  root: Expression
): ReadBeforeAssignment[] {
  const found: ReadBeforeAssignment[] = [];
  const seen = new Set<Expression>();
  const visit = (expr: Expression, repeats: boolean): void => {
    if (seen.has(expr)) return;
    // A dictionary holds its values apart from the operands: the attributes
    // of a `let` (`let r = do { … }`), or a dictionary literal. Each value
    // is evaluated once.
    if (isDictionary(expr)) {
      seen.add(expr);
      for (const value of expr.values) visit(value, repeats);
      return;
    }
    if (!isFunction(expr)) return;
    seen.add(expr);
    if (expr.operator === 'Function') {
      // The body of a function literal runs once for each call, with new
      // bindings. The other operands are the parameters.
      if (expr.ops[0] !== undefined) visit(expr.ops[0], false);
      return;
    }
    if (expr.operator === 'Block')
      found.push(...blockReadsBeforeAssignment(expr, repeats));
    const inner = repeats || !RUN_ONCE_OPERATORS.has(expr.operator);
    for (const op of expr.ops) visit(op, inner);
  };
  visit(root, false);
  return found;
}

/** The reads of `readsBeforeAssignment()` for the locals of the one block
 * `block`. `repeats` is true when the block can run more than once with the
 * same bindings. */
function blockReadsBeforeAssignment(
  block: Expression,
  repeats: boolean
): ReadBeforeAssignment[] {
  const scope = block.localScope;
  if (scope === undefined || !isFunction(block)) return [];
  const statementOf = (raw: Expression): Expression =>
    isFunction(raw, 'Typed') ? raw.ops[0] : raw;
  const locals: [name: string, kind: 'assignment' | 'let'][] = [];
  // In a block outside every function literal, a read of an assignment
  // local before its first assignment is the bare symbol, not an error.
  if (isFunctionBodyBlock(scope))
    for (const name of assignmentLocalsOf(scope) ?? [])
      locals.push([name, 'assignment']);
  for (const raw of block.ops) {
    const statement = statementOf(raw);
    if (isFunction(statement, 'Declare') && statement.ops[0] !== undefined)
      for (const name of targetNames(statement.ops[0]))
        locals.push([name, 'let']);
  }
  const found: ReadBeforeAssignment[] = [];
  for (const [name, kind] of locals) {
    const binding = scope.bindings.get(name);
    const def =
      binding !== undefined && 'value' in binding ? binding.value : undefined;
    if (def === undefined) continue;
    if (block.ops.some((statement) => assigns(statement, name, true))) continue;
    // A `let` local gets a new binding with no value on each run of the
    // block (each iteration of a loop body too), so a use before the `let`
    // is an error on each run, also in a branch.
    const conditional = kind === 'let' || !repeats;
    for (const raw of block.ops) {
      const statement = statementOf(raw);
      // The `let` itself: its initializer reads the name of an enclosing
      // scope, and the local has a value after it.
      if (
        kind === 'let' &&
        isFunction(statement, 'Declare') &&
        statement.ops[0] !== undefined &&
        targetNames(statement.ops[0]).includes(name)
      )
        break;
      const writes = assigns(statement, name, false);
      const reads: Expression[] = [];
      if (!writes) collectReads(statement, def, conditional, reads);
      else if (
        kind === 'assignment' &&
        isFunction(statement, 'Assign') &&
        statement.ops[0] !== undefined &&
        statement.ops[1] !== undefined &&
        isTargetOf(statement.ops[0], name) &&
        !assigns(statement.ops[1], name, false)
      )
        collectReads(statement.ops[1], def, conditional, reads);
      if (reads.length > 0) {
        // The first use in the order of evaluation (the operands of the
        // canonical tree, in order), which is the use that gives the error
        // at run time.
        const first = reads.find(
          (read) => read.sourceOffsets !== undefined
        )?.sourceOffsets;
        found.push({ name, kind, read: first, statement: raw.sourceOffsets });
        break;
      }
      if (writes) break;
      // A statement after a `return`, `break` or `continue` of the block
      // does not run.
      if (
        isFunction(statement, 'Return') ||
        isFunction(statement, 'Break') ||
        isFunction(statement, 'Continue')
      )
        break;
    }
  }
  return found;
}

/**
 * Whether `expr` holds an `Assign` to `name` (a plain target, or a leaf of a
 * destructuring target). With `inFunction`, only an `Assign` in a function
 * literal of `expr` is counted. A name is compared, not a binding: an
 * assignment to another binding of the same name is counted too, so that
 * the analysis reports less, never more.
 */
function assigns(expr: Expression, name: string, inFunction: boolean): boolean {
  const seen = new Set<Expression>();
  const walk = (e: Expression, inside: boolean): boolean => {
    if (seen.has(e)) return false;
    // A dictionary holds its values apart from the operands: the attributes
    // of a `let` hold its initializer (`let z = do { t = 1 }`), as
    // `collectReads()` reads it. A value is in a function literal when the
    // dictionary is.
    if (isDictionary(e)) {
      seen.add(e);
      return e.values.some((value) => walk(value, inside));
    }
    if (!isFunction(e)) return false;
    seen.add(e);
    const nowInside = inside || e.operator === 'Function';
    if (
      e.operator === 'Assign' &&
      (nowInside || !inFunction) &&
      e.ops[0] !== undefined &&
      isTargetOf(e.ops[0], name)
    )
      return true;
    return e.ops.some((op) => walk(op, nowInside));
  };
  return walk(expr, false);
}

/** The names that the target of a `Declare` declares: the symbol, or the
 * leaves of a destructuring target. */
function targetNames(target: Expression): string[] {
  if (isSymbol(target))
    return target.symbol === 'Nothing' ? [] : [target.symbol];
  return isFunction(target, 'Tuple') ? target.ops.flatMap(targetNames) : [];
}

/** Whether the target of an `Assign` writes `name`: the symbol `name`, or a
 * destructuring target with a leaf `name`. */
function isTargetOf(target: Expression, name: string): boolean {
  return isSymbol(target)
    ? target.symbol === name
    : isFunction(target, 'Tuple') &&
        target.ops.some((leaf) => isTargetOf(leaf, name));
}

/**
 * Add to `out` the symbols of `expr` that read the binding `def` when
 * `expr` is evaluated, and the calls of the function it holds. With `conditional`, a read in an operand that may
 * not be evaluated (a branch of an `If`, a later operand of an `And` or an
 * `Or`, the body of a loop) is added too.
 */
function collectReads(
  expr: Expression,
  def: object,
  conditional: boolean,
  out: Expression[]
): void {
  const seen = new Set<Expression>();
  const walk = (e: Expression): void => {
    if (isSymbol(e)) {
      if (e.valueDefinition === def) out.push(e);
      return;
    }
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    // A call of the function that the local holds (`h(1)` before
    // `h = (x) => x`) uses the local as a read does. The arguments are not
    // evaluated.
    if (e.baseDefinition === def) {
      out.push(e);
      return;
    }
    const ops = e.ops;
    switch (e.operator) {
      case 'Function':
        return;
      case 'Block':
        ops.forEach(walk);
        return;
      case 'Assign':
        if (ops[1] !== undefined) walk(ops[1]);
        return;
      case 'Declare': {
        // `Declare(name, type?, value?)`, or the value in the attributes
        // dictionary that ends the operands.
        const last = ops[ops.length - 1];
        const value =
          last !== undefined && isDictionary(last) ? last.get('value') : ops[2];
        if (value !== undefined) walk(value);
        return;
      }
      case 'Typed':
        if (ops[0] !== undefined) walk(ops[0]);
        return;
      case 'If':
      case 'And':
      case 'Or':
        if (ops[0] !== undefined) walk(ops[0]);
        if (conditional) ops.slice(1).forEach(walk);
        return;
      case 'Loop':
        // `Loop(body, Element(index, collection), …)`, or `Loop(body)` for a
        // `while` loop, whose body holds the condition. The collection of the
        // first clause is evaluated once, when the loop starts. The body,
        // and the collection of a later clause, are evaluated for each
        // element of the clauses before them, maybe for none.
        ops.forEach((op, i) => {
          if (i > 0 && isFunction(op, 'Element')) {
            if (op.ops[1] !== undefined && (i === 1 || conditional))
              walk(op.ops[1]);
          } else if (conditional) walk(op);
        });
        return;
      case 'Comprehension':
        // A comprehension is a lazy list: its clause domains and its body
        // are evaluated when its elements are read (`Length(r)`, `r[1]`),
        // not where it is written. That read can come after the assignment
        // (`r = [x for x in t]; t = [1]; Length(r)` is `1`), so a read in it
        // is not certain to come first, and is not reported. A read of the
        // list before the assignment gives the error at run time: the error
        // is then the value of the whole list.
        return;
      default:
        if (evaluatesOperands(e)) ops.forEach(walk);
    }
  };
  walk(expr);
}
