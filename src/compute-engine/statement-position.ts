import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from './global-types.js';
import { isSymbol } from './boxed-expression/type-guards.js';

// The canonical forms of a statement operand, and the position of the
// statement that is canonicalized now. A statement operand is an operand
// that the operator's definition declares with the `statement` role (the
// `operands` handler): a statement of a `Block`, a branch of an `If`, the
// body of a `Loop`. This module imports only the type guards, so that the
// boxing code (`box.ts`), which canonicalizes the statement operands of an
// operator without a `canonical` handler, the handlers of the control
// structures and the symbol code can all import it.

/**
 * The number of branches and loop bodies that are canonicalized now inside
 * the innermost function body (or inside the top level when no function
 * body is canonicalized). A function body starts a new count of branches.
 *
 * Canonicalization is synchronous, so a count shared by all the engines is
 * sufficient: no other canonicalization can start between the start and the
 * end of the canonicalization of a branch.
 */
let branchDepth = 0;
const savedBranchDepths: number[] = [];

/**
 * The number of blocks and function literal bodies whose statements are
 * canonicalized now (`enterBody()`). An assignment there writes a variable
 * that a scope declares, and never declares one.
 */
let bodyDepth = 0;
const bodyBranchDepths: number[] = [];

/**
 * Call when the canonicalization of the body of a function literal starts
 * (`canonicalFunctionLiteralArguments()`, `function-utils.ts`), and call
 * `exitFunctionBody()` when it ends, also when it throws. The body is not
 * in a branch, also when the literal is written in one. The term of a
 * `Comprehension` and the body of a `Sum` or a `Product` use the same pair
 * of calls: they are evaluated once for each element.
 */
export function enterFunctionBody(): void {
  savedBranchDepths.push(branchDepth);
  branchDepth = 0;
}

/** See `enterFunctionBody()`. */
export function exitFunctionBody(): void {
  branchDepth = savedBranchDepths.pop() ?? 0;
}

/**
 * Call when the canonicalization of the statements of a block starts, and
 * call `exitBody()` when it ends, also when it throws. A statement of the
 * block is not in a branch, also when the block is in one.
 */
export function enterBody(): void {
  bodyDepth += 1;
  bodyBranchDepths.push(branchDepth);
  branchDepth = 0;
}

/** See `enterBody()`. Call it only after a call of `enterBody()`. */
export function exitBody(): void {
  if (bodyDepth > 0) bodyDepth -= 1;
  branchDepth = bodyBranchDepths.pop() ?? 0;
}

/**
 * Call when the canonicalization of a branch of an `If` or a `Which`, or of
 * the body of a loop, starts, and call `exitBranch()` when it ends, also
 * when it throws. A branch at the top level (an `If` that the host boxes
 * alone, a statement of an Epsil program) is counted as a branch in a
 * block is.
 */
function enterBranch(): void {
  branchDepth += 1;
}

/** See `enterBranch()`. Call it only after a call of `enterBranch()`. */
function exitBranch(): void {
  if (branchDepth > 0) branchDepth -= 1;
}

/**
 * True while a branch of a conditional or the body of a loop is
 * canonicalized, in the innermost block or function body
 * (`enterBranch()`). A `Declare` there is the static error
 * `declaration-below-statement`: a local is declared by a statement of a
 * block or of a function body.
 */
export function isInBranch(): boolean {
  return branchDepth > 0;
}

/**
 * True while a statement of a block, of a branch or of a loop body is
 * canonicalized (`enterBody()`, `enterBranch()`), or the body of a function
 * literal (`enterFunctionBody()`). An
 * assignment there to a name that no scope declares is the static error
 * `assignment-to-undeclared-variable`: the name must be declared, with a
 * `Declare` statement of the block or of an enclosing scope.
 */
export function isInBodyOrBranch(): boolean {
  return bodyDepth > 0 || branchDepth > 0 || savedBranchDepths.length > 0;
}

/**
 * The names that a function definition statement (`DefineFunction`, the
 * Epsil `function f(…) { … }` or `f(x) = …`) defines in the statement list
 * of the `Declare` statement that is canonicalized now, or `undefined` when
 * no `Declare` statement is canonicalized as a direct statement of a list.
 */
let pairedFunctionNames: ReadonlySet<string> | undefined;

/**
 * Canonicalize the `Declare` statement of a statement list in `fn`, with
 * `names` the names that the function definition statements of the same
 * list define (`isPairedFunctionSignature()`).
 *
 * A `Declare` without a value is valid only when its type is a function
 * type and a function definition statement of the same name is in the same
 * statement list: the definition gives the name its value from the start of
 * the list, so the `Declare` only gives the signature of the function. The
 * pairing is by name within one list, never with a definition of an
 * enclosing list. Call this function only around the canonicalization of a
 * direct statement of the list: a `Declare` nested in another statement (a
 * branch) is in another list, and does not see the names.
 */
export function withPairedFunctionNames<T>(
  names: ReadonlySet<string>,
  fn: () => T
): T {
  const saved = pairedFunctionNames;
  pairedFunctionNames = names;
  try {
    return fn();
  } finally {
    pairedFunctionNames = saved;
  }
}

/**
 * Take the names of `withPairedFunctionNames()` for the `Declare` that is
 * canonicalized now, and clear them, so that a `Declare` canonicalized
 * inside its operands does not see them. Returns `undefined` when the
 * `Declare` is not a direct statement of a list.
 */
export function takePairedFunctionNames(): ReadonlySet<string> | undefined {
  const names = pairedFunctionNames;
  pairedFunctionNames = undefined;
  return names;
}

/**
 * The canonical form of `op`, a branch of an `If` or a `Which`, the body of
 * a loop, or another statement operand that the operator runs zero, one or
 * several times (`enterBranch()`). With `statement` false, `op` is a value
 * position (a value of a `Which`), where a bare `Break` is not refused.
 */
export function canonicalBranch(
  ce: ComputeEngine,
  op: Expression,
  statement = true
): Expression {
  enterBranch();
  try {
    return statement ? canonicalStatement(ce, op) : op.canonical;
  } finally {
    exitBranch();
  }
}

/**
 * Canonicalize an expression in **statement position** (a `Block` operand, an
 * `If` branch, or a `Loop` body). A bare *symbol* `Break`/`Continue` (as
 * opposed to the function forms `Break()`/`Continue()`) is almost certainly a
 * mistake: the control-flow dispatch in `evaluateStatements`/`runLoop` only
 * recognizes the function form, so a bare symbol would silently canonicalize
 * to an ordinary variable reference. Flag it as an error instead. Bare
 * `Return` is intentionally left alone.
 */
export function canonicalStatement(
  ce: ComputeEngine,
  op: Expression
): Expression {
  if (isSymbol(op) && (op.symbol === 'Break' || op.symbol === 'Continue'))
    return ce.error(
      `\`${op.symbol}\` must be written as a function: \`${op.symbol}()\``,
      op.symbol
    );
  return op.canonical;
}
