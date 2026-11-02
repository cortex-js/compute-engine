// Absence (Missing, Nothing) in conditions and operands: decidability,
// poison slots, and the guards for comparisons over absent operands.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isDecidedLoopIndex } from './javascript-value-facts.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { leafwardElementType } from '../collection-utils.js';
import {
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
  numericMissingSlot,
} from '../../common/type/utils.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget, TargetSource } from './types.js';
import type {
  CompiledCondition,
  ConditionDialect,
  ConditionNode,
  DecidedNumberTest,
  LocalEntry,
  LocalValueFrame,
} from './compiler-types.js';
import { groundSignature } from './compile-assignment-checks.js';
import {
  CONDITION_DIALECT_JS,
  assertScalarCondition,
  kleeneCondition,
} from './compile-conditions.js';
import { tempVar } from './compiler-naming.js';
import { _compileParents } from './compile-statements.js';
import { core } from './compiler-core-hooks.js';
import { compilationType } from './compiler-type-facts.js';
import { _codeAliases, _codeOverrides } from './compiler-mode.js';

/**
 * Compile `expr` as a **value operand** — a sub-expression spliced into a
 * surrounding expression. Behaves like `compile`, but on targets whose
 * multi-statement constructs are bare statement sequences
 * (`target.bareStatementBlocks`, i.e. GLSL/WGSL), it **fails closed** (D6)
 * when the operand compiled to such a block. A shader has no expression-level
 * loop/IIFE, so a loop-form `Sum`/`Product`, a `Loop` or a multi-statement
 * `Block` cannot be a sub-expression; splicing it would emit invalid source
 * (e.g. `return _acc; + 1.0`). Where the enclosing position has a statement
 * sink (`CompileTarget.hoist`) these lowerings move their statements there
 * and answer a plain expression, so the gate fires only where no sink is
 * available: a conditional arm, or an expression-only route. The offending
 * head is named in the error, which the engine-level `compile()` surfaces
 * via `success: false` + `unsupported`.
 */
/**
 * Pick the target's absence axis (§3.F) for a position of type `t` by its
 * DOMAIN (I6): a position whose type is not provably outside the numbers
 * uses `absence.numeric` — that is a numeric type, `never` (a bare
 * `missing` numeric absence is `NaN`), an unknown type, and a union that
 * mixes numbers with objects; a position provably outside the numbers (a
 * string, a list) uses `absence.object`. The predicate is
 * `absentDomainIsObject`, the same one the selection lowerings use to
 * PRODUCE an absent value (`absenceKind`). On the JavaScript and Python
 * targets both axes read the object null AND the numeric marker as absent:
 * a discharge reads an absent operand whatever its spelling (R3 of
 * `docs/plans/2026-11-01-absent-value-contract.md`), and an object-domain
 * position can hold the numeric marker at run time, from a producer that
 * picks its marker from a wider type (`_SYS.atWithValueMarker` returns a
 * `NaN` element as it is) or, on Python, from a written `Missing`, which is
 * `math.nan` there. Throws
 * (fail closed) when the target declares no absence capability at all, or
 * lacks the required object axis.
 */
