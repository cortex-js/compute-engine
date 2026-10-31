// Block locals: value frames, local reads and writes, chained assignments,
// use-before-declare checks and the classification of local reads.

import type { Scope } from '../types-evaluation.js';
import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { signatureEffects } from '../../common/type/utils.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { parseType } from '../../common/type/parse.js';
import type { EffectSet } from '../../common/type/types.js';
import { isFunctionDeclarationStatement } from '../library/control-structures.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { functionLiteralDeclaredEffects } from '../boxed-expression/function-literal.js';
import type { CompileTarget, TargetSource } from './types.js';
import { lazyOperandRegions } from './cse.js';
import { rangeCount } from '../numerics/range-count.js';
import {
  assignmentLocalsOf,
  laterDeclarationLocalsOf,
} from '../assignment-locals.js';
import {
  EffectContractError,
  inferFunctionLiteralEffects,
} from '../boxed-expression/effects-inference.js';
import { isEffectSubset } from '../../common/type/effects.js';
import { declareValueOperand } from './compile-declarations.js';
import { localShapeFrameOf } from './compile-shapes.js';
import type {
  CheckedLocalsFrame,
  ConditionNode,
  LocalEntry,
  LocalReadClasses,
  LocalValueFrame,
} from './compiler-types.js';
import {
  _localNameKeys,
  _localValueFrames,
  blockLocalOf,
  blockLocalsNamed,
  conditionDecidability,
  isVarsObjectRead,
  localDependsOnInputs,
  operandMayBeAbsent,
} from './compile-absence.js';
import { STRICT_OPERATORS } from './compiler-tables.js';
import { booleanClaim } from './compile-conditions.js';
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
  // of the local checks its arguments against the declared parameter
  // types (`localParameterChecks`). A `Declare` with a value is kept: the
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
 * The `Declare` statements for the inner targets of a chained assignment
 * that `splitChainedAssignments` moved to statement position, in a
 * statement list that has no `Block` node whose scope
 * `withImplicitLocalDeclares` can read (a loop body that is one
 * statement). The interpreter declares such a target in the scope of the
 * loop when no enclosing scope has the name. The test is on the
 * compilation: a name is bound outside when it is a parameter or a loop
 * index (`boundVars`), or a local of an enclosing compiled block or
 * function (`boundVars`, or `localShapeFrameOf` on the shader targets).
 * A name that an engine scope outside the expression binds is not
 * declared either: it is written as an input (`chainedAmbientWrite`).
 * Each other name gets one declaration, as in the block route
 * (`withImplicitLocalDeclares`).
 */
export function chainedLocalDeclares(
  stmts: ReadonlyArray<Expression>,
  chained: ReadonlySet<string>,
  target: CompileTarget<Expression>
): Expression[] {
  const declared = new Set<string>();
  return stmts.flatMap((s) => {
    if (!isFunction(s, 'Assign') || !isSymbol(s.ops[0])) return [];
    const lhs = s.ops[0];
    const name = lhs.symbol;
    if (
      !chained.has(name) ||
      declared.has(name) ||
      target.boundVars?.has(name) ||
      localShapeFrameOf(name) !== undefined ||
      chainedAmbientWrite(lhs)
    )
      return [];
    declared.add(name);
    // Raw, as in `withImplicitLocalDeclares`: a canonical `Declare`
    // would register the name in the scope the compilation runs under.
    return [
      lhs.engine._fn('Declare', [lhs, lhs.engine.string('unknown')], {
        canonical: false,
      }),
    ];
  });
}

/**
 * Prepend the `Declare` statements a statement list is MISSING: one per
 * block-local that the block introduces by bare ASSIGNMENT.
 *
 * `canonicalBlock` hoists a top-level `Assign(w, …)` whose target is not
 * visible in the enclosing scope chain into the block's OWN scope — that is
 * the interpreter's block-local, and it is why `{ w ⩴ 2t; w + 1 }` answers
 * `2t+1` rather than leaking a `w`. No `Declare` statement records it, so
 * the locals harvest below never saw it and the two halves of the local
 * disagreed: the write emitted a bare `w = …` (a stray global in sloppy JS,
 * an undeclared identifier no shader compiler accepts) while every read
 * resolved to the free-variable spelling `_.w`, which nothing ever wrote.
 * The block then answered `NaN` behind `success: true` — and since a
 * canonical `Function`-literal body IS such a block, so did every emitted
 * user-function definition with a multi-statement body (`_fn_a(_.u)`).
 *
 * Synthesizing the declaration — rather than special-casing the emission —
 * routes the implicit local through the machinery the declared one already
 * has: the `let`/`float` declaration, the bare-name reads, and the
 * complex-ness / vector-width inference the shader targets need to give it
 * a type.
 *
 * Three shapes are deliberately left alone, each because it is NOT a
 * block-local: a name the enclosing compilation already binds (a parameter,
 * an outer block's local, a loop index — `boundVars`), a name this list
 * declares explicitly, and a name the canonicalizer did not hoist, which
 * means the assignment writes an OUTER binding (that shape has its own
 * pre-existing asymmetry, tracked separately).
 */
export function withImplicitLocalDeclares(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined,
  /** The targets of the assignments `splitChainedAssignments` moved out of
   * the value of another assignment. */
  chained: ReadonlySet<string> = new Set()
): ReadonlyArray<Expression> {
  const scope = node?.localScope;
  if (!scope) return args;

  const implicit: Expression[] = [];
  const seen = new Set<string>();
  for (const arg of args) {
    if (!isFunction(arg, 'Assign')) continue;
    const lhs = arg.ops[0];
    if (!isSymbol(lhs)) continue;
    const name = lhs.symbol;
    if (seen.has(name)) continue;
    // A name that an enclosing compiled block or function binds is written
    // there. The exception is a function defined in the top-level block of
    // a program before the statement that declares the same name: the
    // canonicalization made the name a local of the function body
    // (`recordLaterDeclarationLocals()`, `assignment-locals.ts`), and the
    // interpreter gives each call of the function its own local, so the
    // compiled function declares its own variable too.
    if (
      target.boundVars?.has(name) &&
      laterDeclarationLocalsOf(scope)?.includes(name) !== true
    )
      continue;
    // The canonicalizer hoists only a TOP-LEVEL assignment into the block's
    // scope. An assignment that was the value of another one (`t ≔ (u ≔
    // s)`) is declared by the interpreter when it runs, in the scope of the
    // block, unless an enclosing scope already has the name. So such a
    // name is a block-local when no enclosing scope binds it.
    //
    // Two kinds of enclosing binding are not a compiled local (which
    // `boundVars` above, or a shader shape frame, would name). A binding
    // of an engine scope outside the expression (`ce.declare('u', …)`)
    // is changed by the interpreter, and is an input of the compiled code
    // (`chainedAmbientWrite`). A binding that the canonical form gives a
    // read of the name in an enclosing block of the expression (a `u` read
    // after a loop) is not changed by the interpreter, whose loop body
    // declares its own `u`: the name is a block-local here too.
    if (!scope.bindings.has(name)) {
      if (!chained.has(name)) continue;
      if (scopeChainBinds(scope.parent, name)) {
        if (chainedAmbientWrite(lhs)) continue;
        if (localShapeFrameOf(name) !== undefined) continue;
      }
    }
    if (
      args.some(
        (a) =>
          isFunction(a, 'Declare') &&
          isSymbol(a.ops[0]) &&
          a.ops[0].symbol === name
      )
    )
      continue;
    seen.add(name);
    // Raw (unbound): this is a synthetic statement, and canonicalizing a
    // `Declare` would register the name in whatever scope the compilation
    // happens to run under. Nothing below does arithmetic on it — the
    // emission paths read `ops[0]` (the name) and `declareValueOperand`
    // (none here) only.
    implicit.push(
      lhs.engine._fn('Declare', [lhs, lhs.engine.string('unknown')], {
        canonical: false,
      })
    );
  }

  // A function body also owns the names that only an assignment in a
  // nested block assigns (a branch of an `if`, a loop body, a `do`
  // block): the canonicalization recorded them as assignment locals of
  // the body (`nestedAssignmentNames()`, `library/control-structures.ts`).
  // Declare each of them here, at the level of the body, so that the
  // writes in the nested blocks and the reads after them use the same
  // variable, and each call has its own. The names that a statement of
  // this list assigns are done by the loop above.
  const ce = node!.engine;
  for (const name of assignmentLocalsOf(scope) ?? []) {
    if (seen.has(name) || !scope.bindings.has(name)) continue;
    if (
      args.some(
        (a) =>
          (isFunction(a, 'Assign') || isFunction(a, 'Declare')) &&
          isSymbol(a.ops[0]) &&
          a.ops[0].symbol === name
      )
    )
      continue;
    if (
      target.boundVars?.has(name) &&
      laterDeclarationLocalsOf(scope)?.includes(name) !== true
    )
      continue;
    seen.add(name);
    implicit.push(
      ce._fn(
        'Declare',
        [ce.symbol(name, { canonical: false }), ce.string('unknown')],
        { canonical: false }
      )
    );
  }

  return implicit.length === 0 ? args : [...implicit, ...args];
}

