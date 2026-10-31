// Statement bodies: hoisting, statement lists, shader statements, list
// statements and the compile root.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { resetJavaScriptStatements } from './javascript-statements.js';
import { parseType } from '../../common/type/parse.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { multiClauseState } from '../multi-clause.js';
import type {
  CompileTarget,
  CseRegionInstance,
  TargetSource,
} from './types.js';
import { declareValueOperand } from './compile-declarations.js';
import { BINARY_INFIX_VALUE_OPERATORS } from './compiler-tables.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { core } from './compiler-core-hooks.js';
import { writesBlocksAsIife } from './compile-conditions.js';
import { collectUsedNames } from './compiler-names.js';
import { newNamingContext, withBoundScope } from './compiler-naming.js';
import { CompilerState } from './compiler-state.js';
import { PROMOTABLE_RADICAL_HEADS } from './compiler-mode.js';

/**
 * The STATEMENT head `expr` lowers to at a body position — `'Assign'` or
 * `'Declare'` — or `undefined` when the body is (or reduces to) an expression.
 *
 * The structural half of the expression-only contract, shared by the GPU and
 * Python targets (each applies its own language policy to the answer: GLSL
 * assignment is an OPERATOR and stays legal, WGSL and Python assignment are
 * STATEMENTS; a declaration is a statement on all three).
 *
 * Structural, on the body BEFORE it is compiled, deliberately — the two
 * emitted-source scans those targets already run (a newline, a `return` token)
 * are blind to both shapes: `Assign(s, x)` emits the single line `s = x` and a
 * root `Declare(s, 'number', x)` emits the single line `float s` / `var s: f32`
 * (Python: the EMPTY string), each with the initializer silently dropped. A
 * textual `=` scan cannot replace this without re-deriving the emitters'
 * precedence rules — it would false-positive on `==`/`<=`/`>=`/`!=`.
 *
 * A `Block` delegates to its VALUE statement (its last operand), following the
 * base compiler, which unwraps a single-statement block to that statement. A
 * multi-statement `Block` is normally declined by the emitted-source scan
 * anyway, but the two answers must agree on WHICH statement carries the value.
 */
export function statementBodyHead(
  expr: Expression | undefined
): 'Assign' | 'Declare' | undefined {
  let body = expr;
  while (body !== undefined && isFunction(body, 'Block') && body.ops.length > 0)
    body = body.ops[body.ops.length - 1];
  if (body === undefined) return undefined;
  if (isFunction(body, 'Assign')) return 'Assign';
  if (isFunction(body, 'Declare')) return 'Declare';
  return undefined;
}

/**
 * Whether `expr` is a `Block` whose last statement is an assignment that the
 * block hook of a target where assignment is a STATEMENT (Python, WGSL) can
 * return: an `Assign` to a name, or a `Declare` with an initializer, which
 * these targets emit as the same assignment. The hook keeps such a statement
 * and adds `return <name>` after it, so `Block(s ≔ x; t ≔ s)` has a value on
 * those targets (`s = x`, `t = s`, `return t`).
 *
 * Not such a block: a last statement that is a nested `Block` (its emission
 * is a statement sequence the hook does not return), a `Declare` without an
 * initializer (the block's value is `Nothing`), and an assignment to
 * anything else than a name. A single-statement block with no local is
 * unwrapped to its statement by `compileBlock` and emits the single line
 * `s = x`; a caller must also check the emission for the final `return`.
 */
export function isTailAssignmentBlock(expr: Expression | undefined): boolean {
  if (expr === undefined || !isFunction(expr, 'Block') || expr.nops === 0)
    return false;
  const last = expr.ops[expr.nops - 1];
  if (isFunction(last, 'Assign')) return isSymbol(last.ops[0]);
  return (
    isFunction(last, 'Declare') &&
    isSymbol(last.ops[0]) &&
    declareValueOperand(last.ops) !== undefined
  );
}

/**
 * Does the bare operator symbol `s` lower to the binary infix lambda above?
 *
 * A target that consumes an operator symbol in a strictly BINARY role (a
 * `Reduce`/`Scan` combiner) must ask: every other operator symbol now
 * lowers to its eta-expanded wrapper at its OWN arity
 * (`_fn_Negate = (t) => -t`), which is a valid `Map`/`Filter` callback but
 * would silently mis-fold as a combiner (the interpreter raises an arity
 * error there). Before eta-expansion existed, `BaseCompiler.compile` failed
 * closed for those symbols and the combiner sites could rely on it.
 */
