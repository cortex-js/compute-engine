// Block locals: value frames, local reads and writes, and the checks of the
// order of the statements (use before declaration, a first value that reads
// the name of its local).

import type { Scope } from '../types-evaluation.js';
import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { signatureEffects } from '../../common/type/utils.js';
import { parseType } from '../../common/type/parse.js';
import type { EffectSet } from '../../common/type/types.js';
import { isFunctionDeclarationStatement } from '../library/control-structures.js';
import {
  isSymbol,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { functionLiteralDeclaredEffects } from '../boxed-expression/function-literal.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  EffectContractError,
  inferFunctionLiteralEffects,
} from '../boxed-expression/effects-inference.js';
import { isEffectSubset } from '../../common/type/effects.js';
import { declareValueOperand } from './compile-declarations.js';
import { localShapeFrameOf } from './compile-shapes.js';
import type { LocalEntry, LocalValueFrame } from './compiler-types.js';
import { tempVar } from './compiler-naming.js';
import { CompilerState } from './compiler-state.js';

/**
 * Base compiler class containing language-agnostic compilation logic
 */
/**
 * Thrown by every observable operation on `UNREADABLE_OPERAND`, so the
 * reference analysis can tell a handler that read its operands from one that
 * declined without looking at them.
 */
export const OPERAND_READ = new Error(
  'operand read during a reference-analysis probe'
);

/** An operand a caller's `compile` handler cannot read: every property access,
 * `in` test, key listing or prototype read throws `OPERAND_READ`. Handed to a
 * handler by the reference analysis inside a value the compile refuses to bake
 * in — see the probe in `analyzeReferences`. */
export const UNREADABLE_OPERAND: object = new Proxy(Object.create(null), {
  get: () => {
    throw OPERAND_READ;
  },
  has: () => {
    throw OPERAND_READ;
  },
  ownKeys: () => {
    throw OPERAND_READ;
  },
  getPrototypeOf: () => {
    throw OPERAND_READ;
  },
  getOwnPropertyDescriptor: () => {
    throw OPERAND_READ;
  },
});

/**
 * Rewrite each `function` definition in a statement list — `DefineFunction(
 * name, ["Function", body, …params])` — into the equivalent value
 * declaration `Declare(name, "unknown", literal)`.
 *
 * A `function` definition inside a block is block-scoped (it does not leak
 * to the enclosing scope), so it binds exactly what `const name = (…) => …`
 * binds; rewriting to that shape routes it through the machinery the bound
 * literal already has — the `let name = ((…) => …)` emission, the bare-name
 * reads, and the call-site resolution of `CompileTarget.localFunctions`,
 * which gives the definition true recursion (the arrow reads its own binding
 * at call time, after initialization). Before this, `DefineFunction` reached
 * `compileExpr` with no lowering on any target and the whole program failed
 * closed, so a program that defines a function and calls it — the ordinary
 * shape of an Epsil file — could not be compiled at all.
 *
 * Two shapes are deliberately LEFT ALONE, and keep failing closed:
 *
 *  - A MULTI-CLAUSE set (two or more definitions of the same name in one
 *    list). `DefineFunction` ACCUMULATES clauses and the call dispatches on
 *    the argument types; a single value binding would silently keep only the
 *    last clause, answering the wrong branch rather than failing.
 *  - The last statement of a VALUE-CARRYING block, whose value is the
 *    block's: a declaration has no value there, and the rewrite would emit
 *    `return let name = …`.
 *
 * Returns `stmts` unchanged when the list defines no function.
 */