export function absenceAxisForType(
  t: Readonly<Type>,
  target: CompileTarget<Expression>,
  opName: string
): {
  isAbsent?: (x: TargetSource) => TargetSource;
  coalesce?: (x: TargetSource, d: TargetSource) => TargetSource;
} {
  if (target.absence === undefined)
    throw new Error(
      `Could not compile \`${opName}\`: target '${target.language ?? 'unknown'}' has no absence ` +
        `capability.`
    );
  if (!absentDomainIsObject(t)) return target.absence.numeric;
  // A target whose absence spellings cover its whole value model
  // (`coversValueModel`) discharges a list or a verdict position on the
  // numeric axis too: its `isAbsent`/`coalesce` read every domain of the
  // model. The same predicate the gate applies, so a position that
  // compiles can also be discharged.
  if (
    target.absence.numeric.coversValueModel === true &&
    isNumericOrVerdictShaped(
      resolveTypeForCompilation(
        stripMissingFromType(resolveTypeForCompilation(t))
      )
    )
  )
    return target.absence.numeric;
  if (target.absence.object === undefined)
    throw new Error(
      `Could not compile \`${opName}\`: an object-domain absent position has no representation on ` +
        `target '${target.language ?? 'unknown'}'. Discharge with 'Coalesce' ` +
        `first.`
    );
  return target.absence.object;
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

/** True when `a` is a written absence symbol, `Missing` or `Undefined`. */
export function isAbsenceSymbol(a: Expression): boolean {
  return isSymbol(a, 'Missing') || isSymbol(a, 'Undefined');
}

/**
 * True when a numeric comparison operand may hold the object null at run
 * time: a written absence symbol, or a value whose type has a `missing` arm
 * of its own (`First([Missing, 1])` is typed `integer | missing | nan` and
 * lowers to `undefined`). The NaN test does not see that value
 * (`undefined === undefined` is true) and every comparison with it is
 * `false`, so the decidedness test must test it separately.
 */
export function operandMayBeAbsent(a: Expression): boolean {
  if (isAbsenceSymbol(a)) return true;
  const admits = (t: Readonly<Type>): boolean => {
    const r = resolveTypeForCompilation(t);
    if (r === 'missing') return true;
    return typeof r !== 'string' && r.kind === 'union' && r.types.some(admits);
  };
  return admits(compilationType(a));
}

/**
 * An emitted fragment that is already a NAME or a bare constant — an
 * identifier, a member read off one (`_.x`), or a numeric literal. Repeating
 * such a fragment costs nothing and evaluates nothing, so a decidedness test
 * names it inline; anything else is bound to a temporary first (see
 * `withConditionOperands`). It also needs no parentheses in an `===` test,
 * which is the other place this is asked.
 */
export const ATOMIC_FRAGMENT = /^[\w$.]+$/;

/**
 * True when an operand of a branch comparison is one that the caller may
 * test for an absent value.
 *
 * This function is only a first filter. The caller (`conditionNode` in
 * `compiler-core.ts`) tests an operand only when this function accepts it
 * AND `operandMayBeAbsent` holds, that is, when its type has a `missing`
 * arm. So `2r` in `If(2r > 0, 1, -1)` is accepted here but gets no test:
 * with `r: real`, its type has no `missing` arm, and the host supplies every
 * input with a value of its declared type, so an input left out is not
 * considered. A relation with a `NaN` operand is decided: the comparison
 * gives its IEEE value (`false`, or `true` for `NotEqual`).
 *
 * An operand that does not hold a number is never the `NaN` value. A symbol
 * of such a type (a boolean, a string) qualifies, and a complex operand does
 * not: the JavaScript target represents it as a `{ re, im }` object. Any
 * other operand that does not hold a number needs no test.
 *
 * The one numeric exemption is a name the emitted code itself binds to the
 * successive values of a range with a finite literal start and step
 * (`isDecidedLoopIndex`): the loop computes every value it ever holds, so it
 * is a finite number at every read.
 */
export function mayBeUndecided(
  expr: Expression,
  target?: CompileTarget<Expression>
): boolean {
  const t = expr.type;
  if (!t || !t.couldMatch('number'))
    return isSymbol(expr) && !core.isComplexValued(expr);
  if (isSymbol(expr) && isDecidedLoopIndex(expr.symbol, target?.boundVars))
    return false;
  return !core.isComplexValued(expr);
}

/**
 * How the emitted code must test that a branch condition is DECIDED, as the
 * tree described in the "Branch conditions that cannot be decided" comment
 * above.
 *
 * `null` means the condition needs no test: it is decided by construction —
 * every leaf it reaches compares values that can never be the undecided one
 * — or the analysis declines it (a collection-valued operand under a
 * connective, or an impure operand on a target that cannot bind a value in
 * expression position). Both answers keep the plain conditional expression
 * the compiler emitted before this analysis existed, so nothing is added on
 * the common path.
 *
 * `canBind` says whether the caller can bind an operand's value to a name
 * before the test reads it (`bindExpr` on the target, or a block-scoped
 * constant for a statement). The tests name an operand more than once, so
 * an IMPURE operand — a `Random` draw, a call with effects — is admitted
 * only when it can be bound and therefore evaluated once: an impure
 * condition is then three-valued like any other. Without a binding form
 * it is declined and keeps the plain truthiness selection, rather than
 * running its effects at every naming.
 *
 * Otherwise the root node's `test` says which lowering the caller uses:
 * `'value'` inspects the condition's own value for `true`/`false`,
 * `'operands'` tests a relation's operands for NaN, and `'connective'`
 * combines its operands' pairs by the Kleene tables.
 */
/**
 * A guard condition as a target boolean that is true exactly when the
 * condition is DECIDED TRUE — the test the interpreter applies to a
 * guarded `Element` clause (`runNested` keeps an element only when the
 * guard evaluates to the symbol `True`). A condition decided by
 * construction (a comparison of operands that can never be `NaN`) compiles
 * to its plain boolean; any other condition compiles to its three-valued
 * Kleene value (`true`/`false`/undecided) and is tested for `true`, so an
 * undecided relation, a `Not` of one, and a non-boolean value all answer
 * false here, as they answer "no branch" in `If`/`Which`.
 */
export function compileGuardTest(
  cond: Expression,
  target: CompileTarget<Expression>,
  dialect: ConditionDialect = CONDITION_DIALECT_JS
): TargetSource {
  const node = conditionDecidability(cond, true, target);
  if (node === null) return core.compile(cond, target);
  return dialect.isTrue(`(${kleeneCondition(node, target, dialect)})`);
}

export function conditionDecidability(
  cond: Expression,
  canBind = true,
  target?: CompileTarget<Expression>
): ConditionNode | null {
  const node = core.conditionNode(cond, canBind, target);
  if (node === null || isDecidedByConstruction(node)) return null;
  return node;
}

/**
 * The decidedness analysis of an `And`/`Or`, or `null` when the connective
 * is declined and the caller keeps the plain truthiness test.
 *
 * A COLLECTION-valued operand is declined, because a connective over a
 * collection broadcasts element-wise; that lowering is the target's
 * `selection` hook (`_SYS.select`), which the `If`/`Which` compilation
 * consults before this analysis and which has its own no-match marker per
 * cell. An IMPURE operand is admitted when the target can bind: the lazy
 * lowering (`kleeneConnective`, `kleeneRelationLeaf`) binds every leaf
 * exactly once, in operand order, and an operand a SETTLING sibling
 * short-circuits away (a decided `false` before it in an `And`, a decided
 * `true` in an `Or`) is never reached — so a `Random` draw inside the
 * condition is drawn at most once. The draw count differs from the plain
 * `&&` spelling in one case, on purpose: an `And` operand that follows an
 * UNDECIDED sibling is still evaluated, because the Kleene table needs it
 * (`And(undecided, false)` is `false`), where the emitted `&&` treated
 * the sibling's ordinary `false` as settling and never reached it.
 * Without a binding form the leaves decline themselves
 * (`conditionNode`).
 */
export function connectiveNode(
  cond: Expression & FunctionInterface,
  op: 'And' | 'Or',
  canBind: boolean,
  target?: CompileTarget<Expression>
): ConditionNode | null {
  if (cond.nops === 0) return null;
  const operands: ConditionNode[] = [];
  for (const operand of cond.ops) {
    if (operand.type.matches('collection<any>')) return null;
    const node = core.conditionNode(operand, canBind, target);
    if (node === null) return null;
    operands.push(node);
  }
  return {
    negate: false,
    test: { kind: 'connective', expr: cond, op, operands },
  };
}

/**
 * True when nothing this node reaches can carry an undecided value, so no
 * run-time test is needed. A relation over operands that are never NaN
 * (strings, complex `{ re, im }` objects) is one; so is a connective every
 * one of whose operands is.
 */
export function isDecidedByConstruction(node: ConditionNode): boolean {
  const t = node.test;
  if (t.kind === 'value') return false;
  if (t.kind === 'operands') return t.operands.length === 0;
  return t.operands.every((n) => isDecidedByConstruction(n));
}

/**
 * The run-time tests that an already-emitted operand that may be absent
 * (`operandMayBeAbsent`) holds a value a comparison can decide: `present`
 * tests that it does not hold the object null, and `decided` that it is not
 * NaN. In compiled numeric code NaN is also the absence marker of such an
 * operand: a nested else-less `If` or a default-less `Which` with a
 * numeric result answers NaN when it selects no arm, where the interpreter
 * answers `Missing`, so `If(If(c > 0, 1) > 0, 1, 0)` at `c = -1` must take
 * no arm (the interpreter's absent-condition error), not the else arm.
 *
 * Both are plain comparisons, with no function call. `code` appears in the
 * result up to three times, which is why the caller passes the NAME of a
 * costly operand here rather than the operand's own source
 * (`withConditionOperands`, `kleeneRelationLeaf`): an operand with effects
 * is always bound, so the name is what gets repeated, never the effect (an
 * impure operand reaches the analysis only when the caller can bind —
 * `conditionDecidability`). A fragment that is not a single token is
 * parenthesized, because `===` binds looser than most operators an operand
 * may contain.
 */
export function operandDecidedConjuncts(
  code: TargetSource,
  decided: DecidedNumberTest,
  present: DecidedNumberTest
): TargetSource[] {
  // A fragment the compiler already reduced to a finite numeric literal
  // holds that number at every call, so it can decide every comparison it
  // takes part in and needs no test.
  if (code.length > 0 && Number.isFinite(Number(code))) return [];
  const atom = ATOMIC_FRAGMENT.test(code) ? code : `(${code})`;
  // `present` comes first: Python's NaN test raises on `None`, and the
  // conjunction stops at the first false conjunct.
  return [present(atom), decided(atom)];
}

/**
 * The value a compiled `If`/`Which` answers when it takes no branch — its
 * condition is undecided, or (for `Which`) no clause matched.
 *
 * A numeric result is `NaN`, which is how every target that produces real
 * numbers represents a missing one (`docs/ERROR-MODEL.md` describes the
 * absence markers). A result that is PROVABLY not a number — a string, a
 * list — has no NaN, so the value is the target's literal for a missing
 * object, `undefined` in JavaScript. A result whose type is unknown keeps
 * `NaN`: it is a number until proven otherwise, and the object null would
 * turn every arithmetic consumer of the value into a `TypeError` instead
 * of a propagated NaN. See `absenceKind`, which the `When` restriction and
 * the Python target's selection handlers share, so every selection form
 * answers absence the same way on a target. A target that declares no
 * object literal uses `NaN` for both.
 */
export function noBranchValue(
  node: Expression | undefined,
  target: CompileTarget<Expression>,
  complexArms: boolean
): TargetSource {
  if (complexArms) return '({ re: NaN, im: NaN })';
  const nullLiteral = target.absence?.object?.nullLiteral;
  if (
    nullLiteral !== undefined &&
    node !== undefined &&
    absenceKind([node.type.type], target) === 'object'
  )
    return nullLiteral;
  return 'NaN';
}

/**
 * Which absence representation a selection with the given result types
 * emits on `target` where no arm is selected: `'object'` — the target's
 * object null literal — only when the target declares one AND every type,
 * its own absence marker stripped, is provably disjoint from `number`;
 * `'numeric'` — the target's NaN — otherwise. An unknown type is numeric
 * here (see `noBranchValue`), and so is a mix of numeric and object arms,
 * whose consumers are arithmetic more often than not.
 *
 * Shared by the JavaScript lowering (`noBranchValue`) and the Python
 * target's `If`/`When`/`Which` handlers, so the two targets answer
 * absence by the same rule with their own spelling.
 */
export function absenceKind(
  types: ReadonlyArray<Type>,
  target: CompileTarget<Expression>
): 'numeric' | 'object' {
  if (target.absence?.object?.nullLiteral === undefined) return 'numeric';
  if (types.length === 0) return 'numeric';
  return types.every((type) => absentDomainIsObject(type))
    ? 'object'
    : 'numeric';
}

/**
 * True when a binding of type `t` holds a boolean or is absent:
 * `boolean`, or `boolean | missing`. Shared by the targets that read such
 * a binding in a special way (an empty array is an empty `broadcast()`
 * column; the interval target reads `'true'`/`'false'`).
 */
export function isBooleanBindingType(t: Type | undefined): boolean {
  if (t === undefined) return false;
  const r = resolveTypeForCompilation(stripMissingFromType(t));
  return r !== 'never' && isSubtype(r, 'boolean');
}

/** True when `a` is the number literal NaN. */
export function isNanLiteral(a: Expression): boolean {
  return isNumber(a) && Number.isNaN(a.re) && a.im === 0;
}

/**
 * Is the `missing` arm of the type of `expr` there only because an operand
 * is a number that may be absent (`number | missing`)? True for a
 * comparison whose operands with a `missing` arm are all such numbers, and
 * for `And`, `Or`, `Not` and `Xor` of operands that are each such a
 * comparison or have no `missing` arm.
 *
 * A comparison with an absent operand is `Missing` in the interpreter
 * (ROADMAP CE-93), so its type has a `missing` arm. Such a comparison
 * compiles with no guard on every target: on a target with no object
 * domain (the GPU targets) an absent number IS `NaN`, which IEEE
 * arithmetic compares `false`, and on every target the compiled value of a
 * comparison with an absent operand is not specified
 * (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
 */
export function absentOnlyThroughNumericSlots(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  const h = expr.operator;
  if (
    h === 'Less' ||
    h === 'LessEqual' ||
    h === 'Greater' ||
    h === 'GreaterEqual' ||
    h === 'Equal' ||
    h === 'NotEqual'
  )
    return expr.ops.every((op) => {
      const t = compilationType(op);
      return !typeContainsMissing(t) || numericMissingSlot(t);
    });
  if (h === 'And' || h === 'Or' || h === 'Not' || h === 'Xor')
    return expr.ops.every(
      (op) =>
        !typeContainsMissing(compilationType(op)) ||
        absentOnlyThroughNumericSlots(op)
    );
  return false;
}

/**
 * Whether an absent value of type `t` lives on the OBJECT axis: the type,
 * its own `missing` marker stripped and any declared alias unfolded, is
 * provably disjoint from `number`. `never`, an unknown type and `any` are
 * NOT object-domain — they are numbers until proven otherwise — and neither
 * is a union that mixes numbers with objects. The one predicate behind both
 * the production of an absent value (`absenceKind`, `noBranchValue`) and
 * its discharge (`absenceAxisForType`).
 *
 * The alias is unfolded BEFORE the strip: `stripMissingFromType` is
 * structural and does not see through a `reference`, so an alias such as
 * `type alias maybe_n = number | missing` would survive the strip intact
 * and be read as an object domain. It is resolved again afterwards, in case
 * removing the `missing` arm collapsed the union down to a single
 * reference arm.
 */
/**
 * Is `t` a number, a boolean, or an indexed collection (a list, a vector,
 * a tuple) of such values at any depth — a union of these included? The
 * value model of a target with no object domain (the interval target: an
 * enclosure, a verdict, an array of either).
 */
export function isNumericOrVerdictShaped(t: Readonly<Type>): boolean {
  const r = resolveTypeForCompilation(t);
  if (isSubtype(r, 'number') || isSubtype(r, 'boolean')) return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'union')
    return r.types.every((arm) => isNumericOrVerdictShaped(arm));
  // `broadcastable<T>` is `T | list<T>`: in the model when `T` is.
  if (r.kind === 'broadcastable') return isNumericShaped(r.elements);
  if (r.kind === 'tuple')
    return r.elements.every((el) => isNumericShaped(el.type));
  if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
  const element = leafwardElementType(r);
  return element !== undefined && isNumericShaped(element);
}