export function isBinaryInfixValueOperator(s: string): boolean {
  return BINARY_INFIX_VALUE_OPERATORS.has(s);
}

/**
 * The fail-closed refusal for a BUILT-IN operator name used in value
 * position that has no first-class form: it neither eta-expands
 * (`ensureBuiltinCallbackEmitted` declined — a variadic or zero-required
 * signature, or a wrapper body that does not canonicalize) nor lowers to a
 * binary infix lambda. Shared by the two routes that can reach that state
 * (the `target.operators` branch and the bare-symbol branch) so both refuse
 * with the same wording.
 */
export function builtinCallbackRefusal(s: string): string {
  return (
    `Could not compile \`${s}\` as a first-class function: the built-in ` +
    `operator has no fixed arity to eta-expand at (a variadic or ` +
    `zero-required signature), and only the binary arithmetic operators ` +
    `(Add/Subtract/Multiply/Divide) lower to a combiner lambda.`
  );
}

/**
 * The fail-closed refusal for a USER-DEFINED function name used in
 * value position — the callback of `Map`/`Filter`/`CountIf`/`Find`, a
 * `Reduce`/`Scan` combiner, a `Tabulate` generator, an argument to a
 * higher-order user function — whose definition the target declined to
 * emit (`ensureUserFunctionValueRef` returned `undefined`).
 *
 * Without the refusal the name fell through to the ordinary free-symbol
 * read `_.<name>`: the artifact reported `success: true` and then threw
 * `TypeError: _f is not a function` at run time, because nothing binds
 * that key. This is the same defect the bare BUILT-IN operator name in
 * value position had (`Map(Sin, xs)` reading `_.Sin`), and it takes the
 * same answer — either working code or a compile-time refusal, which the
 * default `fallback: true` route turns into interpreted evaluation.
 *
 * `reason` is what the emission route recorded on its way out (see
 * {@link DeclineNote}); it is omitted when a route declined without
 * recording one.
 */
export function userFunctionValueRefRefusal(
  s: string,
  target: CompileTarget<Expression>,
  reason: string | undefined
): string {
  return (
    `Could not compile \`${s}\`: this user function is referenced as a value ` +
    `but its definition cannot be emitted on target ` +
    `'${target.language ?? 'unknown'}'` +
    (reason === undefined ? '' : ` (${reason})`) +
    `. A caller using the default \`fallback: true\` falls back to ` +
    `interpreted evaluation.`
  );
}

/**
 * True when `s` names a function the USER defined — a symbol whose engine
 * definition holds a function literal (`f(x) := …`, `x ↦ …`,
 * `ce.assign(name, lambda)`), or an operator definition carrying a
 * multi-clause set. False for a built-in operator name, a value symbol, a
 * caller `vars` key, and an unknown name, each of which keeps the ordinary
 * free-symbol read.
 *
 * This is exactly the pair of storage routes `ensureUserFunctionEmitted`
 * dispatches on, so the predicate and the emission agree on what counts as
 * a user function.
 */
export function isUserDefinedFunction(
  engine: ComputeEngine,
  s: string
): boolean {
  if (userFunctionLiteral(engine, s) !== undefined) return true;
  return multiClauseState(engine.lookupDefinition(s)) !== undefined;
}

/**
 * `options` with each string `vars` entry that names a user-defined
 * function also given as a `functions` entry, so that a call of that
 * function compiles as a call of the caller's source: `vars: { g: '_.g' }`
 * makes `g(x)` emit `_.g(_.x)` on JavaScript. Without this, the `vars`
 * entry changed only the reads of `g` as a value, and a call `g(x)` still
 * emitted the engine's definition of `g` (`_fn_g`).
 *
 * An entry that `functions` already has is kept: it is the caller's
 * explicit choice for the call. An entry that is not a string bakes a
 * value, which is not callable source, so it is skipped. A source that is
 * not a name or a property path (an arrow function) is put in parentheses,
 * so that the call applies the whole source. CE-260.
 */
export function withVarsMappedUserFunctionHeads<
  O extends {
    vars?: Record<string, unknown>;
    functions?: Record<string, unknown>;
  },