export function withDefineFunctionDeclares(
  stmts: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  valueUsed: boolean
): ReadonlyArray<Expression> {
  // Same target restriction as `CompileTarget.localFunctions`: only a target
  // that binds a function-valued local as a value (`bindsLocalFunctions`:
  // the JavaScript family and Python) can bind one at all. The GPU targets
  // declare a local with a scalar type, separately from its assignment, so
  // the rewrite would emit `float g;` against an arrow-function assignment
  // — source no compiler accepts. They keep failing closed on
  // `DefineFunction` itself.
  if (!bindsLocalFunctions(target)) return stmts;
  if (!stmts.some((s) => isFunction(s, 'DefineFunction'))) return stmts;

  // Names defined more than once in this list are a multi-clause set.
  const definitionCount = new Map<string, number>();
  for (const s of stmts) {
    if (!isFunction(s, 'DefineFunction') || !isSymbol(s.ops[0])) continue;
    const name = s.ops[0].symbol;
    definitionCount.set(name, (definitionCount.get(name) ?? 0) + 1);
  }

  const last = stmts.length - 1;
  // A definition is moved only when it is a function declaration of the
  // statement list (`isFunctionDeclarationStatement()`): a
  // `DefineFunction` of a `Function` literal, whose name is not an absence
  // marker and not the constructor of a declared nominal type. A
  // constructor definition takes effect when it runs, so it is not
  // rewritten to a `Declare` of a local function. A generic definition is
  // moved too, although the interpreter installs it only when its
  // statement runs: the compiled code needs the declaration before the
  // first statement.
  const rewritable = (s: Expression, i: number): boolean => {
    if (!isFunction(s, 'DefineFunction') || !isSymbol(s.ops[0])) return false;
    if (valueUsed && i === last) return false;
    if ((definitionCount.get(s.ops[0].symbol) ?? 0) > 1) return false;
    return isFunctionDeclarationStatement(s.engine, s);
  };
  const asDeclare = (
    s: Expression & FunctionInterface,
    type?: Expression
  ): Expression =>
    s.engine._fn('Declare', [
      s.ops[0],
      type ?? s.engine.string('unknown'),
      s.ops[1],
    ]);

  // HOISTED to the front, in their original relative order, rather than
  // rewritten in place. A `function` definition is visible to the WHOLE
  // statement list — `DefineFunction`'s canonical handler declares the name
  // as the program canonicalizes, which is what lets `let a = g(3)` precede
  // `function g(k) { … }` and still answer 4 in the interpreter. Emitted in
  // place, the same program compiles to `let a = g(3); let g = …`, and `g`
  // is then read inside its own temporal dead zone: a runtime
  // `ReferenceError: Cannot access 'g' before initialization`, for a program
  // that interprets fine.
  //
  // Hoisting is safe because what moves is a `Declare` of a pure `Function`
  // LITERAL: it has no side effects to reorder, and its body reads whatever
  // it references at CALL time, not at binding time — so a hoisted
  // definition may still reference locals bound after it.
  //
  // A `const`/`let` binding of a lambda is NOT hoisted, because the
  // interpreter does not hoist it either: it declares nothing until its own
  // statement runs, so a call before it is invalid there too. Those resolve
  // through the statement-ordered map in `compileBlock`, and a forward call
  // fails closed at compile time rather than reaching a dead zone.
  //
  // A `Declare` with no value of the same name, BEFORE the definition
  // (`let g: (integer) -> integer` then `function g(k) { … }`), is removed.
  // In the interpreter it declares the name and its type, and the
  // definition then gives the name its function. The hoisted `Declare`
  // with the literal binds the name in the compiled code, so the two
  // statements are one binding. Kept, the `Declare` with no value was a
  // second binding of the name after the first one: the call `g(1)` did
  // not resolve to the function (`Unknown operator \`g\``). The declared
  // type moves to the hoisted `Declare`, so the block keeps it as the
  // declared type of the name (`statementListDeclaredVarTypes`), as for a
  // function literal assigned to a declared name (`g = (k) => …`): a call
  // of the local whose argument can be outside a declared parameter type
  // declines (`localParameterChecks`). A `Declare` with a value is kept: the
  // interpreter refuses the definition of a name that holds a value, and
  // the compilation fails too.
  const declaredBefore = new Set<number>();
  const declaredTypes = new Map<string, Expression>();
  stmts.forEach((s, i) => {
    if (
      !isFunction(s, 'Declare') ||
      !isSymbol(s.ops[0]) ||
      declareValueOperand(s.ops) !== undefined
    )
      return;
    const name = s.ops[0].symbol;
    if (
      stmts.some(
        (d, j) =>
          j > i &&
          rewritable(d, j) &&
          isSymbol((d as Expression & FunctionInterface).ops[0], name)
      )
    ) {
      declaredBefore.add(i);
      if (isString(s.ops[1])) declaredTypes.set(name, s.ops[1]);
    }
  });
  const hoisted: Expression[] = [];
  const rest: Expression[] = [];
  stmts.forEach((s, i) => {
    if (rewritable(s, i)) {
      const d = s as Expression & FunctionInterface;
      hoisted.push(
        asDeclare(
          d,
          isSymbol(d.ops[0]) ? declaredTypes.get(d.ops[0].symbol) : undefined
        )
      );
    } else if (!declaredBefore.has(i)) rest.push(s);
  });
  return [...hoisted, ...rest];
}

/**
 * Refuse the compilation of a statement list when it defines a named
 * function that the interpreter refuses to define because of its effects:
 * a `DefineFunction(name, Function(…))` or an `Assign(name, Function(…))`
 * statement (`function g(k) { … }`, `g(k) = …`, `g = (k) => …`).
 *
 * The interpreter checks the effects of the body when it installs the
 * definition (`BoxedOperatorDefinition`, `defineFunctionClause()`):
 *
 * - When the function states no effects, a body that writes a variable
 *   outside the function (or makes an assumption) is refused: such a
 *   write requires the `scope` effect, which must be declared
 *   (`docs/EFFECTS-MODEL.md`, "Scope is opt-in").
 * - When the function states its effects (`function g() pure { … }`), the
 *   effects of the body must be in the stated set.
 *
 * The compiled code does not run this check, so without this test the
 * compiled program wrote the outer variable where the interpreter gives
 * an error: with `let t = 0` before `function g(k) { t = k + 1; t }`, the
 * compiled `[g(1), t]` was `[2, 2]`.
 *
 * A definition is not checked here, and is left to the interpreter, when
 * an earlier `Declare` statement of the list or the binding of the name
 * (`scope`, the scope of the statement list) states the effects of the
 * name: the declaration is then the contract. A name that the list defines
 * more than once is a set of clauses, which the compilation refuses for
 * another reason (`withDefineFunctionDeclares()`).
 */
