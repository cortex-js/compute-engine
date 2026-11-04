// The admission rules of a compilation: every input has a type, and every
// value that the program produces has a settled shape.
//
// Design: rules R1 and R3 of `docs/plans/2026-10-31-static-shape-compilation.md`
// (user decision 2026-10-31, option (A)).

import type { Expression, Scope } from '../global-types.js';
import type { SymbolInterface } from '../types-expression.js';
import type { Type } from '../../common/type/types.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isOpenLocal } from '../boxed-expression/declared-local.js';
import {
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import type { CompileTarget } from './types.js';
import type { UnsettledShape } from './compiler-types.js';
import { CompilerState } from './compiler-state.js';
import {
  CompileDeclineError,
  isCompileDeclineError,
  UNSETTLED_SHAPE_CODE,
  UNTYPED_INPUT_CODE,
} from './diagnostics.js';
import { isCompileBoundName } from './compiler-names.js';
import { collectDeclaredTopSymbols } from './compiler-type-facts.js';
import {
  shapeOfType,
  shapesConflict,
  unionShapeMembers,
} from './static-shape.js';
import type { UnionShapeMember, ValueShape } from './static-shape.js';
import {
  analyzeReferences,
  freeSymbolOccurrence,
  isNamesTarget,
} from './compile-references.js';
import {
  complexDiscipline,
  declareTypeOperand,
  declareValueOperand,
  declaredTypeSource,
} from './compile-declarations.js';
import { parseType } from '../../common/type/parse.js';
import {
  buildCaseClosure,
  getMatchPlan,
} from '../boxed-expression/match-dispatch.js';
import {
  booleanClaim,
  mayBeCollectionCondition,
} from './compile-conditions.js';
import {
  compiledNodeWhere,
  throwStaticTypeError,
} from './compile-static-type-error.js';

/**
 * The inputs of the compiled code of `expr` whose static type is `unknown`
 * or `any` (`untypedInputsOf()`), from the reference analysis of `expr`
 * (`inputsOf()`, which gives the same free symbols as
 * `CompilationResult.freeSymbols`).
 */
export function untypedInputs(
  expr: Expression,
  target: CompileTarget<Expression>
): string[] {
  const { freeSymbols, occurrences } = inputsOf(expr, target);
  return untypedInputsOf(expr, target, freeSymbols, occurrences);
}

/**
 * The reference analysis of `expr` for `target` (`analyzeReferences()`):
 * the free symbols and their occurrences.
 *
 * If the analysis throws, the compilation declines with the code
 * `'untyped-input'` and no `value`: the types of the inputs are not known,
 * so the check cannot pass. A cancellation of the caller is thrown again.
 */
function inputsOf(
  expr: Expression,
  target: CompileTarget<Expression>
): {
  freeSymbols: string[];
  occurrences: Map<string, Expression>;
} {
  try {
    const occurrences = new Map<string, Expression>();
    const { freeSymbols } = analyzeReferences(
      expr,
      target,
      target.varsKeys,
      occurrences
    );
    return { freeSymbols, occurrences };
  } catch (e) {
    throwIfCallerCancellation(e, expr.engine._deadlineFrame);
    if (isCompileDeclineError(e)) throw e;
    throw new CompileDeclineError({
      code: UNTYPED_INPUT_CODE,
      kind: 'correctness',
      message:
        'Could not compile: the analysis of the inputs failed, so the ' +
        `types of the inputs are not known (${
          e instanceof Error ? e.message : String(e)
        }).`,
    });
  }
}

/**
 * The inputs of the compiled code of `expr` whose static type is `unknown`
 * or `any`: nothing declares them and nothing infers a type for them.
 * `freeSymbols` and `occurrences` are the result of the reference analysis
 * of `expr` for `target` (`analyzeReferences()`). The decline of the
 * compilation (`untypedInputs()`) and the interpreter fallback
 * (`buildInterpreterFallback()`) use this function, so they name the same
 * inputs.
 *
 * The inputs are the free symbols as the generated code sees them: a
 * symbol with no value, after the values of the symbols that the code
 * folds and the bodies of the user functions that it calls, and a symbol
 * mapped through `vars`. A parameter of a function literal, of a user
 * function or of the root function is bound, not an input, whatever its
 * type: `x ↦ x` and `f(t)`, with `f` declared `(unknown) -> unknown` and `t`
 * declared `real`, are not refused. A name that the target or the compiler
 * binds (`target.boundVars`, `isCompileBoundName()`) is not an input either.
 * A name that the compiled code assigns and that no enclosing scope of the
 * expression binds is an input when nothing declares it: with `u`
 * undeclared, `u ≔ u + 1` reads `u` before it writes it. A write to an
 * input declines while the code is generated (`assignLValue()`), so no
 * compiled code writes an input.
 *
 * The type of each input is the type that `CompilationResult.freeSymbolTypes`
 * reports for it (`freeSymbolOccurrence()`). A transparent alias of
 * `unknown` or `any` (`ce.declareType("U", "unknown", { alias: true })`) is
 * that type (`isUntypedType()`). A union of shapes (`number | list<number>`)
 * is a type, so an input declared with one is not in the list.
 *
 * A name that occurs only in branches that the code for the target drops
 * (`droppedOperandsOf()`) is not in the list, because the code does not
 * read it: with `z` undeclared, `If(2 < 3, 0, z)` compiles to `0`, also
 * when `vars` maps `z`. A name that occurs anywhere in the code that is
 * kept stays in the list, also where a binder binds it there. This is the
 * simple, sound version: the walk can see a name as bound where the code
 * reads the outer input (the variable of an indefinite integral, which
 * the reference analysis reports free), so
 * `If(2 < 3, 0, x) + Integrate(x^2, Limits(x, Nothing, Nothing))` with `x`
 * undeclared is refused. It also refuses
 * `List(If(2 < 3, 0, z), Sum(z, Limits(z, 1, 3)))`, where the `z` of the sum
 * is its index and the code does not read the input `z`. The names come
 * from the walk of the admission checks (`compiledNodeWhere()`); a name
 * that this walk does not find at all stays in the list. On a
 * shader target, an `If` whose condition is the symbol `True` emits both
 * branches, so `If(True, 0, z)` reads `z` there and `z` stays in the list.
 */
export function untypedInputsOf(
  expr: Expression,
  target: CompileTarget<Expression>,
  freeSymbols: ReadonlyArray<string>,
  occurrences: ReadonlyMap<string, Expression>
): string[] {
  const ce = expr.engine;
  // The walk of the code runs only when a name needs it: most inputs have
  // a type.
  let read: ReturnType<typeof namesReadIn> | undefined;
  const names = (): ReturnType<typeof namesReadIn> =>
    (read ??= namesReadIn(expr, target));
  const untyped = freeSymbols.filter((name) =>
    isUnboundUntypedName(
      name,
      freeSymbolOccurrence(name, occurrences) ?? ce.symbol(name),
      target
    )
  );
  if (untyped.length === 0) return [];
  const { kept, dropped } = names();
  return untyped.filter((name) => kept.has(name) || !dropped.has(name));
}

/**
 * The inputs of `expr` that a declaration types with a union of shapes
 * (`U: real | list<real>`, `P: tuple<real, real> | list<tuple<real, real>>`),
 * each with its members grouped by shape (`unionShapeMembers()`).
 *
 * Only an input that the root expression reads itself is in the list: its
 * name occurs in `expr`, outside the bodies of the user functions that
 * `expr` calls. The input has no value, and its type comes from a
 * declaration (`ce.declare("U", "real | list<real>")`), not from an
 * inference: a union that the engine infers is not a request for a
 * dispatch. A name that the target or the compiler binds is not an input.
 *
 * When the reference analysis fails, the list is empty: the other checks
 * of the compilation decline for that expression.
 *
 * The reference analysis runs only when a symbol of `expr` has such a
 * declaration. It compiles the operands of each operator, and so calls the
 * compile handlers of the operators; without a candidate, the compilation
 * calls them in the order it did before this dispatch existed.
 */
export function declaredUnionInputsOf(
  expr: Expression,
  target: CompileTarget<Expression>
): { name: string; members: UnionShapeMember[] }[] {
  const ce = expr.engine;
  const candidates = new Map<string, UnionShapeMember[]>();
  for (const name of expr.symbols) {
    if (target.boundVars?.has(name) || isCompileBoundName(name)) continue;
    const def = ce.lookupDefinition(name);
    if (def === undefined || !('value' in def) || def.value === undefined)
      continue;
    if (def.value.inferredType !== false || def.value.value !== undefined)
      continue;
    const members = unionShapeMembers(def.value.type.type);
    if (members !== undefined) candidates.set(name, members);
  }
  if (candidates.size === 0) return [];
  let freeSymbols: string[];
  try {
    freeSymbols = inputsOf(expr, target).freeSymbols;
  } catch (e) {
    throwIfCallerCancellation(e, expr.engine._deadlineFrame);
    return [];
  }
  const result: { name: string; members: UnionShapeMember[] }[] = [];
  for (const name of freeSymbols) {
    const members = candidates.get(name);
    if (members !== undefined) result.push({ name, members });
  }
  return result;
}

/**
 * True when the name `name`, whose symbol is `symbol`, is bound by neither
 * the target (`target.boundVars`: a parameter of the root function or of a
 * function literal in compilation) nor the compiler
 * (`isCompileBoundName()`), and its type is `unknown` or `any`
 * (`isUntypedType()`). `untypedInputsOf()` refuses each free symbol of the
 * root with no value for which this is true.
 */
function isUnboundUntypedName(
  name: string,
  symbol: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (target.boundVars?.has(name) || isCompileBoundName(name)) return false;
  return isUntypedType(symbol.type.type);
}

/**
 * Decline the compilation of `head` when one of its operands `args` is a
 * symbol declared `any` or `value`, or a library application over one
 * (`isDeclaredTopOperand()`). The value of such a symbol can be a number or
 * a list, and compiled code does not test the shape of a value at run time.
 * The decline has the code `'unsettled-shape'` and the kind `'capability'`,
 * and its message names each such symbol.
 *
 * Its `value`, which the interpreter fallback puts in `unsupported`, is the
 * name of the first symbol only: the other `'unsettled-shape'` declines
 * name one node in `value` too (`throwUnsettledShape()`).
 *
 * A symbol that the admission of the root refuses after the code is
 * generated is not named here, so that its decline has the code
 * `'untyped-input'`, as on every other target: a name that is not bound,
 * of type `any` (`isUnboundUntypedName()`), with no value. Every other such
 * symbol declines here: a parameter declared `any` or `value`, an input
 * declared `value`, and a symbol declared `any` or `value` that has a value
 * (`ce.declare("k", "any")`, `ce.assign("k", [1, 2])`: the compiled code
 * would read the list as a number in `k + x`).
 */
export function assertNoDeclaredTopOperands(
  head: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): void {
  const found = new Set<Expression & SymbolInterface>();
  const visited = new Set<Expression>();
  for (const a of args) collectDeclaredTopSymbols(a, found, visited);
  const names = [...found]
    .filter(
      (s) =>
        !isUnboundUntypedName(s.symbol, s, target) ||
        s.engine._getSymbolValue(s.symbol) !== undefined
    )
    .map((s) => s.symbol);
  if (names.length === 0) return;
  const list = names.map((n) => `"${n}"`).join(', ');
  throw new CompileDeclineError({
    code: UNSETTLED_SHAPE_CODE,
    kind: 'capability',
    message:
      `Could not compile \`${head}\` over ${list}: ` +
      `${names.length === 1 ? 'it is' : 'they are'} declared \`any\` or ` +
      `\`value\`, so ${names.length === 1 ? 'its value' : 'each value'} ` +
      `can be a number or a list, and compiled code does not test the ` +
      `shape of a value at run time. Declare the shape, for example ` +
      `\`real\` or \`list<real>\`.`,
    value: names[0],
  });
}

/**
 * True when `t` is `unknown` or `any`, after the transparent aliases that
 * name it are unfolded (`resolveTypeAlias()`, which stops at a cycle of
 * aliases). A nominal type is a type of its own, and is not unfolded.
 */
function isUntypedType(t: Readonly<Type>): boolean {
  const r = resolveTypeAlias(t);
  return r === 'unknown' || r === 'any';
}

/**
 * The names of the symbols and of the operators that the walk of the
 * admission checks (`compiledNodeWhere()`) finds in `expr`, bound or free:
 * `kept` in the code that the target keeps, `dropped` in the branches that
 * it drops (`droppedOperandsOf()`).
 */
function namesReadIn(
  expr: Expression,
  target: CompileTarget<Expression>
): { kept: Set<string>; dropped: Set<string> } {
  const kept = new Set<string>();
  const dropped = new Set<string>();
  compiledNodeWhere(
    expr,
    target,
    (node, isKept) => {
      const name = isSymbol(node)
        ? node.symbol
        : isFunction(node)
          ? node.operator
          : undefined;
      if (name !== undefined) (isKept ? kept : dropped).add(name);
      return false;
    },
    (node) => droppedOperandsOf(node, target)
  );
  return { kept, dropped };
}

/**
 * Decline the compilation when an input has the static type `unknown` or
 * `any` (`untypedInputs()`): `names` are the names of these inputs.
 *
 * The compiled code reads each input in one shape, a number, a list or a
 * point, and the shape comes from the input's type. With no type, the shape
 * is not known, and the compiled value can differ from the interpreter's:
 * with `M` undeclared, `If(M < 3, M, 0)` read `M` as a number, and gave `0`
 * for `M = [1, 5]` where the interpreter gives `[1, 0]`. The host declares
 * the input (`ce.declare("M", "real")`, or a union such as
 * `real | list<real>` when it can pass both shapes).
 *
 * This applies on every target. The diagnostic has the code
 * `'untyped-input'` and the kind `'correctness'`. Its `value` is the names
 * of the inputs, separated by commas, for display. The interpreter fallback
 * puts each name in `unsupported` (`buildInterpreterFallback()`): the
 * names of `value`, and those that `untypedInputsOf()` finds (also when
 * another reason declines first).
 */
function throwUntypedInputs(names: ReadonlyArray<string>): never {
  const list = names.map((name) => `\`${name}\``).join(', ');
  throw new CompileDeclineError({
    code: UNTYPED_INPUT_CODE,
    kind: 'correctness',
    message:
      `Could not compile: the input${names.length > 1 ? 's' : ''} ${list} ` +
      `${names.length > 1 ? 'have' : 'has'} no type (\`unknown\` or ` +
      `\`any\`). Declare the type of each input, for example with ` +
      `\`ce.declare("${names[0]}", "real")\`.`,
    value: names.join(','),
  });
}

/**
 * The value of a condition when it is known at compile time: the symbol
 * `True` or `False`, or a pure condition whose static type is the literal
 * value `True` or `False`, as the type of `2 < 3` is (`booleanClaim()`,
 * the test that the code generation uses to skip a branch). `undefined`
 * when the condition is decided at run time.
 */
function knownCondition(cond: Expression): boolean | undefined {
  if (isSymbol(cond, 'True')) return true;
  if (isSymbol(cond, 'False')) return false;
  return booleanClaim(cond);
}

/**
 * The indices of the operands of an `If(cond, a, b)` or of a
 * `Which(c1, v1, c2, v2, ...)` that the generated code drops, from the
 * operands `ops`. A dropped operand is never evaluated, so its shape does
 * not matter, and the code does not read the inputs in it.
 *
 * On the targets that are not shaders, a branch whose condition is known to
 * be `False` (`knownCondition()`) is dropped, and the clauses after a
 * condition known to be `True` (their conditions and their values) are
 * dropped.
 *
 * On the shader targets (GLSL, WGSL), every branch that the shader code has
 * must have the same type, also a branch that is never taken, or the shader
 * is not valid. The operands dropped are those that the shader lowering
 * does not emit:
 * - an `If` whose condition has a static type that is the literal value
 *   `True` or `False` (`booleanClaim()`, as for `2 < 3`) emits only the
 *   selected branch. An `If` whose condition is the symbol `True` or
 *   `False` emits both branches: `If(False, (1, 2), 0)` gives
 *   `((false) ? (vec2(1.0, 2.0)) : (0.0))` on GLSL.
 * - a `Which` emits every clause up to the first clause whose condition is
 *   the symbol `True`, and no clause after it. A condition whose static
 *   type is a literal value does not drop its clause:
 *   `Which(2 < 3, (1, 2), True, 0)` gives
 *   `((true) ? (vec2(1.0, 2.0)) : ((0.0)))` on GLSL.
 *
 * A condition that is not known keeps its branch, because the choice is
 * made at run time. A condition is never dropped when the clause before it
 * is kept: the condition of a branch known to be `False` is not emitted,
 * but its static type is a literal value, so it reads no input.
 */
function droppedOperands(
  operator: 'If' | 'Which',
  ops: ReadonlyArray<Expression>,
  shader: boolean
): Set<number> {
  const dropped = new Set<number>();
  if (operator === 'If') {
    const known = shader ? booleanClaim(ops[0]) : knownCondition(ops[0]);
    if (known === true) dropped.add(2);
    else if (known === false) dropped.add(1);
    return dropped;
  }
  for (let i = 0; i + 1 < ops.length; i += 2) {
    const known = shader
      ? isSymbol(ops[i], 'True') || undefined
      : knownCondition(ops[i]);
    if (known === false) dropped.add(i + 1);
    if (known === true) {
      for (let j = i + 2; j < ops.length; j++) dropped.add(j);
      break;
    }
  }
  return dropped;
}

/**
 * True when the condition `c` of an `If` or of a `Which` has a scalar type
 * (a boolean). A conditional whose condition has another type selects
 * element by element over a collection condition: it is not a choice
 * between its branches.
 *
 * When `unknownIsScalar` is true (the walk of `assignmentConflictIn()`,
 * and the comparison of the branches of `hasConflictingBranches()` and
 * `endValuesOf()`, where it can only add comparisons), two more conditions
 * count as a scalar:
 * - a condition of type `unknown`: the type gives no information about the
 *   value (an untyped parameter of a function literal, for example), and
 *   the code for the condition reads such a value as a scalar;
 * - a condition whose type has no single shape but cannot hold a
 *   collection, such as `number | missing`: no value of that type selects
 *   element by element, so the conditional is a choice between its
 *   branches.
 *   A union with a tuple member (`boolean | tuple<boolean, boolean>`) is
 *   such a type: a tuple selects as one value.
 * A condition whose type can hold a collection (`list<boolean>`, `any`, a
 * union with a list member) or whose type is a tuple does not count: the
 * walk declines such a conditional when a branch changes the state.
 */
function hasScalarCondition(
  c: Expression | undefined,
  unknownIsScalar = false
): boolean {
  if (c === undefined) return false;
  const shape = shapeOfType(c.type.type);
  if (shape?.kind === 'scalar') return true;
  if (!unknownIsScalar) return false;
  const r = resolveTypeForCompilation(c.type.type);
  if (r === 'unknown') return true;
  return (
    shape === undefined &&
    !c.type.matches('collection<any>') &&
    !mayBeCollectionCondition(c.type.type) &&
    !isSubtype('list<any>', r)
  );
}

/**
 * The indices of the operands of `node` that the generated code for
 * `target` drops (`droppedOperands()`), or `undefined` when it drops none:
 * `node` is not an `If` or a `Which`, or it has a condition whose type is
 * not a scalar (`hasScalarCondition()`). The walk of the admission checks
 * (`unsettledShapeIn()`, `untypedInputs()`) does not apply them to the
 * nodes in a dropped operand: on JavaScript, the code of
 * `If(2 < 3, 0, If(x > 0, [1, 2], 3))` is `0`.
 */
function droppedOperandsOf(
  node: Expression,
  target: CompileTarget<Expression>
): ReadonlySet<number> | undefined {
  if (!isFunction(node)) return undefined;
  const shader = isShaderTarget(target);
  // A function of the target for `Which` (a caller override through the
  // `functions` option, or a function of the target itself) receives every
  // operand (`compileExprWhich()`, `compile-conditionals.ts`), so none is
  // dropped: with `functions: { Which: 'myWhich' }`,
  // `Which(True, 0, True, M)` compiles to `myWhich(true, 0, true, _.M)`. An
  // `If` with no else branch that is not a statement is compiled as a
  // `Which`: `If(False, M)` gives `myWhich(false, _.M)`. For an `If`, a
  // condition whose type is a literal value (`booleanClaim()`) drops its
  // branch before the function is used (`compileExprIf()`), and a function
  // given as a string then receives every operand: with
  // `functions: { If: 'myIf' }`, `If(True, 0, M)` compiles to
  // `myIf(true, 0, _.M)`. A function given as a JavaScript function
  // compiles the operands that it chooses (the `If` of `interval-js` drops
  // a branch whose condition is `True` or `False`), so the rules below
  // apply to it.
  //
  // A `compile` handler of the definition of `Which` runs before the stock
  // lowering, and it receives every operand too: the code that it returns
  // can read any of them. With a handler that emits its last operand,
  // `Which(True, 0, True, M)` reads `M`. No operand of such a `Which` is
  // dropped. A handler can also return no code (`undefined`, `null` or an
  // empty string), and the stock lowering then drops the clauses after a
  // `True` condition. The admission does not call the handler to find out
  // which case applies: the handler can have effects, and the code that it
  // returns depends on the compilation of the operands. So the operands are
  // kept also for such a handler, and an operand that the code then does
  // not read is still checked: with a handler that returns no code,
  // `Which(True, 0, True, M)` declines because `M` has no type, although
  // the code reads only `0`. The result is a decline, never a wrong value.
  const ifFn = target.functions?.('If');
  const whichFn =
    target.functions?.('Which') ??
    (node.operator === 'Which' &&
      typeof node.operatorDefinition?.compile === 'function');
  let dropped: Set<number> | undefined;
  if (node.operator === 'If' && node.nops === 2 && whichFn) return undefined;
  if (node.operator === 'If' && hasScalarCondition(node.ops[0]))
    dropped = droppedOperands(
      'If',
      node.ops,
      shader || typeof ifFn === 'string'
    );
  else if (
    node.operator === 'Which' &&
    !whichFn &&
    node.ops.every((c, i) => i % 2 === 1 || hasScalarCondition(c))
  )
    dropped = droppedOperands('Which', node.ops, shader);
  return dropped !== undefined && dropped.size > 0 ? dropped : undefined;
}

/** True on the shader targets, GLSL and WGSL. */
function isShaderTarget(target: CompileTarget<Expression>): boolean {
  return target.language === 'glsl' || target.language === 'wgsl';
}

/**
 * The branches of a conditional node, whose value is the value of the node:
 * the two branches of an `If`, the values of a `Which`, the bodies of the
 * cases of a `Match`. `undefined` for another node, and for an `If` or a
 * `Which` with a condition whose type is not a scalar
 * (`hasScalarCondition()`): the shape of the value of such a conditional
 * is the shape of the condition, or it is not known.
 *
 * Of an `If` or a `Which`, only the branches that the generated code keeps
 * are returned (`droppedOperands()`, where `shader` selects the rule of the
 * GLSL and WGSL targets): on JavaScript, `Which(2 < 3, [1, 2], True, 0)`
 * has one branch, the list. `unknownIsScalar` is as in
 * `hasScalarCondition()`.
 *
 * A node whose code a caller's `compile` handler wrote, in each of its
 * lowerings (`CompilerState._callerLowered`), is not a conditional here:
 * the handler takes precedence over the stock lowering, and its code is
 * not the stock code that tests a condition and gives one branch. Such a
 * node is one value, of its static type. A handler of `Which` can
 * broadcast a scalar branch to the length of a list branch: with
 * `x: real`, its code for `Which(x > 0, 0, True, [1, 2])` can be
 * `x > 0 ? [0, 0] : [1, 2]`. The static type of such a node can still
 * admit several shapes (`integer | list<integer>` for that `Which`), and
 * `unsettledShapeIn()` declines when the stock code of a consumer reads it.
 */
function conditionalBranches(
  node: Expression,
  shader: boolean,
  unknownIsScalar = false
): Expression[] | undefined {
  if (!isFunction(node)) return undefined;
  if (CompilerState._callerLowered.get(node) === true) return undefined;
  const kept = (operator: 'If' | 'Which', first: number): Expression[] => {
    const dropped = droppedOperands(operator, node.ops, shader);
    const branches: Expression[] = [];
    for (let i = first; i < node.ops.length; i += operator === 'If' ? 1 : 2)
      if (!dropped.has(i)) branches.push(node.ops[i]);
    return branches;
  };
  if (node.operator === 'If')
    return hasScalarCondition(node.ops[0], unknownIsScalar)
      ? kept('If', 1)
      : undefined;
  if (node.operator === 'Which')
    return node.ops.every(
      (c, i) => i % 2 === 1 || hasScalarCondition(c, unknownIsScalar)
    )
      ? kept('Which', 1)
      : undefined;
  if (node.operator === 'Match')
    return node.ops
      .slice(1)
      .filter((c) => isFunction(c, 'MatchCase') && c.ops.length >= 2)
      .map((c) => (c as Expression & { ops: Expression[] }).ops.at(-1)!);
  return undefined;
}

/**
 * True when `node` is a conditional (`If`, `Which`, `Match`) with two
 * branches whose static types settle shapes that conflict
 * (`shapesConflict()`), such as `If(x > 0, [1, 2], 3)` (a list and a scalar)
 * or `If(x > 0, (1, 2), [(1, 2), (3, 4)])` (a point and a list of points).
 *
 * A branch whose type settles no shape (`unknown`, `any`, a union of shapes,
 * `broadcastable<T>`) is not compared: the shape of such a value is decided
 * at run time by the dispatch that compiles it today (the test of the
 * result of a user-function call, the broadcast of an operand). A branch
 * with no value (`Nothing`, the missing `else` of an `If`) is not compared
 * either.
 *
 * Two points of different arities (`If(x > 0, (1, 2), (3, 4, 5))`, of type
 * `tuple<integer, integer> | tuple<integer, integer, integer>`) conflict
 * only when `arity` is true. The shader targets set it: a point is a
 * `vec2`, a `vec3` or a `vec4` there, and the two branches of a conditional
 * must have the same type. On the other targets a point of any arity is
 * one array, and the consumers of the value read its arity at run time
 * (`Norm`, `PointX`, an element-wise sum), so the union is a type that
 * compiles.
 */
function hasConflictingBranches(node: Expression, arity: boolean): boolean {
  // `arity` is true on the shader targets, and only there.
  const branches = conditionalBranches(node, arity, true);
  if (branches === undefined || branches.length < 2) return false;
  return haveConflictingShapes(branches, arity);
}

/**
 * The values that `e` can give when its evaluation ends at its end, and not
 * at a `Return`: the last value of a `Block`, each branch that the code for
 * the target keeps of a conditional with a scalar condition
 * (`conditionalBranches()`). A `Return`, a `Break` and a `Continue` give
 * no value here: they leave `e`. A `Loop` is one value, whose static type
 * settles no shape, so it is not compared: a `Loop` whose value is used
 * and that has a `Break` declines (`isUnrepresentableLoopValue()`), and
 * the compiled `Break` of a loop whose value is not used carries no value.
 * For another node, the value is `e`.
 *
 * The cases of a `Match` are held raw, and the type of a raw expression is
 * not known. When `matchCases` is given, a `Match` gives the values of its
 * canonical case bodies (`matchCasePartsOf()`, with the innermost local
 * scope of the engine around the `Match`, from `scope` and the nodes that
 * the walk goes through); otherwise its raw bodies, which are not compared.
 */
function endValuesOf(
  e: Expression,
  target: CompileTarget<Expression>,
  matchCases = false,
  scope?: Scope
): Expression[] {
  // A node that several branches share (a DAG, as in
  // `If(c, e, e)` where both branches are the same object) is visited once,
  // and each value is listed once: without this, a chain of `n` such
  // conditionals gives 2^n values.
  const values = new Set<Expression>();
  const seen = new Set<Expression>();
  const shader = isShaderTarget(target);
  const visit = (
    e: Expression,
    depth: number,
    around: Scope | undefined
  ): void => {
    if (seen.has(e)) return;
    seen.add(e);
    if (depth > 64 || !isFunction(e)) {
      values.add(e);
      return;
    }
    const h = e.operator;
    if (h === 'Return' || h === 'Break' || h === 'Continue') return;
    if (matchCases && h === 'Match') {
      for (const b of matchCasePartsOf(e, around, true))
        visit(b, depth + 1, caseScopeOf(b, around));
      return;
    }
    const inner = e.localScope ?? around;
    if (h === 'Block') {
      if (e.nops > 0) visit(e.ops[e.nops - 1], depth + 1, inner);
      return;
    }
    const branches = conditionalBranches(e, shader, true);
    if (branches === undefined) values.add(e);
    else for (const b of branches) visit(b, depth + 1, inner);
  };
  visit(e, 0, scope);
  return [...values];
}

/**
 * The operands of the `Return` statements in `body`, in the code that the
 * target keeps: an operand that the target drops (`droppedOperandsOf()`)
 * is not read, and neither is a nested function literal (its `Return`
 * statements belong to it) or a `Hold`. A `Return` with no operand gives
 * no value, and is not listed.
 */
function returnValuesIn(
  body: Expression,
  target: CompileTarget<Expression>
): Expression[] {
  const values: Expression[] = [];
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if ((!isFunction(e) && !isDictionary(e)) || seen.has(e)) return;
    seen.add(e);
    // The values of a dictionary are code, also in a nested dictionary. A
    // dictionary can be shared by several parents: it is read once.
    if (isDictionary(e)) {
      [...e.values].forEach(visit);
      return;
    }
    const h = e.operator;
    if (h === 'Function' || h === 'Hold') return;
    if (h === 'Return') {
      if (e.nops > 0) values.push(e.ops[0]);
      return;
    }
    const dropped = droppedOperandsOf(e, target);
    if (dropped === undefined) codeOperandsOf(e).forEach(visit);
    else
      e.ops.forEach((op, i) => {
        if (!dropped.has(i)) visit(op);
      });
  };
  visit(body);
  return values;
}

