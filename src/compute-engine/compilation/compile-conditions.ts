// Conditions: scalar and boolean claims and guard conditions.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { multiClauseState } from '../multi-clause.js';
import type {
  CompileTarget,
  CseRegionInstance,
  TargetSource,
} from './types.js';
import { descendantRegionAt, type CseRegion } from './cse.js';
import {
  LOGICAL_BROADCAST_HEADS,
  SCALAR_ARITHMETIC_HEADS,
} from './compiler-tables.js';
import {
  carriesNoSortEvidence,
  compilationType,
} from './compiler-type-facts.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { core } from './compiler-core-hooks.js';
import { unsettledShapeDecline } from './diagnostics.js';
import { isStatementArm } from '../boxed-expression/conditional-value.js';

// `isStatementArm()` is defined beside `restrictionParts()`, which reads a
// single-branch `If` as a restriction only when its arm is not a statement.
export { isStatementArm };

/**
 * Whether a function promises a scalar result but provably constructs a
 * collection. This is a contradiction check, not result-type inference:
 * declarations remain authoritative unless the stored body disproves them.
 *
 * The guard applies on every target. JavaScript would otherwise consume the
 * returned array as a number, while GLSL/WGSL could emit a vector from a
 * scalar-returning function. Open and broadcastable result types do not count
 * as scalar promises and retain their existing target-specific paths.
 */
export function isContradictedScalarDeclaration(body: Expression): boolean {
  if (!isScalarDeclaredType(body)) return false;
  return isProvablyCollectionValuedApplication(body, new Set());
}

/** Whether a declaration promises a one-word scalar: number or boolean. */
export function isScalarDeclaredType(body: Expression): boolean {
  const t = body.type;
  return t.matches('number') || t.matches('boolean');
}

/**
 * Definition-site form of {@link isContradictedScalarDeclaration}. Shader
 * targets bake the declared result into the function signature, so the body
 * must be checked even when a bare call has no scalar-consuming parent.
 * Declared result ascriptions are unwrapped by the shared body look-through.
 */
export function isContradictedScalarFunctionBody(body: Expression): boolean {
  if (!isScalarDeclaredType(body)) return false;
  return isProvablyCollectionValuedBody(body, new Set());
}

/**
 * Reject a contradicted scalar declaration when an ordinary operator will
 * consume the call as a scalar. The rule lives in the shared dispatcher
 * because the contradiction belongs to the application, not to one target.
 *
 * Scalar arithmetic, broadcastable operators, relations, and connectives are
 * consuming positions. Containers, accessors, and a bare top-level call are
 * not. Open result types also retain their element-wise or target-specific
 * handling because they do not promise a scalar.
 */
export function assertNoContradictedScalarOperand(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.length === 0) return;
  const consumesScalarOperands = (): boolean => {
    if (
      SCALAR_ARITHMETIC_HEADS.has(h) ||
      isRelationalOperator(h) ||
      LOGICAL_BROADCAST_HEADS.has(h)
    )
      return true;
    const def = engine.lookupDefinition(h);
    return isOperatorDef(def) && def.operator.broadcastable === true;
  };
  if (!consumesScalarOperands()) return;
  const offending = args.find((a) => isContradictedScalarDeclaration(a));
  if (offending === undefined) return;
  throw new Error(
    `Could not compile \`${h}\`: the declaration of '${
      isFunction(offending) ? offending.operator : offending.toString()
    }' says it returns a scalar ` +
      `('${offending.type.toString()}'), but its body constructs a ` +
      `collection. The declaration is contradicted by the body, so this ` +
      `scalar position would consume a run-time collection as a number. ` +
      `Fix the declaration (e.g. '-> list<number>') or evaluate instead.`
  );
}