export function refuseEffectContractViolations(
  stmts: ReadonlyArray<Expression>,
  scope: Expression['localScope']
): void {
  if (
    !stmts.some(
      (s) =>
        (isFunction(s, 'DefineFunction') || isFunction(s, 'Assign')) &&
        isFunction(s.ops[1], 'Function')
    )
  )
    return;
  const definitionCount = new Map<string, number>();
  for (const s of stmts) {
    if (!isFunction(s, 'DefineFunction') || !isSymbol(s.ops[0])) continue;
    const name = s.ops[0].symbol;
    definitionCount.set(name, (definitionCount.get(name) ?? 0) + 1);
  }
  // The effects that an earlier `Declare` statement states for a name
  // (`let g: (integer) scope -> integer`, `let g: (integer) pure -> real`).
  // A later definition of that name is checked against them: the
  // interpreter refuses `function g(k) { Random() }` under the `pure`
  // declaration (`incompatible-type`), and the compiled program must not
  // run it either. (Before 2026-10-19 such a name was skipped, so the
  // compiled program ran the definition the interpreter refused.)
  const declaredEffects = new Map<string, EffectSet>();
  // The names that an earlier statement defines with a function literal.
  const definedBefore = new Set<string>();
  for (const s of stmts) {
    if (isFunction(s, 'Declare') && isSymbol(s.ops[0])) {
      const type = s.ops[1];
      const source = isString(type) ? type.string : undefined;
      if (source === undefined) continue;
      try {
        const parsed = parseType(source, s.engine._typeResolver);
        const effects = signatureEffects(parsed);
        if (effects !== undefined)
          declaredEffects.set(s.ops[0].symbol, effects);
      } catch {
        // Not a type: the `Declare` statement reports it.
      }
      continue;
    }
    if (!isFunction(s, 'DefineFunction') && !isFunction(s, 'Assign')) continue;
    const target = s.ops[0];
    const literal = s.ops[1];
    if (!isSymbol(target) || !isFunction(literal, 'Function')) continue;
    const name = target.symbol;
    if ((definitionCount.get(name) ?? 0) > 1) continue;
    const declared = declaredEffects.get(name);
    if (declared !== undefined) {
      const inferred = inferFunctionLiteralEffects(s.engine, literal, {
        selfName: name,
      });
      if (
        !inferred.unresolvedHead &&
        !isEffectSubset(inferred.effects, declared)
      ) {
        const error = new EffectContractError(name, declared, inferred.effects);
        throw new Error(
          `Could not compile \`${s.operator}\`: ${error.message}.`
        );
      }
      continue;
    }
    // The binding of a name that an earlier statement of the list defines
    // holds the effects of that definition, not a declaration. The
    // interpreter checks the new literal on its own then: with
    // `function g(k) scope { … }` before it, `g = (k) => do { t = k + 2;
    // t }` is refused, since the literal states no effects and writes
    // `t`. The literal is checked here in the same way.
    const redefinition = definedBefore.has(name);
    definedBefore.add(name);
    if (!redefinition && bindingStatesEffects(scope, name)) continue;
    const stated = functionLiteralDeclaredEffects(literal);
    const inferred = inferFunctionLiteralEffects(s.engine, literal, {
      selfName: name,
    });
    let error: EffectContractError | undefined = undefined;
    if (stated !== undefined) {
      if (!inferred.unresolvedHead && !isEffectSubset(inferred.effects, stated))
        error = new EffectContractError(name, stated, inferred.effects);
    } else if (inferred.escapingWrite)
      error = new EffectContractError(
        name,
        undefined,
        inferred.effects,
        undefined,
        /* scopeDefault */ true
      );
    if (error !== undefined)
      throw new Error(`Could not compile \`${s.operator}\`: ${error.message}.`);
  }
}

/** Whether the binding of `name` that `scope` or one of its parents holds
 * states the effects of the function: an operator definition or a value
 * definition whose effects are declared, or a value definition with a
 * declared (not inferred) signature type that carries effects. */
