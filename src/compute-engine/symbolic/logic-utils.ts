import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';

import {
  isFunction,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards';

/**
 * Basic evaluation functions for logical operators.
 * Extracted from logic.ts for better code organization.
 */

/** Helper to get `.op1` from a function expression, or undefined. */
function fnOp1(expr: Expression): Expression | undefined {
  return isFunction(expr) ? expr.op1 : undefined;
}

/** Helper to get `.op2` from a function expression, or undefined. */
function fnOp2(expr: Expression): Expression | undefined {
  return isFunction(expr) ? expr.op2 : undefined;
}

/** Helper to get `.ops` from a function expression, or undefined. */
function fnOps(
  expr: Expression
): ReadonlyArray<Expression> | undefined {
  return isFunction(expr) ? expr.ops : undefined;
}

/**
 * Check if an And expression is a contradiction (contains A and Not(A)).
 * Non-recursive to avoid infinite loops.
 */
function isContradiction(args: ReadonlyArray<Expression>): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (let j = i + 1; j < args.length; j++) {
      const other = args[j];
      if (
        (arg.operator === 'Not' && fnOp1(arg)!.isSame(other)) ||
        (other.operator === 'Not' && fnOp1(other)!.isSame(arg))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if an Or expression is a tautology (contains A and Not(A)).
 * Non-recursive to avoid infinite loops.
 */
function isTautologyCheck(args: ReadonlyArray<Expression>): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (let j = i + 1; j < args.length; j++) {
      const other = args[j];
      if (
        (arg.operator === 'Not' && fnOp1(arg)!.isSame(other)) ||
        (other.operator === 'Not' && fnOp1(other)!.isSame(arg))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function evaluateAnd(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  if (args.length === 0) return ce.True;
  const ops: Expression[] = [];
  for (let arg of args) {
    // Check if an Or operand is a tautology (contains A and Not(A))
    // For example: Or(A, Not(A)) -> True, and And(..., True, ...) simplifies
    if (arg.operator === 'Or' && isTautologyCheck(fnOps(arg)!)) {
      arg = ce.True;
    }

    // ['And', ... , 'False', ...] -> 'False'
    if (sym(arg) === 'False') return ce.False;
    if (sym(arg) !== 'True') {
      //Check if arg matches one of the tail elements
      let duplicate = false;
      for (const x of ops) {
        if (x.isSame(arg)) {
          // ['And', a, ..., a]
          // Duplicate element, ignore it
          duplicate = true;
        } else if (
          (arg.operator === 'Not' && fnOp1(arg)!.isSame(x)) ||
          (x.operator === 'Not' && fnOp1(x)!.isSame(arg))
        ) {
          // ['And', ['Not', a],... a]
          // Contradiction
          return ce.False;
        }
      }
      if (!duplicate) ops.push(arg);
    }
  }
  if (ops.length === 0) return ce.True;
  if (ops.length === 1) return ops[0];

  // Absorption: A ∧ (A ∨ B) → A
  // If we have both A and Or(A, ...), remove the Or
  const absorbed = applyAbsorptionAnd(ops);

  if (absorbed.length === 0) return ce.True;
  if (absorbed.length === 1) return absorbed[0];
  return ce._fn('And', absorbed);
}

/**
 * Apply absorption law for And: A ∧ (A ∨ B) → A
 * If any operand is an Or that contains another operand of the And, remove the Or.
 */
function applyAbsorptionAnd(ops: Expression[]): Expression[] {
  const result: Expression[] = [];
  for (const op of ops) {
    // Check if this Or can be absorbed by another operand
    const orOps = op.operator === 'Or' ? fnOps(op) : undefined;
    if (orOps) {
      let absorbed = false;
      // Check if any element of the Or is also a direct operand of the And
      for (const orArg of orOps) {
        for (const other of ops) {
          if (other !== op && orArg.isSame(other)) {
            // A ∧ (A ∨ B) → A: the Or is absorbed, skip it
            absorbed = true;
            break;
          }
        }
        if (absorbed) break;
      }
      if (!absorbed) result.push(op);
    } else {
      result.push(op);
    }
  }
  return result;
}

export function evaluateOr(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  if (args.length === 0) return ce.True;
  const ops: Expression[] = [];
  for (let arg of args) {
    // Check if an And operand is a contradiction (contains A and Not(A))
    // For example: And(A, Not(A)) -> False, and Or(..., False, ...) is removed
    if (arg.operator === 'And' && isContradiction(fnOps(arg)!)) {
      arg = ce.False;
    }

    // ['Or', ... , 'True', ...] -> 'True'
    if (sym(arg) === 'True') return ce.True;
    if (sym(arg) !== 'False') {
      //Check if arg matches one of the tail elements
      let duplicate = false;
      for (const x of ops) {
        if (x.isSame(arg)) {
          // ['Or', a, ..., a]
          // Duplicate element, ignore it
          duplicate = true;
        } else if (
          (arg.operator === 'Not' && fnOp1(arg)!.isSame(x)) ||
          (x.operator === 'Not' && fnOp1(x)!.isSame(arg))
        ) {
          // ['Or', ['Not', a],... a]
          // Tautology
          return ce.True;
        }
      }
      if (!duplicate) ops.push(arg);
    }
  }
  if (ops.length === 0) return ce.False;
  if (ops.length === 1) return ops[0];

  // Absorption: A ∨ (A ∧ B) → A
  // If we have both A and And(A, ...), remove the And
  const absorbed = applyAbsorptionOr(ops);

  if (absorbed.length === 0) return ce.False;
  if (absorbed.length === 1) return absorbed[0];
  return ce._fn('Or', absorbed);
}

/**
 * Apply absorption law for Or: A ∨ (A ∧ B) → A
 * If any operand is an And that contains another operand of the Or, remove the And.
 */
function applyAbsorptionOr(ops: Expression[]): Expression[] {
  const result: Expression[] = [];
  for (const op of ops) {
    // Check if this And can be absorbed by another operand
    const andOps = op.operator === 'And' ? fnOps(op) : undefined;
    if (andOps) {
      let absorbed = false;
      // Check if any element of the And is also a direct operand of the Or
      for (const andArg of andOps) {
        for (const other of ops) {
          if (other !== op && andArg.isSame(other)) {
            // A ∨ (A ∧ B) → A: the And is absorbed, skip it
            absorbed = true;
            break;
          }
        }
        if (absorbed) break;
      }
      if (!absorbed) result.push(op);
    } else {
      result.push(op);
    }
  }
  return result;
}

export function evaluateNot(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  const op1 = sym(args[0]);
  if (op1 === 'True') return ce.False;
  if (op1 === 'False') return ce.True;
  return undefined;
}

export function evaluateEquivalent(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  const lhs = sym(args[0]);
  const rhs = sym(args[1]);
  if (
    (lhs === 'True' && rhs === 'True') ||
    (lhs === 'False' && rhs === 'False')
  )
    return ce.True;
  if (
    (lhs === 'True' && rhs === 'False') ||
    (lhs === 'False' && rhs === 'True')
  )
    return ce.False;
  return undefined;
}

export function evaluateImplies(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  const lhs = sym(args[0]);
  const rhs = sym(args[1]);
  if (
    (lhs === 'True' && rhs === 'True') ||
    (lhs === 'False' && rhs === 'False') ||
    (lhs === 'False' && rhs === 'True')
  )
    return ce.True;
  if (lhs === 'True' && rhs === 'False') return ce.False;
  return undefined;
}

export function evaluateXor(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  // N-ary XOR is true when an odd number of operands are true
  // (equivalent to parity check)
  if (args.length === 0) return ce.False;

  let trueCount = 0;
  const unknowns: Expression[] = [];

  for (const arg of args) {
    if (sym(arg) === 'True') {
      trueCount++;
    } else if (sym(arg) === 'False') {
      // False doesn't change parity
    } else {
      unknowns.push(arg);
    }
  }

  // If all arguments are known, return the result
  if (unknowns.length === 0) {
    return trueCount % 2 === 1 ? ce.True : ce.False;
  }

  // Partial evaluation: XOR with known True values flips the result
  // XOR(True, x) = NOT(x), XOR(False, x) = x
  if (unknowns.length === 1 && trueCount % 2 === 1) {
    // Odd number of Trues with one unknown = NOT(unknown)
    return ce._fn('Not', [unknowns[0]]);
  }
  if (unknowns.length === 1 && trueCount % 2 === 0) {
    // Even number of Trues with one unknown = unknown
    return unknowns[0];
  }

  return undefined;
}

export function evaluateNand(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  // N-ary NAND is the negation of AND
  // NAND(a, b, c, ...) = NOT(AND(a, b, c, ...))
  if (args.length === 0) return ce.False; // NOT(True) = False

  // If any argument is False, AND is False, so NAND is True
  for (const arg of args) {
    if (sym(arg) === 'False') return ce.True;
  }

  // Check if all are True
  let allTrue = true;
  for (const arg of args) {
    if (sym(arg) !== 'True') {
      allTrue = false;
      break;
    }
  }

  if (allTrue) return ce.False; // NOT(True) = False

  return undefined;
}

export function evaluateNor(
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  // N-ary NOR is the negation of OR
  // NOR(a, b, c, ...) = NOT(OR(a, b, c, ...))
  if (args.length === 0) return ce.True; // NOT(False) = True

  // If any argument is True, OR is True, so NOR is False
  for (const arg of args) {
    if (sym(arg) === 'True') return ce.False;
  }

  // Check if all are False
  let allFalse = true;
  for (const arg of args) {
    if (sym(arg) !== 'False') {
      allFalse = false;
      break;
    }
  }

  if (allFalse) return ce.True; // NOT(False) = True

  return undefined;
}

/**
 * Convert a boolean expression to Negation Normal Form (NNF).
 * In NNF, negations only appear directly before variables (literals).
 * This is a prerequisite for CNF/DNF conversion.
 */
export function toNNF(
  expr: Expression,
  ce: ComputeEngine
): Expression {
  const op = expr.operator;

  // Base cases
  if (!op) return expr;
  if (sym(expr) === 'True' || sym(expr) === 'False') return expr;

  // Handle Not
  if (op === 'Not') {
    const inner = fnOp1(expr);
    if (!inner) return expr;

    const innerOp = inner.operator;

    // Double negation: ¬¬A → A
    if (innerOp === 'Not') {
      return toNNF(fnOp1(inner)!, ce);
    }

    // De Morgan's law: ¬(A ∧ B) → (¬A ∨ ¬B)
    if (innerOp === 'And') {
      const negatedOps = fnOps(inner)!.map((x) =>
        toNNF(ce._fn('Not', [x]), ce)
      );
      return ce._fn('Or', negatedOps);
    }

    // De Morgan's law: ¬(A ∨ B) → (¬A ∧ ¬B)
    if (innerOp === 'Or') {
      const negatedOps = fnOps(inner)!.map((x) =>
        toNNF(ce._fn('Not', [x]), ce)
      );
      return ce._fn('And', negatedOps);
    }

    // ¬True → False, ¬False → True
    if (sym(inner) === 'True') return ce.False;
    if (sym(inner) === 'False') return ce.True;

    // Negation of implication: ¬(A → B) → (A ∧ ¬B)
    if (innerOp === 'Implies') {
      const a = fnOp1(inner)!;
      const b = fnOp2(inner)!;
      return toNNF(ce._fn('And', [a, ce._fn('Not', [b])]), ce);
    }

    // Negation of equivalence: ¬(A ↔ B) → (A ∧ ¬B) ∨ (¬A ∧ B)
    if (innerOp === 'Equivalent') {
      const a = fnOp1(inner)!;
      const b = fnOp2(inner)!;
      return toNNF(
        ce._fn('Or', [
          ce._fn('And', [a, ce._fn('Not', [b])]),
          ce._fn('And', [ce._fn('Not', [a]), b]),
        ]),
        ce
      );
    }

    // Negation of Xor: ¬(A ⊕ B) ≡ A ↔ B ≡ (A ∧ B) ∨ (¬A ∧ ¬B)
    if (innerOp === 'Xor') {
      const innerOps = fnOps(inner)!;
      if (innerOps.length === 2) {
        const a = innerOps[0];
        const b = innerOps[1];
        return toNNF(
          ce._fn('Or', [
            ce._fn('And', [a, b]),
            ce._fn('And', [ce._fn('Not', [a]), ce._fn('Not', [b])]),
          ]),
          ce
        );
      }
      // For n-ary Xor negation, first convert Xor to binary, then negate
      return toNNF(ce._fn('Not', [toNNF(inner, ce)]), ce);
    }

    // Negation of Nand: ¬NAND(A, B) ≡ A ∧ B
    if (innerOp === 'Nand') {
      return toNNF(ce._fn('And', fnOps(inner)!), ce);
    }

    // Negation of Nor: ¬NOR(A, B) ≡ A ∨ B
    if (innerOp === 'Nor') {
      return toNNF(ce._fn('Or', fnOps(inner)!), ce);
    }

    // Literal: ¬x stays as is
    return expr;
  }

  // Handle Implies: A → B ≡ ¬A ∨ B
  if (op === 'Implies') {
    const a = fnOp1(expr)!;
    const b = fnOp2(expr)!;
    return toNNF(ce._fn('Or', [ce._fn('Not', [a]), b]), ce);
  }

  // Handle Equivalent: A ↔ B ≡ (A → B) ∧ (B → A) ≡ (¬A ∨ B) ∧ (¬B ∨ A)
  if (op === 'Equivalent') {
    const a = fnOp1(expr)!;
    const b = fnOp2(expr)!;
    return toNNF(
      ce._fn('And', [
        ce._fn('Or', [ce._fn('Not', [a]), b]),
        ce._fn('Or', [ce._fn('Not', [b]), a]),
      ]),
      ce
    );
  }

  // Handle Xor: A ⊕ B ≡ (A ∨ B) ∧ (¬A ∨ ¬B)
  // For n-ary Xor, we process pairwise
  if (op === 'Xor') {
    const exprOps = fnOps(expr)!;
    if (exprOps.length === 2) {
      const a = exprOps[0];
      const b = exprOps[1];
      return toNNF(
        ce._fn('And', [
          ce._fn('Or', [a, b]),
          ce._fn('Or', [ce._fn('Not', [a]), ce._fn('Not', [b])]),
        ]),
        ce
      );
    }
    // For n-ary Xor, reduce: Xor(a, b, c) = Xor(Xor(a, b), c)
    if (exprOps.length > 2) {
      const first = ce._fn('Xor', [exprOps[0], exprOps[1]]);
      const rest = exprOps.slice(2);
      return toNNF(ce._fn('Xor', [first, ...rest]), ce);
    }
    if (exprOps.length === 1) return toNNF(exprOps[0], ce);
    return ce.False; // Empty Xor
  }

  // Handle Nand: NAND(A, B) ≡ ¬(A ∧ B) ≡ ¬A ∨ ¬B
  if (op === 'Nand') {
    const exprOps = fnOps(expr)!;
    // NAND(a, b, c, ...) = NOT(AND(a, b, c, ...))
    return toNNF(ce._fn('Not', [ce._fn('And', exprOps)]), ce);
  }

  // Handle Nor: NOR(A, B) ≡ ¬(A ∨ B) ≡ ¬A ∧ ¬B
  if (op === 'Nor') {
    const exprOps = fnOps(expr)!;
    // NOR(a, b, c, ...) = NOT(OR(a, b, c, ...))
    return toNNF(ce._fn('Not', [ce._fn('Or', exprOps)]), ce);
  }

  // Recursively process And/Or
  if (op === 'And' || op === 'Or') {
    const nnfOps = fnOps(expr)!.map((x) => toNNF(x, ce));
    return ce._fn(op, nnfOps);
  }

  return expr;
}

/**
 * Distribute Or over And to get CNF.
 * (A ∧ B) ∨ C → (A ∨ C) ∧ (B ∨ C)
 */
function distributeOrOverAnd(
  expr: Expression,
  ce: ComputeEngine
): Expression {
  const op = expr.operator;

  if (op !== 'Or') {
    if (op === 'And') {
      return ce._fn(
        'And',
        fnOps(expr)!.map((x) => distributeOrOverAnd(x, ce))
      );
    }
    return expr;
  }

  // Collect all operands, flattening nested Ors
  const orOperands: Expression[] = [];
  for (const operand of fnOps(expr)!) {
    if (operand.operator === 'Or') {
      orOperands.push(...fnOps(operand)!);
    } else {
      orOperands.push(operand);
    }
  }

  // Find an And operand to distribute over
  const andIndex = orOperands.findIndex((x) => x.operator === 'And');
  if (andIndex === -1) {
    // No And to distribute, we're done
    return expr;
  }

  const andExpr = orOperands[andIndex];
  const otherOperands = [
    ...orOperands.slice(0, andIndex),
    ...orOperands.slice(andIndex + 1),
  ];
  const otherOr =
    otherOperands.length === 1 ? otherOperands[0] : ce._fn('Or', otherOperands);

  // Distribute: (A ∧ B) ∨ C → (A ∨ C) ∧ (B ∨ C)
  const distributed = ce._fn(
    'And',
    fnOps(andExpr)!.map((x) => ce._fn('Or', [x, otherOr]))
  );

  // Recursively distribute
  return distributeOrOverAnd(distributed, ce);
}

/**
 * Convert a boolean expression to Conjunctive Normal Form (CNF).
 */
export function toCNF(
  expr: Expression,
  ce: ComputeEngine
): Expression {
  // First convert to NNF
  const nnf = toNNF(expr, ce);

  // Then distribute Or over And
  const cnf = distributeOrOverAnd(nnf, ce);

  // Simplify the result
  return cnf.simplify();
}

/**
 * Distribute And over Or to get DNF.
 * (A ∨ B) ∧ C → (A ∧ C) ∨ (B ∧ C)
 */
function distributeAndOverOr(
  expr: Expression,
  ce: ComputeEngine
): Expression {
  const op = expr.operator;

  if (op !== 'And') {
    if (op === 'Or') {
      return ce._fn(
        'Or',
        fnOps(expr)!.map((x) => distributeAndOverOr(x, ce))
      );
    }
    return expr;
  }

  // Collect all operands, flattening nested Ands
  const andOperands: Expression[] = [];
  for (const operand of fnOps(expr)!) {
    if (operand.operator === 'And') {
      andOperands.push(...fnOps(operand)!);
    } else {
      andOperands.push(operand);
    }
  }

  // Find an Or operand to distribute over
  const orIndex = andOperands.findIndex((x) => x.operator === 'Or');
  if (orIndex === -1) {
    // No Or to distribute, we're done
    return expr;
  }

  const orExpr = andOperands[orIndex];
  const otherOperands = [
    ...andOperands.slice(0, orIndex),
    ...andOperands.slice(orIndex + 1),
  ];
  const otherAnd =
    otherOperands.length === 1
      ? otherOperands[0]
      : ce._fn('And', otherOperands);

  // Distribute: (A ∨ B) ∧ C → (A ∧ C) ∨ (B ∧ C)
  const distributed = ce._fn(
    'Or',
    fnOps(orExpr)!.map((x) => ce._fn('And', [x, otherAnd]))
  );

  // Recursively distribute
  return distributeAndOverOr(distributed, ce);
}

/**
 * Convert a boolean expression to Disjunctive Normal Form (DNF).
 */
export function toDNF(
  expr: Expression,
  ce: ComputeEngine
): Expression {
  // First convert to NNF
  const nnf = toNNF(expr, ce);

  // Then distribute And over Or
  const dnf = distributeAndOverOr(nnf, ce);

  // Simplify the result
  return dnf.simplify();
}

/**
 * Extract all propositional variables from a boolean expression.
 * Returns a sorted array of unique variable names.
 */
export function extractVariables(expr: Expression): string[] {
  const variables = new Set<string>();

  function visit(e: Expression) {
    // Skip True/False constants
    if (sym(e) === 'True' || sym(e) === 'False') return;

    // If it's a symbol (variable), add it
    if (isSymbol(e) && e.operator === 'Symbol') {
      variables.add(e.symbol);
      return;
    }

    // Recursively process operands
    if (isFunction(e)) {
      for (const op of e.ops) {
        visit(op);
      }
    }
  }

  visit(expr);
  return Array.from(variables).sort();
}

/**
 * Evaluate a boolean expression with a given truth assignment.
 * Returns True, False, or undefined if the expression cannot be evaluated.
 */
export function evaluateWithAssignment(
  expr: Expression,
  assignment: Record<string, boolean>,
  ce: ComputeEngine
): Expression {
  // Build substitution map
  const subs: Record<string, Expression> = {};
  for (const [variable, value] of Object.entries(assignment)) {
    subs[variable] = value ? ce.True : ce.False;
  }

  // Substitute and evaluate
  const substituted = expr.subs(subs).canonical;
  return substituted.evaluate();
}

/**
 * Generate all possible truth assignments for a list of variables.
 * Each assignment is a Record mapping variable names to boolean values.
 */
export function* generateAssignments(
  variables: string[]
): Generator<Record<string, boolean>> {
  const n = variables.length;
  const total = 1 << n; // 2^n combinations

  for (let i = 0; i < total; i++) {
    const assignment: Record<string, boolean> = {};
    for (let j = 0; j < n; j++) {
      // Use bit j of i to determine the value
      assignment[variables[j]] = ((i >> (n - 1 - j)) & 1) === 1;
    }
    yield assignment;
  }
}
