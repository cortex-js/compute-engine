// The order of the code that the caller supplies (`vars` sources,
// `functions` and `operators` entries, `compile` handlers) on the GLSL
// target: the checks that this code runs once, in the order of the
// interpreter, when the emitter writes an operand twice or computes it in a
// statement ahead of the rest of its statement.

import type { Expression } from '../global-types.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { gpuOperandShape } from './gpu-shapes.js';
import { gpuEvaluatedUnit, gpuVec2 } from './gpu-emit.js';
import {
  isShaderVariableRead,
  reachesCallerCodeOn,
  targetReadsInput,
} from './compile-folding.js';
import {
  blockLocalFunction,
  userFunctionLiteral,
} from './compile-assignment-checks.js';
import { multiClauseState } from '../multi-clause.js';

/**
 * Does the emitted source of `expr` contain code that the caller of
 * `compile()` supplied: a symbol whose `vars` entry is caller source (not a
 * plain uniform read), or an application of a head whose emission the caller
 * supplied (a `functions` or `operators` entry, an operator's own `compile`
 * handler)? The values of the symbols that `expr` reads and the bodies of the
 * user functions it calls are looked through, as the shader inlines them.
 * Caller code can count its calls or draw a number, and the compiler does not
 * see inside it, so it must run once, in the order of the interpreter, which
 * evaluates each operand once, from the first to the last. A symbol that
 * reads an input (a plain `vars` read, a bound variable) emits that read
 * only, so its stored value does not count. `skip` names a node that the
 * walk does not enter.
 */
export function gpuReachesCallerCode(
  expr: Expression,
  target: CompileTarget<Expression>,
  skip?: (node: Expression) => boolean
): boolean {
  return reachesCallerCodeOn(expr, target, skip);
}

/**
 * Fail closed when the code of `operand` is written more than once in the
 * emitted source and contains caller code (`gpuReachesCallerCode`): each copy
 * would run the caller's code again, where the interpreter evaluates the
 * operand once. `Cot(W)` with `vars: { W: 'nextValue()' }` would emit
 * `cos(nextValue()) / sin(nextValue())`. Binding the operand to a temporary
 * is not done: the temporary runs ahead of the statement, and the caller's
 * code would then run before code written before it. An operand whose
 * emitted code is the read of one variable (`isShaderVariableRead`:
 * `vars: { a: 'u_t', b: 'u_t' }`) is accepted, as two copies of a read run
 * no code.
 */
export function gpuAssertCallerCodeNotRepeated(
  head: string,
  operands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  if (
    operands.some(
      (x) => !isShaderVariableRead(x, target) && gpuReachesCallerCode(x, target)
    )
  )
    throw new Error(
      `Could not compile \`${head}\`: an operand contains code supplied by the caller ` +
        '(a `vars` source, a `functions` or `operators` entry, or a `compile` ' +
        'handler), and this shader form writes the operand more than once, so ' +
        'that code would run more than once.'
    );
}

/**
 * Fail closed when a statement that computes `hoisted` and runs ahead of the
 * current statement would change the order in which caller code
 * (`gpuReachesCallerCode`) runs. The interpreter evaluates the operands of a
 * node from the first to the last; a hoisted statement runs before every
 * part of the statement that stays in place. This is a simple, sound check,
 * which does not compare positions: when `hoisted` contains caller code, the
 * rest of the statement must have no caller code.
 *
 * The GLSL fragment has no random draw (`Random` and `WithRandomSeed` have
 * no rule in `glsl-fragment.ts`), and an admitted assignment writes only a
 * local of its function. The other impure nodes that reach the emitter are
 * blocks used as values and calls of functions whose body is a block, which
 * write only their own locals, so their order is not checked.
 *
 * `Add(W, Max(V))` with `vars: { W: 'nextValue()', V: 'vec3(nextValue())' }`
 * would hold `V` in a temporary ahead of the statement, so the call of `V`
 * would run before the call of `W`: it declines, although `V` written after
 * `W` would also decline here, where the order would be kept (a limit, not
 * a reorder). When `hoisted` contains caller code and stands at more than
 * one place of the statement, or at none (it comes from the value of a
 * symbol), the statement declines too. When `hoisted` is `undefined`, the
 * hoisted code is not known, and the statement declines when any part of it
 * contains caller code. A statement with no caller code is not affected.
 */
export function gpuAssertHoistKeepsCallerOrder(
  head: string,
  hoisted: ReadonlyArray<Expression> | undefined,
  target: CompileTarget<Expression>
): void {
  if (!gpuHoistKeepsCallerOrder(hoisted, target))
    throw new Error(
      `Could not compile \`${head}\`: its code would be computed in a statement ` +
        'ahead of the rest of its statement, and code supplied by the caller ' +
        '(a `vars` source, a `functions` or `operators` entry, or a `compile` ' +
        'handler) would then run out of the order of the interpreter.'
    );
}