/**
 * The values that a unit of code can give, where `body` is its code: the
 * body of a function literal, or the root of the compilation. These are
 * the value of each `Return` that belongs to the unit, and the values of
 * the body when its evaluation ends at its end (`endValuesOf()`).
 *
 * A `Return` belongs to the innermost function literal around it, or to
 * the root when there is none. The interpreter takes it out of every
 * `Block` and every `Loop` between it and that literal: in
 * `a ↦ Block(Loop(If(a > 1, Return(3)), Element(k, 1..3)), [1, 2])`, the
 * literal gives `3` or `[1, 2]`.
 */
function unitValuesOf(
  body: Expression,
  target: CompileTarget<Expression>
): Expression[] {
  return [
    ...new Set([
      ...returnValuesIn(body, target).flatMap((v) =>
        endValuesOf(v, target)
      ),
      ...endValuesOf(body, target),
    ]),
  ];
}

/**
 * True when two of `values` have static types that settle shapes that
 * conflict (`shapesConflict()`, with `arity` as in
 * `hasConflictingBranches()`). A value whose type settles no shape is not
 * compared. Each distinct shape is compared once, so the cost depends on the
 * number of distinct shapes, not on the number of values.
 */
function haveConflictingShapes(
  values: ReadonlyArray<Expression>,
  arity: boolean
): boolean {
  if (values.length < 2) return false;
  return haveConflictingTypes(
    values.map((v) => v.type.type),
    arity
  );
}