/**
 * Positive evidence that a big-operator body with an open declared type is
 * nevertheless collection-valued.
 *
 * The first clause above already declines a body whose declared type matches
 * `list`/`indexed_collection`. Consumers, however, register helpers under the
 * open `(unknown) -> unknown` head (the spelling that keeps list-broadcasting
 * working), so `a(t) = [cos t, sin t]` applied inside a Sum types
 * `broadcastable<unknown>` and slips past that clause via the two documented
 * exemptions for top types and `broadcastable<T>`. Those exemptions protect
 * an absence of evidence, not a body that provably builds a collection.
 *
 * So this fires only where an exemption is doing the admitting — the body's
 * type carries no sort evidence at all (`unknown`/`any`/… and the union
 * spelling of the top type) or is `broadcastable<T>` — and only on positive
 * evidence: the operator names a user function (`userFunctionLiteral`) whose
 * `Function`-literal body has a type that matches a collection (the subtype
 * direction, so a wide body type is not evidence). A nested user-function
 * application recurses, `visited` declining self/mutual recursion.
 *
 * The JavaScript target never consults this: its own wider gate
 * (`isElementwiseBigOpBody` → `isPossiblyCollectionTypedJS`, which routes the
 * same shape through the value-safe `_SYS.bcast` element-wise fold) diverts
 * every body this predicate accepts before `assertScalarBigOpBody` is reached,
 * so JS emission is unchanged. The GPU/Python/interval targets have no
 * element-wise arm, so for them the only sound answer is to decline.
 */
export function isCollectionValuedBigOpBodyByLookThrough(
  body: Expression
): boolean {
  const t = compilationType(body);
  const exempted =
    (typeof t !== 'string' && t.kind === 'broadcastable') ||
    carriesNoSortEvidence(t);
  if (!exempted) return false;
  return isProvablyCollectionValuedApplication(body, new Set());
}

/**
 * See `isCollectionValuedBigOpBodyByLookThrough` — the body half of the
 * look-through. This conservative whitelist may miss evidence, but must never
 * produce a false positive because a positive result declines compilation.
 */