/**
 * The locals of a block, the values assigned to each of them, and the
 * locals that a statement at the top level of the block gives a value
 * before each statement, for the reads that a comparison of a local must
 * test.
 *
 * A comparison that reads a local (`a2 < m` after `a2 := n + 1`) has no
 * value in the interpreter while `n` has none, since `a2` is then `n + 1`
 * with no value. The rule is simple (user decision 2026-10-30): a
 * comparison that reads a local of the block, or a variable outside the
 * block that the block assigns, tests every caller input that the whole
 * block reads (`blockInputs`), before it compares. It is too strict where
 * the value read at run time does not use an input: `a := 5; If(x > 0,
 * a := n + 1); a < 1` at `x = -1`, `n` absent, has no value, where the
 * interpreter gives `False`. That is accepted. It never gives a value
 * where the interpreter has none, whatever the order of the assignments,
 * the branches and the loops of the block.
 *
 * A local that no top-level statement before the read assigns (it is
 * assigned only in a branch, in a loop body, or in a nested block) may
 * still hold `undefined` at the read, where the interpreter has no value
 * for it. Such a read is tested itself (`isOmittableRead`):
 * `a2 !== undefined`.
 *
 * A variable outside the block that the block assigns (`c := n + 1` with
 * `c` declared in the engine compiles to `_.c = _.n + 1`, and so does a
 * function `gg := t ↦ t + c`) is a local for this rule: after the write,
 * `_.c !== undefined` is true while `n` has no value.
 *
 * The locals are keyed by their definition (the binding of the scope
 * that declares them), not by their name, and so are the reads
 * (`blockLocalOf`): a binder nested in the block that uses the name of a
 * free variable (`Sum(2n, (n, 1, 3))`, `n ↦ 2n`, a `Loop` over `n`) is
 * neither the local nor a reason to skip that variable. A local of a
 * scope nested in the block (a local of a loop body: `n := n + a` in
 * `while n < 4 { let a = 2; … }`) and the variable of a binder inside the
 * block are never inputs: at the loop condition they would compile to
 * the vars read `_.a`, never present, and the loop would never end.
 */
export function blockLocalValueFrame(
  stmts: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>,
  spell: (name: string) => string,
  scope: Scope | undefined,
  node: Expression | undefined
): LocalValueFrame {
  const byDef = new Map<object, LocalEntry>();
  const byName = new Map<string, LocalEntry[]>();
  // The definitions that a binder inside the block creates: a loop index
  // (`for k in …`), a parameter, a `Sum` index. A `Block` is not counted:
  // its scope also declares the free variables of its body.
  const binderDefs = new Set<object>();
  // The free variables of the block. Without the block node, those of
  // its statements, less its locals.
  const names = new Set<string>(
    node !== undefined
      ? node.unknowns
      : stmts.flatMap((s) => s.unknowns).filter((n) => !locals.includes(n))
  );
  const frame: LocalValueFrame = {
    byDef,
    byName,
    binderDefs,
    stmts,
    node,
    loopIndices: new Map(),
    names,
    assignedBefore: [],
    current: 0,
    bySpelling: new Map(),
  };
  // The definition that `name` resolves to in the innermost of `scopes`
  // that binds it, and whether that scope is the block's own. When no
  // scope binds it: a local of a block with no scope, or a temporary
  // that a desugar added (`_tv1` of a destructuring assignment), is keyed
  // by name; a variable outside the block that an assignment writes
  // (`target`, the symbol node of the assignment) is keyed by the
  // definition that its reads have.
  const resolve = (
    name: string,
    scopes: ReadonlyArray<Scope>,
    target?: Expression
  ): { def: object; own: boolean; outer: boolean } | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const binding = scopes[i].bindings.get(name);
      if (binding === undefined) continue;
      const def: object =
        'value' in binding ? (binding.value as object) : binding;
      return { def, own: i === 0, outer: false };
    }
    if (locals.includes(name))
      return {
        def: localNameKey(name),
        own: true,
        outer: false,
      };
    if (target === undefined) return undefined;
    // The target of an assignment is held, not bound, so its definition
    // is looked up: in the scopes that enclose the block (a parameter of
    // the enclosing function), then in the engine.
    let binding: unknown;
    for (let sc = scope?.parent; sc && binding === undefined; sc = sc.parent)
      binding = sc.bindings.get(name);
    binding ??= target.engine.lookupDefinition(name);
    if (binding === undefined || binding === null) return undefined;
    const def: object =
      typeof binding === 'object' && 'value' in binding
        ? (binding.value as object)
        : (binding as object);
    return { def, own: true, outer: true };
  };
  const entryOf = (
    name: string,
    scopes: ReadonlyArray<Scope>,
    target?: Expression
  ): LocalEntry | undefined => {
    const r = resolve(name, scopes, target);
    if (r === undefined) return undefined;
    let entry = byDef.get(r.def);
    if (entry === undefined) {
      entry = { name, frame, values: [], own: r.own, outer: r.outer };
      byDef.set(r.def, entry);
      const list = byName.get(name);
      if (list === undefined) byName.set(name, [entry]);
      else list.push(entry);
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
    if (e.operator !== 'Block' && e.localScope !== undefined)
      for (const name of boundVariableNames(e)) {
        const binding = e.localScope.bindings.get(name);
        if (binding !== undefined)
          binderDefs.add(
            'value' in binding ? (binding.value as object) : binding
          );
      }
    if (e.operator === 'Assign' || e.operator === 'Declare') {
      const value =
        e.operator === 'Assign' ? e.ops[1] : declareValueOperand(e.ops);
      if (value !== undefined)
        for (const t of targetSymbols(e.ops[0])) {
          if (!isSymbol(t)) continue;
          entryOf(t.symbol, inner, t)?.values.push(value);
        }
    }
    // The index of a `Loop` clause holds an element of its collection
    // (each leaf of a destructuring pattern, the whole element).
    if (e.operator === 'Loop' && e.localScope !== undefined)
      for (const clause of e.ops.slice(1)) {
        if (!isFunction(clause, 'Element') || clause.nops < 2) continue;
        for (const t of targetSymbols(clause.ops[0])) {
          if (!isSymbol(t)) continue;
          const binding = e.localScope.bindings.get(t.symbol);
          if (binding === undefined) continue;
          const def: object =
            'value' in binding ? (binding.value as object) : binding;
          frame.loopIndices.set(def, {
            name: t.symbol,
            frame,
            values: [clause.ops[1]],
            own: false,
            outer: false,
          });
        }
      }
    for (const op of e.ops) visit(op, inner);
  };
  for (const stmt of stmts) visit(stmt, rootScopes);
  // `assignedBefore[i]`: the locals that a top-level `Assign`, or a
  // `Declare` with a value, among the statements before statement `i`
  // gives a value.
  let assigned = new Set<string>();
  for (const stmt of stmts) {
    frame.assignedBefore.push(assigned);
    if (
      isFunction(stmt) &&
      isSymbol(stmt.ops[0]) &&
      locals.includes(stmt.ops[0].symbol) &&
      (stmt.operator === 'Assign' ||
        (stmt.operator === 'Declare' &&
          declareValueOperand(stmt.ops) !== undefined))
    ) {
      assigned = new Set(assigned);
      assigned.add(stmt.ops[0].symbol);
    }
  }
  for (const name of locals) frame.bySpelling.set(spell(name), name);
  return frame;
}