/**
 * True when two of the types `types` settle shapes that conflict
 * (`shapesConflict()`), as `haveConflictingShapes()` tests the types of its
 * values. A type that settles no shape is not compared.
 */
function haveConflictingTypes(
  types: ReadonlyArray<Readonly<Type>>,
  arity: boolean
): boolean {
  if (types.length < 2) return false;
  const shapes: ValueShape[] = [];
  const keys = new Set<string>();
  for (const t of types) {
    const s = shapeOfType(t);
    if (s === undefined) continue;
    const key = JSON.stringify(s);
    if (keys.has(key)) continue;
    keys.add(key);
    if (shapes.some((other) => shapesConflict(other, s, arity))) return true;
    shapes.push(s);
  }
  return false;
}

/**
 * True when `t` admits values of shapes that conflict, as the branches of a
 * conditional conflict (`haveConflictingTypes()`): `broadcastable<T>`, a
 * union with a member that is such a type (`broadcastable<real> |
 * missing`), or a union with two members whose shapes conflict
 * (`integer | list<integer>`). The members `missing` and `nothing` are not
 * compared, as a branch with no value is not, and neither is a member that
 * settles no shape (`unknown`, a string): `integer | missing`, the type of
 * `Which(x > 0, 1, x < 0, 2)`, is not such a type. `arity` is as in
 * `haveConflictingTypes()`: two points of different arities conflict only
 * on the shader targets. `depth` stops the search in a type that refers to
 * itself, as in `shapeOfType()`; such a type is then read as one that
 * admits shapes that conflict, so the result is a decline.
 */
function hasNoSettledShape(
  t: Readonly<Type>,
  arity: boolean,
  depth = 0
): boolean {
  if (depth > 16) return true;
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string') return false;
  if (r.kind === 'broadcastable') return true;
  if (r.kind !== 'union') return false;
  const members = r.types.filter((m) => m !== 'missing' && m !== 'nothing');
  if (members.some((m) => hasNoSettledShape(m, arity, depth + 1))) return true;
  return haveConflictingTypes(members, arity);
}

/**
 * True when `node` is a function literal whose values have conflicting
 * shapes (`haveConflictingShapes()`): the values of the body of the
 * literal (`unitValuesOf()`). With `M: list<real>`,
 * the body of `(a: list<real>) ↦ Block(If(Length(a) > 1, Return(First(a))),
 * Reverse(a))` gives a number or a list.
 */
function hasConflictingValues(
  node: Expression,
  target: CompileTarget<Expression>,
  arity: boolean
): boolean {
  if (isFunction(node, 'Function') && node.nops > 0)
    return haveConflictingShapes(unitValuesOf(node.ops[0], target), arity);
  return false;
}

/**
 * How the parent `node` uses the value of its operand at index `i`:
 * - `'statement'`: the value is discarded. This is a statement of a `Block`
 *   that is not its last one, and the body of a `Loop`.
 * - `'end'`: the value is the value of `node`, so it is used when the value
 *   of `node` is used. This is the last statement of a `Block`, a branch of
 *   an `If` or a `Which` with scalar conditions (`hasScalarCondition()`),
 *   a case of a `Match` and the body of a `MatchCase`. This is the rule of
 *   `endValuesOf()`.
 * - `'value'`: the value is used, for every other operand.
 */
function operandUse(
  node: Expression,
  i: number
): 'statement' | 'end' | 'value' {
  if (!isFunction(node)) return 'value';
  const h = node.operator;
  const last = i === node.nops - 1;
  if (h === 'Block') return last ? 'end' : 'statement';
  if (h === 'Loop') return i === 0 ? 'statement' : 'value';
  if (h === 'If')
    return i > 0 && hasScalarCondition(node.ops[0]) ? 'end' : 'value';
  if (h === 'Which')
    return i % 2 === 1 &&
      node.ops.every((c, j) => j % 2 === 1 || hasScalarCondition(c))
      ? 'end'
      : 'value';
  if (h === 'Match') return i > 0 ? 'end' : 'value';
  if (h === 'MatchCase') return last ? 'end' : 'value';
  return 'value';
}

/**
 * The names that the `Assign` or the `Declare` `node` writes, each with the
 * static type of the value that it writes, or `undefined` when that type is
 * not known. A destructuring `Tuple` target gives each leaf the type of the
 * element at its position, when the type of the value is a tuple of the
 * same length; otherwise the leaves have no known type. The placeholder `_`
 * is not a name, and is not listed. Another target (`At(L, i)`) writes no
 * name. A `Declare` with no value writes its names with no known type.
 */
function assignedTypesOf(
  node: Expression
): Map<string, Readonly<Type> | undefined> {
  const result = new Map<string, Readonly<Type> | undefined>();
  if (!isFunction(node) || node.nops === 0) return result;
  const record = (t: Expression, type: Readonly<Type> | undefined): void => {
    if (isSymbol(t)) {
      if (t.symbol !== '_') result.set(t.symbol, type);
    } else if (isFunction(t, 'Tuple')) {
      const r =
        type === undefined ? undefined : resolveTypeForCompilation(type);
      const elements =
        r !== undefined &&
        typeof r !== 'string' &&
        r.kind === 'tuple' &&
        r.elements.length === t.nops
          ? r.elements
          : undefined;
      t.ops.forEach((leaf, i) => record(leaf, elements?.[i].type));
    }
  };
  if (node.operator === 'Assign' && node.nops >= 2)
    record(node.ops[0], node.ops[1].type.type);
  else if (node.operator === 'Declare')
    record(node.ops[0], declareValueOperand(node.ops)?.type.type);
  return result;
}

/**
 * The type that the `Declare` `node` states for its name, or `undefined`
 * when it states none, states `unknown`, or states a type that does not
 * parse.
 */
function statedTypeOf(node: Expression): Readonly<Type> | undefined {
  if (!isFunction(node, 'Declare')) return undefined;
  const spec = declareTypeOperand(node.ops);
  const source = spec === undefined ? undefined : declaredTypeSource(spec);
  if (source === undefined || source === 'unknown') return undefined;
  try {
    return parseType(source, node.engine._typeResolver);
  } catch {
    return undefined;
  }
}

/**
 * True when the compilation uses the `complex` compile mode: the option
 * `mode: 'complex'` of the target, or the discipline of that mode in force
 * (`complexDiscipline()`). Every
 * value that is not typed real is then lifted to a complex number where it
 * is used, so a real and a complex value have one representation.
 */
function complexMode(target: CompileTarget<Expression>): boolean {
  return target.mode === 'complex' || complexDiscipline();
}

/**
 * True when no compiled value can have the types of all of `types`: two of
 * them settle shapes that conflict (`haveConflictingTypes()`, with `arity`
 * as in `hasConflictingBranches()`), or one is a string and another is not,
 * or one is real (or boolean) and another is complex and not real.
 *
 * The compiled code gives a name one representation, which the type of the
 * name selects: a number, a complex number (an object with a real and an
 * imaginary part in JavaScript), a string, an array for a list, an array for
 * a point, an array of arrays for a matrix. These are the shape classes of
 * the rule of `assignmentConflictIn()`. The length of a list is not part of
 * its shape: `[1, 2]` and `[1, 2, 3]` do not conflict. A type that settles
 * no shape (`unknown`, `any`, a union of shapes, `number`, which admits both
 * a real and a complex value) is not compared on the axis it does not settle.
 */
function assignedTypesConflict(
  types: ReadonlyArray<Readonly<Type>>,
  arity: boolean,
  /** True in the `complex` compile mode (`complexMode()`). */
  complex: boolean
): boolean {
  if (haveConflictingTypes(types, arity)) return true;
  const classes = new Set<'string' | 'real' | 'complex' | 'other'>();
  for (const t of types) {
    const r = resolveTypeForCompilation(t);
    if (r === 'unknown' || r === 'any' || r === 'never' || r === 'error')
      continue;
    if (isSubtype(r, 'string')) classes.add('string');
    else if (isSubtype(r, 'real') || isSubtype(r, 'boolean'))
      classes.add('real');
    else if (isSubtype(r, 'complex')) classes.add('complex');
    else if (shapeOfType(r) !== undefined) classes.add('other');
  }
  // In the `complex` compile mode, every value that is not typed real is
  // lifted to a complex number where it is used (`complexMode()`), so
  // a real and a complex value have one representation there.
  return (
    (classes.has('string') && classes.size > 1) ||
    (classes.has('real') && classes.has('complex') && !complex)
  );
}

