import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { tempVar } from './compiler-naming.js';
import { OWNED_LOCAL_UPDATE_OPS } from './in-place-update.js';
import {
  poolLoopAsWritten,
  type PoolAccumulator,
  type PoolLoopReason,
} from './pool-loop.js';

//
// The asynchronous copy of a JavaScript program
// (`docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`, section 4, "The
// program"). `runAsync()` runs this copy. It is the code of `run()`, except
// at a `parallel for` that can run on the worker pool: there the copy awaits
// one call of the runtime, `_run.loop()`, and runs the in-order loop of
// `run()` when that call gives `undefined`.
//
// The copy is a second emission of the whole program, made by
// `JavaScriptTarget` after the emission of `run()`, while this module holds
// the state of that emission (`beginAsyncEmission()`). The emitters of
// `run()` do not change their code: outside the second emission every hook
// of this module returns `undefined` or its input.
//
// An `await` is valid only directly inside an `async` function, so the copy
// makes `async` each JavaScript function between the entry and a loop that
// waits, and awaits each call of such a function:
//
// - the entry of the program, the body of an `AsyncFunction`;
// - the arrow function that is called at once for a block whose value is
//   used (`compileBlock()`), when a statement of the block waits;
// - a user function of the engine (a definition `_fn_f` of the preamble) or
//   of a block (`let f = …`) whose body waits. Each use of the name of such
//   a function in the copy must be a waited call or its definition; the
//   driver (`parallelCopyAttempt()` in `javascript-target.ts`) counts the
//   uses in the text, and when one is not a waited call, the loops of the
//   function and of the functions that it awaits, transitively, are emitted
//   in order and the copy is made again.
//
// Each wait is written `_run.r(await _run.s(P).catch(_run.e))`. `_run.s(P)`
// sets the reconstruction digits of the caller of `runAsync()` again and
// gives `P` (always a promise): the program leaves the thread at the
// `await`. `_run.r(v)` sets the digits of the program again when it
// continues, and gives `v`. When `P` rejects, `_run.e` does the same and
// throws the error again. Each one also saves the digits that are current
// then, which the `finally` below sets again. An `async` function
// of the copy restores the caller's digits when it ends (`finally`), since
// its caller continues only in a later job. So the digits of a pending run
// are set only while its own code runs.
//
// The positions where a loop can wait (condition 1 of the design, decision
// D1) are marked blocks: the entry and the body of a user function, and in a
// marked block, a nested block, the branches of an `if` statement and the
// body of a loop that is not a `parallel for` (`markStatement()`). A
// `parallel for` that is a statement of a marked block can wait, and so can a
// call of a user function that is a statement of a marked block, the value
// of a declaration or an assignment there, its last value, or the whole body
// of a function. The body of another `parallel for` and every other node
// are not marked, so every other emitter leaves the copy as the code of
// `run()`. An `await`
// that an emitter puts inside a JavaScript function that is not `async` (the
// callback of `map`, an arrow function that a lowering calls at once) is a
// syntax error, since each `await` of the copy is followed by an identifier:
// the driver checks that the text compiles, and emits the loops in order
// otherwise.
//

/** A loop that can run on the pool, as the asynchronous copy calls it: its
 * index in `CompilationResult.parallelLoops`, its outer variables and its
 * accumulators in the order of the parameters of the loop as a function. */
export type PoolWaitLoop = {
  readonly index: number;
  readonly outer: ReadonlyArray<string>;
  readonly accumulators: ReadonlyArray<PoolAccumulator>;
};

/**
 * One function of the copy: the entry, or the body of a user function.
 * `blocks` are its marked blocks, and `domains` maps the `ParallelDomain`
 * node of each loop at a statement of a marked block to that `Loop`
 * statement. `waits` counts the waits emitted in the body (a loop, a call,
 * an awaited block); `loops` holds the index of each loop that waits there,
 * and `awaited` the names of the functions whose calls it awaits.
 * `awaitedBy` counts the waited calls of this function in the whole copy.
 * `failed` is set when the function cannot be emitted in its `async` form.
 */