/** The collection half of `isNumericOrVerdictShaped`: a number, or an
 * indexed collection of numbers at any depth. A verdict is a value of the
 * model only as a SCALAR — the collection consumers of the interval target
 * read an element as a number, an enclosure or a kinded result, and a
 * verdict element would read as `entire`, a wrong value behind
 * `success: true`. */
export function isNumericShaped(t: Readonly<Type>): boolean {
  const r = resolveTypeForCompilation(t);
  if (isSubtype(r, 'number')) return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'union') return r.types.every((arm) => isNumericShaped(arm));
  if (r.kind === 'broadcastable') return isNumericShaped(r.elements);
  if (r.kind === 'tuple')
    return r.elements.every((el) => isNumericShaped(el.type));
  if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
  const element = leafwardElementType(r);
  return element !== undefined && isNumericShaped(element);
}

export function absentDomainIsObject(t: Readonly<Type>): boolean {
  const stripped = resolveTypeForCompilation(
    stripMissingFromType(resolveTypeForCompilation(t))
  );
  return (
    stripped !== 'never' &&
    stripped !== 'unknown' &&
    stripped !== 'any' &&
    provablyDisjoint(stripped, 'number')
  );
}

/**
 * Strip the `Not`s a branch condition is wrapped in, and report whether an
 * ODD number came off.
 *
 * A `Not` can be decided exactly when its operand can, but the negation
 * cannot be left to an emitted `!`. A value that cannot be decided is one
 * that is neither `true` nor `false`, and `!undefined` is a confident
 * `true` — an answer from no evidence. So when the condition under the
 * `Not`s is tested by its value, that inner value is decided first and the
 * two constants the tests compare against are exchanged; no `!` is emitted.
 *
 * A `Not` over a comparison does not come through here. There the test reads
 * the comparison's operands, which `Not` leaves alone, so the whole
 * condition, `!` included, compiles as written.
 */