// The local scope of the function literal that binds the captures of
// each canonical case part with captures (`matchCasePartsOf()`).
const caseScopes = new WeakMap<Expression, Scope>();

/**
 * The innermost local scope of the engine for the code of `part`, a part of
 * a `Match` case from `matchCasePartsOf()` or a node in it: the scope of the
 * function literal that binds the captures of the part, the `localScope`
 * of the part, or `around`.
 */
function caseScopeOf(
  part: Expression,
  around: Scope | undefined
): Scope | undefined {
  return caseScopes.get(part) ?? part.localScope ?? around;
}

/**
 * The guard and the body of each case of the `Match` `node`, in the
 * canonical form that the compiled code evaluates. The operands of a
 * `MatchCase` are held raw, and the type of a raw expression is not known,
 * so a check that reads types must read the canonical form. As
 * `compileMatchGuard()` and `compileMatchBody()` (`compile-match.ts`) do, a
 * part with no capture is made canonical in `scope`, the local scope around
 * the `Match`, and a part with captures is the body of a function literal
 * whose parameters are the captures (`buildCaseClosure()`). A part that
 * cannot be made canonical is returned raw.
 *
 * The scope that binds the names of a part (`caseScopeOf()`) is the local
 * scope of that function literal for a part with captures: a nested
 * `Match` in the part must be made canonical there, where the captures are
 * bound, or its canonical form would declare the captures in an outer scope
 * of the engine.
 */
function matchCasePartsOf(
  node: Expression,
  scope: Scope | undefined,
  /** When true, only the bodies, not the guards. */
  bodiesOnly = false,
  /** When given, each guard that is returned is also added to it. */
  guards?: Set<Expression>
): Expression[] {
  if (!isFunction(node, 'Match')) return [];
  const ce = node.engine;
  const inScope = <T>(f: () => T): T =>
    scope === undefined ? f() : ce._inScope(scope, f);
  const canonical = (e: Expression, names: string[]): Expression => {
    try {
      if (names.length === 0) return inScope(() => e.canonical);
      const closure = inScope(() => buildCaseClosure(ce, e, names));
      if (!isFunction(closure, 'Function')) return e;
      const body = closure.ops[0];
      const bound = closure.localScope ?? body.localScope;
      if (bound !== undefined) caseScopes.set(body, bound);
      return body;
    } catch {
      return e;
    }
  };
  const parts: Expression[] = [];
  for (const segment of getMatchPlan(ce, node.ops).segments)
    for (const c of segment.cases) {
      if (!bodiesOnly && c.hasGuard && c.guard !== undefined) {
        const guard = canonical(c.guard, c.captureNames);
        guards?.add(guard);
        parts.push(guard);
      }
      parts.push(canonical(c.body, c.captureNames));
    }
  return parts;
}

/**
 * The operands of `e` that the walks of this file read as code: for a
 * `Declare`, its name and its value (`declareValueOperand()`, also when the
 * value is in the dictionary of its attributes, which is not a function
 * node); for another node, its operands, where a dictionary operand stands
 * for its values. With `Declare(f, {value: p ↦ …})`, the body of the literal
 * is then searched as the body of a stored function.
 */
function codeOperandsOf(e: Expression): Expression[] {
  if (!isFunction(e)) return [];
  if (e.operator === 'Declare') {
    const value = declareValueOperand(e.ops);
    return value === undefined ? [e.ops[0]] : [e.ops[0], value];
  }
  return e.ops.flatMap((op) => (isDictionary(op) ? [...op.values] : [op]));
}

/**
 * For each `Match` node in `bodies`, the innermost local scope of the
 * engine around it (the `localScope` of the nearest enclosing node that
 * has one), or `undefined` when no node around it has one. The walk does
 * not enter a `Hold`.
 */
function localScopesOf(
  bodies: ReadonlyArray<Expression>
): Map<Expression, Scope | undefined> {
  const result = new Map<Expression, Scope | undefined>();
  const seen = new Set<Expression>();
  const stack: [Expression, Scope | undefined][] = bodies.map((b) => [
    b,
    undefined,
  ]);
  while (stack.length > 0) {
    const [e, outer] = stack.pop()!;
    if (!isFunction(e) || seen.has(e)) continue;
    seen.add(e);
    if (e.operator === 'Hold') continue;
    if (e.operator === 'Match') result.set(e, outer);
    const scope = e.localScope ?? outer;
    for (const op of codeOperandsOf(e)) stack.push([op, scope]);
  }
  return result;
}

/**
 * The names that the target of the `Assign` or the `Declare` `node` writes,
 * each with the static type of its symbol: the declared type of the name,
 * or the type that inference gives it. A name whose symbol is not known (a
 * leaf of a destructuring `Tuple` that is not a symbol) is not listed.
 */
function targetTypesOf(node: Expression): Map<string, Readonly<Type>> {
  const result = new Map<string, Readonly<Type>>();
  if (!isFunction(node) || node.nops === 0) return result;
  if (node.operator !== 'Assign' && node.operator !== 'Declare') return result;
  const record = (t: Expression): void => {
    if (isSymbol(t)) {
      if (t.symbol !== '_') result.set(t.symbol, t.type.type);
    } else if (isFunction(t, 'Tuple')) t.ops.forEach(record);
  };
  record(node.ops[0]);
  return result;
}

/**
 * The first assignment in `bodies` that gives a name a value whose shape
 * class conflicts with another value or with the type of the same name in
 * the same scope (`assignedTypesConflict()`), or another part of `bodies`
 * whose effects the compiled code does not reproduce, as an
 * `UnsettledShape`; `undefined` when there is none. `bodies` are the root
 * of the compilation and the user-function bodies and stored values that
 * the compiled code reaches.
 *
 * The compiled code gives each variable one representation, which its type
 * selects. So, for each variable, the walk collects these types: the type
 * of each value that an `Assign` or a `Declare` gives it, the type of its
 * symbol (declared, or inferred from its uses), the type that a `Declare`
 * states for it, and for a parameter of a function literal the type of the
 * parameter (and, for a literal that `Apply` applies where it is written,
 * the type of each scalar argument). When two of these types conflict, the
 * compilation declines with the reason `'assignments'`, and the diagnostic
 * names the `Assign` (or the `Declare`, or the function literal) that adds
 * the type that conflicts. With `x: real`, the body of
 * `t ↦ Block(If(x > 0, p ≔ [1, 2], p ≔ 3), 2p)` declines, and so does
 * `Block(p ≔ 0, p ≔ [1, 2], p)`, also when the interpreter has a value:
 * the order of the assignments and the paths of the code are not examined.
 * `Block(p ≔ [1, 2], p ≔ [1, 2, 3], p)` compiles: the length of a list is
 * not part of its shape. A value whose type settles no shape is not
 * compared. A variable whose `Declare` states a type that admits several
 * shapes (a union such as `real | list<real>`, or `broadcastable<number>`)
 * is not checked: the declaration asks for both shapes, as a declared union
 * does for an input (rule R1), and the compiled code tests the shape of the
 * value where it reads it.
 *
 * The variables are identified by name, and a name is a new variable only
 * where it is certainly one: a parameter of a function literal, a name that
 * a `Declare` statement of a `Block` declares (in that block), and the index
 * of a clause of a `Loop`, a `Sum`, a `Product`, a `Comprehension` or an
 * `Integrate`. Every other occurrence of a name, in any of `bodies`, is the
 * same variable: a local that a block or a function body creates by its
 * first assignment, and a local of the same name elsewhere, are compared as
 * one variable. This can decline where the interpreter has a value (two
 * functions that each use a local `p` of a different shape); it never
 * accepts two shapes for one variable.
 *
 * The same walk declines for the effects that the compiled code does not
 * reproduce. These declines do not depend on the shapes, and each is the
 * simple, sound version of its rule:
 * - `'index-assignment'`: an `Assign`, in a function literal, of the index
 *   of a `Loop`, a `Sum`, a `Product`, a `Comprehension` or an `Integrate`
 *   that encloses the literal. With
 *   `Block(n ≔ 0, Loop(Block(Apply(u ↦ k ≔ 5, 0), n ≔ n + 1), Element(k, 1..3)), n)`
 *   the interpreter gives 3 and the compiled code gave 1. An assignment of
 *   the index directly in the body is left to the code generation of each
 *   target, which declines it or compiles it to a new variable.
 * - `'elementwise'`: an `If` or a `Which` whose condition is or can be a
 *   collection (`hasScalarCondition()` with `unknownIsScalar`; an `Equal`
 *   or a `NotEqual`, which compares whole values, is not such a condition)
 *   and whose branch assigns a name or has a `Return`, a `Break` or a
 *   `Continue` (`changesState()`). The interpreter selects element by
 *   element, and the compiled code cannot run a branch for some elements
 *   only.
 * - `'scoped-assignment'`, for a `Comprehension`, a `Sum`, a `Product` or an
 *   `Integrate` with a part where an assignment does not have the same
 *   effect in the interpreter and in the compiled code (`scopedPartsOf()`)
 *   and that has an effect outside itself (`writesOuterName()`; for an
 *   `Integrate`, any assignment, `changesState()`), and for a `Sum` or a
 *   `Product` whose body has a `Return`, or a `Break` or a `Continue` that
 *   no `Loop` of the body encloses.
 * - `'scoped-assignment'`, for a function literal that has an effect
 *   outside itself (`writesOuterName()`: it assigns a name of an enclosing
 *   scope or an element of one, or a `Break` or a `Continue` leaves it).
 *   For a callback, the interpreter and the compiled code do not agree on
 *   such an effect: with `Block(p ≔ 0, Filter(L, u ↦ Block(p ≔ 5, u > 1)),
 *   p)`, the interpreter gives 0 (it does not run the callback when the
 *   result is not used) and the compiled code gave 5. The check cannot see
 *   every path by which a function reaches a callback operator (a stored
 *   function passed by name, behind an `If`, returned by another literal),
 *   so it declines for every such literal: a callback, the value of a
 *   `Declare` or an `Assign`, a literal returned by another one, and the
 *   body of a user function that the code calls (a root of `bodies` after
 *   the first). Two literals are exempt: the root of the compilation, which
 *   the host calls, and a literal that `Apply` applies where it is written,
 *   whose body runs once as inline code. That one declines only when a
 *   `Break` or a `Continue` leaves it, or when an argument is not known to
 *   be a scalar (the literal can then map over the argument and run its
 *   body zero or more times) and it assigns a name of an enclosing scope.
 *   User decision 2026-11-01 (the simple decline), ROADMAP CE-720.
 *
 * `writesOuterName()` tells a local from an outer name by the bindings of
 * the local scopes (`ownLocalNames()`): two user functions that each assign
 * a local `t` do not write an outer name.
 *
 * A `Hold` and an operand that the target drops (`droppedOperandsOf()`) are
 * not walked. The walk uses a stack, not recursion, so the depth of the
 * code does not matter.
 *
 * Design: the simple rule for assignments of R3 in
 * `docs/plans/2026-10-31-static-shape-compilation.md` (CE-712.1).
 */
