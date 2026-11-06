/**
 * The assignment locals of each block scope: the names of the `Assign`
 * statements of a `Block` that no enclosing scope declared when the block
 * was canonicalized (`canonicalBlock()`, `library/control-structures.ts`).
 * Such an `Assign` is the declaration of the local: the first assignment of
 * a name at the block's own level.
 *
 * Whether such a name is a local of the block is decided at
 * canonicalization and never changes after. The repair of a definition
 * (`repairWave()`, `function-utils.ts`) builds a function literal again from
 * its raw operands, and keeps the decision (`withKeptAssignmentLocals()`).
 * Each run of the block gives the name a new binding
 * (`declareAssignmentLocals()`, `function-utils.ts`), and the effect inference
 * counts a write to it as confined (`withBlockLocals()`,
 * `boxed-expression/effects-inference.ts`).
 *
 * The record is kept here, apart from the scope bindings, because a run of
 * the block removes the bindings that the canonicalization made
 * (`sweepCanonicalizationBindings()` in `library/control-structures.ts`,
 * `hideBodyScopeParams()` in `function-utils.ts`). This module imports
 * nothing, so that both the evaluation and the inference can read it.
 *
 * The module also holds the position of the statement that is canonicalized
 * now (`enterBranch()`, `enterFunctionBody()`): a first assignment of a name
 * is a declaration only at the own level of a block, or at the top level,
 * when it is not in a branch of a conditional or in the body of a loop.
 */

const ASSIGNMENT_LOCALS = new WeakMap<object, readonly string[]>();

/**
 * The number of branches and loop bodies that are canonicalized now inside
 * the innermost function body (or inside the top level when no function
 * body is canonicalized). A function body starts a new count of branches: a
 * block of a function literal written in a branch declares its own locals.
 *
 * Canonicalization is synchronous, so a count shared by all the engines is
 * sufficient: no other canonicalization can start between the start and the
 * end of the canonicalization of a branch.
 */
let branchDepth = 0;
const savedBranchDepths: number[] = [];

/**
 * Call when the canonicalization of the body of a function literal starts
 * (`canonicalFunctionLiteralArguments()`, `function-utils.ts`), and call
 * `exitFunctionBody()` when it ends, also when it throws. The body is not
 * in a branch, also when the literal is written in one. The term of a
 * `Comprehension` and the body of a `Sum` or a `Product` use the same pair
 * of calls: they are evaluated once for each element, and a block there
 * declares its own locals.
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
 * Call when the canonicalization of a branch of an `If` or a `Which`, or of
 * the body of a loop, starts, and call `exitBranch()` when it ends, also
 * when it throws. A branch at the top level (an `If` that the host boxes
 * alone, a statement of an Epsil program) is counted as a branch in a
 * block is: an assignment there to a name that no scope declares is a first
 * assignment, and a static error. An assignment to a name that the engine
 * declares (`ce.declare()`, an earlier top-level assignment) writes that
 * symbol.
 */
export function enterBranch(): void {
  branchDepth += 1;
}

/** See `enterBranch()`. Call it only after a call of `enterBranch()`. */
export function exitBranch(): void {
  if (branchDepth > 0) branchDepth -= 1;
}

/**
 * True while a statement of a branch or of a loop body is canonicalized
 * (`enterBranch()`). A first assignment of a name there is a static error:
 * the name must be declared with a value before the branch.
 */
export function isInBranch(): boolean {
  return branchDepth > 0;
}

/**
 * The bindings that the engine declared for a free symbol of the body of a
 * function literal, in the scope that the literal is written in, when a use
 * of the symbol in the body narrowed its type (`_inferOnOuterBinding()`,
 * `boxed-expression/boxed-symbol.ts`). The program did not declare them.
 */
const FREE_SYMBOL_DECLARATIONS = new WeakSet<object>();

/** Record that the engine declared `def` for a free symbol of a body. */
export function markFreeSymbolDeclaration(def: object): void {
  FREE_SYMBOL_DECLARATIONS.add(def);
}

/**
 * True when `def` is the binding of a free symbol that the engine declared
 * (`markFreeSymbolDeclaration()`) and `hasValue` is false (no assignment
 * gave it a value), while the body of a function literal is canonicalized
 * (`enterFunctionBody()`).
 *
 * Such a binding is not a declaration for an assignment in the body. The
 * engine makes it when a use of the free symbol narrows its type, and then
 * boxes the whole expression again. Without this rule, in
 * `x ↦ { { t ≔ 2; t }; t + x }` the second boxing found the binding of `t`,
 * and the first assignment of `t` in the nested block wrote the outer `t`,
 * which is not a local of the block.
 */