export function bindingStatesEffects(
  scope: Expression['localScope'],
  name: string
): boolean {
  for (
    let s: NonNullable<Expression['localScope']> | null | undefined = scope;
    s;
    s = s.parent
  ) {
    const def = s.bindings.get(name);
    if (def === undefined) continue;
    if ('operator' in def) return def.operator.effectsDeclared;
    if ('value' in def) {
      const value = def.value;
      if (value.effectsDeclared) return true;
      return (
        !value.inferredType && signatureEffects(value.type.type) !== undefined
      );
    }
    return false;
  }
  return false;
}

/**
 * The locals of a block and the values assigned to each of them, for the
 * callback analysis that reads the element type of a local collection
 * (`untrustedCallbackSource` in `compile-callbacks.ts`).
 *
 * A variable outside the block that the block assigns (`c := n + 1` with
 * `c` declared in the engine compiles to `_.c = _.n + 1`) is a local for
 * this purpose too.
 *
 * The locals are keyed by their definition (the binding of the scope
 * that declares them), not by their name, and so are the reads
 * (`blockLocalOf`): a binder nested in the block that uses the name of a
 * free variable (`Sum(2n, (n, 1, 3))`, `n ↦ 2n`, a `Loop` over `n`) is
 * not the local.
 */
export function blockLocalValueFrame(
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>,
  scope: Scope | undefined
): LocalValueFrame {
  const byDef = new Map<object, LocalEntry>();
  const frame: LocalValueFrame = { byDef };
  // The definition that `name` resolves to in the innermost of `scopes`
  // that binds it. When no
  // scope binds it: a local of a block with no scope, or a temporary
  // that a desugar added (`_tv1` of a destructuring assignment), is keyed
  // by name; a variable outside the block that an assignment writes
  // (`target`, the symbol node of the assignment) is keyed by the
  // definition that its reads have.
  const resolve = (
    name: string,
    scopes: ReadonlyArray<Scope>,
    target?: Expression
  ): object | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const binding = scopes[i].bindings.get(name);
      if (binding === undefined) continue;
      return 'value' in binding ? (binding.value as object) : binding;
    }
    if (locals.includes(name)) return localNameKey(name);
    if (target === undefined) return undefined;
    // The target of an assignment is held, not bound, so its definition
    // is looked up: in the scopes that enclose the block (a parameter of
    // the enclosing function), then in the engine.
    let binding: unknown;
    for (let sc = scope?.parent; sc && binding === undefined; sc = sc.parent)
      binding = sc.bindings.get(name);
    binding ??= target.engine.lookupDefinition(name);
    if (binding === undefined || binding === null) return undefined;
    return typeof binding === 'object' && 'value' in binding
      ? (binding.value as object)
      : (binding as object);
  };
  const entryOf = (
    name: string,
    scopes: ReadonlyArray<Scope>,
    target?: Expression
  ): LocalEntry | undefined => {
    const def = resolve(name, scopes, target);
    if (def === undefined) return undefined;
    let entry = byDef.get(def);
    if (entry === undefined) {
      entry = { values: [] };
      byDef.set(def, entry);
    }
    return entry;
  };
  const rootScopes: Scope[] = scope === undefined ? [] : [scope];
  for (const name of locals) entryOf(name, rootScopes);
  // The symbol nodes that a target of `Assign`/`Declare` names: the
  // symbol, or the leaves of a destructuring pattern. A leaf is given the
  // whole value.
  const targetSymbols = (t: Expression | undefined): Expression[] =>
    t === undefined
      ? []
      : isSymbol(t)
        ? [t]
        : isFunction(t) && (t.operator === 'Tuple' || t.operator === 'List')
          ? t.ops.flatMap(targetSymbols)
          : [];
  // Each node object once: a statement built from shared subtrees has
  // few distinct nodes but exponentially many paths.
  const seen = new Set<Expression>();
  const visit = (e: Expression, scopes: ReadonlyArray<Scope>): void => {
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    const inner =
      e.localScope !== undefined && scope !== undefined
        ? [...scopes, e.localScope]
        : scopes;
    if (e.operator === 'Assign' || e.operator === 'Declare') {
      const value =
        e.operator === 'Assign' ? e.ops[1] : declareValueOperand(e.ops);
      if (value !== undefined)
        for (const t of targetSymbols(e.ops[0])) {
          if (!isSymbol(t)) continue;
          entryOf(t.symbol, inner, t)?.values.push(value);
        }
    }
    for (const op of e.ops) visit(op, inner);
  };
  for (const stmt of stmts) visit(stmt, rootScopes);
  return frame;
}

export function localNameKey(name: string): object {
  let key = _localNameKeys.get(name);
  if (key === undefined) {
    key = { name };
    _localNameKeys.set(name, key);
  }
  return key;
}

/**
 * The assignments in `expr`, in the order of the operands, whose target is
 * a symbol in `names`. An assignment in a function literal is not
 * included, nor an assignment in a nested block that declares the name
 * (`let`) or in the body of an operator whose index has the name: these
 * write another binding.
 */