function assignmentConflictIn(
  bodies: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): UnsettledShape | undefined {
  const shader = isShaderTarget(target);
  // A scope maps each name that it binds to the key of its variable. A name
  // with no entry is the variable `*:<name>`.
  type Env = ReadonlyMap<string, string>;
  const keyOf = (env: Env, name: string): string =>
    env.get(name) ?? `*:${name}`;
  let nextScope = 0;
  const indexKeys = new Set<string>();
  // For each scope, the keys of the clause indices that are bound outside
  // the innermost function literal around it.
  const crossedIndices = new WeakMap<Env, ReadonlySet<string>>();
  const bind = (
    env: Env,
    names: Iterable<string>,
    kind: 'names' | 'indices' | 'function' = 'names'
  ): Env => {
    const id = nextScope++;
    const next = new Map(env);
    for (const name of names) {
      const key = `${id}:${name}`;
      next.set(name, key);
      if (kind === 'indices') indexKeys.add(key);
    }
    const crossed = crossedIndices.get(env);
    if (kind === 'function')
      crossedIndices.set(
        next,
        new Set([...env.values()].filter((k) => indexKeys.has(k)))
      );
    else if (crossed !== undefined) crossedIndices.set(next, crossed);
    return next;
  };

  // The variables whose `Declare` states a type that admits values of
  // several shapes (a union, `broadcastable<number>`).
  const declaredUnions = new Set<string>();
  // The variables that are block locals whose first value has the type
  // `unknown`. Such a local keeps the type `unknown` (`isOpenLocal()`), so
  // its type selects no representation. A read of the local finds its
  // binding (the target of an `Assign` or a `Declare` is not bound).
  const untypedTargets = new Set<string>();
  // The types of each variable, in the order of the walk, each with the
  // node that gives it.
  const variables = new Map<
    string,
    { type: Readonly<Type>; node: Expression }[]
  >();
  const add = (
    key: string,
    type: Readonly<Type> | undefined,
    node: Expression
  ): void => {
    if (type === undefined) return;
    const entries = variables.get(key);
    if (entries === undefined) variables.set(key, [{ type, node }]);
    else entries.push({ type, node });
  };

  const writesOuter = (part: Expression, writes?: Expression[]): boolean =>
    writesOuterName(part, true, writes);

  // The roots of `bodies` after the first one: the bodies of the user
  // functions that the compiled code calls, and the values that it inlines.
  const reached = new Set(bodies.slice(1));

  // Each entry: a node, the scope of names around it, its parent, and the
  // innermost local scope of the engine around it (to make the parts of a
  // `Match` canonical).
  type Entry = [Expression, Env, Expression | undefined, Scope | undefined];
  const stack: Entry[] = bodies.map((b) => [
    b,
    new Map(),
    undefined,
    undefined,
  ]);
  // A node can be shared by several parents (a DAG): it is walked once for
  // each scope and each parent that reach it.
  const seen = new Map<Expression, [Env, Expression | undefined][]>();
  while (stack.length > 0) {
    const [node, outer, parent, outerScope] = stack.pop()!;
    if (isSymbol(node)) {
      const def = node.valueDefinition;
      if (def !== undefined && isOpenLocal(def))
        untypedTargets.add(keyOf(outer, node.symbol));
      continue;
    }
    if (!isFunction(node) && !isDictionary(node)) continue;
    const visits = seen.get(node);
    if (visits?.some(([env, p]) => env === outer && p === parent)) continue;
    if (visits === undefined) seen.set(node, [[outer, parent]]);
    else visits.push([outer, parent]);
    // The compiled code evaluates the values of a dictionary: walk them in
    // the scope of the dictionary, also in a nested dictionary.
    if (isDictionary(node)) {
      for (const v of node.values) stack.push([v, outer, parent, outerScope]);
      continue;
    }
    if (!isFunction(node)) continue;
    const scope = node.localScope ?? outerScope;
    const h = node.operator;
    if (h === 'Hold') continue;
    let env = outer;

    if (h === 'Function') {
      const params = parametersOf(node);
      env = bind(outer, params.keys(), 'function');
      for (const [name, type] of params) add(keyOf(env, name), type, node);
      if (isFunction(parent, 'Apply') && parent.ops[0] === node) {
        // Applied where it is written: the body runs once, as inline code,
        // unless an argument is not known to be a scalar (the literal can
        // then map over it and run its body zero or more times).
        const args = parent.ops.slice(1);
        const scalar = args.map((a) => isSubtype(a.type.type, 'scalar'));
        if (
          writesOuterName(node, false) ||
          (scalar.some((x) => !x) && writesOuter(node))
        )
          return { node: parent, reason: 'scoped-assignment' };
        node.ops.slice(1).forEach((p, k) => {
          const name = parameterName(p);
          if (name !== undefined && scalar[k] === true)
            add(keyOf(env, name), args[k].type.type, parent);
        });
      } else if (
        (parent !== undefined || reached.has(node)) &&
        writesOuter(node)
      )
        // Every other function literal that assigns a name of an enclosing
        // scope declines: a callback, a stored function, a returned
        // function, and the body of a user function that the code calls
        // (user decision 2026-11-01, ROADMAP CE-720).
        return { node: parent ?? node, reason: 'scoped-assignment' };
    } else if (h === 'Block') {
      const declared: string[] = [];
      for (const stmt of node.ops)
        if (isFunction(stmt, 'Declare'))
          declared.push(...assignedTypesOf(stmt).keys());
      if (declared.length > 0) env = bind(outer, declared);
    } else if (CLAUSE_OPERATORS.has(h)) {
      const indices: string[] = [];
      for (const clause of node.ops.slice(1))
        indices.push(...clauseIndexNames(clause));
      if (indices.length > 0) env = bind(outer, indices, 'indices');
      if (
        h !== 'Loop' &&
        (scopedPartsOf(node).some((part) =>
          h === 'Integrate' ? changesState(part) : writesOuter(part)
        ) ||
          // The compiled code of the body of a `Sum` or a `Product` is an
          // expression, not the body of a loop: a `Break` or a `Continue`
          // in it cannot leave the loop of the sum, or an enclosing `Loop`,
          // and a `Return` in it cannot end the enclosing function.
          ((h === 'Sum' || h === 'Product') &&
            node.nops > 0 &&
            writesOuterName(node.ops[0], false)))
      )
        return { node, reason: 'scoped-assignment' };
    } else if (h === 'If' || h === 'Which') {
      const isCondition = (i: number): boolean =>
        h === 'If' ? i === 0 : i % 2 === 0;
      // An `Equal` or a `NotEqual` compares its operands as whole values in
      // the interpreter and in the compiled code (`_SYS.eq`), also when its
      // static type is `list<boolean>` because an operand is a union with a
      // list member: it does not select element by element.
      // Test: `collection-equality-absent.test.ts`, "an operand that is only
      // POSSIBLY a collection is read the same way".
      const elementwise = node.ops.some(
        (c, i) =>
          isCondition(i) &&
          !isFunction(c, 'Equal') &&
          !isFunction(c, 'NotEqual') &&
          !hasScalarCondition(c, true)
      );
      if (
        elementwise &&
        node.ops.some((op, i) => !isCondition(i) && changesState(op))
      )
        return { node, reason: 'elementwise' };
    } else if (h === 'Assign' || h === 'Declare') {
      const values = assignedTypesOf(node);
      const symbols = targetTypesOf(node);
      const stated = h === 'Declare' ? statedTypeOf(node) : undefined;
      const statesUnion =
        stated !== undefined &&
        (() => {
          const r = resolveTypeForCompilation(stated);
          return (
            typeof r !== 'string' &&
            (r.kind === 'union' || r.kind === 'broadcastable') &&
            shapeOfType(r) === undefined
          );
        })();
      for (const [name, type] of values) {
        const key = keyOf(env, name);
        if (statesUnion) declaredUnions.add(key);
        if (h === 'Assign' && crossedIndices.get(env)?.has(key) === true)
          return { node, reason: 'index-assignment' };
        add(key, stated, node);
        add(key, symbols.get(name), node);
        add(key, type, node);
      }
    }

    // The parts that the compiled code evaluates: of a `Declare`, its value
    // (`declareValueOperand()`, also when it is in the dictionary of its
    // attributes); of a `Match`, the subject and the guard and the body of
    // each case, in canonical form (`matchCasePartsOf()`); of another node,
    // the operands that the target keeps.
    // Each part with its position in the operands of `node`, or -1.
    let parts: ReadonlyArray<[Expression, number]>;
    if (h === 'Declare') {
      const value = declareValueOperand(node.ops);
      parts = value === undefined ? [] : [[value, -1]];
    } else if (h === 'Match')
      parts = [node.ops[0], ...matchCasePartsOf(node, scope)].map((p) => [
        p,
        -1,
      ]);
    else {
      const dropped = droppedOperandsOf(node, target);
      parts = node.ops
        .map((op, i): [Expression, number] => [op, i])
        .filter(([, i]) => dropped?.has(i) !== true);
    }
    for (const [part] of parts)
      stack.push([part, env, node, caseScopeOf(part, scope)]);
  }

  for (const [key, entries] of variables) {
    if (declaredUnions.has(key)) continue;
    // A variable of type `unknown` that is given a value of a shape other
    // than a number (a list, a point, a matrix, a string) declines: the
    // compiled code reads the variable by the static type of each use, and
    // a use of an `unknown` operand is read as a number. With `t` untyped,
    // `Block(Declare(q, "unknown", t), If(t > 0, q ≔ [2, 3]), 2q)` gave
    // `[NaN, NaN]` for `t = 4`; the interpreter gives `[4, 6]`.
    if (untypedTargets.has(key)) {
      const nonScalar = entries.find(({ type }) => {
        const r = resolveTypeForCompilation(type);
        if (r === 'unknown' || r === 'any' || r === 'never' || r === 'error')
          return false;
        return (
          isSubtype(r, 'string') ||
          (!isSubtype(r, 'number') &&
            !isSubtype(r, 'boolean') &&
            shapeOfType(r) !== undefined)
        );
      });
      if (nonScalar !== undefined)
        return { node: nonScalar.node, reason: 'assignments' };
    }
    const types: Readonly<Type>[] = [];
    for (const { type, node } of entries) {
      types.push(type);
      if (
        types.length > 1 &&
        assignedTypesConflict(types, shader, complexMode(target))
      )
        return { node, reason: 'assignments' };
    }
  }
  return undefined;
}

/**
 * The parts of `node`, a `Comprehension`, a `Sum`, a `Product` or an
 * `Integrate`, where an assignment does not have the same effect in the
 * interpreter and in the compiled JavaScript. In the interpreter, an
 * assignment in the body or in a clause of a `Comprehension` (other than
 * the source of its first clause) and in a clause of a `Sum` or a
 * `Product` does not change the name outside the node, but the compiled
 * code changes it: with `Block(p ≔ 0, Comprehension(Block(p ≔ 5, i),
 * Element(i, [1])), p)` the interpreter gives 0 and the compiled code 5. An
 * assignment in the body or in a clause of an `Integrate` changes the name
 * in the interpreter, but not in the compiled code, which evaluates the
 * integrand in a function of its own. The admission walk declines when one
 * of these parts has an effect outside itself (`writesOuterName()`). The
 * body of a `Sum` or a `Product` and the source of the first clause of a
 * `Comprehension` are not returned: an assignment there has the same
 * effect in both.
 */
function scopedPartsOf(node: Expression): Expression[] {
  if (!isFunction(node) || node.nops === 0) return [];
  const h = node.operator;
  const parts: Expression[] = [];
  if (h === 'Comprehension' || h === 'Integrate') parts.push(node.ops[0]);
  for (const [k, clause] of node.ops.slice(1).entries()) {
    if (!isFunction(clause)) {
      parts.push(clause);
      continue;
    }
    for (const [j, part] of clause.ops.entries()) {
      if (j === 0 && isSymbol(part)) continue;
      if (
        h === 'Comprehension' &&
        k === 0 &&
        j === 1 &&
        clause.operator === 'Element'
      )
        continue;
      parts.push(part);
    }
  }
  return parts;
}

/**
 * True when `node`, or a node in it, assigns a name (`Assign`, `Declare`)
 * or leaves its parent (`Return`, `Break`, `Continue`). A `Hold` is not
 * searched. The search uses a stack, not recursion, so the depth of
 * `node` does not matter.
 */
function changesState(node: Expression): boolean {
  const stack: Expression[] = [node];
  const seen = new Set<Expression>();
  while (stack.length > 0) {
    const e = stack.pop()!;
    if ((!isFunction(e) && !isDictionary(e)) || seen.has(e)) continue;
    seen.add(e);
    // The values of a dictionary are code: search them, also in a nested
    // dictionary.
    if (isDictionary(e)) {
      stack.push(...e.values);
      continue;
    }
    const h = e.operator;
    if (h === 'Hold') continue;
    if (
      h === 'Assign' ||
      h === 'Declare' ||
      h === 'Return' ||
      h === 'Break' ||
      h === 'Continue'
    )
      return true;
    for (const op of codeOperandsOf(e)) stack.push(op);
  }
  return false;
}

/**
 * True when the `Block` `block` is a value expression that binds names: each
 * statement before the last is a `Declare` (a declaration with no value is
 * a static error, so each one has a value), the last statement is not a
 * `Declare`, and no node of the block is an `Assign`, a `Loop`, a `While`,
 * a `Return`, a `Break` or a `Continue`. The `where` clause and the `;`
 * parse give such a block. The value of each name is then the value of its
 * declaration, and the block compiles as a value in an operand position.
 */
function isBindingBlock(block: Expression): boolean {
  if (!isFunction(block, 'Block') || block.ops.length < 2) return false;
  const last = block.ops[block.ops.length - 1];
  if (isFunction(last, 'Declare')) return false;
  if (!block.ops.slice(0, -1).every((s) => isFunction(s, 'Declare')))
    return false;
  const stack: Expression[] = [block];
  const seen = new Set<Expression>();
  while (stack.length > 0) {
    const e = stack.pop()!;
    if ((!isFunction(e) && !isDictionary(e)) || seen.has(e)) continue;
    seen.add(e);
    if (isDictionary(e)) {
      stack.push(...e.values);
      continue;
    }
    const h = e.operator;
    if (h === 'Hold') continue;
    if (
      h === 'Assign' ||
      h === 'Loop' ||
      h === 'While' ||
      h === 'Return' ||
      h === 'Break' ||
      h === 'Continue'
    )
      return false;
    for (const op of codeOperandsOf(e)) stack.push(op);
  }
  return true;
}

/**
 * The name of the parameter `p` of a function literal: a symbol, or the
 * symbol of a `Typed` parameter (`Typed(u, "real")`, as in
 * `(u: real) ↦ 2u`). `undefined` for another parameter.
 */
function parameterName(p: Expression): string | undefined {
  if (isSymbol(p)) return p.symbol;
  if (isFunction(p, 'Typed') && isSymbol(p.ops[0])) return p.ops[0].symbol;
  return undefined;
}

/**
 * The names of the parameters of the function literal `fn`, each with its
 * type: the type of the symbol (a type that the body infers for it), or
 * for a `Typed` parameter the type of the parameter in the signature of
 * `fn`.
 */