export function peelNegations(cond: Expression): {
  expr: Expression;
  negate: boolean;
} {
  let expr = cond;
  let negate = false;
  while (isFunction(expr) && expr.operator === 'Not' && expr.nops === 1) {
    expr = expr.ops[0];
    negate = !negate;
  }
  return { expr, negate };
}

/**
 * The three-valued value of a leaf whose own value has to be inspected: it
 * is `true`/`false` when it is exactly one of them, and undecided
 * otherwise.
 *
 * The value is inspected twice and answered once, so anything that is not
 * already a name is bound first and evaluated once. A name or a constant
 * stays inline: naming it again evaluates nothing.
 */
export function kleeneValueLeaf(
  expr: Expression,
  negate: boolean,
  target: CompileTarget<Expression>,
  dialect: ConditionDialect
): TargetSource {
  const code = core.compile(expr, target);
  if (ATOMIC_FRAGMENT.test(code)) return dialect.kleeneOfValue(code, negate);
  const name = tempVar(target);
  return dialect.bind([name], dialect.kleeneOfValue(name, negate), [code]);
}

/**
 * The three-valued value of a relation leaf: the comparison itself when its
 * operands can decide it, and the undecided value otherwise.
 *
 * An operand whose emitted source is not already a name or a constant is
 * bound to a parameter first, and the comparison then reads that parameter
 * (`_codeOverrides`, the same substitution the real-operand runtime guard
 * uses). Without it the operand's computation runs THREE times: the
 * comparison embeds it once and the decidedness test names it twice more.
 * Common-subexpression elimination cannot remove those copies — it analyzes
 * the expression tree, where the operand occurs once, while the copies are
 * made at code-generation time.
 *
 * The binding is a PARAMETER of this leaf rather than a temporary around
 * the whole selection, so it is evaluated only when the leaf is reached.
 *
 * A relation under an odd number of `Not`s negates the comparison, which is
 * safe here and only here: the negation sits inside the decided branch, so
 * the value it negates is a real boolean.
 */