export function nestedAssignmentsTo(
  expr: Expression,
  names: ReadonlySet<string>
): { assign: Expression; name: string; value: Expression }[] {
  const result: { assign: Expression; name: string; value: Expression }[] = [];
  const walk = (e: Expression, hidden: ReadonlySet<string>): void => {
    if (!isFunction(e) || e.operator === 'Function') return;
    let inner = hidden;
    const hide = (target: Expression | undefined) => {
      if (isSymbol(target) && names.has(target.symbol))
        inner = new Set([...inner, target.symbol]);
    };
    if (e.operator === 'Block') {
      for (const s of e.ops)
        if (isFunction(s, 'Declare') || isFunction(s, 'DefineFunction'))
          hide(s.ops[0]);
    } else
      for (const clause of e.ops)
        if (isFunction(clause, 'Element') || isFunction(clause, 'Limits'))
          hide(clause.ops[0]);
    if (
      e.operator === 'Assign' &&
      isSymbol(e.ops[0]) &&
      e.ops[1] !== undefined &&
      names.has(e.ops[0].symbol) &&
      !inner.has(e.ops[0].symbol)
    )
      result.push({ assign: e, name: e.ops[0].symbol, value: e.ops[1] });
    for (const op of e.ops) walk(op, inner);
  };
  walk(expr, new Set());
  return result;
}

/**
 * Fail closed when the first value of a local of a block reads the name of
 * the local: `Declare(x, "unknown", x + 1)`, which the parse of
 * `x \coloneq x+1; 2x` gives. The interpreter reads the enclosing binding of `x` in that value
 * (the symbol `x`, left symbolic), and the compiled code has no value for
 * it: JavaScript read `undefined` and answered `NaN`, GLSL read an uninitialized variable, and Python read
 * a parameter of the same name.
 *
 * The first value of a local is the value of the first statement of the
 * list that declares it with a value or assigns it. A read of the local in
 * an earlier statement is the static error `read-before-declaration`, and
 * a `Declare` below a statement is the static error
 * `declaration-below-statement`, so this test looks at that one value only.
 * A read inside a function literal is not counted, since it happens when
 * the function is called, nor is a read in a nested scope that declares
 * the same name again.
 */
export function assertLocalsAssignedBeforeRead(
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>
): void {
  if (locals.length === 0) return;
  const pending = new Set(locals);
  // Each walk visits a node once: a subtree shared by several operands
  // (a DAG) gives the same answer at every visit, and walking it once per
  // path took exponential time.
  const reads = (root: Expression, name: string): boolean => {
    const seen = new Set<Expression>();
    const walk = (e: Expression): boolean => {
      if (isSymbol(e)) return e.symbol === name;
      if (!isFunction(e) || seen.has(e)) return false;
      seen.add(e);
      if (e.operator === 'Function') return false;
      if (e.localScope?.bindings.has(name) && e.operator !== 'Block')
        return false;
      if (
        e.operator === 'Block' &&
        e.ops.some(
          (s) =>
            isFunction(s, 'Declare') &&
            isSymbol(s.ops[0]) &&
            s.ops[0].symbol === name
        )
      )
        return false;
      if (e.operator === 'Assign' || e.operator === 'Declare')
        return e.ops.slice(1).some(walk);
      return e.ops.some(walk);
    };
    return walk(root);
  };
  for (const stmt of stmts) {
    if (!isFunction(stmt) || !isSymbol(stmt.ops[0])) continue;
    const isDeclare = stmt.operator === 'Declare';
    if (!isDeclare && stmt.operator !== 'Assign') continue;
    const name = stmt.ops[0].symbol;
    if (!pending.has(name)) continue;
    const value = isDeclare ? declareValueOperand(stmt.ops) : stmt.ops[1];
    if (value === undefined) continue;
    if (reads(value, name)) unassignedLocalRead(name);
    pending.delete(name);
    if (pending.size === 0) return;
  }
}

/**
 * Decline a block in which a statement reads or assigns a name before the
 * `Declare` of that name in the same block (`Block(U ≔ 2; Declare(U); …)`).
 *
 * The local of the block exists from the start of the block, so the name
 * of such a statement is the local, not a variable of an enclosing scope.
 * The canonicalization makes the use a static error
 * (`read-before-declaration`), for a write as for a read, so a valid
 * expression has no such use, and this check stays as a second check.
 * Before the static rule, the compiled code did not report it:
 * JavaScript threw a `ReferenceError` when the code ran, and GLSL
 * wrote a variable before its declaration, which is not valid source.
 *
 * A use inside a function literal is not counted, since it happens when
 * the function is called, nor is a use in a nested scope that declares
 * the same name again.
 */