export function isProvablyCollectionValuedApplication(
  e: Expression,
  visited: Set<string>
): boolean {
  if (!isFunction(e)) return false;
  const op = e.operator;
  if (typeof op !== 'string' || visited.has(op)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(op);
  const literal = userFunctionLiteral(e.engine, op);
  // A MULTI-CLAUSE function has no single literal (`userFunctionLiteral`
  // answers `undefined` — the same test `ensureUserFunctionEmitted` uses to
  // route to `tryEmitMultiClauseFunction`), so read its clause set instead.
  if (literal === undefined)
    return isProvablyCollectionValuedClauseSet(e.engine, op, nextVisited);
  const fnBody = literal.ops[0];
  if (fnBody === undefined) return false;
  return isProvablyCollectionValuedBody(fnBody, nextVisited);
}

/**
 * Multi-clause counterpart of the user-function body look-through.
 * `userFunctionLiteral` has no single literal for such a function, so inspect
 * each stored clause through the shared body predicate.
 *
 * Any collection-producing clause is enough to decline a scalar-consuming
 * call because the consuming position is compiled once for every branch.
 * Targets without multi-clause lowering decline before reaching this check.
 */
export function isProvablyCollectionValuedClauseSet(
  engine: ComputeEngine,
  op: string,
  visited: Set<string>
): boolean {
  const state = multiClauseState(engine.lookupDefinition(op));
  if (state === undefined) return false;
  return state.clauses.some((c) => {
    if (!isFunction(c.literal, 'Function')) return false;
    const body = c.literal.ops[0];
    if (body === undefined) return false;
    return isProvablyCollectionValuedBody(body, visited);
  });
}

/**
 * The body half of `isProvablyCollectionValuedApplication`: does this
 * function-literal body provably construct a collection?
 *
 * Split out so the same evidence can be read from either a call site or from
 * definition emission (`isContradictedScalarFunctionBody`), which receives the
 * body directly and has no application in hand.
 *
 * Canonical parsing wraps a lambda body in `Block`, whose value is its last
 * statement, so that is the statement to judge for both single- and
 * multi-statement bodies.
 *
 * A `Return` in an earlier statement disqualifies the block: control
 * may never reach the last statement, so it is not provably the value and
 * this positive-evidence predicate must answer `false`.
 *
 * A declared result type additionally ascribes the body: the
 * `ce.declare('a', { signature: '(number) -> number' })` +
 * `ce.assign('a', λ)` route stores `Block(Typed(List(…), 'number'))`, so the
 * ascription reports `number` and hides the `List` underneath. Unwrap it: the
 * constructed value beneath the ascription is precisely the evidence the
 * declaration is contradicting (the interpreter does not coerce — `a(0.3)`
 * really answers a 2-list).
 */
export function isProvablyCollectionValuedBody(
  body: Expression,
  visited: Set<string>
): boolean {
  let fnBody: Expression = body;
  for (;;) {
    if (isFunction(fnBody, 'Block') && fnBody.nops >= 1) {
      const stmts = fnBody.ops;
      if (stmts.slice(0, -1).some(containsReturn)) return false;
      fnBody = stmts[stmts.length - 1];
    } else if (isFunction(fnBody, 'Typed') && fnBody.nops >= 1)
      fnBody = fnBody.ops[0];
    else break;
  }
  // The type `never` (a body that only fails, or whose type is not yet
  // known) matches every type, and is no evidence of a collection.
  if (fnBody.type.type !== 'never' && fnBody.type.matches('collection<any>'))
    return true;
  return isProvablyCollectionValuedApplication(fnBody, visited);
}

/**
 * Does `e` contain a `Return` anywhere? Read by
 * `isProvablyCollectionValuedBody` to disqualify a block whose last statement
 * may not be reached.
 */
/**
 * The function literals that `body`, the body of a function literal,
 * returns, when it returns a function literal on every path: the body is
 * a literal, a `Block` whose last statement returns literals, or an `If`
 * with an else branch whose two branches do. `undefined` for any other
 * body, and for a body with an explicit `Return`, whose paths are not
 * read here.
 */
export function returnedFunctionLiterals(
  body: Expression
): Array<Expression & FunctionInterface> | undefined {
  if (isFunction(body, 'Function')) return [body];
  if (isFunction(body, 'Block')) {
    const last = body.ops[body.nops - 1];
    if (last === undefined || body.ops.some(containsEarlyReturn))
      return undefined;
    return returnedFunctionLiterals(last);
  }
  if (isFunction(body, 'If') && body.nops === 3) {
    const yes = returnedFunctionLiterals(body.ops[1]);
    const no = returnedFunctionLiterals(body.ops[2]);
    return yes && no ? [...yes, ...no] : undefined;
  }
  return undefined;
}

export function containsReturn(e: Expression): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === 'Return') return true;
  return e.ops.some(containsReturn);
}

/**
 * Whether `e` contains a `Return` that returns from the ENCLOSING function
 * — one outside any nested function literal. A `Return` inside a nested
 * `Function` literal returns from that literal, so it does not make a
 * block that contains the literal an early-returning block.
 */
export function containsEarlyReturn(e: Expression): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === 'Return') return true;
  if (e.operator === 'Function') return false;
  return e.ops.some(containsEarlyReturn);
}

/**
 * Whether `target` writes a block with several statements as a JavaScript
 * IIFE (`(() => { …; return v })()`): it has no `block` hook and no
 * statement model of its own (the JavaScript and interval targets).
 */
export function writesBlocksAsIife(target: CompileTarget<Expression>): boolean {
  return target.block === undefined && !target.bareStatementBlocks;
}

/**
 * The value of `e` in a TAIL position — the compilation root, or the last
 * statement of a block whose value is used — on a target that writes a
 * block as an IIFE (`writesBlocksAsIife`). There, `Return(v)` gives `v`,
 * and a `Return` in a branch of an `If` gives the value of that branch:
 * `If(c, Return(1), Return(5))` is the conditional `If(c, 1, 5)`. This is
 * the reading the IIFE already gives an earlier `Return` (the IIFE
 * returns it as the value of the block). The emitted `return` is a
 * statement, so written in place it put `return` inside an expression
 * (`return return x`, `c ? return 1 : return 5`), a syntax error.
 *
 * With `keepReturn`, a `Return` that is `e` itself is kept (a target
 * whose block hook emits it as the `return` statement of the block, as
 * Python does); a `Return` in a branch is still replaced.
 *
 * `e` itself when it has no such `Return`.
 */