/** True when `expr` reads a local of a block being compiled that could
 * depend on a caller input (`localDependsOnInputs`), or a variable
 * outside the block that the block assigns, or calls a function that the
 * block assigns and that could (`blockLocalOf`, `blockLocalsNamed`). */
export function readsBlockLocal(
  expr: Expression,
  target?: CompileTarget<Expression>
): boolean {
  if (_localValueFrames.length === 0) return false;
  const dependent = (l: LocalEntry) => localDependsOnInputs(l, target);
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e)) {
      const local = blockLocalOf(e);
      return local !== undefined && dependent(local);
    }
    if (!isFunction(e)) return false;
    if (blockLocalsNamed(e.operator).some(dependent)) return true;
    return e.ops.some(visit);
  };
  return visit(expr);
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
 * Classify each read of a local of the statement list `args` that its
 * `Declare` gives no value (`Declare(n, integer)`, or the `Declare` that
 * `withImplicitLocalDeclares` makes for a bare assignment). There are
 * three classes of read:
 *
 * 1. The local is assigned on every path before the read. The read
 *    compiles with no check.
 * 2. The local is assigned on no path before the read. The compilation
 *    fails, with a message that names the local (`localReadWithNoWrite`).
 * 3. The local is assigned on some paths only. The read is put in the
 *    `unproved` result: each target decides how it handles it
 *    (`checkedLocalReads`).
 *
 * The interpreter has no value for a read of class 2 or 3 that finds the
 * local with no value: it reports `read-before-declaration` in a function
 * body, and it keeps the read symbolic in a top-level block. Compiled code
 * cannot give that answer. Without a check, JavaScript read `undefined`
 * (`undefined != 1` is `true`), WGSL read the zero that a `var` starts
 * with, and GLSL read an undefined value.
 *
 * The analysis follows the order of evaluation with two facts for each
 * local: it is certainly assigned (on every path), and it is possibly
 * assigned (on one path at least). A read is of class 1 when the first
 * fact holds, of class 3 when only the second holds, and of class 2 when
 * neither holds.
 * - A `Block` is walked in order. An `Assign` of the local sets both
 *   facts after its value is walked.
 * - The branches of an `If` start after its condition. After the `If`,
 *   the local is certainly assigned when both branches assign it (a
 *   missing branch assigns nothing), and possibly assigned when one
 *   branch can. A `Which` is walked as a chain of `If`, and an `And` or an
 *   `Or` as its first operand followed by the others, which may not run.
 *   When the compiled code may not decide the condition, the path on
 *   which no branch runs counts too (`mayRunNoBranch` below).
 * - `Break` and `Continue` end the path that reaches them: the facts of
 *   that path do not count after a branch. A `Return` does not end a
 *   path, because a target can compile a nested block to a function of
 *   its own, which the `Return` leaves.
 * - A loop body can run several times, so a read in the body sees an
 *   assignment of an earlier pass as possible. After the loop, an
 *   assignment of the body is certain only when the loop runs at least
 *   once (each clause is a constant `Range` or a `List` or `Tuple` literal
 *   with an element) and the body has no `Break`, `Continue` or `Return`.
 *   A loop that can stop early is not analyzed further: a read after
 *   `Loop(Block(y ≔ i; If(i > 3, Break)), i ∈ 1..10)` is checked on
 *   JavaScript, although the first pass assigns `y` before the `Break`.
 * - A read in a function literal happens when the function is called,
 *   which can be later. It is of class 1 when the local is certainly
 *   assigned where the literal is, and of class 3 otherwise, never of
 *   class 2. An assignment in a function literal is possible after it.
 * - In the operands of any other operator, whose order of evaluation is
 *   not known, an assignment is possible but not certain for a read in
 *   another operand. After the expression it is certain only for an
 *   operator that evaluates every operand (`STRICT_OPERATORS`).
 * - A nested block that declares the same name again, and an operator
 *   whose index or parameter has the name, bind another variable: they
 *   are not walked.
 *
 * Each approximation makes a read of class 1 a read of class 3, never the
 * other way, and a read is of class 2 only when no path can assign the
 * local before it. A node that several paths reach is walked once for each
 * state, so the time is linear in the size of the statements.
 *
 * A read is compared by its binding, as `checkedLocalRead` does: a symbol
 * that is bound to another definition (a parameter of a function with the
 * same name) is not a read of the local. A symbol with no binding is.
 */