>(engine: ComputeEngine, options: O): O {
  const vars = options.vars;
  if (vars === undefined) return options;
  let functions: Record<string, unknown> | undefined;
  for (const [name, source] of Object.entries(vars)) {
    if (typeof source !== 'string') continue;
    if (options.functions && Object.hasOwn(options.functions, name)) continue;
    if (!isUserDefinedFunction(engine, name)) continue;
    functions ??= { ...options.functions };
    functions[name] = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(source)
      ? source
      : `(${source})`;
  }
  return functions === undefined ? options : { ...options, functions };
}

export function compileValueOperand(
  expr: Expression | undefined,
  target: CompileTarget<Expression>,
  prec = 0
): TargetSource {
  if (isFunction(expr, 'Assign') && isSymbol(expr.ops[0]))
    assertAssignmentIsStatement(expr.ops[0].symbol, target);
  const code = core.compile(expr, target, prec);
  if (
    target.bareStatementBlocks &&
    typeof code === 'string' &&
    (code.includes('\n') || /^\s*(?:return|break|continue)\b/.test(code))
  ) {
    const head = expr !== undefined && isFunction(expr) ? expr.operator : '?';
    throw new Error(
      `Could not compile \`${head}\`: a multi-statement construct (loop-form Sum/Product, Loop, or Block) ` +
        `cannot be used as a sub-expression in "${target.language ?? 'this'}" ` +
        `here — this position has no statement sink to hoist its statements ` +
        `into (a conditional arm, or an expression-only route), so it is ` +
        `only valid as a top-level function body.`
    );
  }
  assertNoStatementOperand(expr, code, target);
  return code;
}

/**
 * Fail closed on a target where an assignment is a statement and has no
 * expression form — Python and WGSL — when an assignment to `name` is
 * compiled as an operand of an expression: an operand of an operator, or
 * an argument of a function. Python read `np.sin(t = 1)` as a keyword
 * argument, and WGSL accepts neither `w = sin(t = 1.0)` nor
 * `_ = t = 1.0 + 2.0`. JavaScript and GLSL have an assignment expression.
 */
export function assertAssignmentIsStatement(
  name: string,
  target: CompileTarget<Expression>
): void {
  if (target.language !== 'python' && target.language !== 'wgsl') return;
  throw new Error(
    `Could not compile \`Assign\`: the assignment to "${name}" is an ` +
      `operand of an expression, and an assignment is a statement in ` +
      `'${target.language}', with no expression form. Assign the value in ` +
      `a statement of its own first.`
  );
}

/**
 * Fail closed when the code of an operand of an expression is a statement
 * (`return …`, `break`, `continue`), on a target that writes a block as an
 * IIFE (`writesBlocksAsIife`). A `Return` that is not in a statement or
 * tail position (`tailValue`) is emitted that way, and the result is a
 * syntax error (`c ? return 1 : 2`). The interpreter does not leave the
 * enclosing function there either: it keeps the `Return` as a held value
 * of the expression.
 */
export function assertNoStatementOperand(
  expr: Expression | undefined,
  code: TargetSource,
  target: CompileTarget<Expression>
): void {
  if (
    !writesBlocksAsIife(target) ||
    typeof code !== 'string' ||
    !/^\s*(?:return|break|continue)\b/.test(code)
  )
    return;
  const head = expr !== undefined && isFunction(expr) ? expr.operator : '?';
  throw new Error(
    `Could not compile \`${head}\`: a \`${head}\` that is an operand of ` +
      `an expression has no lowering on target ` +
      `'${target.language ?? 'unknown'}'. A \`Return\` compiles as a ` +
      `statement of a block, or as the value of a block or of the ` +
      `compilation.`
  );
}

/**
 * Whether `target` currently accepts hoisted statements (Tycho item 110).
 *
 * True only when the target declares a `hoist` sink AND no binder has been
 * entered since it was installed: a statement hoisted out of a binder scope
 * would reference a name that does not exist where it lands. Every binder
 * spreads a FRESH `boundVars` set into its inner target, so the identity
 * comparison detects the crossing without every binding site having to
 * cooperate. A binder that wants its body to hoist installs its own sink.
 */
export function canHoist(target: CompileTarget<Expression>): boolean {
  return (
    target.hoist !== undefined && target.hoist.boundVars === target.boundVars
  );
}

/** Push a statement onto `target`'s hoist sink. Callers must check
 * `canHoist` first — hoisting into a closed sink is a compiler bug. */