export function tailValue(e: Expression, keepReturn = false): Expression {
  if (isFunction(e, 'Return') && e.nops === 1)
    return keepReturn ? e : tailValue(e.ops[0]);
  // A block of one statement is that statement (`Block(Return(x))`).
  if (isFunction(e, 'Block') && e.nops === 1) {
    const inner = tailValue(e.ops[0], keepReturn);
    return inner === e.ops[0] ? e : inner;
  }
  if (isFunction(e, 'If') && e.nops >= 2) {
    const arms = e.ops.slice(1).map((a) => tailValue(a));
    if (arms.every((a, i) => a === e.ops[i + 1])) return e;
    return e.engine._fn('If', [e.ops[0], ...arms]);
  }
  return e;
}

/**
 * `tailValue` for the targets that read a `Return` in a tail position as
 * its value: the IIFE targets (`writesBlocksAsIife`), and Python, whose
 * block hook writes the last statement as `return …` (a `Return` itself
 * is kept there, and only a `Return` in a branch of an `If` is replaced).
 * `e` itself on any other target.
 */
export function tailValueFor(
  e: Expression,
  target: CompileTarget<Expression>
): Expression {
  if (writesBlocksAsIife(target)) return tailValue(e);
  if (target.language === 'python') return tailValue(e, true);
  return e;
}

/**
 * Positive evidence that a big-op body can NEVER produce a number, so the
 * scalar accumulation arm would emit a numerically meaningless `+`/`*`.
 *
 * Deliberately narrow — this is a DECLINE predicate, so every uncertainty
 * resolves to `false` (compile it):
 *
 * - `couldMatch('number')` covers the wide types on its own: `unknown`,
 *   `any`, `expression` and any union carrying a numeric arm all answer
 *   `true` and are admitted. Only a type with no numeric inhabitant at all
 *   reaches the rest.
 * - `boolean` is EXEMPT. It is not a number, but `+` over booleans is
 *   numerically faithful on the numeric targets (JS/Python coerce to 0/1),
 *   which is the counting idiom `Σ_i (x_i > 0)` — compiled it answers `2`
 *   where the interpreter only manages a symbolic `2·True + 2·False`.
 *   Declining it would remove a working lowering to fix nothing.
 * - `broadcastable<T>` is EXEMPT: it spans scalar and collection, so such a
 *   body is routinely a plain scalar at run time (a wide-declared helper
 *   application in a shader body). The JS target routes it through the
 *   `_SYS.bcast` fold before it ever gets here; the GPU/Python/interval
 *   targets rely on it staying admitted. The narrow case where the body can
 *   be PROVEN collection-valued despite the open declared type is carved out
 *   by the caller's third clause
 *   (`isCollectionValuedBigOpBodyByLookThrough`), not here.
 *
 * What is left is the filed class: `string`, `symbol`, `nothing`,
 * `record`/`dictionary`, and function types. Collections are handled by the
 * caller's own branch, which has an actionable message.
 */
export function isProvablyNonNumericBigOpBody(body: Expression): boolean {
  const t = body.type;
  if (t.couldMatch('number')) return false;
  if (t.matches('boolean')) return false;
  const resolved = compilationType(body);
  if (typeof resolved !== 'string' && resolved.kind === 'broadcastable')
    return false;
  return true;
}

/**
 * True if the expression provably evaluates to a boolean (`True`/`False`) —
 * a relational (`Less`, `Equal`, …) or logical (`And`/`Or`/`Not`) form, the
 * `True`/`False` symbols, or anything declared `boolean`. Used to decide
 * whether a `Which`/`If` condition needs the fail-closed guard: a provably
 * boolean condition never diverges from the interpreter, so it is emitted
 * bare.
 */