/**
 * For each statement sink, the depths of the compile stack
 * (`BaseCompiler.compileParents()`) at which the statement form of a
 * selection started to compile a clause that runs in a branch
 * (`gpuInSelectionBranch`). A statement hoisted while such a clause compiles
 * is placed in the branch, ahead of the rest of that clause only.
 */
const gpuBranchStarts = new Map<object, number[]>();

/**
 * Run `f`, which compiles a clause of the statement form of a selection
 * whose hoisted statements are placed in the branch of that clause
 * (`compileGPUStatementSelection`). While it runs, the order check of a
 * hoisted statement (`gpuHoistKeepsCallerOrder`) compares it with the rest
 * of the clause, not with the whole statement: the branch runs after the
 * code that comes before the selection, and the selection itself was
 * checked against the rest of the statement. The clause is the node that
 * the compiler pushes first onto the compile stack inside `f`; this is the
 * node that is compiled, which can be a copy of the clause expression
 * (`Match` compiles a canonical copy of each case body).
 */
export function gpuInSelectionBranch<T>(sink: object, f: () => T): T {
  let starts = gpuBranchStarts.get(sink);
  if (starts === undefined) {
    starts = [];
    gpuBranchStarts.set(sink, starts);
  }
  starts.push(BaseCompiler.compileParents().length);
  try {
    return f();
  } finally {
    starts.pop();
    if (starts.length === 0) gpuBranchStarts.delete(sink);
  }
}

/**
 * The expression that a statement hoisted into the sink of `target` runs
 * ahead of: the clause of the selection branch that is compiling
 * (`gpuInSelectionBranch`), else the evaluated part of the statement
 * (`gpuEvaluatedUnit`).
 */
function gpuCallerOrderUnit(
  target: CompileTarget<Expression>
): Expression | undefined {
  const starts =
    target.hoist === undefined ? undefined : gpuBranchStarts.get(target.hoist);
  const depth = starts?.[starts.length - 1];
  if (depth !== undefined) {
    const clause = BaseCompiler.compileParents()[depth];
    if (clause !== undefined) return clause;
  }
  return gpuEvaluatedUnit(target);
}

/** The test of `gpuAssertHoistKeepsCallerOrder`, as a boolean. */
export function gpuHoistKeepsCallerOrder(
  hoisted: ReadonlyArray<Expression> | undefined,
  target: CompileTarget<Expression>
): boolean {
  const unit = gpuCallerOrderUnit(target);
  if (hoisted === undefined)
    return unit === undefined || !gpuReachesCallerCode(unit, target);
  if (!hoisted.some((x) => gpuReachesCallerCode(x, target))) return true;
  if (unit === undefined) return false;
  const own = new Set(hoisted);
  // A read of one variable in the rest of the statement
  // (`isShaderVariableRead`) runs no code. Hoisted caller code can write the
  // variable, so a read before it is checked below (`gpuReadsVarsBefore`).
  if (
    gpuReachesCallerCode(
      unit,
      target,
      (n) => own.has(n) || isShaderVariableRead(n, target)
    )
  )
    return false;
  // Each hoisted operand that contains caller code must stand at one place
  // of the statement, so skipping it skips no other occurrence of its code.
  // The count walks the graph that `gpuReachesCallerCode` walks: the values
  // of the symbols (except a symbol that reads an input), the literals of
  // the user functions and of the functions the block defines, and the
  // clauses of a multi-clause function, as the shader inlines them. With
  // `g(n) := n + Max(V)`, `Add(g(1), Max(V))` reaches the node `Max(V)`
  // twice. The count of a node is computed once, so a tree with shared nodes
  // is walked in linear time. A symbol or a function reached again inside
  // its own value or body (a cycle), or a block-local function whose literal
  // cannot be read, gives no count, and the statement declines.
  const count = (x: Expression): number | undefined => {
    const memo = new Map<Expression, number>();
    const names = new Set<string>();
    const fns = new Set<string>();
    let unknown = false;
    const enter = (
      set: Set<string>,
      name: string,
      body: Expression | null | undefined
    ): number => {
      if (body === null || set.has(name)) {
        unknown = true;
        return 0;
      }
      if (body === undefined) return 0;
      set.add(name);
      const c = walk(body);
      set.delete(name);
      return c;
    };
    const walk = (n: Expression): number => {
      const known = memo.get(n);
      if (known !== undefined) return known;
      let c = n === x ? 1 : 0;
      if (isSymbol(n)) {
        const name = n.symbol;
        const local = blockLocalFunction(name, target);
        if (local !== undefined) c += enter(fns, name, local);
        else if (!targetReadsInput(name, target))
          c += enter(names, name, n.engine._getSymbolValue(name));
      } else if (isDictionary(n)) {
        for (const v of n.values) c += walk(v);
      } else if (isFunction(n)) {
        for (const op of n.ops) c += walk(op);
        const name = n.operator;
        const local = blockLocalFunction(name, target);
        if (local !== undefined) c += enter(fns, name, local);
        else {
          const literal = userFunctionLiteral(n.engine, name);
          if (literal !== undefined) c += enter(fns, name, literal);
          else {
            const clauses = multiClauseState(
              n.engine.lookupDefinition(name)
            )?.clauses;
            if (clauses !== undefined && clauses.length > 0) {
              if (fns.has(name)) unknown = true;
              else {
                fns.add(name);
                for (const clause of clauses) c += walk(clause.literal);
                fns.delete(name);
              }
            }
          }
        }
      }
      memo.set(n, c);
      return c;
    };
    const total = walk(unit);
    return unknown ? undefined : total;
  };
  if (hoisted.some((x) => gpuReachesCallerCode(x, target) && count(x) !== 1))
    return false;
  return !gpuReadsVarsBefore(unit, own, target);
}