export function hoistStatement(
  target: CompileTarget<Expression>,
  ...stmts: string[]
): void {
  if (!canHoist(target))
    throw new Error(
      'Internal: hoisting a statement out of a binder scope (or with no ' +
        'hoist sink installed)'
    );
  target.hoist!.stmts.push(...stmts);
}

/**
 * Compile `expr` at a **statement position** — a function body, or the
 * right-hand side of a shader-body assignment — with a fresh hoist sink
 * installed.
 *
 * Returns the emitted source plus the statements that were hoisted while
 * compiling it, in emission order. Nothing hoisted means the result is
 * byte-identical to `compile()`, so this is a drop-in for every statement
 * position on a `bareStatementBlocks` target.
 */
export function compileStatementBody(
  expr: Expression | undefined,
  target: CompileTarget<Expression>,
  prec = 0,
  root = false
): { stmts: string[]; code: string } {
  // `root` records `expr` as the statement list this position OWNS: a
  // multi-statement `Block` that is `expr` itself emits in place as the
  // body's statements, while a `Block` nested anywhere inside `expr` is a
  // value operand and lowers through the target's `valueBlock` hook. A
  // position whose value lands on the right of an assignment (a
  // `compileShader()` body statement) leaves `root` unset, so a `Block`
  // there also takes the operand lowering.
  const run = (): { stmts: string[]; code: string } => {
    const sink: NonNullable<CompileTarget<Expression>['hoist']> = {
      stmts: [],
      boundVars: target.boundVars,
    };
    if (root && expr !== undefined) sink.root = expr;
    sink.unit = expr;
    const code = core.compile(expr, { ...target, hoist: sink }, prec);
    return { stmts: sink.stmts, code };
  };
  return withStatementRecompile(target, expr, run);
}

/**
 * Run `run`, the compilation of one statement. When it throws, the target
 * may compile the statement again (`CompileTarget.recompileStatement`).
 * `run` installs a fresh hoist sink each time, so nothing the first
 * attempt hoisted is kept, and the state of the enclosing CSE instances
 * is put back as it was before the first attempt: a temporary the first
 * attempt bound had its declaration in the discarded sink, so a second
 * attempt that read it as bound would name an undeclared temporary.
 */
export function withStatementRecompile<R>(
  target: CompileTarget<Expression>,
  unit: Expression | undefined,
  run: () => R
): R {
  if (target.recompileStatement === undefined) return run();
  const restoreCse = snapshotCseInstances(target);
  try {
    return run();
  } catch (error) {
    const again = target.recompileStatement(
      error,
      () => {
        restoreCse();
        return run();
      },
      unit
    );
    if (again === undefined) throw error;
    return again;
  }
}

/**
 * Save the state of the CSE instances open on `target` (which candidates
 * are bound, their names, the bindings, the cached constant code), and
 * return a function that puts it back. The instances a compilation pushes
 * are popped when it ends, also when it throws, so only these can keep
 * state from a discarded compilation.
 */
export function snapshotCseInstances(
  target: CompileTarget<Expression>
): () => void {
  const instances = target.cse?.instances ?? [];
  const saved = instances.map((instance) => ({
    instance,
    state: new Map(instance.state),
    names: new Map(instance.names),
    bindings: instance.bindings.length,
    inline: new Map(_cseInlineCode.get(instance) ?? []),
  }));
  return () => {
    for (const { instance, state, names, bindings, inline } of saved) {
      instance.state.clear();
      for (const [k, v] of state) instance.state.set(k, v);
      instance.names.clear();
      for (const [k, v] of names) instance.names.set(k, v);
      instance.bindings.length = bindings;
      _cseInlineCode.set(instance, inline);
    }
  };
}

/**
 * The function nodes being compiled now, the outermost first and the
 * node being compiled last (`_compileParents`). Read-only.
 */
export function compileParents(): ReadonlyArray<Expression> {
  return _compileParents;
}

/**
 * `compileStatementBody`, assembled into a single function-body string:
 * the hoisted statements followed by the value, `return`-prefixed when the
 * value is an expression (a multi-statement value already carries its own
 * `return` on the last line — the pre-item-110 block convention).
 */