export function isFreeSymbolDeclarationInBody(
  def: object,
  hasValue: boolean
): boolean {
  return (
    !hasValue &&
    savedBranchDepths.length > 0 &&
    FREE_SYMBOL_DECLARATIONS.has(def)
  );
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
 * Record the assignment locals of the block scope `scope`, when the block is
 * canonicalized for the first time.
 *
 * A block that is built again with the same scope (`subs()`,
 * `rewriteWithBinders()` in `boxed-expression/binders.ts`, the simplifier)
 * is canonicalized again, and `canonicalBlock()` then finds the names that
 * the scope already binds, and does not count them. A second record for the
 * same scope is ignored, so that such a name stays a local, and the block
 * does not write a binding of the same name outside it. The record is kept
 * also when it has no name, so that a name that a later canonicalization
 * finds is not made a local either.
 *
 * The map holds its keys weakly: a record goes away with its scope, and the
 * record of a scope of one engine is never read for another engine.
 */
export function recordAssignmentLocals(
  scope: object,
  names: readonly string[]
): void {
  if (!ASSIGNMENT_LOCALS.has(scope)) ASSIGNMENT_LOCALS.set(scope, names);
}

/** The assignment locals of the block scope `scope`, or `undefined` when
 * no block with this scope was canonicalized. */
export function assignmentLocalsOf(
  scope: object
): readonly string[] | undefined {
  return ASSIGNMENT_LOCALS.get(scope);
}

/** The assignment locals that the rebuild of a function literal keeps, and
 * the scope that the literal is written in. See
 * {@link withKeptAssignmentLocals}. Canonicalization is synchronous, so one
 * value shared by all the engines is sufficient. */
let keptAssignmentLocals:
  | { names: ReadonlySet<string>; scope: object }
  | undefined;

/**
 * Run `fn`, which builds a function literal again from its raw operands in
 * `scope`, the scope that the literal is written in. `names` are the names
 * that the blocks of the literal made assignment locals when it was first
 * canonicalized.
 *
 * A binding of such a name that `scope` or an enclosing scope holds now was
 * made after the literal was written, and does not make the name an outer
 * variable of the literal. With `h = n ↦ { g := z ↦ 0; z ↦ g(z) + n }`
 * followed by a global `g := t ↦ 9`, `g` stays a local of `h`, and `h` does
 * not write the global.
 *
 * A binding in a scope inside the literal still counts: in
 * `n ↦ { a := 1; m ↦ { a := 2 } }` the second assignment writes the local of
 * the outer block, as it did the first time.
 */
export function withKeptAssignmentLocals<T>(
  names: ReadonlySet<string> | undefined,
  scope: object | undefined,
  fn: () => T
): T {
  const saved = keptAssignmentLocals;
  keptAssignmentLocals =
    names !== undefined && scope !== undefined ? { names, scope } : undefined;
  try {
    return fn();
  } finally {
    keptAssignmentLocals = saved;
  }
}

/**
 * The scope where the search for a declaration of `name` stops, when
 * {@link withKeptAssignmentLocals} keeps `name` as an assignment local, or
 * `undefined` when the search goes through the whole scope chain.
 */
export function keptAssignmentLocalBoundary(name: string): object | undefined {
  return keptAssignmentLocals?.names.has(name)
    ? keptAssignmentLocals.scope
    : undefined;
}

const LATER_DECLARATION_LOCALS = new WeakMap<object, readonly string[]>();

/**
 * Record the assignment locals of the block scope `scope` that a binding of
 * an enclosing block would have taken, if a later statement of that block
 * had not declared it. Such an enclosing block is the top-level block of a
 * program: it declares all its names before it canonicalizes its
 * statements, but a function body does not see a name that a later
 * top-level statement declares (`canonicalBlock()` in
 * `library/control-structures.ts`). In
 * `function g(k) { t = k + 1; t }; let t = 0`, `t` is such a local of the
 * body of `g`. The record also holds a local of a function literal that is
 * built again, when an enclosing scope made a binding of the name after the
 * literal was written ({@link withKeptAssignmentLocals}).
 *
 * The compiler reads the record (`withImplicitLocalDeclares()` in
 * `compilation/base-compiler.ts`): it declares such a name as a local of the
 * compiled function, although the compiled program also declares it. As
 * with {@link recordAssignmentLocals}, the first record for a scope is kept.
 */
export function recordLaterDeclarationLocals(
  scope: object,
  names: readonly string[]
): void {
  if (!LATER_DECLARATION_LOCALS.has(scope))
    LATER_DECLARATION_LOCALS.set(scope, names);
}

/** The names that {@link recordLaterDeclarationLocals} recorded for the
 * block scope `scope`, or `undefined`. */
export function laterDeclarationLocalsOf(
  scope: object
): readonly string[] | undefined {
  return LATER_DECLARATION_LOCALS.get(scope);
}

/**
 * Give the block scope `to` the records of the block scope `from`: its
 * assignment locals and its locals of
 * {@link recordLaterDeclarationLocals}. A record that `to` has already is
 * kept.
 *
 * Call it when a block is rebuilt on a new scope without a new
 * canonicalization: a closure re-rooted on the scopes it captures
 * (`captureClosures()`, `function-utils.ts`). Without the record, a run of
 * the rebuilt block does not give its assignment locals a new binding, and
 * the effect inference counts a write to one as a write outside the
 * function.
 *
 * With `rename`, each name of the records that is a key of `rename` is
 * replaced in the copy by its value: the block is rebuilt with its locals
 * renamed (`renameBoundVariables()`, `function-utils.ts`). The records of
 * `from` are not changed.
 */
export function copyAssignmentLocals(
  from: object,
  to: object,
  rename?: ReadonlyMap<string, string>
): void {
  const renamed = (names: readonly string[]): readonly string[] =>
    rename === undefined ? names : names.map((n) => rename.get(n) ?? n);
  const record = ASSIGNMENT_LOCALS.get(from);
  if (record !== undefined && !ASSIGNMENT_LOCALS.has(to))
    ASSIGNMENT_LOCALS.set(to, renamed(record));
  const later = LATER_DECLARATION_LOCALS.get(from);
  if (later !== undefined && !LATER_DECLARATION_LOCALS.has(to))
    LATER_DECLARATION_LOCALS.set(to, renamed(later));
}