type WaitContext = {
  readonly blocks: WeakSet<Expression>;
  readonly domains: WeakMap<Expression, Expression>;
  waits: number;
  readonly loops: Set<number>;
  readonly awaited: Set<string>;
  awaitedBy: number;
  failed: boolean;
};

type AsyncEmission = {
  readonly loops: ReadonlyMap<Expression, PoolWaitLoop>;
  readonly stack: WaitContext[];
  readonly root: WaitContext;
  /** Every context of the emission: the entry, and each function, also one
   * whose name is not found (`endAsyncEmission()` reads the failed ones). */
  readonly contexts: WaitContext[];
  /** The `async` functions of the copy, by their emitted name. */
  readonly functions: Map<string, WaitContext>;
  /** The `Function` literals that a statement binds to a name. */
  readonly definitions: WeakSet<Expression>;
  /** The marked block of each statement of a marked block, for
   * `poolStatementCode()`, which receives the statement only. */
  readonly blockOf: WeakMap<Expression, Expression>;
  /** The context of a definition literal that was emitted `async` while the
   * current statement compiled, waiting for its name (`poolStatementCode()`). */
  pendingLiterals: WaitContext[];
  /** The loops that cannot wait for a reason other than their position. */
  readonly refused: Map<number, PoolLoopReason>;
};

let emission: AsyncEmission | undefined;

function newContext(): WaitContext {
  return {
    blocks: new WeakSet(),
    domains: new WeakMap(),
    waits: 0,
    loops: new Set(),
    awaited: new Set(),
    awaitedBy: 0,
    failed: false,
  };
}

/**
 * Mark `body`, the entry or the body of a function, in `context`
 * (`markStatement()`): when it is a block, it is a marked block, with the
 * positions of its statements. A block of one statement is often compiled
 * as that statement, without the statement list of `compileBlock()`, so the
 * marks are set here, before the emission, and not only when a statement
 * list compiles (`poolStatement()`).
 */
function markBody(context: WaitContext, body: Expression): void {
  if (emission !== undefined) markStatement(emission, context, body);
}

function top(): WaitContext | undefined {
  return emission?.stack[emission.stack.length - 1];
}

/**
 * Start the emission of an asynchronous copy, whose loops `loops` (the
 * loops as written that can run on the pool, with their records) can wait.
 * `root` is the expression that the emitters compile: a block is the first
 * marked block. Close it with `endAsyncEmission()`.
 */
export function beginAsyncEmission(
  loops: ReadonlyMap<Expression, PoolWaitLoop>,
  root: Expression
): void {
  const rootContext = newContext();
  emission = {
    loops,
    stack: [rootContext],
    root: rootContext,
    contexts: [rootContext],
    functions: new Map(),
    definitions: new WeakSet(),
    blockOf: new WeakMap(),
    pendingLiterals: [],
    refused: new Map(),
  };
  markBody(rootContext, root);
}

/**
 * Run `f`, a compilation that starts while the asynchronous copy of another
 * program is emitted (a compile handler that compiles a part of its node),
 * as an ordinary compilation: no hook of this module changes its code.
 */
export function withoutAsyncEmission<T>(f: () => T): T {
  const saved = emission;
  emission = undefined;
  try {
    return f();
  } finally {
    emission = saved;
  }
}

/**
 * The outcome of the emission of an asynchronous copy, read when the text is
 * complete. `waited` maps the index of each loop that waits, in a function
 * that the entry reaches through waited calls, to the name of the function
 * whose body holds it (`undefined` for the entry). `functions` are the
 * `async` functions of the copy, with the count of their waited calls and
 * the loops of their awaited closure (`awaitedClosure()`).
 * `failed` are the loops of the awaited closure of each function, or of the
 * entry, that could not be emitted in its `async` form, and `refused` the
 * loops that cannot wait for another reason. `invalid` is set when such a
 * function has no loop in its closure: no retry can make it not `async`.
 */