export function compileFunctionBody(
  expr: Expression | undefined,
  target: CompileTarget<Expression>
): string {
  const { stmts, code } = compileStatementBody(expr, target, 0, true);
  if (stmts.length === 0) return code;
  return [...stmts, code.includes('\n') ? code : `return ${code};`].join('\n');
}

/**
 * Join the statements of a list that has no value on a
 * `bareStatementBlocks` target: one per line, with the `;` terminator of
 * the shader targets (`joinShaderStatements`), or with no terminator on
 * Python, where a statement ends at the end of its line.
 */
export function statementLines(
  target: CompileTarget<Expression>,
  lines: ReadonlyArray<string>
): string {
  return target.language === 'python'
    ? lines.join('\n')
    : joinShaderStatements(lines);
}

/**
 * Refuse the compiled value `code` of an `Assign` or of a `Declare` of
 * `name` when it is not one expression, on a target that writes a block
 * as a bare statement sequence (Python, the shader targets).
 *
 * A value that compiles to several statements, or to a `return`, cannot
 * be the right side of an assignment: splicing `u = s\nreturn 2 * u`
 * after `t = ` gave `t = u = s` and a `return` that left the enclosing
 * function with the value of the inner block. The shader targets move
 * such a block into the enclosing statement list when they can
 * (`valueBlock`), and its value then compiles to a single temporary;
 * where no statement list is available, and on Python, which has no such
 * lowering, the assignment declines.
 */
export function assertExpressionValue(
  code: TargetSource,
  target: CompileTarget<Expression>,
  head: 'Assign' | 'Declare',
  name: string
): void {
  if (
    !target.bareStatementBlocks ||
    typeof code !== 'string' ||
    !(code.includes('\n') || /^\s*(?:return|break|continue)\b/.test(code))
  )
    return;
  throw new Error(
    head === 'Assign'
      ? `Could not compile \`Assign\`: the value assigned to ` +
          `"${name}" lowers to a statement sequence on target ` +
          `'${target.language ?? 'unknown'}' (a block, or a loop), which ` +
          `has no expression form there. Assign the value of the last ` +
          `statement instead (\`Block(u ≔ s; t ≔ 2u)\`).`
      : `Could not compile \`Declare\`: the value of "${name}" lowers to ` +
          `a statement sequence on target '${target.language ?? 'unknown'}' ` +
          `(a block, or a loop), which has no expression form there. ` +
          `Declare the local with no value and assign the value of the ` +
          `last statement instead.`
  );
}

/**
 * Join statement lines for a `bareStatementBlocks` target, terminating each
 * with `;` unless it already ends with one or with a closing brace — a
 * hoisted statement (`float t = 0.0;`, a `for (…) { … }` loop, a compound
 * `{ … }` block) arrives terminated, while a statement this compiler emits
 * (`float a`, `a = x`, `return v`) does not. A blind `join(';\n')` would
 * leave `;;` and `};` behind, which both languages accept but neither
 * needs.
 */
export function joinShaderStatements(lines: ReadonlyArray<string>): string {
  return lines
    .map((line) => (/[;}]\s*$/.test(line) ? line : `${line};`))
    .join('\n');
}

/**
 * Compile one statement of a statement list on a `bareStatementBlocks`
 * target with a hoist sink of its own, and return the statements it
 * hoisted followed by its own emission. The sink's `boundVars` is the
 * statement list's, so a lowering inside the statement that needs
 * statements — a loop-form `Sum` on the right of an assignment, a block
 * used as an operand, a CSE temporary — hoists them to just ahead of the
 * statement, inside the list's own scope. Without a sink such a lowering
 * had nowhere to put its statements and spliced its bare statement block
 * into the assignment (`a = float _tv1 = 0.0; for (…) …`), reporting
 * success on source no driver accepts. Hoisted statements are returned
 * without their terminators so the caller's joiner treats them like its
 * own lines.
 *
 * On every other target the statement compiles under `target` unchanged.
 */
export function compileListStatement(
  target: CompileTarget<Expression>,
  /** The statement itself, recorded on the sink as `hoist.unit`. */
  unit: Expression | undefined,
  compileWith: (t: CompileTarget<Expression>) => string[]
): string[] {
  if (!target.bareStatementBlocks) return compileWith(target);
  return withStatementRecompile(target, unit, () => {
    const sink = { stmts: [] as string[], boundVars: target.boundVars, unit };
    const lines = compileWith({ ...target, hoist: sink });
    if (sink.stmts.length === 0) return lines;
    return [...sink.stmts.map((s) => s.replace(/;\s*$/, '')), ...lines];
  });
}