function parametersOf(fn: Expression): Map<string, Readonly<Type>> {
  const result = new Map<string, Readonly<Type>>();
  if (!isFunction(fn, 'Function')) return result;
  const sig = fn.type.type;
  const args =
    typeof sig === 'object' && sig.kind === 'signature'
      ? [...(sig.args ?? []), ...(sig.optArgs ?? [])]
      : [];
  fn.ops.slice(1).forEach((p, k) => {
    const name = parameterName(p);
    if (name === undefined) return;
    result.set(name, isSymbol(p) ? p.type.type : (args[k]?.type ?? 'unknown'));
  });
  return result;
}

/**
 * The operators whose clauses (`Element(i, …)`, `Limits(i, …)`, the
 * operands after the first one) bind their index in the body and in the
 * clauses.
 */
const CLAUSE_OPERATORS = new Set([
  'Loop',
  'Sum',
  'Product',
  'Comprehension',
  'Integrate',
]);

/**
 * The names that the clause `clause` (`Element(i, …)`, `Limits(i, …)`) of
 * a `Loop`, a `Sum`, a `Product`, a `Comprehension` or an `Integrate`
 * binds: its index, or each name of a destructuring index
 * (`Element(Tuple(k, j), pairs)` binds `k` and `j`; the placeholder `_`
 * binds nothing).
 */
function clauseIndexNames(clause: Expression): string[] {
  if (!isFunction(clause) || clause.nops === 0) return [];
  const names: string[] = [];
  const leaves = (t: Expression): void => {
    if (isSymbol(t)) {
      if (t.symbol !== '_') names.push(t.symbol);
    } else if (isFunction(t, 'Tuple')) t.ops.forEach(leaves);
  };
  leaves(clause.ops[0]);
  return names;
}

/**
 * The names of `scope` whose binding is its own: the names that the code of
 * the scope declares or assigns first. A name whose binding is the binding
 * of the same name in the nearest enclosing scope that has one is not
 * listed: it is the outer variable. With
 * `function g(k) { t = k + 1; t }` followed by `let t = 0`, the body of `g`
 * has a binding of its own for `t` (it shadows the outer `t`), so `t` is a
 * local of `g`.
 */
function ownLocalNames(scope: Scope | undefined): string[] {
  if (scope === undefined) return [];
  const result: string[] = [];
  for (const [name, binding] of scope.bindings) {
    // `parent` is `null` or missing at the outermost scope.
    let s = scope.parent ?? undefined;
    while (s !== undefined && !s.bindings.has(name)) s = s.parent ?? undefined;
    if (s === undefined || s.bindings.get(name) !== binding) result.push(name);
  }
  return result;
}

/**
 * True when `part` has an effect outside itself:
 * - it assigns (`Assign`, `Declare`) a name that is free in `part`. A name
 *   is bound only where `part` binds it: a parameter of a function literal
 *   of `part`, a name that a `Declare` statement of a `Block` of `part`
 *   declares (in that block), the index of a clause of a `Loop`, a `Sum`,
 *   a `Product`, a `Comprehension` or an `Integrate` of `part`, and a
 *   local of a `Block` of `part` or of the body of a function literal of
 *   `part`: a name of its local scope whose binding is its own, not the
 *   binding of the same name in an enclosing scope (`ownLocalNames()`). A
 *   body that assigns a name of an enclosing scope does not get a binding
 *   of its own for it, so that write counts. An `Assign` whose target is
 *   not a name or a tuple of names (an element of a list) counts as an
 *   assignment of a free name.
 * - it has a `Return` that no function literal of `part` encloses (`part`
 *   counts as such a literal when it is one).
 * - it has a `Break` or a `Continue` that no `Loop` of `part` encloses.
 *
 * When `assignments` is false, only the `Return`, `Break` and `Continue`
 * statements are searched. When `writes` is given, an assignment of a free
 * name (an `Assign` or a `Declare` whose target is a name or a tuple of
 * names) is added to `writes` and does not make the result true: the
 * result is then true only for the other effects.
 *
 * With `Comprehension(Block(Declare(q, 'real'), q ≔ 2i, q), Element(i,
 * [1, 2, 3]))`, the body declares `q`, so the body has no effect outside
 * itself. A `Hold` is not searched. The search uses a stack, not
 * recursion, so the depth of `part` does not matter.
 */
function writesOuterName(
  part: Expression,
  assignments = true,
  writes?: Expression[]
): boolean {
  type Context = {
    readonly bound: ReadonlySet<string>;
    readonly inFunction: boolean;
    readonly inLoop: boolean;
  };
  const stack: [Expression, Context][] = [
    [part, { bound: new Set(), inFunction: false, inLoop: false }],
  ];
  // A node can be shared by several parents (a DAG): it is searched once
  // for each context that reaches it.
  const seen = new Map<Expression, Set<Context>>();
  while (stack.length > 0) {
    const [e, outer] = stack.pop()!;
    // The values of a dictionary are code: search them, also in a nested
    // dictionary. With `Comprehension({a -> (p ≔ 5)}, Element(i, [1]))`,
    // the compiled code builds the dictionary and assigns `p`.
    if (!isFunction(e) && !isDictionary(e)) continue;
    let contexts = seen.get(e);
    if (contexts?.has(outer)) continue;
    if (contexts === undefined) seen.set(e, (contexts = new Set()));
    contexts.add(outer);
    if (isDictionary(e)) {
      for (const v of e.values) stack.push([v, outer]);
      continue;
    }
    if (!isFunction(e)) continue;
    const h = e.operator;
    if (h === 'Hold') continue;
    const names: string[] = [];
    if (h === 'Function') {
      names.push(...parametersOf(e).keys());
      if (e.nops > 0 && isFunction(e.ops[0]))
        names.push(...ownLocalNames(e.ops[0].localScope));
    } else if (h === 'Block') {
      for (const stmt of e.ops)
        if (isFunction(stmt, 'Declare'))
          names.push(...assignedTypesOf(stmt).keys());
      names.push(...ownLocalNames(e.localScope));
    } else if (CLAUSE_OPERATORS.has(h))
      for (const clause of e.ops.slice(1))
        names.push(...clauseIndexNames(clause));
    const ctx: Context =
      names.length > 0 || h === 'Function' || h === 'Loop'
        ? {
            bound:
              names.length > 0
                ? new Set([...outer.bound, ...names])
                : outer.bound,
            inFunction: outer.inFunction || h === 'Function',
            inLoop: outer.inLoop || h === 'Loop',
          }
        : outer;
    if (h === 'Return' && !ctx.inFunction) return true;
    if ((h === 'Break' || h === 'Continue') && !ctx.inLoop) return true;
    const assigns = assignments && (h === 'Assign' || h === 'Declare');
    if (assigns && h === 'Assign' && e.nops > 0 && !isNamesTarget(e.ops[0]))
      return true;
    if (assigns)
      for (const name of assignedTypesOf(e).keys())
        if (!ctx.bound.has(name)) {
          if (writes === undefined) return true;
          writes.push(e);
          break;
        }
    for (const op of codeOperandsOf(e)) stack.push([op, ctx]);
  }
  return false;
}

/**
 * The first `Return` in `body` (the root of the compilation, or a
 * user-function body or a stored value that the compiled code reaches)
 * that a `Loop` encloses and that the compiled code does not handle as the
 * interpreter does, or `undefined` when there is none. The compiled code
 * of a `Loop` is a function of its own (in JavaScript, a closure that is
 * called where the loop is), so a `Return` in its body ends only the loop:
 * the code after the loop still runs. With `L: list<real>`, the body of
 * `p ↦ Block(q ≔ 0, Loop(If(i > 1, Block(q ≔ 7, Return(5))), Element(i,
 * L)), 100 + q)` gives 5 in the interpreter and 107 in the compiled code.
 *
 * A `Return` is accepted when the only `Loop` between it and the function
 * literal (or the root) that it ends is in tail position: the body of the
 * function, or the last statement of a `Block` in tail position. The
 * value of the loop is then the value of the function, as in the
 * interpreter, for a loop with no indexing set. A tail loop with an indexing
 * set passes this check, but `isUnrepresentableLoopValue()` declines it when
 * its value is used: it gives `Nothing` when no `Return` runs, and the
 * compiled code has no form for `Nothing`. A `Return` in a nested `Loop` is
 * not accepted.
 *
 * The search does not enter a `Hold` or the operands that the target drops
 * (`droppedOperandsOf()`). It uses a stack, not recursion, so the depth of
 * `body` does not matter.
 */
function returnInLoopIn(
  body: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  // `loops`: the number of `Loop` nodes between the node and the function
  // that a `Return` ends, up to 2. `tail`: the node is in tail position in
  // that function. `tailLoop`: the one loop around the node is in tail
  // position.
  type Context = { loops: number; tail: boolean; tailLoop: boolean };
  const stack: [Expression, Context][] = [
    [body, { loops: 0, tail: true, tailLoop: false }],
  ];
  const seen = new Map<Expression, Set<string>>();
  while (stack.length > 0) {
    const [e, ctx] = stack.pop()!;
    if (!isFunction(e) && !isDictionary(e)) continue;
    const key = `${ctx.loops}:${ctx.tail}:${ctx.tailLoop}`;
    let keys = seen.get(e);
    if (keys?.has(key)) continue;
    if (keys === undefined) seen.set(e, (keys = new Set()));
    keys.add(key);
    // The values of a dictionary are code, not in tail position.
    if (isDictionary(e)) {
      for (const v of e.values) stack.push([v, { ...ctx, tail: false }]);
      continue;
    }
    if (!isFunction(e)) continue;
    const h = e.operator;
    if (h === 'Hold') continue;
    if (h === 'Return' && ctx.loops > 0 && !(ctx.loops === 1 && ctx.tailLoop))
      return e;
    const dropped = droppedOperandsOf(e, target);
    // The value of a `Declare` can be in the dictionary of its attributes
    // (`codeOperandsOf()`).
    (h === 'Declare' ? codeOperandsOf(e) : e.ops).forEach((op, i) => {
      if (dropped?.has(i) === true) return;
      let next: Context;
      if (h === 'Function')
        next =
          i === 0
            ? { loops: 0, tail: true, tailLoop: false }
            : { ...ctx, tail: false };
      else if (h === 'Loop')
        next = {
          loops: Math.min(ctx.loops + 1, 2),
          tail: false,
          tailLoop: ctx.loops === 0 && ctx.tail,
        };
      else if (h === 'Block')
        next = { ...ctx, tail: ctx.tail && i === e.nops - 1 };
      else next = { ...ctx, tail: false };
      stack.push([op, next]);
    });
  }
  return undefined;
}

/**
 * True when `body`, the body of a `Loop`, has a `Break` of this loop in the
 * code that the target keeps. A nested `Loop` or a function literal owns
 * the `Break` inside it. The search does not enter a `Hold` or the operands
 * that the target drops (`droppedOperandsOf()`), as the other walks of this
 * file: `If(False, Break(2), 0)` has no `Break`. It uses a stack, not
 * recursion.
 */
function hasKeptBreak(
  body: Expression,
  target: CompileTarget<Expression>
): boolean {
  const stack: Expression[] = [body];
  const seen = new Set<Expression>();
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (!isFunction(e) || seen.has(e)) continue;
    seen.add(e);
    const h = e.operator;
    if (h === 'Break') return true;
    if (h === 'Function' || h === 'Hold' || h === 'Loop') continue;
    const dropped = droppedOperandsOf(e, target);
    if (dropped === undefined) stack.push(...codeOperandsOf(e));
    else stack.push(...e.ops.filter((_, i) => !dropped.has(i)));
  }
  return false;
}

/**
 * True when the value of the `Loop` `loop` is used and the compiled code
 * cannot give it. The value of a loop is the value of the `Break` that ends
 * it, or `Nothing` when it ends at the end of its indexing sets or with a
 * `Break` with no value. `Nothing` is the erasure marker, which has no
 * compiled representation, and the compiled loop does not carry the value
 * of a `Break` either. Only a loop with no indexing set and no `Break` of
 * its own is accepted: it ends only through a `Return` or never ends. A
 * loop with an indexing set declines also when it has a `Return` and is the
 * last statement of its function: when no `Return` runs, the loop ends at
 * the end of its indexing sets and the interpreter gives `Nothing`, where
 * the compiled function gave `undefined` (JavaScript) or `None` (Python).
 */
function isUnrepresentableLoopValue(
  loop: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isFunction(loop, 'Loop') || loop.nops === 0) return false;
  return loop.nops > 1 || hasKeptBreak(loop.ops[0], target);
}