export function assertNoUseBeforeDeclare(
  stmts: ReadonlyArray<Expression>
): void {
  const declaredAt = new Map<string, number>();
  stmts.forEach((stmt, i) => {
    if (
      isFunction(stmt, 'Declare') &&
      isSymbol(stmt.ops[0]) &&
      !declaredAt.has(stmt.ops[0].symbol)
    )
      declaredAt.set(stmt.ops[0].symbol, i);
  });
  if (declaredAt.size === 0) return;
  // Each walk visits a node once: a subtree shared by several operands
  // (a DAG) gives the same answer at every visit.
  const uses = (root: Expression, name: string): boolean => {
    const seen = new Set<Expression>();
    const walk = (e: Expression): boolean => {
      if (isSymbol(e)) return e.symbol === name;
      if (!isFunction(e) || seen.has(e)) return false;
      seen.add(e);
      if (e.operator === 'Function') return false;
      if (e.localScope?.bindings.has(name) && e.operator !== 'Block')
        return false;
      if (
        e.operator === 'Block' &&
        e.ops.some(
          (s) =>
            isFunction(s, 'Declare') &&
            isSymbol(s.ops[0]) &&
            s.ops[0].symbol === name
        )
      )
        return false;
      return e.ops.some(walk);
    };
    return walk(root);
  };
  for (const [name, at] of declaredAt)
    for (let i = 0; i < at; i++)
      if (uses(stmts[i], name))
        throw new Error(
          `Could not compile \`Block\`: a statement uses the block local ` +
            `"${name}" before the \`Declare\` of "${name}" in the same ` +
            `block. The local exists from the start of the block, so the ` +
            `statement reads or writes the local, not a variable of an ` +
            `enclosing scope, and such a use is the static error ` +
            `\`read-before-declaration\`. Move the \`Declare\` before the ` +
            `first use, or give the local another name.`
        );
}

export function unassignedLocalRead(name: string): never {
  throw new Error(
    `Could not compile \`Block\`: a statement reads the block local ` +
      `"${name}" before any statement gives it a value. A local is ` +
      `declared with a value (\`Declare(${name}, type, value)\`, or a first ` +
      `assignment at the level of the block); the compiled ` +
      `code would read an uninitialized variable. Give "${name}" a value ` +
      `first, or give the ` +
      `local another name (\`Block(y ≔ ${name} + 1; 2y)\`), so that ` +
      `"${name}" is the input.`
  );
}

/** The fresh names that `compileBlock` gave to block locals while
 * `withFreshBlockLocals` runs, which `assignLValue` accepts as the
 * spelling of a write. Cleared when the outermost call ends. */
export const _freshLocalNames = new Set<string>();
/** The emitted name of a `Declare` statement whose local has the name of an
 * identifier that the emitted code uses (`_SYS`). The routine that compiles
 * the statement list of the `Declare` (`compileBlock`, or `compileLoopBody`
 * for a loop body) gives such a local a fresh name and records it here,
 * keyed by the `Declare` node, before it compiles the statements
 * (`noteReservedDeclares`). It removes the record when the statements are
 * compiled. The `Declare` handler reads it, so the declaration and the
 * reads in the list use the same name. */
export const _reservedDeclareNames = new WeakMap<object, string>();

/**
 * Give a fresh name to each local in `locals` that has the name of an
 * identifier that the emitted code uses (`CompileTarget.reservedEmittedNames`,
 * for example `_SYS`, the runtime helper object of the JavaScript target).
 * Otherwise the declaration of the local hides that identifier in its
 * scope, and each helper call in the scope fails at run time. A local that
 * has an entry in `spelled` already keeps it. Each fresh name goes into
 * `spelled` and into `_freshLocalNames`, so that `assignLValue` accepts a
 * write of it. Each name that this call adds to `_freshLocalNames` is also
 * pushed to `added`: the caller removes these names when the scope ends.
 */
export function spellReservedLocals(
  locals: ReadonlyArray<string>,
  target: CompileTarget<Expression>,
  spelled: Map<string, string>,
  added: string[]
): void {
  for (const local of locals) {
    if (spelled.has(local)) continue;
    if (target.reservedEmittedNames?.has(local) !== true) continue;
    const fresh = tempVar(target);
    spelled.set(local, fresh);
    if (!_freshLocalNames.has(fresh)) {
      _freshLocalNames.add(fresh);
      added.push(fresh);
    }
  }
}

/**
 * Record in `_reservedDeclareNames` the emitted name (`spell`) of each
 * `Declare` statement in `stmts` whose local has the name of an identifier
 * that the emitted code uses. Returns the function that removes the
 * records (and puts back a record that a statement had before). Call it
 * when the statements are compiled, also when the compilation fails.
 */
export function noteReservedDeclares(
  stmts: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  spell: (name: string) => string
): () => void {
  const previous = new Map<object, string | undefined>();
  for (const s of stmts) {
    if (!isFunction(s, 'Declare') || !isSymbol(s.ops[0])) continue;
    const name = s.ops[0].symbol;
    if (target.reservedEmittedNames?.has(name) !== true) continue;
    if (!previous.has(s)) previous.set(s, _reservedDeclareNames.get(s));
    _reservedDeclareNames.set(s, spell(name));
  }
  return () => {
    for (const [s, name] of previous)
      if (name === undefined) _reservedDeclareNames.delete(s);
      else _reservedDeclareNames.set(s, name);
  };
}