export function kleeneRelationLeaf(
  test: {
    readonly expr: Expression;
    readonly operands: ReadonlyArray<Expression>;
  },
  negate: boolean,
  target: CompileTarget<Expression>,
  dialect: ConditionDialect
): { code: TargetSource; decided: boolean } {
  const params: string[] = [];
  const args: TargetSource[] = [];
  const installed: Expression[] = [];
  const present = (x: TargetSource) =>
    `${dialect.not}(${dialect.isUndecided(x)})`;
  try {
    const conjuncts: TargetSource[] = [];
    for (const op of test.operands) {
      const code = core.compile(op, target);
      const inline = operandDecidedConjuncts(
        code,
        dialect.decidedNumber,
        present
      );
      // No test at all: the operand is a constant the compiler already
      // folded, so it decides every comparison it takes part in.
      if (inline.length === 0) continue;
      if (ATOMIC_FRAGMENT.test(code) || _codeOverrides.has(op)) {
        conjuncts.push(...inline);
        continue;
      }
      const name = tempVar(target);
      params.push(name);
      args.push(code);
      _codeOverrides.set(op, name);
      installed.push(op);
      conjuncts.push(
        ...operandDecidedConjuncts(name, dialect.decidedNumber, present)
      );
    }
    const compare = core.compile(test.expr, target);
    const value = negate ? `${dialect.not}(${compare})` : `(${compare})`;
    const body =
      conjuncts.length === 0
        ? value
        : dialect.ternary(
            conjuncts.join(` ${dialect.and} `),
            value,
            dialect.undecided
          );
    return {
      code: params.length === 0 ? body : dialect.bind(params, body, args),
      decided: conjuncts.length === 0,
    };
  } finally {
    for (const op of installed) _codeOverrides.delete(op);
  }
}