/**
 * Compile `expr` as the **root** of a compilation: open the compilation
 * boundary on `target`, then compile.
 *
 * `compile()` is the recursive entry — every sub-expression flows through it,
 * so it cannot tell a new compilation from a nested one. This is the entry a
 * caller driving a whole compilation uses (`expr.compile({ target })`,
 * plugin targets), and the one that gives a REUSED target object the fresh
 * per-compilation numbering an engine-created target gets by being new: two
 * compilations of one expression then emit identical source.
 *
 * Not used where one target deliberately spans several root compilations —
 * a shader body compiles each of its statements against a single target so
 * their random counters stay distinct (`compileShaderBody`).
 */
export function compileRoot(
  expr: Expression | undefined,
  target: CompileTarget<Expression>,
  prec = 0
): TargetSource {
  // Open the naming boundary here, not only in the optional
  // `beginCompilation` hook (which most targets do not define): restart the
  // generated-name numbering and fold this expression's own symbols into the
  // collision inventory. A caller-built target reused for two compilations
  // then emits identical source for both. (The GPU targets' own
  // `beginCompilation` resets as well — a double reset is harmless.)
  if (target.naming !== undefined) {
    target.naming.counter = 0;
    if (expr !== undefined)
      for (const n of collectUsedNames(expr)) target.naming.usedNames.add(n);
  } else target.naming = newNamingContext(expr);
  resetJavaScriptStatements(target);
  // (The shared antiderivative budget is NOT reset here: registered
  // targets compile through `compileCseRoot` without passing this entry,
  // so the reset lives at the depth-0 boundary of `compile` below, which
  // every route crosses.)
  target.beginCompilation?.(target);
  return core.compile(expr, target, prec);
}

/**
 * Record, for the `promoted` report, the promotions of a subtree that the
 * constant fold replaces with a COMPLEX literal. The subtree is not
 * compiled, so no emitter records its promotable heads. But the literal is
 * complex because those heads promote: with promotion off, the fold
 * declines and the real kernel gives NaN (`√(Σ cos k)` for k = 1..5 is
 * `1.11…i` under `auto` and NaN under `strict`). So each promotable head
 * of the subtree is given to `promotesRadicalToComplex`, which records the
 * same promotions that the emitters record for the same heads.
 *
 * A call of a user function in the subtree is folded with its body, so
 * the body of the function is read too (once for each function, which
 * also stops a recursive function). With `g := k ↦ √(k − 5)`, `x + g(3)`
 * folds to `x + 1.41…i` under `auto`, and the promotion is in the body of
 * `g`.
 *
 * A descendant that folds on its own to a REAL number supplies no part of
 * the complex value, so its subtree is not read. With
 * `i + Sum(√(2 + sin k), k, 1, 16)`, the sum folds to `22.85…` and the
 * imaginary unit supplies the imaginary part: the radical in the sum is not
 * a promotion. A descendant that does not fold on its own (it mentions a
 * bound index or a parameter, for example) is read, and its promotable
 * heads are recorded. The root is not folded again: the caller folded it
 * to a complex literal.
 */
export function recordFoldedPromotions(
  expr: Expression,
  target: CompileTarget<Expression>,
  visited: Set<string> = new Set(),
  root = true
): void {
  if (!isFunction(expr)) return;
  if (!root) {
    // The fold evaluates the subtree and can compile a callback, which can
    // record a promotion. That code is not emitted, so the record is
    // restored.
    const recorded = CompilerState._promoted;
    let folded: ReturnType<typeof core.constantFoldValue>;
    try {
      folded = core.constantFoldValue(expr, target);
    } finally {
      CompilerState._promoted = recorded;
    }
    if (
      folded !== undefined &&
      folded.elements === undefined &&
      isNumber(folded.value) &&
      !folded.value.isComplex
    )
      return;
  }
  const h = expr.operator;
  if (h === 'Power' || h === 'Root' || PROMOTABLE_RADICAL_HEADS.has(h))
    void core.promotesRadicalToComplex(h, expr.ops);
  if (!visited.has(h)) {
    const literal = userFunctionLiteral(expr.engine, h);
    if (literal !== undefined) {
      visited.add(h);
      recordFoldedPromotions(literal.op1, target, visited, false);
    }
  }
  for (const op of expr.ops) recordFoldedPromotions(op, target, visited, false);
}