/**
 * The innermost value of `root` that has no settled shape, or `undefined`
 * when there is none: a conditional whose branches have conflicting shapes
 * (`hasConflictingBranches()`), or a function literal or the root whose
 * values have conflicting shapes (`hasConflictingValues()`,
 * `unitValuesOf()`). `assertAdmitted()` declines for it.
 *
 * The compiled code gives each value one shape, which the static type
 * settles. When the branches of a conditional have different shapes, the
 * shape of its value is known only at run time, and its consumers would
 * have to test it: `If(x > 0, [1, 2], 3) + 1` is a list or a number. On a
 * shader target the branches must have the same type, so the code would
 * not be valid. This is the simple, sound version of the rule: it can
 * decline where the interpreter has a value, and the compiled code never
 * gives a different value.
 *
 * On the targets that are not shaders, a conditional or a function literal
 * whose value the code discards is not checked
 * (`operandUse()`): a statement of a `Block` that is not its last one, the
 * body of a `Loop`, and a branch of such a conditional. With `x: real`,
 * `Block(If(x > 0, p ≔ (1, 2), n ≔ 3), x)` compiles: an `Assign` has the
 * type of its value, so the branches have different shapes, but the value
 * of the `If` is not read. A node that is also used as a value somewhere,
 * or that the walk reaches as the root of a body (a user-function body, a
 * stored value), is checked. On a shader target every conditional is
 * checked: the shader code of a conditional in a statement position is a
 * conditional expression too (`c ? a : b`), and its two branches must have
 * the same type.
 *
 * The values that the code assigns to one variable, and its type, must have
 * one shape class too (`assignmentConflictIn()`): with `x: real`, the body
 * of `t ↦ Block(If(x > 0, p ≔ [1, 2], p ≔ 3), 2p)` declines, and so does
 * `Block(p ≔ 0, p ≔ [1, 2], p)`. The diagnostic names an `Assign`.
 *
 * A node whose code a caller's `compile` handler wrote
 * (`CompilerState._callerLowered`) is one value, not a conditional
 * (`conditionalBranches()`). When its static type admits shapes that
 * conflict (`hasNoSettledShape()`), it is a candidate with the reason
 * `'handler-value'`, which declines when its value is used (`isUsed()`,
 * also on a shader target) and the stock code of a consumer reads it: a
 * parent whose code no handler wrote uses it as a value, or it is the
 * value of such a parent (the last statement of a `Block`, a branch of an
 * `If`, the body of a function literal) that the stock code of a consumer
 * reads in the same way. It compiles as the root of the compilation (the
 * host reads its value), as the value of the root (with `x: real`,
 * `Block(a ≔ x, Which(a > 0, 0, True, [1, 2]))`), and as an operand of
 * another node whose code a handler wrote. With `x: real` and a handler on
 * `Which`, `Which(x > 0, 0, True, [1, 2])` compiles to the code of the
 * handler, and `Which(x > 0, 0, True, [1, 2]) + 1` declines: the type of
 * the `Which` is `integer | list<integer>`, and the stock code of `Add`
 * would decide the shape at run time with a broadcast. As the body of a
 * user function that the code calls, or in a `Return`, it declines also
 * when the call or the `Return` gives the value of the root: the walk does
 * not record which nodes read the value of a call. In a case of a `Match`,
 * whose parts the check makes canonical again (so they are not the nodes
 * that `_callerLowered` holds), a part whose operator has a handler that
 * wrote the code of a node, and whose static type admits shapes that
 * conflict, declines when its value is used at all, also by the host:
 * `Match(x, MatchCase(1, H(x)), MatchCase(_, 3)) + 1` declines for a
 * handler operator `H` of type `integer | list<integer>`. This is the simple,
 * sound version: it can decline where the code of the handler would give
 * the value, and never compiles a run-time test of a shape. The nodes whose
 * code a handler wrote are known only after the code is generated, so
 * `assertAdmitted()` runs the search again whenever there is one.
 *
 * The walk that finds such a conditional is the one of the decline of a
 * sub-expression of static type `error` (`compiledNodeWhere()`): it goes
 * into every operand and into the bodies of the user functions that the
 * code calls, so a call of `f`, with `f(x) = If(x > 0, [x, x], x)`, has no
 * settled shape. A conditional in a branch that the code for the target
 * drops (`droppedOperandsOf()`) is not checked, because the code never
 * evaluates it: `If(2 < 3, 0, If(x > 0, [1, 2], 3))` compiles to `0`. A
 * sub-expression of static type `error` in a dropped branch still
 * declines.
 *
 * It runs before the code is generated, on every target.
 *
 * Design: rule R3 of `docs/plans/2026-10-31-static-shape-compilation.md`.
 */
export function unsettledShapeIn(
  root: Expression,
  target: CompileTarget<Expression>,
  /** When true, a sub-expression of static type `error` declines here, as
   * `throwStaticTypeError()` declines it: the two checks then share one
   * walk of the expression and of the values it reaches. */
  staticTypeErrors = false
): UnsettledShape | undefined {
  const arity = isShaderTarget(target);
  // The candidates, innermost first (the walk calls the test of a node
  // after the tests of its operands).
  const candidates: UnsettledShape[] = [];
  // For each operand of a node of the code that is kept: whether some node
  // uses its value (`'value'`), the parents whose value it is (`'end'`),
  // and whether it is an operand at all. A node that is never an operand
  // is the root of a walk, and its value is used.
  const recorded = new Set<Expression>();
  const usedAsValue = new Set<Expression>();
  const isOperand = new Set<Expression>();
  const endParents = new Map<Expression, Expression[]>();
  // The parents that use the value of each operand (`'value'`), for the
  // check of a node whose code a caller's `compile` handler wrote.
  const valueParents = new Map<Expression, Expression[]>();
  // The user-function bodies and stored values that the walk reaches from
  // the code that is kept: each is the root of a body, whose value is used,
  // also when the same node is a discarded statement elsewhere.
  const roots = new Set<Expression>();
  // The `Match` nodes of the code that is kept.
  const matches: Expression[] = [];
  // The `Loop` nodes of the code that is kept.
  const loops: Expression[] = [];
  // The `Block`, `Assign` and `Declare` nodes of the code that is kept.
  const statementNodes: Expression[] = [];
  const error = compiledNodeWhere(
    root,
    target,
    (node, kept) => {
      if (staticTypeErrors && node.type.type === 'error') return true;
      if (!kept) return false;
      // A `Match` in the raw case body of another one is not canonical: it
      // is reached through the canonical parts of the outer one, in the
      // scope that binds its names. Made canonical here, it would be made in
      // the wrong scope, which declares its free names in the engine.
      if (
        isFunction(node, 'Match') &&
        node.isCanonical &&
        !matches.includes(node)
      )
        matches.push(node);
      if (isFunction(node, 'Loop') && !loops.includes(node)) loops.push(node);
      if (
        (isFunction(node, 'Block') ||
          isFunction(node, 'Assign') ||
          isFunction(node, 'Declare')) &&
        !statementNodes.includes(node)
      )
        statementNodes.push(node);
      // The use of each operand is recorded on every target: the check of
      // a `Loop` whose value is used (below) reads it on a shader target
      // too.
      if (isFunction(node) && !recorded.has(node)) {
        recorded.add(node);
        const dropped = droppedOperandsOf(node, target);
        node.ops.forEach((op, i) => {
          if (dropped?.has(i) === true) return;
          isOperand.add(op);
          const use = operandUse(node, i);
          if (use === 'value') {
            usedAsValue.add(op);
            const users = valueParents.get(op);
            if (users === undefined) valueParents.set(op, [node]);
            else users.push(node);
          } else if (use === 'end') {
            const parents = endParents.get(op);
            if (parents === undefined) endParents.set(op, [node]);
            else parents.push(node);
          }
        });
      }
      if (candidates.every((c) => c.node !== node)) {
        if (hasConflictingBranches(node, arity))
          candidates.push({ node, reason: 'branches' });
        else if (hasConflictingValues(node, target, arity))
          candidates.push({ node, reason: 'values' });
        else if (
          CompilerState._callerLowered.get(node) === true &&
          hasNoSettledShape(node.type.type, arity)
        )
          candidates.push({ node, reason: 'handler-value' });
      }
      // The walk goes on, to find a sub-expression of type `error` anywhere,
      // and to record how each operand is used.
      return false;
    },
    (node) => droppedOperandsOf(node, target),
    (node, kept) => {
      if (kept) roots.add(node);
    }
  );
  if (error !== undefined) throwStaticTypeError(error);

  // Whether the value of `node` is used: some node uses it as a value, it
  // is the root of a walk (`root`, or a body or a stored value that the
  // walk reached), or it is the value of a node whose value is used. A node
  // on the stack of the search counts as not used, which ends a cycle.
  const used = new Map<Expression, boolean>();
  const isUsed = (node: Expression): boolean => {
    const known = used.get(node);
    if (known !== undefined) return known;
    used.set(node, false);
    const result =
      usedAsValue.has(node) ||
      roots.has(node) ||
      !isOperand.has(node) ||
      (endParents.get(node) ?? []).some(isUsed);
    used.set(node, result);
    return result;
  };
  // Whether the stock code of a consumer reads the value of `node`: a
  // parent whose code a caller's `compile` handler did not write uses it as
  // a value (`operandUse()`), or it is the value of such a parent (the last
  // statement of a `Block`, a branch of an `If`) whose value the stock code
  // of a consumer reads in the same way. A body or a stored value that the
  // walk reached (`roots`), other than `root`, counts as read: the walk
  // does not record the calls of a user function. The root of the
  // compilation has no consumer: the host reads its value. A node on the
  // stack of the search counts as not read, which ends a cycle.
  const stockRead = new Map<Expression, boolean>();
  const readByStockCode = (node: Expression): boolean => {
    const known = stockRead.get(node);
    if (known !== undefined) return known;
    stockRead.set(node, false);
    const stock = (p: Expression): boolean =>
      CompilerState._callerLowered.get(p) !== true;
    // The body of a function literal is its value too: it is read when
    // the literal is read (a callback of `Map`), and not when the literal
    // is the root.
    const passes = (p: Expression): boolean =>
      isFunction(p, 'Function') && p.ops[0] === node;
    const result =
      (node !== root && roots.has(node)) ||
      (valueParents.get(node) ?? []).some((p) =>
        passes(p) ? stock(p) && readByStockCode(p) : stock(p)
      ) ||
      (endParents.get(node) ?? []).some((p) => stock(p) && readByStockCode(p));
    stockRead.set(node, result);
    return result;
  };
  const unsettled = candidates.find((c) =>
    c.reason === 'handler-value'
      ? isUsed(c.node) && readByStockCode(c.node)
      : arity || isUsed(c.node)
  );
  if (unsettled !== undefined) return unsettled;

  // The cases of a `Match` are held raw, and the type of a raw expression
  // is not known, so the walk above compares no branch of a `Match` and
  // checks nothing in its cases. Here the bodies are compared in the
  // canonical form that the compiled code evaluates (`matchCasePartsOf()`),
  // made in the local scope around the `Match`, and each guard and each
  // body is checked for a conditional or a function literal with values of
  // different shapes (with no exception for a value that the
  // code discards), and for a nested `Match` in the same way: with
  // `x: real`, `Match(x, MatchCase(1, [1, 2]), MatchCase(_, 3))` declines.
  // This check does not follow the calls of user functions: the walk above
  // reached their bodies, and a recursive function would loop.
  // The `Loop` nodes in the case parts of a `Match` whose value is used.
  // The walk above does not reach them: the cases are held raw.
  const caseLoops: Expression[] = [];
  if (matches.length > 0) {
    // The operators of the nodes whose code a caller's `compile` handler
    // wrote.
    const handlerOperators = new Set<string>();
    for (const [node, lowered] of CompilerState._callerLowered)
      if (lowered) handlerOperators.add(node.operator);
    const scopes = localScopesOf([root, ...roots]);
    // Each `Match` with its scope, whether its branches are compared, and
    // whether its value is used (for the check of a `Loop` in a case).
    const pending: [Expression, Scope | undefined, boolean, boolean][] =
      matches.map((m) => [m, scopes.get(m), arity || isUsed(m), isUsed(m)]);
    const done = new Set<Expression>();
    while (pending.length > 0) {
      const [m, scope, used, valueUsed] = pending.pop()!;
      if (done.has(m)) continue;
      done.add(m);
      const bodies = matchCasePartsOf(m, scope, true);
      if (
        used &&
        haveConflictingShapes(
          [
            ...new Set(
              bodies.flatMap((b) =>
                endValuesOf(b, target, true, caseScopeOf(b, scope))
              )
            ),
          ],
          arity
        )
      )
        return { node: m, reason: 'branches' };
      // Each node with the innermost local scope around it, and whether its
      // value is used (`operandUse()`): a guard is used, and a case body is
      // used when the value of the `Match` is.
      const guards = new Set<Expression>();
      const parts = matchCasePartsOf(m, scope, false, guards);
      const stack: [Expression, Scope | undefined, boolean][] = parts.map(
        (part) => [
          part,
          caseScopeOf(part, scope),
          valueUsed || guards.has(part),
        ]
      );
      const seen = new Set<Expression>();
      while (stack.length > 0) {
        const [e, around, partUsed] = stack.pop()!;
        if (!isFunction(e) || seen.has(e) || e.operator === 'Hold') continue;
        seen.add(e);
        if (e.operator === 'Match') {
          pending.push([e, around, true, partUsed]);
          continue;
        }
        const inner = e.localScope ?? around;
        if (hasConflictingBranches(e, arity))
          return { node: e, reason: 'branches' };
        if (hasConflictingValues(e, target, arity))
          return { node: e, reason: 'values' };
        // The parts are made canonical again here, so they are not the
        // nodes that `CompilerState._callerLowered` holds. A used part
        // whose operator has a caller's `compile` handler that wrote the
        // code of a node, and whose static type admits shapes that
        // conflict, declines: this is the simple, sound version, which
        // also declines when the value is read by the host or by the code
        // of a handler.
        if (
          partUsed &&
          handlerOperators.has(e.operator) &&
          hasNoSettledShape(e.type.type, arity)
        )
          return { node: e, reason: 'handler-value' };
        if (partUsed && isFunction(e, 'Loop')) caseLoops.push(e);
        const useOf = (op: Expression): boolean => {
          const i = e.ops.indexOf(op);
          const use = i < 0 ? 'value' : operandUse(e, i);
          return use === 'value' || (use === 'end' && partUsed);
        };
        const dropped = droppedOperandsOf(e, target);
        if (dropped === undefined)
          for (const op of codeOperandsOf(e))
            stack.push([op, inner, useOf(op)]);
        else
          e.ops.forEach((op, i) => {
            if (!dropped.has(i)) stack.push([op, inner, useOf(op)]);
          });
      }
    }
  }

  // The Python target emits a `Loop` inline, as a `for` or a `while`
  // statement in the function that contains it: a `Return` in the loop
  // ends that function, as in the interpreter. The other targets need the
  // check (`returnInLoopIn()`).
  for (const body of target.language === 'python' ? [] : [root, ...roots]) {
    const loopReturn = returnInLoopIn(body, target);
    if (loopReturn !== undefined)
      return { node: loopReturn, reason: 'return-in-loop' };
  }
  const conflict = assignmentConflictIn([root, ...roots], target);
  if (conflict !== undefined) return conflict;

  // The root is a unit of code too: a `Return` that no function literal
  // encloses ends the compiled code with its value. The walk checks a root
  // that is a function literal.
  if (
    !isFunction(root, 'Function') &&
    haveConflictingShapes(unitValuesOf(root, target), arity)
  )
    return { node: root, reason: 'values' };

  // A `Loop` whose value is used declines, on every target, unless the
  // compiled code gives its value (`isUnrepresentableLoopValue()`): the
  // JavaScript code of `Loop(k, Element(k, 1..3))` gave `undefined` where
  // the interpreter gives `Nothing`, and with `x: real` the code of
  // `Loop(If(k > x, Break(10k)), Element(k, 1..5))` gave `undefined` where
  // the interpreter gives `30` for `x = 2`. A loop that is a statement (a
  // statement of a `Block` that is not its last one, or the body of a
  // loop) has no used value, and compiles. This check runs last, so that a
  // more specific reason (a `Return` in a loop with code after it, a
  // `Break` in a `Sum`) stays the reason.
  // An assignment and a declaration are statements, and a block that ends
  // in one has the value `Nothing` in the interpreter, which compiled code
  // has no form for: where its value is used, it declines. The JavaScript
  // code of `[1, Block(b ≔ 2)]` gave `[1, 2]` where the interpreter gives
  // `[1, Nothing]`.
  // A branch of a conditional is its value, also when `operandUse()`
  // reads a condition that is not a scalar (an untyped parameter) as a
  // use of each branch: the branch is then used only when the conditional
  // is, and a conditional over a collection with an assignment in a branch
  // declines on its own (`'elementwise'`).
  const isBranchOf = (p: Expression, node: Expression): boolean =>
    (isFunction(p, 'If') && p.ops[0] !== node) ||
    (isFunction(p, 'Which') && p.ops.indexOf(node) % 2 === 1);
  const valueUsed = new Map<Expression, boolean>();
  const isValueUsed = (node: Expression): boolean => {
    const known = valueUsed.get(node);
    if (known !== undefined) return known;
    valueUsed.set(node, false);
    const result =
      roots.has(node) ||
      !isOperand.has(node) ||
      (valueParents.get(node) ?? []).some(
        (p) => !isBranchOf(p, node) || isValueUsed(p)
      ) ||
      (endParents.get(node) ?? []).some(isValueUsed);
    valueUsed.set(node, result);
    return result;
  };
  const nothingValue = statementNodes.find(
    (n) => !isFunction(n, 'Block') && isValueUsed(n)
  );
  if (nothingValue !== undefined)
    return { node: nothingValue, reason: 'nothing-value' };
  // A block with an assignment is a statement, or the body of a function
  // literal, of the root or of a binder (the first operand of a `Sum`, a
  // `Product`, an `Integrate` or a `Comprehension`, which is a function of
  // its index), or their last value (the last statement of a block, a
  // branch of a conditional). In every other operand position
  // (`1 + Block(a ≔ x, 2a)`, the value of an `Assign`) it declines: compiled
  // code lowers such a block only as a statement list. A block whose
  // statements before the last are only declarations with a value is a
  // value expression, and it compiles in every operand position: the
  // `where` clause and the `;` parse give such a block
  // (`Block(Declare(a, "unknown", 3.7x), a - Floor(a))`). Each `Declare`
  // binds a new name, and nothing in the block changes the value of a name
  // after its declaration.
  const isBodyOf = (p: Expression, node: Expression): boolean =>
    isFunction(p) &&
    p.ops[0] === node &&
    (p.operator === 'Function' ||
      p.ops
        .slice(1)
        .some((op) => isFunction(op, 'Limits') || isFunction(op, 'Element')));
  const inOperand = new Map<Expression, boolean>();
  const isInOperand = (node: Expression): boolean => {
    const known = inOperand.get(node);
    if (known !== undefined) return known;
    inOperand.set(node, false);
    const result =
      (valueParents.get(node) ?? []).some((p) =>
        isBranchOf(p, node) ? isInOperand(p) : !isBodyOf(p, node)
      ) || (endParents.get(node) ?? []).some(isInOperand);
    inOperand.set(node, result);
    return result;
  };
  const blockValue = statementNodes.find(
    (n) =>
      isFunction(n, 'Block') &&
      n.ops.some((s) => isFunction(s, 'Assign') || isFunction(s, 'Declare')) &&
      !isBindingBlock(n) &&
      isInOperand(n)
  );
  if (blockValue !== undefined)
    return { node: blockValue, reason: 'block-value' };

  const loopValue =
    loops.find((l) => isUsed(l) && isUnrepresentableLoopValue(l, target)) ??
    caseLoops.find((l) => isUnrepresentableLoopValue(l, target));
  if (loopValue !== undefined) return { node: loopValue, reason: 'loop-value' };
  return undefined;
}