/**
 * Compile the operands a relation's decidedness test reads, then run `fn`
 * with the run-time tests those operands take.
 *
 * An operand whose emitted source is not already a name or a constant is
 * bound to a temporary first, and the condition `fn` compiles reads that
 * temporary instead (`_codeOverrides`, the same substitution the real-operand
 * runtime guard uses). Without it the operand's computation runs THREE times
 * per call: the condition embeds it once and the decidedness test names it
 * twice more. Common-subexpression elimination cannot remove those copies —
 * it analyzes the expression tree, where the operand occurs once, while the
 * copies are made at code-generation time.
 *
 * A literal, a variable read, and a temporary an enclosing guard already
 * bound stay inline: naming them again evaluates nothing.
 *
 * The bindings are RETURNED rather than emitted here, because they must wrap
 * the whole selection — the decidedness test and the condition both read
 * them — and only the caller knows whether that selection is an expression
 * or a statement. `canBind` is false for a target with no way to bind a
 * value in expression position, which then keeps the inline form.
 *
 * Only a LONE relation comes through here. A relation inside a connective is
 * compiled by `kleeneRelationLeaf`, which binds its operands to parameters
 * of the leaf instead, so that an operand a sibling short-circuits away is
 * never evaluated.
 */
export function withConditionOperands<T>(
  operands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  canBind: boolean,
  fn: (conjuncts: ReadonlyArray<TargetSource>) => T,
  dialect: ConditionDialect = CONDITION_DIALECT_JS
): { value: T; bindings: Array<[string, TargetSource]> } {
  const bindings: Array<[string, TargetSource]> = [];
  const installed: Expression[] = [];
  const present = (x: TargetSource) =>
    `${dialect.not}(${dialect.isUndecided(x)})`;
  try {
    const conjuncts: TargetSource[] = [];
    for (const op of operands) {
      const code = core.compile(op, target);
      const inline = operandDecidedConjuncts(
        code,
        dialect.decidedNumber,
        present
      );
      // No test at all: the operand is a constant the compiler already
      // folded, so it decides every comparison it takes part in.
      if (inline.length === 0) continue;
      if (!canBind || ATOMIC_FRAGMENT.test(code) || _codeOverrides.has(op)) {
        conjuncts.push(...inline);
        continue;
      }
      const name = tempVar(target);
      bindings.push([name, code]);
      _codeOverrides.set(op, name);
      installed.push(op);
      conjuncts.push(
        ...operandDecidedConjuncts(name, dialect.decidedNumber, present)
      );
    }
    return { value: fn(conjuncts), bindings };
  } finally {
    for (const op of installed) _codeOverrides.delete(op);
  }
}