export function classifyLocalReads(
  args: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>,
  node: Expression | undefined,
  target: CompileTarget<Expression>
): LocalReadClasses {
  const unproved = new Map<string, object | undefined>();
  const safe = new Set<Expression>();
  // The read nodes of class 3. A symbol node can be shared by several
  // places of the statements: when one of them is of class 3, the node is
  // checked at all of them.
  const unsafe = new Set<Expression>();
  const valueless = locals.filter((name) => {
    const decl = args.find(
      (s) => isFunction(s, 'Declare') && isSymbol(s.ops[0], name)
    );
    return isFunction(decl) && declareValueOperand(decl.ops) === undefined;
  });
  if (valueless.length === 0) return { unproved, safe };
  const scope = node?.localScope;
  // The state of a path is two bits: MUST (the local is certainly
  // assigned) and MAY (it is possibly assigned). On a live path MUST
  // implies MAY, so MUST without MAY marks a path that does not continue
  // (after a `Break`, `Continue` or `Return`). That state is the neutral
  // element of `join`, the merge of two paths.
  const MUST = 1;
  const MAY = 2;
  const ENDED = MUST;
  const join = (a: number, b: number): number =>
    (a & b & MUST) | ((a | b) & MAY);
  const withMay = (s: number, may: boolean): number =>
    may && s !== ENDED ? s | MAY : s;
  // Whether the compiled code can run no branch for the condition `cond`
  // of an `If` or a `Which`. A condition that the code cannot decide when
  // it runs selects no branch, as in the interpreter: the statement then
  // assigns nothing. The analysis is the one the targets use to emit that
  // test (`conditionDecidability`), read as the emitters read it
  // (`withConditionOperands`, `operandDecidedConjuncts`):
  // - a condition decided by construction runs one branch;
  // - a relation can be undecided only through an operand that may be
  //   absent: a `missing` value (`operandMayBeAbsent`), or, on a target
  //   with a vars object, an input that the caller can leave out (`_.x`,
  //   `isInputOperand`). A `NaN` operand decides a relation;
  // - a condition read by its value (a `boolean` input, a call) can be
  //   undecided, and so can a connective with such an operand.
  // GLSL and WGSL always run one branch. The answer does not depend on the
  // local, so it is kept for all of them.
  // A symbol is an input when the compiled code reads it from the vars
  // object, unless its binding is one that the compiler makes a variable
  // of the compiled code (`compiledLocalDefinitions`): a local of a block
  // made by a `Declare` or an assignment, an index, a parameter. Any other
  // symbol is an input, also one with no binding (a node that the
  // compiler made) and an undeclared symbol, which the engine declares in
  // the scope of the block that holds it when it boxes the block.
  let localDefs: ReadonlySet<object> | undefined;
  // The local test comes first: `target.var` of a name that the target
  // does not bind declares the name in the engine (JavaScript), and a
  // compilation must not change the engine. Such a call is made only for
  // a name that the compiled code reads as an input anyway.
  const isInputOperand = (op: Expression): boolean => {
    if (!isSymbol(op)) return false;
    const def = op.valueDefinition;
    if (def !== undefined) {
      localDefs ??= compiledLocalDefinitions(args, locals, node);
      if (localDefs.has(def)) return false;
    }
    return isVarsObjectRead(target.var(op.symbol) ?? '', target);
  };
  // The value of a condition that is known at compile time.
  const provedCondition = (cond: Expression): boolean | undefined =>
    isSymbol(cond, 'True')
      ? true
      : isSymbol(cond, 'False')
        ? false
        : booleanClaim(cond);
  const noBranchMemo = new Map<Expression, boolean>();
  const mayBeUndecided = (n: ConditionNode): boolean => {
    const t = n.test;
    if (t.kind === 'value') return true;
    if (t.kind === 'connective') return t.operands.some(mayBeUndecided);
    return t.operands.some(
      (op) => operandMayBeAbsent(op) || isInputOperand(op)
    );
  };
  const mayRunNoBranch = (cond: Expression): boolean => {
    if (target.language === 'glsl' || target.language === 'wgsl') return false;
    let known = noBranchMemo.get(cond);
    if (known === undefined) {
      const node = conditionDecidability(cond, true, target);
      known = node !== null && mayBeUndecided(node);
      noBranchMemo.set(cond, known);
    }
    return known;
  };
  for (const name of valueless) {
    const binding = scope?.bindings.get(name);
    const def =
      binding !== undefined && 'value' in binding ? binding.value : undefined;
    const isOurs = (e: Expression): boolean =>
      isSymbol(e, name) &&
      (def === undefined ||
        e.valueDefinition === undefined ||
        e.valueDefinition === def);
    // A construct that binds another variable with the name: a block that
    // declares it again, or a function literal with a parameter of that
    // name. An operator with an index of that name (`Sum`, `Loop`) is
    // walked by `walkBinder`.
    const isOther = (e: Expression): boolean =>
      (isFunction(e, 'Function') &&
        e.localScope?.binderNames?.has(name) === true) ||
      (isFunction(e, 'Block') &&
        e.ops.some(
          (op) =>
            (isFunction(op, 'Declare') || isFunction(op, 'DefineFunction')) &&
            isSymbol(op.ops[0], name)
        ));
    // Whether a subtree can assign the name: an `Assign` whose target has
    // the name anywhere (a destructuring target too). It is an
    // over-approximation, used only for the MAY fact.
    const writesMemo = new Map<Expression, boolean>();
    const mayWrite = (e: Expression): boolean => {
      if (!isFunction(e)) return false;
      const known = writesMemo.get(e);
      if (known !== undefined) return known;
      writesMemo.set(e, false);
      const mentions = (t: Expression): boolean =>
        isSymbol(t, name) || (isFunction(t) && t.ops.some(mentions));
      const result =
        (e.operator === 'Assign' &&
          e.ops[0] !== undefined &&
          mentions(e.ops[0])) ||
        e.ops.some(mayWrite);
      writesMemo.set(e, result);
      return result;
    };
    // Whether a subtree has a `Return` outside a function literal, at any
    // depth.
    const returnsMemo = new Map<Expression, boolean>();
    const hasReturn = (e: Expression): boolean => {
      if (!isFunction(e) || e.operator === 'Function') return false;
      const known = returnsMemo.get(e);
      if (known !== undefined) return known;
      returnsMemo.set(e, false);
      const result = e.operator === 'Return' || e.ops.some(hasReturn);
      returnsMemo.set(e, result);
      return result;
    };
    // Whether a subtree has a `Break`, a `Continue` or a `Return`, at any
    // depth.
    const jumpsMemo = new Map<Expression, boolean>();
    const hasJump = (e: Expression): boolean => {
      if (!isFunction(e)) return false;
      const known = jumpsMemo.get(e);
      if (known !== undefined) return known;
      jumpsMemo.set(e, false);
      const result =
        e.operator === 'Break' ||
        e.operator === 'Continue' ||
        e.operator === 'Return' ||
        e.ops.some(hasJump);
      jumpsMemo.set(e, result);
      return result;
    };
    // `deferred`: inside a function literal, whose body runs when the
    // function is called.
    // `stmt`: in statement position of the statement list, or of a
    // statement of it (a nested block, a branch, a loop body). There a
    // `Return`, a `Break` or a `Continue` ends the path. Elsewhere (the
    // value of an assignment, an operand) a block is compiled as a value of
    // its own (an immediately applied function on JavaScript), and a
    // `Return` in it gives the value of that block only.
    const memo = new Map<Expression, number[]>();
    const walk = (
      e: Expression,
      s: number,
      deferred: boolean,
      stmt: boolean
    ): number => {
      const key = s + (deferred ? 4 : 0) + (stmt ? 8 : 0);
      let byState = memo.get(e);
      if (byState === undefined) memo.set(e, (byState = []));
      const known = byState[key];
      if (known !== undefined) return known;
      let result = walkNode(e, s, deferred, stmt);
      // A construct in value position that holds a `Return`, a `Break` or
      // a `Continue` can end before its assignments: they are not certain
      // after it.
      if (!stmt && isFunction(e) && e.operator !== 'Function' && hasJump(e))
        result = withMay(s, mayWrite(e) || (result & MAY) !== 0);
      // A nested block with a `Return`, in any position, keeps only the
      // facts from before it. JavaScript can compile a nested block to a
      // function of its own (`(() => { if (c) { return 0 }; y = 1 })()`):
      // the `Return` leaves that function only, and the statements after
      // the block run with the assignments after the `Return` not made.
      else if (isFunction(e, 'Block') && hasReturn(e))
        result = withMay(s, mayWrite(e) || (result & MAY) !== 0);
      byState[key] = result;
      return result;
    };
    // The operands of an operator whose order of evaluation is not known:
    // each one starts with the state before the operator, with MAY set
    // when one of them can assign the local.
    const walkOperands = (
      ops: ReadonlyArray<Expression>,
      s: number,
      deferred: boolean
    ): number => {
      const after = withMay(s, ops.some(mayWrite));
      for (const op of ops) walk(op, after, deferred, false);
      return after;
    };
    // An operator with an index of the name (`Sum(n, Limits(n, 1, n))`,
    // `Loop(…, Element(n, …))`). The body and the index are another
    // variable. The clauses before the one of that index, and the bounds or
    // the collection of that clause, are evaluated in the enclosing scope,
    // so their reads are reads of the local. A condition of the clause
    // (`Element(n, xs, cond)`) sees the index, and a later clause can too:
    // they are not walked. A clause of another shape ends the walk.
    const walkBinder = (
      e: Expression & { ops: ReadonlyArray<Expression> },
      s: number,
      deferred: boolean
    ): number => {
      const after = withMay(s, mayWrite(e));
      for (const clause of e.ops.slice(1)) {
        if (
          !isFunction(clause) ||
          (clause.operator !== 'Limits' && clause.operator !== 'Element') ||
          clause.nops < 2
        )
          break;
        const ownIndex = isSymbol(clause.ops[0], name);
        const evaluated =
          ownIndex && clause.operator === 'Element'
            ? clause.ops.slice(1, 2)
            : clause.ops.slice(1);
        for (const op of evaluated) walk(op, after, deferred, false);
        if (ownIndex) break;
      }
      return after;
    };
    const walkNode = (
      e: Expression,
      s: number,
      deferred: boolean,
      stmt: boolean
    ): number => {
      if (isSymbol(e)) {
        if (!isOurs(e)) return s;
        if ((s & MUST) !== 0) safe.add(e);
        else if (deferred || (s & MAY) !== 0) {
          unsafe.add(e);
          unproved.set(name, def);
        } else localReadWithNoWrite(name);
        return s;
      }
      if (isDictionary(e)) return walkOperands([...e.values], s, deferred);
      if (!isFunction(e) || isOther(e)) return s;
      const ops = e.ops;
      if (
        e.operator !== 'Block' &&
        e.operator !== 'Function' &&
        e.localScope?.binderNames?.has(name) === true
      )
        return walkBinder(e, s, deferred);
      switch (e.operator) {
        case 'Function': {
          // The body runs when the function is called. The parameters
          // are names, not reads.
          if (ops[0] !== undefined) walk(ops[0], s, true, true);
          return withMay(s, mayWrite(e));
        }
        case 'Assign': {
          const after =
            ops[1] === undefined ? s : walk(ops[1], s, deferred, false);
          if (!isSymbol(ops[0], name)) {
            // A target that is not a name or a destructuring pattern (an
            // indexed target) reads its operands.
            const target = ops[0];
            if (isFunction(target) && target.operator !== 'Tuple')
              walkOperands(target.ops, s, deferred);
            return withMay(after, mayWrite(e));
          }
          // In a function literal, the assignment happens only when the
          // function is called.
          if (deferred || after === ENDED) return after;
          return MUST | MAY;
        }
        case 'Declare': {
          // The target is a name, not a read. A `Declare` of the local
          // with a value assigns it.
          const value = declareValueOperand(ops);
          if (value === undefined) return s;
          const after = walk(value, s, deferred, false);
          if (!isSymbol(ops[0], name) || deferred || after === ENDED)
            return after;
          return MUST | MAY;
        }
        case 'Block': {
          // The statements of a block in value position are in statement
          // position of that block: a `Return` there ends the rest of
          // the block (the result is then corrected by `walk`).
          let a = s;
          for (const op of ops) a = walk(op, a, deferred, true);
          return a;
        }
        case 'If': {
          if (ops[0] === undefined) return s;
          // A condition that is the symbol `True` or `False`, or whose
          // type proves its value (`booleanClaim`), selects one arm when
          // the code runs: the other arm never runs.
          const claim = provedCondition(ops[0]);
          if (claim !== undefined) {
            const arm = claim ? ops[1] : ops[2];
            return arm === undefined ? s : walk(arm, s, deferred, stmt);
          }
          const c = walk(ops[0], s, deferred, false);
          const yes =
            ops[1] === undefined ? c : walk(ops[1], c, deferred, stmt);
          const no = ops[2] === undefined ? c : walk(ops[2], c, deferred, stmt);
          const both = join(yes, no);
          return mayRunNoBranch(ops[0]) ? join(both, c) : both;
        }
        case 'Which': {
          // `Which(c1, v1, c2, v2, …)`: each condition is evaluated after
          // the conditions before it, when they are false. A condition
          // that the code cannot decide ends the search with no value.
          // When no condition holds, no value is evaluated, except after
          // a condition that is the symbol `True`, which ends the chain.
          let c = s;
          let result = ENDED;
          let fallThrough = true;
          for (let i = 0; i < ops.length; i += 2) {
            const cond = ops[i];
            const value = ops[i + 1];
            // A condition that `booleanClaim` proves false selects
            // nothing, and one that it proves true ends the chain, as the
            // symbol `True` does.
            const claim = provedCondition(cond);
            if (claim === false) continue;
            if (claim === true) {
              if (value !== undefined)
                result = join(result, walk(value, c, deferred, stmt));
              fallThrough = value === undefined;
              break;
            }
            c = walk(cond, c, deferred, false);
            if (value !== undefined)
              result = join(result, walk(value, c, deferred, stmt));
            if (mayRunNoBranch(cond)) result = join(result, c);
          }
          return fallThrough ? join(result, c) : result;
        }
        case 'And':
        case 'Or': {
          // The first operand is always evaluated, the others may not be.
          if (ops[0] === undefined) return s;
          let a = walk(ops[0], s, deferred, false);
          for (const op of ops.slice(1))
            a = withMay(a, (walk(op, a, deferred, false) & MAY) !== 0);
          return a;
        }
        case 'Loop': {
          // The clauses (the collection of each `Element`) are evaluated
          // before the body, which `Loop` stores first.
          let a = s;
          for (const op of ops.slice(1)) a = walk(op, a, deferred, false);
          if (ops[0] === undefined) return a;
          const writes = mayWrite(e);
          const end = walk(ops[0], withMay(a, writes), deferred, true);
          const certain =
            (a & MUST) !== 0 ||
            (!deferred &&
              (end & MUST) !== 0 &&
              !hasJump(ops[0]) &&
              loopRunsOnce(ops.slice(1)));
          if (a === ENDED) return ENDED;
          return (certain ? MUST : 0) | ((a & MAY) !== 0 || writes ? MAY : 0);
        }
        case 'Break':
        case 'Continue': {
          walkOperands(ops, s, deferred);
          return ENDED;
        }
        case 'Return':
          // A `Return` does not end a path here. Some targets compile a
          // nested block to a function of its own, which a `Return`
          // leaves, and the statements after the block still run. A read
          // after an early `Return` keeps its check.
          return walkOperands(ops, s, deferred);
        case 'Apply': {
          // A function literal applied in place runs here, after its
          // arguments, so a read in its body is classified as any other
          // read. An assignment in its body is not certain after it: it
          // can write a local of the function body.
          const fn = ops[0];
          if (!isFunction(fn, 'Function') || isOther(fn))
            return walkOperands(ops, s, deferred);
          const a = walkOperands(ops.slice(1), s, deferred);
          if (fn.ops[0] !== undefined) walk(fn.ops[0], a, deferred, true);
          return withMay(a, mayWrite(fn));
        }
        default: {
          // An operator that evaluates each operand once (`Add`), in an
          // order that is not known: a read in an operand sees only the
          // state before the operator, and an assignment that an operand
          // makes on every path is certain after the operator. An operand
          // with a `Break`, a `Continue` or a `Return` can end before its
          // assignment.
          const after = withMay(s, ops.some(mayWrite));
          const results = ops.map((op) => walk(op, after, deferred, false));
          if (
            after === ENDED ||
            !STRICT_OPERATORS.has(e.operator) ||
            lazyOperandRegions(e).length > 0
          )
            return after;
          const certain = ops.some(
            (op, i) => (results[i] & MUST) !== 0 && !hasJump(op)
          );
          return certain ? after | MUST : after;
        }
      }
    };
    let state = 0;
    for (const arg of args) state = walk(arg, state, false, true);
  }
  for (const e of unsafe) safe.delete(e);
  return { unproved, safe };
}