/**
 * Decline the compilation of `root`, after its code was generated with no
 * decline, when it does not satisfy the admission rules:
 * - `unsettled`, the value with no settled shape that `unsettledShapeIn()`
 *   found before the code was generated, declines first. The diagnostic
 *   has the code `'unsettled-shape'` and the kind `'capability'`; its
 *   `value` is the conditional, the function literal, the `Loop` or the
 *   root, as `toString()` writes it.
 * - an input with no type (`untypedInputs()`) declines next. The
 *   diagnostic has the code `'untyped-input'` and the kind
 *   `'correctness'`; its `value` is the names, separated by commas.
 *
 * These checks run after the code was generated so that a more specific
 * reason to decline stays the reason that the result reports: a lowering
 * that the target does not have, an operand that the target cannot read
 * (a comparison of vectors on a shader). The interpreter fallback adds the
 * names of the inputs with no type to `unsupported` also when another
 * reason is the main one (`buildInterpreterFallback()`). In every case the
 * compilation declines.
 *
 * Design: rules R1 and R3 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`.
 */
export function assertAdmitted(
  root: Expression,
  target: CompileTarget<Expression>,
  unsettled: UnsettledShape | undefined
): void {
  // `unsettled` was found before the code was generated, when it was not
  // known which nodes a caller's `compile` handler would lower. When a
  // handler wrote the code of a node, the search runs again: a conditional
  // whose code the handler wrote is then one value (`conditionalBranches()`),
  // and a node whose code the handler wrote, conditional or not, declines
  // when its static type admits several shapes and the stock code of a
  // consumer reads its value (reason `'handler-value'`). So the search runs
  // again whenever a handler wrote the code of a node, whatever the first
  // search found.
  if ([...CompilerState._callerLowered.values()].includes(true))
    unsettled = unsettledShapeIn(root, target);
  if (unsettled !== undefined) throwUnsettledShape(unsettled);
  const analysis = inputsOf(root, target);
  const names = untypedInputsOf(
    root,
    target,
    analysis.freeSymbols,
    analysis.occurrences
  );
  if (names.length > 0) throwUntypedInputs(names);
}

/**
 * Decline the compilation for the value with no settled shape `unsettled`.
 * The diagnostic has the code `'unsettled-shape'` and the kind
 * `'capability'`; its `value` is the node, as `toString()` writes it.
 */
function throwUnsettledShape(unsettled: UnsettledShape): never {
  const value = unsettled.node.toString();
  if (unsettled.reason === 'index-assignment')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": a function literal assigns the index ` +
        `of an enclosing \`Loop\`, \`Sum\`, \`Product\`, \`Comprehension\` ` +
        `or \`Integrate\`, which is not compiled. The interpreter and the ` +
        `compiled code do not agree on the iterations that follow such an ` +
        `assignment.`,
      value,
    });
  if (unsettled.reason === 'scoped-assignment') {
    const op = unsettled.node.operator;
    if (!['Comprehension', 'Sum', 'Product', 'Integrate'].includes(op)) {
      // The node is the parent of the literal: the operator that receives
      // it, or a node that holds it (a stored, returned or user function).
      const holder = [
        'Function',
        'Assign',
        'Declare',
        'DefineFunction',
        'Block',
      ].includes(op);
      const what = holder
        ? 'a function (stored, returned, or a user function that the code ' +
          'calls)'
        : `the function passed to \`${op}\``;
      throw new CompileDeclineError({
        code: UNSETTLED_SHAPE_CODE,
        kind: 'capability',
        message:
          `Could not compile "${value}": ${what} assigns a name of an ` +
          `enclosing scope, or has a \`Break\` or a \`Continue\` that leaves ` +
          `it, which is not compiled. A function can reach an operator that ` +
          `calls it, such as \`Filter\`, where the interpreter and the ` +
          `compiled code do not agree on whether such an assignment changes ` +
          `the name outside the function.`,
        value,
      });
    }
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": an assignment, a \`Return\`, a ` +
        `\`Break\` or a \`Continue\` inside the \`${op}\` (in its body or ` +
        `in its clauses) is not compiled. The interpreter and the compiled ` +
        `code do not agree on whether such an assignment changes the name ` +
        `outside the \`${op}\`.`,
      value,
    });
  }
  if (unsettled.reason === 'loop-value')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": the value of this \`Loop\` is used. ` +
        `A loop that ends with no \`Break\`, or with a \`Break\` with no ` +
        `value, evaluates to \`Nothing\`, the erasure marker, which has no ` +
        `compiled representation, and the compiled loop does not carry the ` +
        `value of a \`Break\`. Use the loop as a statement, and end the ` +
        `block with the value it should have.`,
      value,
    });
  if (unsettled.reason === 'nothing-value')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": an assignment or a declaration is a ` +
        `statement, and its value is used here (it is the last statement ` +
        `of a block whose value is used). Such a block has the value ` +
        `\`Nothing\`, which has no compiled representation. End the block ` +
        `with the value it should have.`,
      value,
    });
  if (unsettled.reason === 'block-value')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": a block with a statement other than ` +
        `a declaration with a value is an operand here. Such a block ` +
        `compiles only as a statement, or as the body of a function or of ` +
        `the compiled expression. A block that only declares names with a ` +
        `value before its last statement (a \`where\` clause) compiles as ` +
        `an operand. ` +
        `Assign the value of the block to a local declared before it, and ` +
        `read the local.`,
      value,
    });
  if (unsettled.reason === 'return-in-loop')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": a \`Return\` inside a \`Loop\` is ` +
        `not compiled, unless that loop is the last statement of the ` +
        `function and has no indexing set. The compiled loop is a ` +
        `function of its own, so the ` +
        `\`Return\` would end only the loop, and the code after the loop ` +
        `would still run.`,
      value,
    });
  if (unsettled.reason === 'elementwise')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": its condition is or can be a ` +
        `collection, so it selects a branch for each element (element-wise ` +
        `selection), and a branch assigns a name or has a \`Return\`, ` +
        `a \`Break\` or a \`Continue\`. The compiled code cannot run a ` +
        `branch for some ` +
        `elements only.`,
      value,
    });
  if (unsettled.reason === 'handler-value')
    throw new CompileDeclineError({
      code: UNSETTLED_SHAPE_CODE,
      kind: 'capability',
      message:
        `Could not compile "${value}": a \`compile\` handler wrote its ` +
        `code, but its type, ${unsettled.node.type.toString()}, admits ` +
        `values of different shapes (for example a number and a list), and ` +
        `the code of its consumer, which no handler wrote, would know its ` +
        `shape only at run time. Give the node a type of one shape (for ` +
        `example with a type handler on the definition of its operator), ` +
        `or write the code of the consumer with a \`compile\` handler too.`,
      value,
    });
  const parts =
    unsettled.reason === 'values'
      ? 'the values that it can give (the value of a `Return` or of a ' +
        '`Break`, and its last value) have'
      : unsettled.reason === 'assignments'
        ? 'the name that it assigns gets values or types (an assigned ' +
          'value, its declared or inferred type) that have'
        : 'its branches have';
  throw new CompileDeclineError({
    code: UNSETTLED_SHAPE_CODE,
    kind: 'capability',
    message:
      `Could not compile "${value}": ${parts} different shapes ` +
      `(for example a number and a list), so the shape of its value is ` +
      `known only at run time.`,
    value,
  });
}