export type AsyncEmissionOutcome = {
  readonly waited: ReadonlyMap<number, string | undefined>;
  readonly functions: ReadonlyMap<
    string,
    { readonly awaitedBy: number; readonly loops: ReadonlySet<number> }
  >;
  readonly failed: ReadonlySet<number>;
  readonly refused: ReadonlyMap<number, PoolLoopReason>;
  readonly invalid: boolean;
};

/**
 * The loops of the awaited closure of `context`: its own loops and those of
 * each function that it awaits, transitively. A function is `async` because
 * its body waits at one of its loops or at a waited call of another `async`
 * function, so when these loops run in order, the function is not `async`
 * in the next emission.
 */
function awaitedClosure(
  state: AsyncEmission,
  context: WaitContext
): Set<number> {
  const loops = new Set<number>();
  const seen = new Set<WaitContext>([context]);
  const pending = [context];
  while (pending.length > 0) {
    const c = pending.pop()!;
    for (const i of c.loops) loops.add(i);
    for (const name of c.awaited) {
      const callee = state.functions.get(name);
      if (callee !== undefined && !seen.has(callee)) {
        seen.add(callee);
        pending.push(callee);
      }
    }
  }
  return loops;
}

/** Close the emission that `beginAsyncEmission()` opened, and give its
 * outcome. */
export function endAsyncEmission(): AsyncEmissionOutcome {
  const state = emission;
  emission = undefined;
  if (state === undefined)
    return {
      waited: new Map(),
      functions: new Map(),
      failed: new Set(),
      refused: new Map(),
      invalid: false,
    };
  const failed = new Set<number>();
  let invalid = false;
  // A literal whose name was not found keeps its loops in order.
  for (const context of state.pendingLiterals) context.failed = true;
  const names = new Map<WaitContext, string>();
  for (const [name, context] of state.functions) names.set(context, name);
  // The functions that the entry reaches through waited calls.
  const reached = new Set<WaitContext>([state.root]);
  const pending = [state.root];
  while (pending.length > 0) {
    const context = pending.pop()!;
    for (const name of context.awaited) {
      const callee = state.functions.get(name);
      if (callee !== undefined && !reached.has(callee)) {
        reached.add(callee);
        pending.push(callee);
      }
    }
  }
  const waited = new Map<number, string | undefined>();
  for (const context of reached) {
    if (context.failed) continue;
    for (const i of context.loops) waited.set(i, names.get(context));
  }
  // A function that failed, also one whose name was not found and that is
  // not in `functions`, keeps the loops of its awaited closure in order.
  for (const context of state.contexts) {
    if (!context.failed) continue;
    const loops = awaitedClosure(state, context);
    if (loops.size === 0) invalid = true;
    for (const i of loops) failed.add(i);
  }
  const functions = new Map<
    string,
    { awaitedBy: number; loops: ReadonlySet<number> }
  >();
  for (const [name, context] of state.functions)
    functions.set(name, {
      awaitedBy: context.awaitedBy,
      loops: awaitedClosure(state, context),
    });
  return { waited, functions, failed, refused: state.refused, invalid };
}

/**
 * The text of a wait for the promise `promise` in the asynchronous copy:
 * the program leaves the thread with the digits of its caller and sets its
 * own digits again when it continues (see the module comment).
 */
function waitFor(promise: string): string {
  return `_run.r(await _run.s(${promise}).catch(_run.e))`;
}

/**
 * The body of an `async` function of the copy, `body` (statements), wrapped
 * so that the function restores the digits of the caller of `runAsync()`
 * when it ends: its caller continues in a later job.
 */
export function asyncFunctionBody(body: string): string {
  return `try { ${body} } finally { _run.s(); }`;
}

//
// The emitter of a block (`compileBlock()` in `compile-blocks.ts`).
//

/** The count of waits of the current function when a block starts, read
 * again when the block ends (`poolBlockCode()`). */
export type PoolBlockMark = {
  readonly context: WaitContext;
  readonly waits: number;
};

/** At the start of the emission of a block. */
export function poolBlockMark(): PoolBlockMark | undefined {
  const context = top();
  return context === undefined ? undefined : { context, waits: context.waits };
}