/**
 * The value definitions of the variables that the compiled code of the
 * statements `args` of the block `node` declares itself: the locals
 * `locals` of the block, the names that a `Declare` or an assignment of a
 * nested block makes local (a destructuring pattern too), and the index or
 * parameter names of each construct (`binderNames`). A symbol bound to
 * one of these is not an input (`classifyLocalReads`). A symbol that the
 * engine declared in the scope of a block because nothing declared it is
 * an input, and its definition is not in the set.
 */
export function compiledLocalDefinitions(
  args: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>,
  node: Expression | undefined
): ReadonlySet<object> {
  const defs = new Set<object>();
  const add = (
    scope: Expression['localScope'],
    names: Iterable<string>
  ): void => {
    if (scope === undefined) return;
    for (const name of names) {
      const binding = scope.bindings.get(name);
      if (binding !== undefined && 'value' in binding) defs.add(binding.value);
    }
  };
  const patternNames = (t: Expression): string[] =>
    isSymbol(t)
      ? [t.symbol]
      : isFunction(t, 'Tuple')
        ? t.ops.flatMap(patternNames)
        : [];
  add(node?.localScope, locals);
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    add(e.localScope, e.localScope?.binderNames ?? []);
    if (e.operator === 'Block')
      add(
        e.localScope,
        e.ops.flatMap((op) =>
          (isFunction(op, 'Declare') ||
            isFunction(op, 'Assign') ||
            isFunction(op, 'DefineFunction')) &&
          op.ops[0] !== undefined
            ? patternNames(op.ops[0])
            : []
        )
      );
    for (const op of e.ops) visit(op);
  };
  for (const arg of args) visit(arg);
  return defs;
}