/**
 * Does `unit` read a `vars` key (a symbol that the caller maps to shader
 * code, whatever that code is) before it reaches the first node of `own`,
 * in the order of the interpreter: the operands of a node from the first to
 * the last, then the body of the function it calls? Caller code can write a
 * private shader variable that a plain read such as `state.value` reads, so
 * hoisted caller code must not run ahead of such a read: with
 * `vars: { W: 'state.value' }` and `functions: { F: 'nextValue' }`,
 * `(W, If(c, F(x), 0))` would call `nextValue` before `W` is read. A read
 * after the hoisted node runs after it in both orders. A literal, a bound
 * variable and a symbol with no `vars` entry are not counted. The values of
 * symbols and the bodies of user functions are looked through, as the
 * shader inlines them. A block-local function whose literal cannot be read
 * counts as a read. When no node of `own` is found, every read counts.
 */
function gpuReadsVarsBefore(
  unit: Expression,
  own: ReadonlySet<Expression>,
  target: CompileTarget<Expression>
): boolean {
  const names = new Set<string>();
  const fns = new Set<string>();
  let reached = false;
  const enter = (set: Set<string>, name: string, body: Expression): boolean => {
    if (set.has(name)) return false;
    set.add(name);
    const found = visit(body);
    set.delete(name);
    return found;
  };
  const visit = (n: Expression): boolean => {
    if (reached) return false;
    if (own.has(n)) {
      reached = true;
      return false;
    }
    if (isSymbol(n)) {
      const name = n.symbol;
      const local = blockLocalFunction(name, target);
      if (local === null) return true;
      if (local !== undefined) return enter(fns, name, local);
      if (target.varsKeys?.has(name) === true) return true;
      if (target.boundVars?.has(name) === true) return false;
      const value = n.engine._getSymbolValue(name);
      return value !== undefined && enter(names, name, value);
    }
    if (isDictionary(n)) {
      for (const v of n.values) if (visit(v)) return true;
      return false;
    }
    if (!isFunction(n)) return false;
    for (const op of n.ops) if (visit(op)) return true;
    if (reached) return false;
    const name = n.operator;
    const local = blockLocalFunction(name, target);
    if (local === null) return true;
    if (local !== undefined) return enter(fns, name, local);
    const literal = userFunctionLiteral(n.engine, name);
    if (literal !== undefined) return enter(fns, name, literal);
    for (const clause of multiClauseState(n.engine.lookupDefinition(name))
      ?.clauses ?? [])
      if (enter(fns, name, clause.literal)) return true;
    return false;
  };
  return visit(unit);
}

/**
 * Compile an operand the caller will splice MORE THAN ONCE into its emitted
 * source. A pure operand compiles directly (byte-identical to `compile(x)`
 * for the common case). An impure one is bound to a hoisted temporary, so
 * that it is computed once, or the head declines where no statement sink is
 * available. In the GLSL fragment, such an operand is a block used as a
 * value or a call of a function whose body is a block (the fragment has no
 * random draw). `complex`
 * selects a `vec2` temporary (a complex operand has no scalar shape, so the
 * scalar-shape test is skipped there; `canHoist` is the test that applies).
 * An operand that contains caller code (`gpuReachesCallerCode`) declines.
 */
export function gpuOperandOnce(
  head: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  complex = false
): string {
  // Caller code would run once per copy of the operand, and a temporary for
  // it would run ahead of earlier code (`gpuAssertCallerCodeNotRepeated`).
  gpuAssertCallerCodeNotRepeated(head, [x], target);
  // Read through the value of a symbol, as the shader inlines it: a symbol
  // whose value is impure is pure to the engine.
  if (!BaseCompiler.foldValueImpure(x)) return compile(x);
  if (
    !BaseCompiler.canHoist(target) ||
    (!complex && gpuOperandShape(x) !== 'scalar')
  )
    throw new Error(
      `Could not compile \`${head}\`: an impure operand cannot be bound to a temporary ` +
        'at this position, and the code writes it more than once.'
    );
  gpuAssertHoistKeepsCallerOrder(head, [x], target);
  const t = BaseCompiler.tempVar(target);
  const type = complex ? gpuVec2() : 'float';
  const decl = `${type} ${t}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
  return t;
}