/**
 * The fresh names of the locals of the statement list `stmts` of a loop
 * body that have the name of an identifier that the emitted code uses
 * (`spellReservedLocals`). The `Declare` statements of the list are
 * recorded (`noteReservedDeclares`). `spell` gives the fresh name of such a
 * local, or `undefined` for each other name: the target of the body reads
 * it before its own `var`. Call `done` when the statements are compiled,
 * also when the compilation fails.
 */
export function reservedLoopLocals(
  stmts: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): { spell: (name: string) => string | undefined; done: () => void } {
  const spelled = new Map<string, string>();
  const added: string[] = [];
  spellReservedLocals(
    stmts.flatMap((s) =>
      isFunction(s, 'Declare') && isSymbol(s.ops[0]) ? [s.ops[0].symbol] : []
    ),
    target,
    spelled,
    added
  );
  const unnote = noteReservedDeclares(
    stmts,
    target,
    (name) => spelled.get(name) ?? name
  );
  return {
    spell: (name) => spelled.get(name),
    done: () => {
      unnote();
      for (const name of added) _freshLocalNames.delete(name);
    },
  };
}
/** The fresh names of loop indices that a target spells itself while the
 * loop body compiles (`withWritableLoopIndices`), which `assignLValue`
 * accepts as the spelling of a write. Kept apart from `_freshLocalNames`,
 * which the end of an inner `withFreshBlockLocals` call clears. */
export const _writableLoopIndices = new Set<string>();

/**
 * Run `fn` with the fresh names `names` of loop indices accepted by
 * `assignLValue` as the spelling of a write. A target that gives a loop
 * index a fresh name (the Python `for` statement, whose variable is a
 * variable of the whole function) uses it while it compiles the body, so
 * that a body that assigns its index compiles as it does with the
 * original name. The names are removed when `fn` ends.
 */
export function withWritableLoopIndices<T>(
  names: ReadonlyArray<string>,
  fn: () => T
): T {
  const added = names.filter((n) => !_writableLoopIndices.has(n));
  for (const n of added) _writableLoopIndices.add(n);
  try {
    return fn();
  } finally {
    for (const n of added) _writableLoopIndices.delete(n);
  }
}

/**
 * Run `fn` with each local of each block that `compileBlock` compiles
 * spelled with a fresh name (`tempVar`) instead of its own name. A target
 * whose code puts the statements of a block in the scope of the
 * enclosing function (the Python loop form of a `Sum` with a statement
 * body) uses it, so that a local of the block does not write a variable
 * of the enclosing code with the same name: a parameter `t` of the
 * function, or a local `t` of an enclosing block, is a different binding
 * from a local `t` of the body.
 */
export function withFreshBlockLocals<T>(fn: () => T): T {
  CompilerState._freshBlockLocals += 1;
  try {
    return fn();
  } finally {
    CompilerState._freshBlockLocals -= 1;
    if (CompilerState._freshBlockLocals === 0) _freshLocalNames.clear();
  }
}

/**
 * A fresh name for a block local that a target spells itself, while
 * `withFreshBlockLocals` runs. `assignLValue` accepts it as the spelling
 * of a write, as it accepts the fresh names that `compileBlock` gives.
 * The name stays accepted until the outermost `withFreshBlockLocals`
 * call ends.
 */
export function freshBlockLocalName(target: CompileTarget<Expression>): string {
  if (CompilerState._freshBlockLocals === 0)
    throw new Error(
      'Internal: a fresh block-local name outside `withFreshBlockLocals`'
    );
  const fresh = tempVar(target);
  _freshLocalNames.add(fresh);
  return fresh;
}

/**
 * The decline of a write to a symbol that the compiled code does not
 * declare: a symbol of the engine, an input, or a `vars` name. A compiled
 * block writes only its own locals and the locals of an enclosing compiled
 * block. The interpreter changes the binding of the engine, and compiled
 * code has no binding of the engine to change.
 */
function engineSymbolWriteDecline(name: string): Error {
  return new Error(
    `Could not compile \`Assign\`: "${name}" is not a local of the ` +
      `compiled expression (it is a symbol of the engine, an input or a ` +
      `\`vars\` name), and compiled code writes only the locals that it ` +
      `declares. Return the value and let the host assign it, or declare ` +
      `a local with a value (\`Declare(${name}, type, value)\`, or a first ` +
      `assignment at the level of the block) and read the local.`
  );
}