/**
 * Whether a `Loop` with the clauses `clauses` runs its body at least once:
 * each clause is `Element(index, collection)` with no condition, over a
 * `Range` whose bounds and step are number literals and that has an
 * element, or over a `List` or `Tuple` literal with an element.
 */
export function loopRunsOnce(clauses: ReadonlyArray<Expression>): boolean {
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    if (!isFunction(clause, 'Element') || clause.nops !== 2) return false;
    const coll = clause.ops[1];
    if (isFunction(coll, 'List') || isFunction(coll, 'Tuple'))
      return coll.nops > 0;
    if (!isFunction(coll, 'Range') || coll.nops < 2 || coll.nops > 3)
      return false;
    const [lo, hi, step] = coll.ops;
    if (!isNumber(lo) || !isNumber(hi)) return false;
    if (step !== undefined && !isNumber(step)) return false;
    const values = [lo.re, hi.re, step === undefined ? 1 : step.re];
    if (!values.every((v) => Number.isFinite(v))) return false;
    return rangeCount(values[0], values[1], values[2]) >= 1;
  });
}

/** The failure for a read of class 2 (`classifyLocalReads`). */
export function localReadWithNoWrite(name: string): never {
  throw new Error(
    `Could not compile \`Block\`: a statement reads the block local ` +
      `"${name}", and no path to that read gives "${name}" a value. ` +
      `Inside a function body the interpreter reports that read as ` +
      `\`read-before-declaration\`, and in a top-level block it leaves the ` +
      `read symbolic; the compiled code would read an uninitialized ` +
      `variable. Give "${name}" a value first, or give the local another ` +
      `name, so that "${name}" is the input.`
  );
}

/**
 * The frame of the locals of a statement list whose reads compile with a
 * check, from the reads of class 3 that `classifyLocalReads` found.
 *
 * On the JavaScript and the interval JavaScript targets, each such local
 * starts with a marker object of its own, and a read of class 3 throws an
 * `Error` with `read-before-declaration` and the name of the local when
 * the local still holds the marker (`checkedLocalRead`).
 *
 * Python needs no frame: a local with a read of class 3 starts with the
 * value `_ce_unset(name)`, whose use raises (`PYTHON_UNSET_HELPER` in
 * `python-target.ts`). GLSL and WGSL cannot raise an error, so a read of
 * class 3 is refused there.
 *
 * The checks are written in the code of the statement list only. While
 * the definition of another function compiles (a module-level helper,
 * `emitFunctionLiteralDefinition`), the frames are hidden
 * (`hideCheckedLocals`): the marker objects are not visible there.
 */
export function checkedLocalReads(
  classes: LocalReadClasses,
  target: CompileTarget<Expression>,
  spellLocal: (name: string) => string
): CheckedLocalsFrame | undefined {
  if (classes.unproved.size === 0) return undefined;
  if (target.language === 'python') return undefined;
  if (
    target.language !== 'javascript' &&
    target.language !== 'interval-javascript'
  )
    throw new Error(
      `Could not compile \`Block\`: a statement can read the block local ` +
        `"${[...classes.unproved.keys()][0]}" when no assignment gave it a ` +
        `value (the assignment is on some paths only, for example in one ` +
        `branch of an \`If\`). The interpreter has no value for that read, ` +
        `and target '${target.language ?? 'unknown'}' cannot raise an ` +
        `error at run time. Give the local a value on every path before ` +
        `the read.`
    );
  const markers = new Map<string, string>();
  const spelled = new Map<string, string>();
  const defs = new Map<string, object>();
  for (const [name, def] of classes.unproved) {
    markers.set(name, tempVar(target));
    spelled.set(name, spellLocal(name));
    if (def !== undefined) defs.set(name, def);
  }
  return { markers, spelled, defs, safe: classes.safe };
}

/**
 * The code of a read of the local `s`, which `resolved` spells: a check
 * that the local has a value, when `checkedLocalReads` found that the read
 * can come before every assignment of the local. Otherwise `resolved`.
 */
export function checkedLocalRead(
  expr: Expression,
  s: string,
  resolved: TargetSource
): TargetSource {
  const frames = CompilerState._checkedLocals;
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    const marker = frame.markers.get(s);
    if (marker === undefined) continue;
    // A read of another binding with the same name: a parameter of a
    // function whose definition compiles while this body compiles, or a
    // `let` of a nested block. A symbol with no binding (a node that the
    // compiler made) is taken to read the local, as `classifyLocalReads`
    // does.
    const def = frame.defs.get(s);
    if (
      def !== undefined &&
      (!isSymbol(expr) ||
        (expr.valueDefinition !== undefined && expr.valueDefinition !== def))
    )
      continue;
    if (frame.safe.has(expr) || resolved !== frame.spelled.get(s))
      return resolved;
    const message = JSON.stringify(
      `read-before-declaration: "${s}" is read before its first assignment`
    );
    return `(${resolved} === ${marker} ? (() => { throw new Error(${message}); })() : ${resolved})`;
  }
  return resolved;
}