/**
 * `iife`, the arrow function that is called at once for a block whose value
 * is used, as the copy emits it: `async`, and awaited, when a statement of
 * the block waited (the wait is then inside the arrow function).
 */
export function poolBlockCode(
  mark: PoolBlockMark | undefined,
  iife: string
): string {
  if (mark === undefined || mark.context.waits === mark.waits) return iife;
  const m = /^\(\(\) => \{([\s\S]*)\}\)\(\)$/.exec(iife);
  if (m === null) {
    // Not the form of `compileBlock()`: the function cannot wait.
    mark.context.failed = true;
    return iife;
  }
  mark.context.waits++;
  return waitFor(`(async () => { ${asyncFunctionBody(m[1])} })()`);
}

/** Whether the `Loop` node `loop` is a lowered `parallel for` (its clause
 * domain is a `ParallelDomain` node). */
function isParallelLoop(loop: Expression): boolean {
  return (
    isFunction(loop, 'Loop') &&
    loop.ops
      .slice(1)
      .some(
        (clause) =>
          isFunction(clause, 'Element') &&
          isFunction(clause.ops[1], 'ParallelDomain')
      )
  );
}

/**
 * Mark the positions of the statement `stmt` of a marked block in
 * `context`: a nested block, the branches of an `if`, and the body of a loop
 * that is not a `parallel for` are marked blocks; a `parallel for` whose
 * loop as written can run on the pool can wait.
 */
function markStatement(
  state: AsyncEmission,
  context: WaitContext,
  stmt: Expression
): void {
  if (!isFunction(stmt)) return;
  // The statements of a block are marked here too: the emitter of the
  // branch of an `if` and of the body of a loop compiles them without the
  // statement list of `compileBlock()` (`compileLoopBody()`).
  if (stmt.operator === 'Block') {
    context.blocks.add(stmt);
    for (const op of stmt.ops) {
      state.blockOf.set(op, stmt);
      markStatement(state, context, op);
    }
    return;
  }
  if (stmt.operator === 'If') {
    for (const branch of stmt.ops.slice(1))
      markStatement(state, context, branch);
    return;
  }
  if (stmt.operator !== 'Loop' || stmt.nops < 1) return;
  if (!isParallelLoop(stmt)) {
    markStatement(state, context, stmt.ops[0]);
    return;
  }
  // A `parallel for` with one clause over a `ParallelDomain`.
  const clause = stmt.ops[1];
  if (stmt.nops !== 2 || !isFunction(clause, 'Element')) return;
  const domain = clause.ops[1];
  const loop = poolLoopAsWritten(domain);
  if (loop !== undefined && state.loops.has(loop))
    context.domains.set(domain, stmt);
}

/** Whether `e` is a statement that binds a `Function` literal to a name,
 * and that literal. */
function definedLiteral(e: Expression): Expression | undefined {
  if (
    !isFunction(e, 'Declare') &&
    !isFunction(e, 'Assign') &&
    !isFunction(e, 'DefineFunction')
  )
    return undefined;
  const value = e.ops[e.nops - 1];
  return isFunction(value, 'Function') ? value : undefined;
}

/**
 * Before the statement `stmt` of the block `block` compiles: a `Function`
 * literal that the statement binds to a name is the body of a user function
 * of the copy, and the positions of a statement of a marked block are
 * marked (`markStatement()`).
 */
export function poolStatement(
  block: Expression | undefined,
  stmt: Expression
): void {
  const state = emission;
  const context = top();
  if (state === undefined || context === undefined) return;
  const literal = definedLiteral(stmt);
  if (literal !== undefined) state.definitions.add(literal);
  if (block !== undefined && context.blocks.has(block)) {
    state.blockOf.set(stmt, block);
    markStatement(state, context, stmt);
  }
}

/**
 * The index of the `)` that closes the `(` at `open` in the emitted code
 * `code`, or `-1`. A string literal of the code is skipped.
 */
function closingParenthesis(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++)
        if (code[i] === '\\') i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return c === ')' ? i : -1;
    }
  }
  return -1;
}