/**
 * Produce a branch selection that takes an arm only when its condition can
 * be decided. See the "Branch conditions that cannot be decided" comment
 * above.
 *
 * `thenCode` and `elseCode` arrive already parenthesized the way the caller
 * wants them, so the `null` case produces a plain conditional expression.
 *
 * The `'value'` case inspects the condition's value twice, once against
 * `true` and once against `false`. A condition that is a single token — the
 * common case, a variable read such as `_.b` — is written twice; a
 * condition that is a function call is bound to an arrow parameter first, so
 * that it is evaluated once. Both arms stay inside the arrow, so an arm that
 * is not selected still never runs. `_CND` matches the name the numeric
 * `coalesce` code binds; a variable of that exact name in an enclosing scope
 * would be hidden inside the arms, which is why the name is upper case and
 * unlikely to be written by hand.
 *
 * A condition under an odd number of `Not`s exchanges the two constants the
 * tests compare against, so the arms keep their order (see
 * `peelNegations`).
 */
export function exactSelect(
  cond: CompiledCondition,
  thenCode: TargetSource,
  elseCode: TargetSource,
  noBranch: TargetSource,
  target: CompileTarget<Expression>
): TargetSource {
  const { code, conjuncts, negate, bindings } = cond;
  const [then, otherwise] = negate ? ['false', 'true'] : ['true', 'false'];
  let select: TargetSource;
  if (conjuncts === 'value') {
    select = ATOMIC_FRAGMENT.test(code)
      ? `((${code}) === ${then} ? ${thenCode} : (${code}) === ${otherwise} ? ${elseCode} : ${noBranch})`
      : `((_CND) => _CND === ${then} ? ${thenCode} : _CND === ${otherwise} ? ${elseCode} : ${noBranch})(${code})`;
  } else if (conjuncts.length === 0) {
    select = `((${code}) ? ${thenCode} : ${elseCode})`;
  } else {
    select = `((${conjuncts.join(
      ' && '
    )}) ? ((${code}) ? ${thenCode} : ${elseCode}) : ${noBranch})`;
  }
  return bindings.length === 0 ? select : target.bindExpr!(bindings, select);
}