export function isBooleanValued(expr: Expression): boolean {
  if (isSymbol(expr, 'True') || isSymbol(expr, 'False')) return true;
  if (isFunction(expr)) {
    const h = expr.operator;
    if (isRelationalOperator(h) || h === 'And' || h === 'Or' || h === 'Not')
      return true;
    const t = expr.type;
    return t ? t.matches('boolean') : false;
  }
  if (isSymbol(expr)) {
    const t = expr.type;
    return t ? t.matches('boolean') : false;
  }
  return false;
}

/**
 * A branch condition (`If`/`Which`) must be a scalar boolean. A
 * collection-valued condition can never be one — the interpreter throws
 * ("Condition must evaluate to True or False") rather than silently taking a
 * branch — so fail closed at compile time. Uses the declared type (not
 * `.isCollection`, which is false for a `list<number>`).
 *
 * A CONTRADICTED scalar declaration is the same hazard with the declared type
 * lying about it (2026-08-12 ruling): `b` declared `(number) -> boolean` over
 * a list-constructing body types the condition `boolean`, so the clause above
 * sees nothing and the emitted ternary took a branch off the truthiness of a
 * run-time array. The condition is not an operand of a head in
 * `assertNoContradictedScalarOperand`'s classification (`If`/`Which`
 * are not broadcastable and consume only this one operand as a scalar), so
 * the gate belongs here — the shared condition guard both `If` and
 * `guardCondition` already funnel through.
 */
/**
 * The boolean VALUE a condition's type proves — `true`/`false` when its
 * type is that value type, else `undefined`. The claim comes from the
 * producer's type handler (boolean value types,
 * `docs/plans/2026-08-29-boolean-value-types.md` §4): a proof over TYPES
 * and facts, never an evaluation. Dropping the test is only allowed when
 * the condition is compile-pure — an impure condition (a `Print` inside
 * it) must still run — so an unproven purity keeps the test.
 */
export function booleanClaim(cond: Expression): boolean | undefined {
  if (cond.isPure !== true) return undefined;
  const t = cond.type.type;
  if (
    typeof t === 'object' &&
    t.kind === 'value' &&
    typeof t.value === 'boolean'
  )
    return t.value;
  return undefined;
}

/**
 * The value arms of an `If` or `Which` that the emitted code can reach: an
 * arm behind a condition that `booleanClaim` proves false is dropped, and
 * so is every arm after a condition that it proves true. Such an arm is not
 * emitted, so it must not decide the lane of the node either (CE-230.5): a
 * dead complex arm would put a real result on the complex lane.
 */
export function liveSelectionArms(expr: {
  readonly operator: string;
  readonly ops: ReadonlyArray<Expression>;
}): ReadonlyArray<Expression> {
  const ops = expr.ops;
  if (expr.operator === 'If') {
    const claim = booleanClaim(ops[0]);
    if (claim === undefined) return ops.slice(1);
    return claim ? ops.slice(1, 2) : ops.slice(2, 3);
  }
  const arms: Expression[] = [];
  for (let i = 0; i + 1 < ops.length; i += 2) {
    const claim = booleanClaim(ops[i]);
    if (claim === false) continue;
    arms.push(ops[i + 1]);
    if (claim === true || isSymbol(ops[i], 'True')) break;
  }
  return arms;
}