/**
 * The statement for a value `code` (the compiled `stmt`) whose value is
 * discarded, on a shader target. WGSL has no expression statement — `x +
 * 1.0;` is a syntax error there — so the value is written as a phony
 * assignment, `_ = x + 1.0;`, which evaluates it and discards it. GLSL
 * accepts an expression statement, and `code` is kept. A statement
 * (an assignment, a declaration, a loop, a jump, a block, or code that is
 * already a statement or several lines) is kept as well.
 */
export function shaderExpressionStatement(
  stmt: Expression,
  code: string,
  target: CompileTarget<Expression>
): string {
  if (target.language !== 'wgsl' || code === '' || code.includes('\n'))
    return code;
  if (isSymbol(stmt, 'Nothing')) return code;
  if (
    isFunction(stmt) &&
    [
      'Assign',
      'Declare',
      'Loop',
      'Return',
      'Break',
      'Continue',
      'Block',
    ].includes(stmt.operator)
  )
    return code;
  if (
    /^\s*(?:(?:for|while|loop|if|switch|return|break|continue|var|let|const)\b|_\s*=(?!=)|\{)/.test(
      code
    )
  )
    return code;
  return `_ = ${code}`;
}

/**
 * A loop-body target in which the desugar's temporaries resolve to BARE
 * identifiers. `compileBlock` does this for its locals; the loop-body path
 * has no locals collection of its own, so without it a temp is emitted as
 * `let _tv1 = …` but read back as the free symbol `_._tv1`.
 *
 * Returns `target` unchanged when the statement list declares no temporary.
 */
export function loopBodyTempTarget(
  stmts: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): CompileTarget<Expression> {
  const temps: string[] = [];
  for (const s of stmts)
    if (isFunction(s, 'Declare') && isSymbol(s.ops[0]))
      temps.push(s.ops[0].symbol);
  if (temps.length === 0) return target;
  return {
    ...target,
    var: (id) => (temps.includes(id) ? id : target.var(id)),
    ...withBoundScope(target, temps),
    declaredVarTypes: statementListDeclaredVarTypes(
      stmts,
      target.declaredVarTypes
    ),
  };
}

/**
 * The `declaredVarTypes` map for a statement list: the enclosing map (the
 * definition's parameter types, or an outer list's) merged with the
 * DECLARED types of this list's typed locals, for the raw-LHS lowerings
 * (the protocol-property SET reads its receiver's static type from it —
 * see `CompileTarget.declaredVarTypes`). An UNTYPED local REMOVES the
 * entry it shadows (`let p = …` over a `p: Person` parameter must not
 * keep reading as `Person`). List-scoped, not statement-ordered: a
 * use-before-declare is invalid upstream, so the approximation is safe.
 *
 * Returns the enclosing map unchanged when the list declares nothing.
 */
export function statementListDeclaredVarTypes(
  stmts: ReadonlyArray<Expression>,
  enclosing: Readonly<Record<string, Type>> | undefined
): Readonly<Record<string, Type>> | undefined {
  if (!stmts.some((s) => isFunction(s, 'Declare'))) return enclosing;
  const merged: Record<string, Type> = { ...enclosing };
  for (const arg of stmts) {
    if (!isFunction(arg, 'Declare') || !isSymbol(arg.ops[0])) continue;
    const name = arg.ops[0].symbol;
    delete merged[name];
    const src = arg.ops[1];
    const text = isString(src)
      ? src.string
      : isSymbol(src)
        ? src.symbol
        : undefined;
    if (text === undefined || text === 'unknown') continue;
    try {
      merged[name] = parseType(text, arg.engine._typeResolver);
    } catch {
      // An unparseable annotation contributes nothing (the local then
      // reads as undeclared here, the safe direction).
    }
  }
  return merged;
}

/**
 * The function nodes that `compile()` is compiling now, the innermost
 * last. A symbol compiles while the node that holds it is on top, so the
 * read of an input knows which head consumes it (`readAbsentInput`).
 */
export const _compileParents: Expression[] = [];

/** Constant source is local to one region instance, including one unrolled
 * iteration. Weak keys release the cache when the instance is discarded. */
export const _cseInlineCode = new WeakMap<
  CseRegionInstance,
  Map<object, string>
>();