/**
 * Hide the frames of `checkedLocalReads` and return them, so that the
 * caller can restore them (`CompilerState._checkedLocals = saved`) when the
 * compilation of code outside the body ends. Call it before compiling a
 * definition that is not lexically nested in the body (a module-level
 * helper): the marker objects of the body are not visible there, and a
 * read of a name of the body there reads another binding.
 */
export function hideCheckedLocals(): CheckedLocalsFrame[] {
  const saved = CompilerState._checkedLocals;
  CompilerState._checkedLocals = [];
  return saved;
}

/**
 * The locals of the statement list `args` that no statement of the list
 * assigns or declares with a value, so that only an assignment in a
 * nested block (a branch of an `if`, a loop body) gives them a value: a
 * name that the canonicalization made a local of a function body because
 * a nested block assigns it (`withImplicitLocalDeclares`), or a `let`
 * with no value. Their shape is read from these nested assignments.
 */
export function nestedOnlyLocals(
  args: ReadonlyArray<Expression>,
  locals: ReadonlyArray<string>
): ReadonlySet<string> {
  return new Set(
    locals.filter(
      (name) =>
        !args.some(
          (a) =>
            ((isFunction(a, 'Assign') && a.ops[1] !== undefined) ||
              (isFunction(a, 'Declare') &&
                declareValueOperand(a.ops) !== undefined)) &&
            isSymbol(a.ops[0]) &&
            a.ops[0].symbol === name
        )
    )
  );
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
 * Whether the inner target `lhs` of a chained assignment is bound by an
 * engine scope outside the compiled expression (a scope of the engine's
 * current evaluation context, such as the global scope after
 * `ce.declare('u', 'real')` or `ce.assign('u', 2)`). The interpreter then
 * changes that binding, and the name is an input of the compiled code.
 * The targets write it as a free name, in a local copy of the input
 * (`CompileTarget.inputWrites`): the vars object of the JavaScript
 * targets, a local variable of the shader and Python targets
 * (`CompileTarget.inputLocals`). A shader cannot write an input, because a
 * uniform is read-only.
 */
export function chainedAmbientWrite(
  lhs: Expression & { symbol: string }
): boolean {
  return scopeChainBinds(lhs.engine.context.lexicalScope, lhs.symbol);
}

/** Whether `scope` or one of its parents binds `name`. */
export function scopeChainBinds(
  scope: NonNullable<Expression['localScope']> | null | undefined,
  name: string
): boolean {
  for (let s = scope; s; s = s.parent) if (s.bindings.has(name)) return true;
  return false;
}

/**
 * Split each statement `Assign(t, Assign(u, v))` of a statement list into
 * `Assign(u, v)` followed by `Assign(t, u)`, which is the same program: the
 * value of an assignment is the value it stores. Several levels split the
 * same way, innermost first.
 *
 * Without the split, the nested assignment was spliced into the outer one
 * (`t = u = s`). That is not valid where an assignment is a statement
 * (WGSL), and `u` was never declared: its write went to an undeclared
 * name on the shader targets and to the caller's `vars` object on
 * JavaScript (`_.u`), where the interpreter declares `u` in the scope of
 * the block.
 *
 * Returns the statements, and the names the split moved to statement
 * position (`withImplicitLocalDeclares` decides whether they are locals).
 */
export function splitChainedAssignments(args: ReadonlyArray<Expression>): {
  args: ReadonlyArray<Expression>;
  chained: Set<string>;
} {
  const chained = new Set<string>();
  const isChained = (a: Expression): boolean =>
    isFunction(a, 'Assign') &&
    isSymbol(a.ops[0]) &&
    isFunction(a.ops[1], 'Assign') &&
    isSymbol(a.ops[1].ops[0]);
  if (!args.some(isChained)) return { args, chained };
  const split = (a: Expression): Expression[] => {
    if (!isChained(a) || !isFunction(a)) return [a];
    const inner = a.ops[1];
    if (!isFunction(inner) || !isSymbol(inner.ops[0])) return [a];
    const innerTarget = inner.ops[0];
    chained.add(innerTarget.symbol);
    return [...split(inner), a.engine._fn('Assign', [a.ops[0], innerTarget])];
  };
  return { args: args.flatMap(split), chained };
}

/**
 * Fail closed when a statement of a block reads one of the block's locals
 * before any statement gives it a value.
 *
 * Inside a function body (a block in a function literal), the interpreter
 * reports such a read with the `read-before-declaration` error. In a
 * top-level block it leaves the read symbolic (`Block(x ≔ x + 1; 2x)`,
 * where `x` is a local of the block, evaluates to `2(x + 1)`). In both
 * cases the compiled code has no value to give it: JavaScript read
 * `undefined` and answered `NaN`, WGSL read the zero a `var` starts with,
 * GLSL read an uninitialized variable, and Python read a parameter of the
 * same name.
 *
 * The test is on the statements in order. A local has a value after a
 * statement that assigns it anywhere (in a branch or a loop too, so the
 * test declines only a read that comes before every write), or after a
 * `Declare` with an initial value. A read inside a function literal is not
 * counted, since it happens when the function is called, nor is a read in
 * a nested scope that declares the same name again.
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
  const writes = (root: Expression, name: string): boolean => {
    const seen = new Set<Expression>();
    const walk = (e: Expression): boolean => {
      if (!isFunction(e) || seen.has(e)) return false;
      seen.add(e);
      if (
        e.operator === 'Assign' &&
        isSymbol(e.ops[0]) &&
        e.ops[0].symbol === name
      )
        return true;
      return e.ops.some(walk);
    };
    return walk(root);
  };
  for (const stmt of stmts) {
    for (const name of [...pending]) {
      if (
        isFunction(stmt, 'Declare') &&
        isSymbol(stmt.ops[0]) &&
        stmt.ops[0].symbol === name
      ) {
        // The initial value is read before the local has it.
        const value = declareValueOperand(stmt.ops);
        if (value !== undefined) {
          if (reads(value, name)) unassignedLocalRead(name);
          pending.delete(name);
        }
        continue;
      }
      const assignsHere =
        isFunction(stmt, 'Assign') &&
        isSymbol(stmt.ops[0]) &&
        stmt.ops[0].symbol === name;
      // `x ≔ x + 1` reads `x` before it writes it; any other statement
      // that writes the local is taken to give it a value first.
      if (
        assignsHere
          ? reads(stmt, name)
          : !writes(stmt, name) && reads(stmt, name)
      )
        unassignedLocalRead(name);
      if (assignsHere || writes(stmt, name)) pending.delete(name);
    }
    if (pending.size === 0) return;
  }
}

/**
 * Decline a block in which a statement reads or assigns a name before the
 * `Declare` of that name in the same block (`Block(U ≔ 2; Declare(U); …)`).
 *
 * The local of the block exists from the start of the block, so the name
 * of such a statement is the local, not a variable of an enclosing scope.
 * The interpreter reports the use with the `read-before-declaration`
 * error, for a write as for a read. The compiled code did not report it:
 * JavaScript threw a `ReferenceError` when the code ran, and GLSL and WGSL
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
            `enclosing scope, and the interpreter reports the use as ` +
            `\`read-before-declaration\`. Move the \`Declare\` before the ` +
            `first use, or give the local another name.`
        );
}

export function unassignedLocalRead(name: string): never {
  throw new Error(
    `Could not compile \`Block\`: a statement reads the block local ` +
      `"${name}" before any statement gives it a value. Inside a function ` +
      `body the interpreter reports that read as \`read-before-declaration\`, ` +
      `and in a top-level block it leaves the read symbolic; the compiled ` +
      `code would read an uninitialized variable. Give "${name}" a value ` +
      `first, or give the ` +
      `local another name (\`Block(y ≔ ${name} + 1; 2y)\`), so that ` +
      `"${name}" is the input.`
  );
}

/**
 * True when the statement `stmts[i]` is a `Declare` with no value that
 * Python gives the start value `_ce_unset(name)` (`PYTHON_UNSET_HELPER`
 * in `python-target.ts`).
 *
 * A local gets the start value when a read of it may find it with no
 * value: a read of class 3 of `classifyLocalReads`, `classes` being the
 * result of that analysis on `stmts`. The use of the start value raises.
 * A local whose reads all come after an assignment on every path gets no
 * start value: no read can find it, and Python has no declaration to
 * write in its place. Without a start value, a read on a path with no
 * assignment found the value of the previous pass of a loop, or raised
 * `UnboundLocalError` with no name of a local.
 */
export function needsStartValue(
  stmts: ReadonlyArray<Expression>,
  i: number,
  classes: LocalReadClasses
): boolean {
  const s = stmts[i];
  return (
    isFunction(s, 'Declare') &&
    isSymbol(s.ops[0]) &&
    declareValueOperand(s.ops) === undefined &&
    classes.unproved.has(s.ops[0].symbol)
  );
}
/** The fresh names that `compileBlock` gave to block locals while
 * `withFreshBlockLocals` runs, which `assignLValue` accepts as the
 * spelling of a write. Cleared when the outermost call ends. */
export const _freshLocalNames = new Set<string>();
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
    // both the read and the write.
    if (engine._getSymbolValue(name) !== undefined)
      throw new Error(
        `Could not compile \`Assign\`: "${name}" has an assigned value, which ` +
          `every read of it bakes into the generated source, so this write ` +
          `would be invisible to them.`
      );
    const spelled = target.mangleId ? target.mangleId(name) : name;
    target.inputWrites?.add(spelled);
    return spelled;
  }
  // The local copy of an input that the body writes: reads and writes of
  // the name both use it (`CompileTarget.inputLocals`).
  if (target.inputLocals?.get(name) === resolved) return resolved;
  // A `vars` key that no binding of the expression shadows names an input
  // that the host gives (a uniform, a Python name). A target that keeps a
  // local copy of each written input records it, and compiles the
  // expression again with the copy, so this emission of the write is not
  // kept.
  if (
    target.inputLocals !== undefined &&
    target.varsKeys?.has(name) === true &&
    target.boundVars?.has(name) !== true &&
    localShapeFrameOf(name) === undefined
  ) {
    target.inputWrites?.add(name);
    return resolved;
  }
  if (resolved === name) return resolved;
  // A block local spelled with a fresh name (`withFreshBlockLocals`).
  if (_freshLocalNames.has(resolved)) return resolved;
  // A loop index spelled with a fresh name (`withWritableLoopIndices`).
  if (_writableLoopIndices.has(resolved)) return resolved;
  // A vars-object member access naming this very symbol (`_.s`) is the only
  // other assignable form the built-in targets produce. Matched by string
  // surgery, not a regexp built from `name` (a symbol may hold regexp
  // metacharacters).
  if (
    resolved.endsWith(`.${name}`) &&
    /^[A-Za-z_$][\w$]*$/.test(resolved.slice(0, -(name.length + 1)))
  ) {
    // A write into the vars object of the caller: the target makes that
    // object a local copy before the body runs (`localVarsObjectStatement`).
    if (
      target.varsObjectName !== undefined &&
      resolved.slice(0, -(name.length + 1)) === target.varsObjectName
    )
      target.inputWrites?.add(name);
    return resolved;
  }
  throw new Error(
    `Could not compile \`Assign\`: target '${target.language ?? 'javascript'}' ` +
      `compiles reads of "${name}" as \`${resolved}\`, which is not an ` +
      `assignable reference (a constant, a folded value, or a baked ` +
      `\`vars\` mapping), so the write would be invisible to every read.`
  );
}

