import type { BoxedExpression, ComputeEngine } from '../global-types';
import { asSmallInteger } from '../boxed-expression/numerics';

/**
 * Basic evaluation functions for logical operators.
 * Extracted from logic.ts for better code organization.
 */

/**
 * Check if an And expression is a contradiction (contains A and Not(A)).
 * Non-recursive to avoid infinite loops.
 */
function isContradiction(args: ReadonlyArray<BoxedExpression>): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (let j = i + 1; j < args.length; j++) {
      const other = args[j];
      if (
        (arg.operator === 'Not' && arg.op1.isSame(other)) ||
        (other.operator === 'Not' && other.op1.isSame(arg))
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
function isTautologyCheck(args: ReadonlyArray<BoxedExpression>): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (let j = i + 1; j < args.length; j++) {
      const other = args[j];
      if (
        (arg.operator === 'Not' && arg.op1.isSame(other)) ||
        (other.operator === 'Not' && other.op1.isSame(arg))
      ) {
        return true;
      }
    }
  }
  return false;
}

export function evaluateAnd(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length === 0) return ce.True;
  const ops: BoxedExpression[] = [];
  for (let arg of args) {
    // Check if an Or operand is a tautology (contains A and Not(A))
    // For example: Or(A, Not(A)) -> True, and And(..., True, ...) simplifies
    if (arg.operator === 'Or' && isTautologyCheck(arg.ops!)) {
      arg = ce.True;
    }

    // ['And', ... , 'False', ...] -> 'False'
    if (arg.symbol === 'False') return ce.False;
    if (arg.symbol !== 'True') {
      //Check if arg matches one of the tail elements
      let duplicate = false;
      for (const x of ops) {
        if (x.isSame(arg)) {
          // ['And', a, ..., a]
          // Duplicate element, ignore it
          duplicate = true;
        } else if (
          (arg.operator === 'Not' && arg.op1.isSame(x)) ||
          (x.operator === 'Not' && x.op1.isSame(arg))
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
  return ce._fn('And', ops);
}

export function evaluateOr(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length === 0) return ce.True;
  const ops: BoxedExpression[] = [];
  for (let arg of args) {
    // Check if an And operand is a contradiction (contains A and Not(A))
    // For example: And(A, Not(A)) -> False, and Or(..., False, ...) is removed
    if (arg.operator === 'And' && isContradiction(arg.ops!)) {
      arg = ce.False;
    }

    // ['Or', ... , 'True', ...] -> 'True'
    if (arg.symbol === 'True') return ce.True;
    if (arg.symbol !== 'False') {
      //Check if arg matches one of the tail elements
      let duplicate = false;
      for (const x of ops) {
        if (x.isSame(arg)) {
          // ['Or', a, ..., a]
          // Duplicate element, ignore it
          duplicate = true;
        } else if (
          (arg.operator === 'Not' && arg.op1.isSame(x)) ||
          (x.operator === 'Not' && x.op1.isSame(arg))
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
  return ce._fn('Or', ops);
}

export function evaluateNot(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  const op1 = args[0]?.symbol;
  if (op1 === 'True') return ce.False;
  if (op1 === 'False') return ce.True;
  return undefined;
}

export function evaluateEquivalent(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  const lhs = args[0].symbol;
  const rhs = args[1].symbol;
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
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  const lhs = args[0].symbol;
  const rhs = args[1].symbol;
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
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // N-ary XOR is true when an odd number of operands are true
  // (equivalent to parity check)
  if (args.length === 0) return ce.False;

  let trueCount = 0;
  const unknowns: BoxedExpression[] = [];

  for (const arg of args) {
    if (arg.symbol === 'True') {
      trueCount++;
    } else if (arg.symbol === 'False') {
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
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // N-ary NAND is the negation of AND
  // NAND(a, b, c, ...) = NOT(AND(a, b, c, ...))
  if (args.length === 0) return ce.False; // NOT(True) = False

  // If any argument is False, AND is False, so NAND is True
  for (const arg of args) {
    if (arg.symbol === 'False') return ce.True;
  }

  // Check if all are True
  let allTrue = true;
  for (const arg of args) {
    if (arg.symbol !== 'True') {
      allTrue = false;
      break;
    }
  }

  if (allTrue) return ce.False; // NOT(True) = False

  return undefined;
}

export function evaluateNor(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // N-ary NOR is the negation of OR
  // NOR(a, b, c, ...) = NOT(OR(a, b, c, ...))
  if (args.length === 0) return ce.True; // NOT(False) = True

  // If any argument is True, OR is True, so NOR is False
  for (const arg of args) {
    if (arg.symbol === 'True') return ce.False;
  }

  // Check if all are False
  let allFalse = true;
  for (const arg of args) {
    if (arg.symbol !== 'False') {
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
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const op = expr.operator;

  // Base cases
  if (!op) return expr;
  if (expr.symbol === 'True' || expr.symbol === 'False') return expr;

  // Handle Not
  if (op === 'Not') {
    const inner = expr.op1;
    if (!inner) return expr;

    const innerOp = inner.operator;

    // Double negation: ¬¬A → A
    if (innerOp === 'Not') {
      return toNNF(inner.op1, ce);
    }

    // De Morgan's law: ¬(A ∧ B) → (¬A ∨ ¬B)
    if (innerOp === 'And') {
      const negatedOps = inner.ops!.map((x) => toNNF(ce._fn('Not', [x]), ce));
      return ce._fn('Or', negatedOps);
    }

    // De Morgan's law: ¬(A ∨ B) → (¬A ∧ ¬B)
    if (innerOp === 'Or') {
      const negatedOps = inner.ops!.map((x) => toNNF(ce._fn('Not', [x]), ce));
      return ce._fn('And', negatedOps);
    }

    // ¬True → False, ¬False → True
    if (inner.symbol === 'True') return ce.False;
    if (inner.symbol === 'False') return ce.True;

    // Negation of implication: ¬(A → B) → (A ∧ ¬B)
    if (innerOp === 'Implies') {
      const a = inner.op1;
      const b = inner.op2;
      return toNNF(ce._fn('And', [a, ce._fn('Not', [b])]), ce);
    }

    // Negation of equivalence: ¬(A ↔ B) → (A ∧ ¬B) ∨ (¬A ∧ B)
    if (innerOp === 'Equivalent') {
      const a = inner.op1;
      const b = inner.op2;
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
      const ops = inner.ops!;
      if (ops.length === 2) {
        const a = ops[0];
        const b = ops[1];
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
      return toNNF(ce._fn('And', inner.ops!), ce);
    }

    // Negation of Nor: ¬NOR(A, B) ≡ A ∨ B
    if (innerOp === 'Nor') {
      return toNNF(ce._fn('Or', inner.ops!), ce);
    }

    // Literal: ¬x stays as is
    return expr;
  }

  // Handle Implies: A → B ≡ ¬A ∨ B
  if (op === 'Implies') {
    const a = expr.op1;
    const b = expr.op2;
    return toNNF(ce._fn('Or', [ce._fn('Not', [a]), b]), ce);
  }

  // Handle Equivalent: A ↔ B ≡ (A → B) ∧ (B → A) ≡ (¬A ∨ B) ∧ (¬B ∨ A)
  if (op === 'Equivalent') {
    const a = expr.op1;
    const b = expr.op2;
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
    const ops = expr.ops!;
    if (ops.length === 2) {
      const a = ops[0];
      const b = ops[1];
      return toNNF(
        ce._fn('And', [
          ce._fn('Or', [a, b]),
          ce._fn('Or', [ce._fn('Not', [a]), ce._fn('Not', [b])]),
        ]),
        ce
      );
    }
    // For n-ary Xor, reduce: Xor(a, b, c) = Xor(Xor(a, b), c)
    if (ops.length > 2) {
      const first = ce._fn('Xor', [ops[0], ops[1]]);
      const rest = ops.slice(2);
      return toNNF(ce._fn('Xor', [first, ...rest]), ce);
    }
    if (ops.length === 1) return toNNF(ops[0], ce);
    return ce.False; // Empty Xor
  }

  // Handle Nand: NAND(A, B) ≡ ¬(A ∧ B) ≡ ¬A ∨ ¬B
  if (op === 'Nand') {
    const ops = expr.ops!;
    // NAND(a, b, c, ...) = NOT(AND(a, b, c, ...))
    return toNNF(ce._fn('Not', [ce._fn('And', ops)]), ce);
  }

  // Handle Nor: NOR(A, B) ≡ ¬(A ∨ B) ≡ ¬A ∧ ¬B
  if (op === 'Nor') {
    const ops = expr.ops!;
    // NOR(a, b, c, ...) = NOT(OR(a, b, c, ...))
    return toNNF(ce._fn('Not', [ce._fn('Or', ops)]), ce);
  }

  // Recursively process And/Or
  if (op === 'And' || op === 'Or') {
    const nnfOps = expr.ops!.map((x) => toNNF(x, ce));
    return ce._fn(op, nnfOps);
  }

  return expr;
}

/**
 * Distribute Or over And to get CNF.
 * (A ∧ B) ∨ C → (A ∨ C) ∧ (B ∨ C)
 */
function distributeOrOverAnd(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const op = expr.operator;

  if (op !== 'Or') {
    if (op === 'And') {
      return ce._fn(
        'And',
        expr.ops!.map((x) => distributeOrOverAnd(x, ce))
      );
    }
    return expr;
  }

  // Collect all operands, flattening nested Ors
  const orOperands: BoxedExpression[] = [];
  for (const operand of expr.ops!) {
    if (operand.operator === 'Or') {
      orOperands.push(...operand.ops!);
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
    andExpr.ops!.map((x) => ce._fn('Or', [x, otherOr]))
  );

  // Recursively distribute
  return distributeOrOverAnd(distributed, ce);
}

/**
 * Convert a boolean expression to Conjunctive Normal Form (CNF).
 */
export function toCNF(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
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
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const op = expr.operator;

  if (op !== 'And') {
    if (op === 'Or') {
      return ce._fn(
        'Or',
        expr.ops!.map((x) => distributeAndOverOr(x, ce))
      );
    }
    return expr;
  }

  // Collect all operands, flattening nested Ands
  const andOperands: BoxedExpression[] = [];
  for (const operand of expr.ops!) {
    if (operand.operator === 'And') {
      andOperands.push(...operand.ops!);
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
    orExpr.ops!.map((x) => ce._fn('And', [x, otherAnd]))
  );

  // Recursively distribute
  return distributeAndOverOr(distributed, ce);
}

/**
 * Convert a boolean expression to Disjunctive Normal Form (DNF).
 */
export function toDNF(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
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
export function extractVariables(expr: BoxedExpression): string[] {
  const variables = new Set<string>();

  function visit(e: BoxedExpression) {
    // Skip True/False constants
    if (e.symbol === 'True' || e.symbol === 'False') return;

    // If it's a symbol (variable), add it
    // Note: BoxedSymbol has operator === 'Symbol'
    if (e.symbol && e.operator === 'Symbol') {
      variables.add(e.symbol);
      return;
    }

    // Recursively process operands
    if (e.ops) {
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
  expr: BoxedExpression,
  assignment: Record<string, boolean>,
  ce: ComputeEngine
): BoxedExpression {
  // Build substitution map
  const subs: Record<string, BoxedExpression> = {};
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
