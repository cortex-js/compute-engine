/**
 * The assignment locals of each block scope: the names of the `Assign`
 * statements of a `Block` that no enclosing scope declared when the block
 * was canonicalized (`canonicalBlock()`, `library/control-structures.ts`).
 *
 * Whether such a name is a local of the block is decided at
 * canonicalization and never changes after. Each run of the block gives the
 * name a new binding (`declareAssignmentLocals()`, `function-utils.ts`), and
 * the effect inference counts a write to it as confined (`withBlockLocals()`,
 * `boxed-expression/effects-inference.ts`).
 *
 * The record also says whether the block is written in the body of a
 * function literal (`isFunctionBodyBlock()`). In such a block, a read of an
 * assignment local before the run has assigned it is the
 * `read-before-declaration` error, as for a `let` local. In a block outside
 * every function literal (a block that the host boxes, a `do` block or a
 * loop body of the top level of an Epsil program), the read stays the bare
 * symbol: `Block(x ≔ x + 1; 2x)` evaluates to `2(x + 1)`.
 *
 * The record is kept here, apart from the scope bindings, because a run of
 * the block removes the bindings that the canonicalization made
 * (`sweepCanonicalizationBindings()` in `library/control-structures.ts`,
 * `hideBodyScopeParams()` in `function-utils.ts`). This module imports
 * nothing, so that both the evaluation and the inference can read it.
 */

type AssignmentLocals = {
  readonly names: readonly string[];
  readonly inFunctionBody: boolean;
};

const ASSIGNMENT_LOCALS = new WeakMap<object, AssignmentLocals>();

/**
 * The number of function literal bodies that are being canonicalized now,
 * one inside the other (`enterFunctionBody()`). A block canonicalized while
 * it is more than zero is written in the body of a function literal.
 *
 * Canonicalization is synchronous, so a count shared by all the engines is
 * sufficient: no other canonicalization can start between the start and the
 * end of the canonicalization of a body.
 */
let functionBodyDepth = 0;

/**
 * Call when the canonicalization of the body of a function literal starts
 * (`canonicalFunctionLiteralArguments()`, `function-utils.ts`), and call
 * `exitFunctionBody()` when it ends, also when it throws.
 */
export function enterFunctionBody(): void {
  functionBodyDepth += 1;
}

/** See `enterFunctionBody()`. */
export function exitFunctionBody(): void {
  functionBodyDepth -= 1;
}

/**
 * True while the body of a function literal is canonicalized
 * (`enterFunctionBody()`). A block canonicalized then is the body itself or
 * a block nested in it. `canonicalBlock()` (`library/control-structures.ts`)
 * then makes each name that an assignment in a nested block of a statement
 * writes a local of the block, so that the body, which is canonicalized
 * first, owns it.
 */
export function isInFunctionBody(): boolean {
  return functionBodyDepth > 0;
}

/**
 * Record the assignment locals of the block scope `scope`, when the block is
 * canonicalized for the first time. The record also says whether the block
 * is canonicalized in the body of a function literal (`enterFunctionBody()`).
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
  if (!ASSIGNMENT_LOCALS.has(scope))
    ASSIGNMENT_LOCALS.set(scope, {
      names,
      inFunctionBody: functionBodyDepth > 0,
    });
}

/**
 * Record that the block with the scope `scope` is in the body of a function
 * literal, when it was canonicalized outside every function literal: a
 * block that the host boxed first, then gave to
 * `ce.function('Function', [block])`. The names of its assignment locals do
 * not change. A block with no record (no assignment local) is not changed.
 *
 * The record is for the scope, which the block object keeps. So when the
 * same block object is also evaluated alone, that evaluation follows the
 * rule of a function body too after this call: a read of an assignment
 * local before its first assignment is the `read-before-declaration` error,
 * not the bare symbol. An evaluation before the call gives the bare symbol.
 */
export function markFunctionBodyBlock(scope: object): void {
  const record = ASSIGNMENT_LOCALS.get(scope);
  if (record === undefined || record.inFunctionBody) return;
  ASSIGNMENT_LOCALS.set(scope, { names: record.names, inFunctionBody: true });
}

/** The assignment locals of the block scope `scope`, or `undefined` when
 * no block with this scope was canonicalized. */
export function assignmentLocalsOf(
  scope: object
): readonly string[] | undefined {
  return ASSIGNMENT_LOCALS.get(scope)?.names;
}

/**
 * Whether the block with the scope `scope` was canonicalized in the body of
 * a function literal: the body itself, or a block nested in it (a branch, a
 * loop body, a `do` block). `false` when no block with this scope was
 * canonicalized.
 */
export function isFunctionBodyBlock(scope: object): boolean {
  return ASSIGNMENT_LOCALS.get(scope)?.inFunctionBody === true;
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
 * body of `g`.
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
 * assignment locals, whether it is in a function body, and its locals of
 * {@link recordLaterDeclarationLocals}. A record that `to` has already is
 * kept.
 *
 * Call it when a block is rebuilt on a new scope without a new
 * canonicalization: a closure re-rooted on the scopes it captures
 * (`captureClosures()`, `function-utils.ts`). Without the record, a run of
 * the rebuilt block does not give its assignment locals a new binding, and
 * the effect inference counts a write to one as a write outside the
 * function.
 */
export function copyAssignmentLocals(from: object, to: object): void {
  const record = ASSIGNMENT_LOCALS.get(from);
  if (record !== undefined && !ASSIGNMENT_LOCALS.has(to))
    ASSIGNMENT_LOCALS.set(to, record);
  const later = LATER_DECLARATION_LOCALS.get(from);
  if (later !== undefined && !LATER_DECLARATION_LOCALS.has(to))
    LATER_DECLARATION_LOCALS.set(to, later);
}
