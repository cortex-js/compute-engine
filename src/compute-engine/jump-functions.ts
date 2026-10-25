import type { IComputeEngine, Expression } from './global-types.js';
import { isFunction, isSymbol } from './boxed-expression/type-guards.js';

/**
 * The functions whose result jumps at a point, so that the float of an
 * exact operand can be on the other side of the jump: `Floor(x)` at the
 * exact `x = 1 − 10⁻³⁰` is `0`, but the float of `x` is `1`, and so is its
 * floor. `.N()` promises a correct result (ARCHITECTURE.md, "What `.N()`
 * promises"), so such a function uses the exact value of an exact operand
 * (`exactRoundingOperand` in `library/arithmetic.ts`, `exactPairAtNearTie`
 * in `library/relational-operator.ts`). `Remainder` jumps where `x/m` is
 * half an odd integer, and `Chop` where `|x|` is the tolerance.
 *
 * The auto-compilation of a `Map` reads this set: a body that applies one
 * of these computes an element with an exact input by the interpreter
 * (`hasJumpFunction` in `library/map-auto-compile.ts`). The interpreter
 * itself does not: a user function records the written arguments behind
 * its parameters (`exactArgumentSources` in `function-utils.ts`), and the
 * handler of the jump re-reads one exactly when the float is near the jump
 * (`exactRealValueOf` in `boxed-expression/constraint-subject.ts`).
 *
 * `IsPrime` is in the set for a related reason. The interpreter computes it
 * on the exact integer, but its compiled code reads a double and throws a
 * `RangeError` when that double is beyond the safe integers (`2^61 − 1` is
 * computed as the double `2^61`). In the set, a `Map` body that applies it
 * computes an exact input by the interpreter, unless a proof shows that
 * every intermediate integer is in the safe range.
 */
export const JUMP_FUNCTIONS: ReadonlySet<string> = new Set([
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Fract',
  'Mod',
  'Remainder',
  'Chop',
  'Sign',
  'Heaviside',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'IsPrime',
]);

/**
 * True when `e` applies a function of `JUMP_FUNCTIONS`, directly or
 * through the user functions it calls.
 *
 * `e` is a function literal, its body, or the value a symbol holds. A bare
 * symbol is a function used as a value (`g := Floor`), and applies a jump
 * function when it names one. An application applies one when its head
 * names one, when an operand does, or when its head is a symbol whose
 * definition is built from a literal that does: an operator definition
 * from a one-step definition (`f(x) := Floor(x)`, `_lambdaLiteral`) or a
 * value definition holding a literal or a bare function (`f := x ↦
 * Floor(x)`, `g := Floor`). `Apply(h, x)` reads `h` the same way. A head
 * with no literal (a library operator, a host function) applies one only
 * when its name is in the set. Each literal is visited once, so a recursive
 * definition ends.
 */
export function appliesJumpFunction(
  ce: IComputeEngine,
  e: Expression,
  visited: Set<Expression> = new Set()
): boolean {
  if (isSymbol(e)) return JUMP_FUNCTIONS.has(e.symbol);
  // An iterative walk over the nodes, each visited once: a body whose
  // operands share a node (a DAG) is read once per node, not once per
  // path. A store-backed list holds numbers only, and reading its `ops`
  // would box them, so it is not entered.
  const pending: Expression[] = [e];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (!isFunction(node) || visited.has(node)) continue;
    visited.add(node);
    if (JUMP_FUNCTIONS.has(node.operator)) return true;
    if ((node as { _numericStore?: unknown })._numericStore !== undefined)
      continue;
    for (const op of node.ops) {
      if (isSymbol(op)) {
        if (JUMP_FUNCTIONS.has(op.symbol)) return true;
      } else pending.push(op);
    }
    const head =
      node.operator === 'Apply' && isSymbol(node.op1)
        ? node.op1.symbol
        : node.operator;
    const callee = calleeValue(ce, head);
    if (callee === undefined) continue;
    if (isSymbol(callee)) {
      if (JUMP_FUNCTIONS.has(callee.symbol)) return true;
    } else pending.push(callee);
  }
  return false;
}

/** The literal, or the value, that the definition of `name` applies: the
 * literal of an operator definition built from one, or the value of a value
 * definition. `undefined` for a definition with neither. */
function calleeValue(ce: IComputeEngine, name: string): Expression | undefined {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return undefined;
  if ('operator' in def)
    return (def.operator as { _lambdaLiteral?: Expression })._lambdaLiteral;
  return ce._getSymbolValue(name);
}