export function assertScalarCondition(
  cond: Expression,
  target?: CompileTarget<Expression>
): void {
  if (cond.type.matches('collection<any>'))
    throw new Error(
      'Could not compile: a branch condition is a collection-valued expression, ' +
        'which is never a scalar boolean. Materialize the collection first.'
    );
  // A condition that may be a collection at run time (`B < 0` for
  // `B: broadcastable<number>` is a `broadcastable<boolean>`) selects
  // element-wise in the interpreter when it is a flat list. A
  // conditional expression of the target would read the truthiness of an
  // array instead: Python raises on an array of two or more elements, and
  // the interval target answers an interval where the interpreter answers
  // a list. So when the caller names its `target`, such a condition is
  // refused. A shader target (one with `loweredSymbolType`) is exempt: a
  // variable of a shader is a uniform of a fixed type, so its value is
  // not a list that the code did not declare. A target with an
  // element-wise selection (the JavaScript `_SYS.select`,
  // `target.selection`) never reaches this check with such a condition,
  // and neither does the restriction of the base compiler, which restricts
  // element by element (`_SYS.restrict`).
  if (
    target !== undefined &&
    target.loweredSymbolType === undefined &&
    mayBeCollectionCondition(cond.type.type)
  )
    throw new Error(
      'Could not compile: a branch condition may be a collection at run ' +
        `time ('${cond.type.toString()}'), and the selection is then ` +
        'element-wise, which this target does not lower. Declare the ' +
        'operands as scalars, or evaluate instead.'
    );
  if (isContradictedScalarDeclaration(cond))
    throw new Error(
      `Could not compile: the declaration of '${
        isFunction(cond) ? cond.operator : cond.toString()
      }' says it returns a scalar ('${cond.type.toString()}'), but its body ` +
        `constructs a collection. The declaration is contradicted by the ` +
        `body, so this branch condition would select on the truthiness of a ` +
        `run-time collection. Fix the declaration (e.g. '-> list<number>') ` +
        `or evaluate instead.`
    );
}

/**
 * Whether a condition of type `t` may be a list at run time without
 * being provably one: a `broadcastable<T>`, or a union with a list arm
 * beside a scalar arm (`boolean | list<boolean>`). A tuple arm does not
 * count: a tuple binds whole and selects as a scalar
 * (`boolean | tuple<boolean, boolean>`). A type of unknown contents
 * (`unknown`, `any`) does not count either: its values are scalars until
 * proven otherwise, as everywhere in the compiler.
 */
export function mayBeCollectionCondition(
  t: Readonly<Type>,
  depth = 0
): boolean {
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string') return false;
  if (r.kind === 'broadcastable') return true;
  if (r.kind !== 'union' || depth > 8) return false;
  return r.types.some((arm) => {
    const a = resolveTypeForCompilation(arm);
    if (typeof a === 'string')
      return a === 'list' || a === 'indexed_collection';
    if (a.kind === 'list' || a.kind === 'indexed_collection') return true;
    return mayBeCollectionCondition(a, depth + 1);
  });
}

/**
 * Throw the `unsettled-shape` decline when the static type of the
 * condition `cond` admits a value that is neither a boolean nor absent:
 * `If(c, 1, 2)` with `c` declared `boolean | integer`, or a condition of
 * type `unknown`. The interpreter leaves such a conditional unevaluated
 * for a value that is not a boolean, and compiled code does not test the
 * value at run time (rule R5 of `docs/COMPILATION-MODEL.md`). An absent
 * value (a `missing` or `nan` arm) is accepted: it reads as `false`. A
 * condition whose type cannot be a boolean (`integer`) is already a static
 * type error, which declines before this test.
 */
export function assertBooleanOrAbsentCondition(cond: Expression): void {
  if (isBooleanValued(cond)) return;
  const arms = (t: Type): Type[] => {
    const r = resolveTypeForCompilation(t);
    return typeof r === 'object' && r.kind === 'union'
      ? r.types.flatMap(arms)
      : [r];
  };
  const other = arms(compilationType(cond)).some(
    (arm) =>
      arm !== 'missing' &&
      arm !== 'nan' &&
      arm !== 'never' &&
      (arm === 'unknown' || !isSubtype(arm, 'boolean'))
  );
  if (other)
    throw unsettledShapeDecline(
      cond,
      'the condition can be a value that is not a boolean'
    );
}

/**
 * Compile a `Which`/`If` condition, wrapped in the target's boolean guard
 * (`target.assertBoolean`) when it is not provably boolean. A condition
 * that can be a value that is neither a boolean nor absent declines
 * (`assertBooleanOrAbsentCondition()`), so the guard only reads an absent
 * value: the JavaScript guard (`_SYS.cond`) reads `undefined`, `null`
 * and `NaN` as `false`, as the interpreter does not select an absent
 * condition. A provably boolean condition is emitted bare.
 */