/**
 * Compile a branch condition together with its decidedness test, inside
 * whatever CSE region the caller has opened. Both have to be built in the
 * same region: the region's wrapper binds the temporaries the condition
 * introduced, and a test emitted outside that wrapper would reference names
 * nothing defines.
 *
 * The operands are compiled BEFORE the condition, because a non-trivial one
 * is bound to a temporary the condition must then read instead of recomputing
 * it (`withConditionOperands`).
 */
export function compileExactCondition(
  cond: Expression,
  decidability: ConditionNode,
  target: CompileTarget<Expression>
): CompiledCondition {
  assertScalarCondition(cond, target);
  if (decidability.test.kind === 'value') {
    const { expr, negate } = peelNegations(cond);
    return {
      code: core.compile(expr, target),
      conjuncts: 'value',
      bindings: [],
      negate,
    };
  }
  // A condition that reaches a connective compiles to its three-valued
  // VALUE, which the selection then inspects against `true` and `false` —
  // the same shape a value-tested condition takes, so no new one is
  // introduced. The negation, and every binding the lowering needs, are
  // inside that value.
  // A connective whose value is always decided is selected on directly,
  // like a relation that needs no decidedness test (`conjuncts` empty).
  if (decidability.test.kind === 'connective') {
    const { code, decided } = core.kleeneConditionParts(
      decidability,
      target,
      CONDITION_DIALECT_JS
    );
    return {
      code,
      conjuncts: decided ? [] : 'value',
      bindings: [],
      negate: false,
    };
  }
  const { value, bindings } = withConditionOperands(
    decidability.test.operands,
    target,
    target.bindExpr !== undefined,
    (conjuncts) => ({ code: core.compile(cond, target), conjuncts }),
    CONDITION_DIALECT_JS
  );
  return { ...value, bindings, negate: false };
}

/**
 * The signature user-defined function `h` COMPILES AS: its declared
 * signature (from a value definition's function type, else an operator
 * definition's signature), with a GENERIC one read at its declared bounds.
 * `undefined` when there is no signature, or when the bound reading leaves
 * a type variable behind — the decline convention (never a throw).
 *
 * A polytype's parameter is a type VARIABLE, which the compiler can neither
 * coerce nor decide a broadcast against, so a generic used to decline here
 * unconditionally. Substituting each variable by its DECLARED BOUND is the
 * reading the interpreter's own broadcast gate already performs
 * (`paramsAreScalar` calls `substituteDeclaredBounds` before asking whether
 * a parameter is scalar), so a function declared `(x: T) -> T where T:
 * number` compiles exactly as the ground `(x: number) -> number` does — one
 * emission, whose call sites then get the coercion and broadcast wraps a
 * ground signature earns. Every admissible argument is a subtype of the
 * bound, so no call site can reach a shape that emission was not compiled
 * for.
 *
 * An UNBOUNDED variable (`where T`), or a bound that itself mentions a
 * variable (`where T: list<U>, U`), has no ground reading: those decline,
 * which keeps the whole-function decline and the sound interpreted
 * fallback. Whether an emission is then actually allowed is decided by the
 * TARGET in `ensureUserFunctionEmitted` — only JavaScript emits a generic.
 */
export function userFunctionSignature(
  engine: ComputeEngine,
  h: string
): FunctionSignature | undefined {
  const def = engine.lookupDefinition(h);
  if (!def) return undefined;
  const boxed =
    'value' in def && def.value !== undefined
      ? def.value.type
      : 'operator' in def
        ? def.operator.signature
        : undefined;
  return groundSignature(boxed?.type);
}