/**
 * `code`, a statement of a marked block, the value of the entry or the body
 * of a function, with a call of an `async` function of the copy waited for.
 * The call must be the whole code, or the value of a declaration or an
 * assignment (`let a = f(…)`, `a = f(…)`): any other use of the function
 * stays as it is, and the count of the uses of its name
 * (`parallelCopyAttempt()` in `javascript-target.ts`) then keeps its loops
 * in order.
 */
function waitedCall(context: WaitContext, code: string): string {
  const state = emission;
  if (state === undefined) return code;
  const m = /^((?:(?:let|const) )?[\w$]+ = )?([\w$]+)\(/u.exec(code);
  if (m === null) return code;
  const callee = m[2];
  const fn = state.functions.get(callee);
  if (fn === undefined || fn.failed) return code;
  const open = m[0].length - 1;
  if (closingParenthesis(code, open) !== code.length - 1) return code;
  fn.awaitedBy++;
  context.waits++;
  context.awaited.add(callee);
  return `${m[1] ?? ''}${waitFor(code.slice((m[1] ?? '').length))}`;
}

/**
 * After the statement `stmt` of a statement list compiled to `codes`
 * (`compileListStatement()`, and `compileLoopBody()` for the statements of
 * the branch of an `if` or of the body of a loop): the name of a definition literal that was
 * emitted `async` is recorded, and when `stmt` is a statement of a marked
 * block, a call of an `async` function is waited for.
 */
export function poolStatementCode(
  stmt: Expression | undefined,
  codes: string[]
): string[] {
  const state = emission;
  const context = top();
  if (state === undefined || context === undefined) return codes;
  const block = stmt === undefined ? undefined : state.blockOf.get(stmt);
  if (state.pendingLiterals.length > 0) {
    const literal = state.pendingLiterals.pop()!;
    const name = codes
      .map((c) => /^(?:(?:let|const) )?([\w$]+) = \(async \(/u.exec(c)?.[1])
      .find((n) => n !== undefined);
    if (name === undefined || state.functions.has(name)) literal.failed = true;
    else state.functions.set(name, literal);
    // A second literal of the same statement has no name of its own.
    for (const other of state.pendingLiterals.splice(0)) other.failed = true;
  }
  if (block === undefined || !context.blocks.has(block)) return codes;
  return codes.map((code) => waitedCall(context, code));
}

/** The value of the entry, `code`, with a call of an `async` function
 * waited for (`waitedCall()`). */
export function poolEntryCode(code: string): string {
  const context = emission?.root;
  return context === undefined ? code : waitedCall(context, code);
}

//
// The emitter of a `Function` literal (`compile-function-literals.ts`) and
// of a definition of a user function of the engine (`compiler-core.ts`).
//

/**
 * Before the body of the `Function` literal `literal` compiles: a context of
 * its own when the literal is bound to a name by a statement (the body of a
 * user function of a block), whose body block is marked. Every other literal
 * (a callback, a value) keeps the current context, and its body is not
 * marked. Close it with `endPoolFunction()`.
 */
export function beginPoolLiteral(
  literal: Expression | undefined
): WaitContext | undefined {
  const state = emission;
  if (state === undefined || literal === undefined) return undefined;
  if (!state.definitions.has(literal) || !isFunction(literal, 'Function'))
    return undefined;
  const context = newContext();
  markBody(context, literal.ops[0]);
  state.contexts.push(context);
  state.stack.push(context);
  return context;
}

/**
 * Before the body of the definition of a user function of the engine
 * compiles: a context of its own, whose body block `body` is marked. With
 * `plain` false (a variant of the function for one shape of call, a loop
 * form of a list recursion), the context marks nothing: such a definition
 * runs its loops in order. Close it with `endPoolFunction()`.
 */
export function beginPoolDefinition(
  body: Expression,
  plain: boolean
): WaitContext | undefined {
  if (emission === undefined) return undefined;
  const context = newContext();
  if (plain) markBody(context, body);
  emission.contexts.push(context);
  emission.stack.push(context);
  return context;
}

/** Close the context that `beginPoolLiteral()` or `beginPoolDefinition()`
 * opened. */
export function endPoolFunction(context: WaitContext | undefined): void {
  if (context === undefined || emission === undefined) return;
  const i = emission.stack.lastIndexOf(context);
  if (i >= 0) emission.stack.splice(i, 1);
}

/**
 * The arrow function of a definition literal whose body waited, as the copy
 * emits it, or `undefined` when its body did not wait (the arrow of `run()`
 * is kept). `params` are the emitted parameters and `body` the code of the
 * body. The name that a statement binds it to is read from the code of that
 * statement (`poolStatementCode()`).
 */
export function poolLiteralArrow(
  context: WaitContext | undefined,
  params: string,
  body: string
): string | undefined {
  if (context === undefined || emission === undefined) return undefined;
  // A body that is one call of a function that waits gives the value of
  // that call.
  body = waitedCall(context, body);
  if (context.waits === 0) return undefined;
  emission.pendingLiterals.push(context);
  return `(async (${params}) => { ${asyncFunctionBody(`return ${body};`)} })`;
}

/** The literal of `context` was emitted with a wrapper around its arrow (a
 * conversion of its arguments, a map, a fill of defaults): the call of the
 * wrapper is not a call of the `async` function, so its loops run in
 * order. */
export function poolLiteralWrapped(context: WaitContext | undefined): void {
  if (context !== undefined && context.waits > 0) context.failed = true;
}

/**
 * The definition `const name = …` of a user function of the engine whose
 * body waited, as the copy emits it, or `undefined` when the body did not
 * wait. `body` is the code of the body as an expression, or with
 * `statements` a function that gives the statements of the body (called
 * only for the copy: it names new temporaries).
 */
export function poolDefinitionText(
  context: WaitContext | undefined,
  name: string,
  params: ReadonlyArray<string>,
  body: string,
  statements: (() => string) | undefined
): string | undefined {
  if (context === undefined || emission === undefined) return undefined;
  if (statements === undefined) body = waitedCall(context, body);
  if (context.waits === 0) return undefined;
  if (emission.functions.has(name)) {
    context.failed = true;
    return undefined;
  }
  emission.functions.set(name, context);
  return `const ${name} = async (${params.join(', ')}) => { ${asyncFunctionBody(
    statements?.() ?? `return ${body};`
  )} };`;
}

/** Whether `name` is an `async` function of the copy being emitted: the
 * last-call memo does not wrap it. */
export function isPoolAsyncDefinition(name: string): boolean {
  return emission?.functions.has(name) === true;
}

//
// The emitter of a counted loop (`emitElementLoops()` in `compile-loops.ts`).
//

/** A JavaScript identifier, or a property of the object of variables. */
const PLAIN_READ = /^(?:_\.)?[A-Za-z_$][\w$]*$/u;

/**
 * How the asynchronous copy writes a list accumulator after the pool: `null`
 * in place (its declaration copied the list), the name of the temporary
 * that holds the array the block owns (in place when the local still holds
 * it, as the in-order updates do), or `undefined` into a new list.
 */
type ListWrite = string | null | undefined;

/**
 * The way the in-order loop `loop` writes the list accumulator `name`: the
 * value of `OWNED_LOCAL_UPDATE_OPS` for the operands of each
 * `name = ReplaceAt(name, …)` of the loop, which the block that declares
 * the local recorded (`ownedLocalUpdateChains()` in `in-place-update.ts`).
 * When the writes differ, or the loop has none, the list is written into a
 * new list.
 */
function listWriteOf(loop: Expression, name: string): ListWrite {
  const found: ListWrite[] = [];
  const visit = (e: Expression): void => {
    if (!isFunction(e)) return;
    if (
      e.operator === 'Assign' &&
      e.nops === 2 &&
      isSymbol(e.op1, name) &&
      isFunction(e.op2, 'ReplaceAt')
    ) {
      let node: Expression = e.op2;
      while (isFunction(node, 'ReplaceAt') && node.nops >= 3) node = node.op1;
      if (isSymbol(node, name))
        found.push(OWNED_LOCAL_UPDATE_OPS.get(e.op2.ops));
    }
    for (const op of e.ops) visit(op);
  };
  visit(loop);
  if (found.length === 0) return undefined;
  return found.every((w) => w === found[0]) ? found[0] : undefined;
}

/**
 * The code of a loop that waits, for the counted loop over the
 * `ParallelDomain` node `domain`, or `undefined` when the loop does not
 * wait in the copy: no copy is emitted, the loop is not at a position that
 * can wait, or the code of `run()` does not hold an outer variable or an
 * accumulator in a plain variable. `target` is the target of the code
 * around the loop.
 *
 * The function given takes the code of the in-order `for` statement, the
 * first value, the step and the count of passes of the range (names or
 * numbers that the counted loop computed, with its checks), and `state`,
 * the random state of the passes (`_SYS.parallelPassesBegin()`). A loop
 * under a random frame (`state` is not `undefined`) runs in order: a wait
 * there would leave the frame installed while another call runs.
 */
export function poolLoopWait(
  domain: Expression,
  target: CompileTarget<Expression>
):
  | ((
      forLoop: string,
      first: string,
      step: string,
      count: string,
      state: string
    ) => string)
  | undefined {
  const state = emission;
  const context = top();
  if (state === undefined || context === undefined) return undefined;
  const statement = context.domains.get(domain);
  if (statement === undefined) return undefined;
  const asWritten = poolLoopAsWritten(domain);
  const info = asWritten === undefined ? undefined : state.loops.get(asWritten);
  if (info === undefined) return undefined;
  // The value of each outer variable and accumulator, as the code of
  // `run()` reads it around the loop. A variable that the lowered loop does
  // not name (a rewrite replaced it, as the unrolling of a list of fixed
  // width does), or that the code holds in another form than a plain
  // variable, has no value of its static type here: the loop runs in order.
  const names = new Set(statement.symbols);
  const read = (name: string): string | undefined => {
    if (!names.has(name)) return undefined;
    const code = target.var(name);
    return typeof code === 'string' && PLAIN_READ.test(code) ? code : undefined;
  };
  const outer = info.outer.map(read);
  const accumulators = info.accumulators.map((a) => read(a.name));
  if (outer.some((c) => c === undefined)) {
    state.refused.set(info.index, 'outer-type');
    return undefined;
  }
  if (accumulators.some((c) => c === undefined || c.startsWith('_.'))) {
    state.refused.set(info.index, 'accumulator-scope');
    return undefined;
  }
  const writes = info.accumulators.map((a) =>
    a.kind === 'list' ? listWriteOf(statement, a.name) : undefined
  );
  context.waits++;
  context.loops.add(info.index);
  return (forLoop, first, step, count, randomState) => {
    const sums = tempVar(target);
    const lengths = info.accumulators
      .map((a, j) => (a.kind === 'list' ? `${accumulators[j]}.length` : ''))
      .filter((s) => s !== '');
    // The addition of the sums of the sub-ranges, in their order, to each
    // accumulator (section 4, "The addition to a list").
    const additions = info.accumulators.map((a, j) => {
      const acc = accumulators[j]!;
      if (a.kind === 'number')
        return `${acc} = _run.addNumber(${acc}, ${sums}, ${j});`;
      const write = writes[j];
      if (write === null)
        return `${acc} = _run.addList(${acc}, ${sums}, ${j}, true);`;
      if (write === undefined)
        return `${acc} = _run.addList(${acc}, ${sums}, ${j}, false);`;
      return (
        `${acc} = (${write} = _run.addList(${acc} === ${write} ? ${acc} : ` +
        `(${write} = _SYS.ownedCopy(${acc})), ${sums}, ${j}, true));`
      );
    });
    return (
      `{ let ${sums} = ${randomState} === undefined ? _run.loop(${info.index}, ` +
      `${first}, ${step}, ${count}, [${outer.join(', ')}], [${lengths.join(', ')}]) : undefined; ` +
      `if (${sums} !== undefined) ${sums} = ${waitFor(sums)}; ` +
      `if (${sums} === undefined) { ${forLoop} } else { ${additions.join(' ')} } }`
    );
  };
}