export function guardCondition(
  cond: Expression,
  target: CompileTarget<Expression>
): TargetSource {
  assertScalarCondition(cond, target);
  if (target.assertBoolean) assertBooleanOrAbsentCondition(cond);
  const code = core.compile(cond, target);
  if (target.assertBoolean && !isBooleanValued(cond))
    return target.assertBoolean(code);
  return code;
}

/**
 * The relations: the heads whose compiled value is always a boolean.
 */
export const BRANCH_RELATIONS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);

/** True if the expression is provably integer-typed. */
export function isIntegerValued(expr: Expression): boolean {
  if (isNumber(expr)) return !expr.isComplex && Number.isInteger(expr.re);
  const t = expr.type;
  return t ? t.matches('integer') : false;
}

/** True if the expression is provably non-negative (sign ≥ 0). */
export function isNonNegative(expr: Expression): boolean {
  if (isNumber(expr)) return !expr.isComplex && expr.re >= 0;
  return expr.isNonNegative === true;
}

/**
 * The static region an instance realizes.
 *
 * `CseRegionInstance` keeps it structurally opaque — `compilation/types.ts`
 * is expression-type-free by design, so it cannot name `cse.ts`'s types —
 * and this compiler, their only consumer, narrows here.
 */
export function cseRegionOf(
  instance: CseRegionInstance | undefined
): CseRegion | undefined {
  return instance?.region as CseRegion | undefined;
}

/** The innermost region instance, or `undefined` when CSE is inactive for
 * this compilation. */
export function cseTop(
  target: CompileTarget<Expression>
): CseRegionInstance | undefined {
  const session = target.cse;
  if (session === undefined || !session.enabled) return undefined;
  return session.instances[session.instances.length - 1];
}

/** Push a fresh instance of `region` (`undefined` = a blind instance, which
 * resolves no candidate). */
export function pushCseInstance(
  target: CompileTarget<Expression>,
  region: CseRegion | undefined
): CseRegionInstance {
  const instance: CseRegionInstance = {
    region,
    bindings: [],
    state: new Map(),
    names: new Map(),
    boundVars: target.boundVars,
  };
  target.cse!.instances.push(instance);
  return instance;
}

/**
 * Compile `fn`'s body as one instance of `region`, wrapping the result with
 * the target's `cseBind` when temporaries were bound (§6.1). Instances —
 * never static regions — hold the bindings, so a re-entrant emission of
 * shared structure (an unrolled `Sum` term) can never reuse another
 * traversal's temporary.
 */
export function withCseRegion(
  target: CompileTarget<Expression>,
  region: CseRegion | undefined,
  fn: () => TargetSource
): TargetSource {
  const session = target.cse!;
  const instance = pushCseInstance(target, region);
  let code: TargetSource;
  try {
    code = fn();
  } finally {
    session.instances.pop();
  }
  if (instance.bindings.length === 0) return code;
  return target.cseBind!(instance.bindings, code);
}

/**
 * Compile an expression-position operand through the region harvest opened
 * for the edge `(parent, opIndex)`, if any — the emission counterpart of the
 * shared lazy/binder inventory (§5.1). A non-region edge compiles exactly as
 * before, inheriting the enclosing instance.
 *
 * `target` is the target the OPERAND compiles under (a binder body's inner
 * target, say): the instance records its `boundVars`, which is what keeps the
 * blind-instance guard from firing inside a region that was pushed on purpose.
 */
export function withCseOperand(
  parent: Expression | undefined,
  opIndex: number,
  target: CompileTarget<Expression>,
  fn: () => TargetSource
): TargetSource {
  const top = cseTop(target);
  if (top === undefined || parent === undefined) return fn();
  const region = descendantRegionAt(cseRegionOf(top), parent, opIndex);
  if (region === undefined) return fn();
  return withCseRegion(target, region, fn);
}