/**
 * The statement that makes the vars object of a JavaScript-family target a
 * local copy, or `undefined` when the body writes no input
 * (`CompileTarget.inputWrites`).
 *
 * An `Assign` whose target is an input that an engine scope binds
 * (`ce.declare('u', 'real')`, then `u ≔ u + 1`) is written `_.u = …`, the
 * same spelling as a read. Without a copy, the write changed the object
 * that the caller gave to `run()`. The interpreter changes the engine's
 * binding instead, and the caller's object is not an engine binding.
 *
 * The copy has the caller's object as its prototype, so a read that comes
 * before any write gives the caller's value, and an accessor of the
 * caller's object is still read. The compiled code tests an own property
 * only for a name of `Object.prototype` (`toString`: it reads
 * `Object.prototype.hasOwnProperty.call(_, "toString")`), so the own
 * properties of the caller's object with such a name are also own
 * properties of the copy, and the test gives the same answer as on the
 * caller's object. The other own properties are not copied: a copy of
 * each one made each run take a time that grows with the number of
 * properties of the caller's object (2,000 runs with 2,001 properties took
 * 1.1 s). With no vars object (`run()` with no argument), the copy is an
 * empty object with no prototype, so a body that writes an input before it
 * reads it gives a value.
 *
 * The properties of the copy are DEFINED (the second argument of
 * `Object.create`), not assigned. An assignment would fail on a property
 * that the caller's object, now the prototype, makes read-only
 * (`run(Object.freeze({ u: 5 }))` threw "Cannot assign to read only
 * property"), and would call a setter that the caller's object inherits.
 * An own property that is copied keeps its descriptor, so a getter is not
 * called before the body reads the property, and a data property is made
 * writable. Each input that the body writes is defined as a writable data
 * property with the value that a read gives, so that the write in the body
 * is to an own writable property of the copy, also when the caller's object
 * only inherits it. A getter of an input that the body does not write is
 * never called by the copy.
 *
 * The statement assigns the parameter `_` of the compiled function. The
 * definitions of the preamble that the body calls read `_` when they run,
 * so they read the copy too.
 */
export function localVarsObjectStatement(
  target: CompileTarget<Expression>
): string | undefined {
  const vars = target.varsObjectName;
  if (vars === undefined || !target.inputWrites?.size) return undefined;
  const written = JSON.stringify([...target.inputWrites]);
  return (
    `${vars} = ((s) => { const d = {}; ` +
    `if (s != null) for (const k of Object.getOwnPropertyNames(Object.prototype)) { ` +
    `const p = Object.getOwnPropertyDescriptor(s, k); ` +
    `if (p) { if ('value' in p) { p.writable = true; p.configurable = true; } d[k] = p; } } ` +
    `for (const k of ${written}) d[k] = { value: s == null ? undefined : s[k], ` +
    `writable: true, enumerable: true, configurable: true }; ` +
    `return Object.create(s || null, d); })(${vars})`
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