export function assignLValue(
  engine: ComputeEngine,
  name: string,
  target: CompileTarget<Expression>
): TargetSource {
  const resolved = target.var?.(name);
  if (resolved === undefined) {
    // The target resolved nothing. The read path then FOLDS an assigned
    // value (`tryFoldKnownSymbol`) before falling back to a bare identifier,
    // so a symbol the engine has a value for reads as that value and no
    // write can reach it — fail closed. Otherwise (a genuinely free symbol,
    // which is how every shader target spells one) the bare identifier is
    // both the read and the write. That is a local of the compiled code (a
    // parameter, a loop index, a local of an enclosing compiled block or
    // function), or else an input, and a write to an input declines
    // (`engineSymbolWriteDecline`).
    if (engine._getSymbolValue(name) !== undefined)
      throw new Error(
        `Could not compile \`Assign\`: "${name}" has an assigned value, which ` +
          `every read of it bakes into the generated source, so this write ` +
          `would be invisible to them.`
      );
    if (
      target.boundVars?.has(name) !== true &&
      localShapeFrameOf(name) === undefined
    )
      throw engineSymbolWriteDecline(name);
    return target.mangleId ? target.mangleId(name) : name;
  }
  // A `vars` key that no binding of the expression shadows names an input
  // that the host gives (a uniform, a Python name, a JavaScript `vars`
  // mapping that spells the name as itself): the write declines, on every
  // target.
  if (
    target.varsKeys?.has(name) === true &&
    target.boundVars?.has(name) !== true &&
    localShapeFrameOf(name) === undefined
  )
    throw engineSymbolWriteDecline(name);
  if (resolved === name) return resolved;
  // A block local spelled with a fresh name (`withFreshBlockLocals`).
  if (_freshLocalNames.has(resolved)) return resolved;
  // A loop index spelled with a fresh name (`withWritableLoopIndices`).
  if (_writableLoopIndices.has(resolved)) return resolved;
  // A function parameter with a name that the target must not emit as a
  // binding (`CompileTarget.reservedEmittedNames`: `_SYS`, a JavaScript
  // reserved word, a global that the emitted code reads) is emitted under a
  // fresh name, and its reads and writes use that name
  // (`CompileTarget.renamedWritables`).
  if (target.renamedWritables?.has(resolved) === true) return resolved;
  // A vars-object member access naming this very symbol (`_.s`) is the
  // spelling of an input or of a `vars` name: the write declines. Matched
  // by string surgery, not a regexp built from `name` (a symbol may hold
  // regexp metacharacters).
  if (
    resolved.endsWith(`.${name}`) &&
    /^[A-Za-z_$][\w$]*$/.test(resolved.slice(0, -(name.length + 1)))
  )
    throw engineSymbolWriteDecline(name);
  throw new Error(
    `Could not compile \`Assign\`: target '${target.language ?? 'javascript'}' ` +
      `compiles reads of "${name}" as \`${resolved}\`, which is not an ` +
      `assignable reference (a constant, a folded value, or a baked ` +
      `\`vars\` mapping), so the write would be invisible to every read.`
  );
}

/**
 * Whether the target binds a function-valued block local as a value, so
 * that a call of the local can be compiled as a call of that binding
 * (`CompileTarget.localFunctions`).
 *
 * A target with no `declare` hook (the JavaScript family) lowers a
 * `Declare` as a value binding. The GPU targets declare a local with a
 * scalar type, separately from its assignment, so a function-valued local
 * has no binding a call could reach. Python has a `declare` hook too, but
 * it emits nothing: a Python local is created by its first assignment
 * (`k = lambda u: 2 * u`), so Python binds a function-valued local as a
 * value as well. CE-237.
 */
export function bindsLocalFunctions(
  target: CompileTarget<Expression>
): boolean {
  return target.declare === undefined || target.language === 'python';
}

/**
 * The frames of `blockLocalValueFrame`, innermost last, while the
 * statements of their blocks are compiled.
 */
export const _localValueFrames: LocalValueFrame[] = [];

/** The key of the own local `name` of a block with no scope. */
export const _localNameKeys = new Map<string, object>();

/**
 * The block local that the symbol node `e` reads, in the innermost block
 * being compiled that binds it (`blockLocalValueFrame`), or `undefined`.
 * The node is matched by its definition (`valueDefinition`), so a binder
 * nested in the block that uses the same name (a `Sum` index, a
 * parameter) is not the local, and does not hide a free variable of the
 * same name. A variable outside the block that the block assigns is
 * matched too.
 */
export function blockLocalOf(e: Expression): LocalEntry | undefined {
  if (!isSymbol(e)) return undefined;
  const def = e.valueDefinition as object | undefined;
  const frames = _localValueFrames;
  const nameKey = _localNameKeys.get(e.symbol);
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    const entry =
      (def !== undefined ? frame.byDef.get(def) : undefined) ??
      (nameKey !== undefined ? frame.byDef.get(nameKey) : undefined);
    if (entry !== undefined) return entry;
  }
  return undefined;
}
