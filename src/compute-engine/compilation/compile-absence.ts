// Absence (Missing, Nothing, unsupplied inputs) in conditions and operands:
// decidability, NaN escapes, poison slots, and the guards for comparisons over
// absent operands.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isDecidedLoopIndex } from './javascript-value-facts.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { lookupApplicable } from '../function-utils.js';
import {
  isPossiblyCollectionTyped,
  leafwardElementType,
} from '../collection-utils.js';
import {
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
  numericMissingSlot,
} from '../../common/type/utils.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import {
  boundVariableNames,
  boundVariableNamesInOperand,
} from '../boxed-expression/binders.js';
import { declaredBinders } from '../boxed-expression/binding-sites.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { functionLiteralBoundNames } from '../boxed-expression/function-literal.js';
import { tuplePatternNames } from '../boxed-expression/tuple-pattern.js';
import type { CompileTarget, TargetSource } from './types.js';
import type {
  CompiledCondition,
  ConditionDialect,
  ConditionNode,
  DecidedNumberTest,
  LocalEntry,
  LocalValueFrame,
} from './compiler-types.js';
import {
  groundSignature,
  userFunctionLiteral,
} from './compile-assignment-checks.js';
import { declareValueOperand } from './compile-declarations.js';
import {
  BRANCH_RELATIONS,
  CONDITION_DIALECT_JS,
  DECIDED_NUMBER_JS,
  assertScalarCondition,
  conditionDialectOf,
  containsEarlyReturn,
  kleeneCondition,
  withCseOperand,
} from './compile-conditions.js';
import { tempVar } from './compiler-naming.js';
import { _compileParents, compileValueOperand } from './compile-statements.js';
import { core } from './compiler-core-hooks.js';
import { compilationType } from './compiler-type-facts.js';
import { CompilerState } from './compiler-state.js';
import {
  _codeAliases,
  _codeOverrides,
  isPresentRead,
  withPresentReads,
} from './compiler-mode.js';
import {
  ABSENCE_DISCHARGING_HEADS,
  COLLECTION_HOLDING_HEADS,
  CONTROL_FLOW_HEADS,
} from './compiler-tables.js';

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
 * PRODUCE an absent value (`absenceKind`), so what `Which`/`If`/`When`
 * emit for no selection is what `IsMissing`/`Coalesce` test for. Throws
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

/**
 * The caller inputs that the block of `frame` reads, for a comparison
 * that reads one of its locals (`blockLocalValueFrame`): a node for each
 * free variable of the block (`unknowns`), the inputs of a symbol with an
 * engine value and of the body of a user function that the block reads
 * (`operandInputNodes`). A variable outside the block that the block
 * assigns is read off the vars object, so its read is an input too. A local of a scope nested in the
 * block and the variable of a binder inside the block are not inputs.
 * Computed once for each frame; each node is visited once.
 */
export function blockInputs(
  frame: LocalValueFrame,
  target: CompileTarget<Expression> | undefined
): Expression[] {
  if (frame.inputs !== undefined) return frame.inputs;
  // A read of a local of this block met while the inputs are collected
  // (through `operandInputNodes`) adds nothing more.
  frame.inputs = [];
  const found = new Map<string, Expression>();
  const add = (n: Expression): void => {
    if (
      isSymbol(n) &&
      !found.has(n.symbol) &&
      !isDecidedLoopIndex(n.symbol, target?.boundVars)
    )
      found.set(n.symbol, n);
  };
  const seen = new Set<Expression>();
  const followed = new Set<string>();
  const visit = (e: Expression): void => {
    if (seen.has(e)) return;
    seen.add(e);
    if (isSymbol(e)) {
      if (isInnerBinderRead(e)) return;
      const local = blockLocalOf(e);
      if (local !== undefined) {
        // A variable outside the block that the block assigns is read off
        // the vars object: its value before the write is an input. A
        // local is not: its own read is tested where it is read
        // (`isUnsetLocalRead`), and its test here could run before the
        // local is declared.
        if (local.frame === frame && local.outer) add(e);
        // A dependent local of an enclosing block brings the inputs of
        // that block (a frame being collected gives none, which ends a
        // cycle).
        else if (local.frame !== frame && localDependsOnInputs(local, target))
          blockInputs(local.frame, target).forEach(add);
        return;
      }
      if (frame.names.has(e.symbol)) return add(e);
      if (followed.has(e.symbol)) return;
      followed.add(e.symbol);
      if (e.engine._getSymbolValue(e.symbol) !== undefined)
        operandInputNodes(e, target).forEach(add);
      return;
    }
    if (!isFunction(e)) return;
    if (!followed.has(e.operator)) {
      followed.add(e.operator);
      const literal = userFunctionLiteral(e.engine, e.operator);
      if (literal !== undefined)
        operandInputNodes(literal, target).forEach(add);
    }
    // The target of an assignment is written, not read, the type of a
    // `Declare` is not a variable, and the pattern of a `MatchCase`
    // (`_`, `[h, ...t]`) binds or ignores what it matches.
    if (e.operator === 'MatchCase') {
      e.ops.slice(1).forEach(visit);
      return;
    }
    if (e.operator === 'Assign') {
      if (e.nops > 1) visit(e.ops[1]);
      return;
    }
    if (e.operator === 'Declare') {
      const value = declareValueOperand(e.ops);
      if (value !== undefined) visit(value);
      return;
    }
    e.ops.forEach(visit);
  };
  frame.stmts.forEach(visit);
  frame.inputs = [...found.values()];
  return frame.inputs;
}

/**
 * True when a value of `local` could depend on a caller input: a value
 * reads a caller input (a free variable of the block, or of the value of
 * an engine symbol or the body of a user function that it reads), a
 * variable outside the block, a local or a loop index that could, calls
 * an operator that the engine does not define, or has effects (a
 * `Random` draw). A variable outside the block that the block assigns
 * could always hold the caller's value. Only such a local needs the test
 * of every caller input of its block (`blockInputs`): a loop counter
 * (`k := k + 1`) or a constant compares as it is.
 *
 * The flags of a frame are found once, together: each value is walked
 * once, which records whether it depends by itself and which locals it
 * reads; a local is then set dependent when one of its values is, or
 * reads one that is (the least fixpoint, from "not dependent"). A cycle
 * (`v0 := v0 + 1` in a loop) stays not dependent unless something on it
 * depends. The cost is linear in the size of the values. The locals are
 * matched by definition (`blockLocalOf`), with the name key of a desugar
 * temporary; the index of a `Loop` clause is read through the collection
 * it ranges over (`LocalValueFrame.loopIndices`), and a variable bound by
 * a binder inside the value (a parameter, a `Sum` index) is read inside
 * that value. Any other binder variable counts as dependent.
 */
export function localDependsOnInputs(
  local: LocalEntry,
  target: CompileTarget<Expression> | undefined
): boolean {
  if (local.outer) return true;
  if (local.dependent !== undefined) return local.dependent;
  const frame = local.frame;
  if (!frame.dependenceKnown) {
    frame.dependenceKnown = true;
    findDependentLocals(frame, target);
  }
  // A local found through another frame (a nested scope) is solved with
  // its own frame; anything left unknown counts as dependent.
  return local.dependent ?? true;
}

/** The fixpoint of `localDependsOnInputs` over the locals of `frame`. */
export function findDependentLocals(
  frame: LocalValueFrame,
  target: CompileTarget<Expression> | undefined
): void {
  const entries = [...frame.byDef.values(), ...frame.loopIndices.values()];
  for (const entry of entries) entry.dependent = undefined;
  const readers = new Map<LocalEntry, LocalEntry[]>();
  const dependent = new Set<LocalEntry>();
  // The engine values and user-function bodies already walked, and
  // whether each reads an input.
  const followed = new Map<string, boolean>();
  const literalDepends = (root: Expression): boolean =>
    operandInputNodes(root, target).length > 0 || root.isPure !== true;
  for (const entry of entries) {
    const refs = new Set<LocalEntry>();
    let depends = false;
    const seen = new Set<Expression>();
    const visit = (e: Expression, bound: ReadonlySet<object>): void => {
      if (depends || seen.has(e)) return;
      seen.add(e);
      if (isSymbol(e)) {
        const def = e.valueDefinition as object | undefined;
        if (def !== undefined && bound.has(def)) return;
        const index =
          def === undefined ? undefined : frame.loopIndices.get(def);
        if (index !== undefined) {
          refs.add(index);
          return;
        }
        const ref = blockLocalOf(e);
        if (ref !== undefined) {
          if (ref.outer) depends = true;
          else if (ref.frame === frame) refs.add(ref);
          else if (localDependsOnInputs(ref, target)) depends = true;
          return;
        }
        if (isInnerBinderRead(e)) {
          depends = true;
          return;
        }
        if (e.isConstant && e.engine._getSymbolValue(e.symbol) === undefined)
          return;
        const s = e.symbol;
        let known = followed.get(s);
        if (known === undefined) {
          const value = e.engine._getSymbolValue(s);
          known = value === undefined ? true : literalDepends(value);
          followed.set(s, known);
        }
        if (known) depends = true;
        return;
      }
      if (!isFunction(e)) return;
      const h = e.operator;
      // A call of a function that the block assigns is read through the
      // function's values (its body has effects only if a node of it
      // does).
      const named = blockLocalsNamed(h);
      if (named.length === 0 && h !== 'Function' && e.isPure === false) {
        depends = true;
        return;
      }
      if (named.length > 0) {
        for (const ref of named) {
          if (ref.outer) depends = true;
          else if (ref.frame === frame) refs.add(ref);
          else if (localDependsOnInputs(ref, target)) depends = true;
        }
      } else {
        let known = followed.get(h);
        if (known === undefined) {
          const literal = userFunctionLiteral(e.engine, h);
          known =
            literal !== undefined
              ? literalDepends(literal)
              : !isOperatorDef(
                  lookupApplicable(h, e.engine.context.lexicalScope)
                );
          followed.set(h, known);
        }
        if (known) {
          depends = true;
          return;
        }
      }
      // The variables that a binder in the value binds are read there.
      // A `Block` scope is not one: it also declares the free variables
      // of its body. The parameters of a function literal are declared
      // in the scope of its body.
      let inner = bound;
      const bind = (binding: unknown) => {
        if (binding === undefined || binding === null) return;
        if (inner === bound) inner = new Set(bound);
        (inner as Set<object>).add(
          typeof binding === 'object' && 'value' in binding
            ? (binding.value as object)
            : (binding as object)
        );
      };
      if (e.localScope !== undefined && h !== 'Block')
        for (const binding of e.localScope.bindings.values()) bind(binding);
      if (h === 'Function' && isFunction(e.ops[0], 'Block')) {
        const scope = e.ops[0].localScope;
        for (const param of e.ops.slice(1))
          if (isSymbol(param)) bind(scope?.bindings.get(param.symbol));
      }
      for (const op of e.ops) visit(op, inner);
    };
    for (const value of entry.values) visit(value, new Set());
    if (depends) dependent.add(entry);
    for (const ref of refs) {
      const list = readers.get(ref);
      if (list === undefined) readers.set(ref, [entry]);
      else list.push(entry);
    }
  }
  // A dependent local makes every local that reads it dependent.
  const work = [...dependent];
  while (work.length > 0) {
    const entry = work.pop()!;
    for (const reader of readers.get(entry) ?? [])
      if (!dependent.has(reader)) {
        dependent.add(reader);
        work.push(reader);
      }
  }
  for (const entry of entries) entry.dependent = dependent.has(entry);
}

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

/** True when the symbol node `e` reads a name that a binder inside a
 * block being compiled binds (`binderDefs`): a loop index, a parameter. */
export function isInnerBinderRead(e: Expression): boolean {
  const def = e.valueDefinition as object | undefined;
  if (def === undefined) return false;
  return _localValueFrames.some((f) => f.binderDefs.has(def));
}

/** The locals named `name` of the blocks being compiled, for a call of a
 * function that the block assigns (`g(1)` after `g := t ↦ t + n`). */
export function blockLocalsNamed(name: string): LocalEntry[] {
  const out: LocalEntry[] = [];
  for (const frame of _localValueFrames)
    out.push(...(frame.byName.get(name) ?? []));
  return out;
}

/** True when `code` is the read of a local of a block being compiled that
 * no top-level statement before the current one assigned: it may still be
 * `undefined` (`blockLocalValueFrame`). */
export function isUnsetLocalRead(code: TargetSource): boolean {
  const frames = _localValueFrames;
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    const name = frame.bySpelling.get(code);
    if (name !== undefined)
      return !frame.assignedBefore[frame.current]?.has(name);
  }
  return false;
}

/**
 * The value of a relation with a WRITTEN absence operand (`Missing`,
 * `Undefined`), on a target with an object null `nullLiteral`.
 *
 * With two operands the relation is undecided whatever the other operand
 * holds, so its value is the object null. The other operand is still
 * evaluated when it has effects: the interpreter evaluates it (a `Random`
 * draw is consumed), so the value is the object null bound after it.
 *
 * A CHAIN (`Less(x, 0, Missing)`) is the Kleene conjunction of its pairwise
 * links: a link with an absent operand is undecided, a link between two
 * present operands is an ordinary three-valued comparison (decided for a
 * NaN operand, which makes an ordered link `false`), and one link that is
 * decidedly false makes the whole chain false. So with `x = 1` or
 * `x = NaN`, `Less(x, 0, Missing)` is `false`, and with `x = 1`,
 * `Less(x, 5, Missing)` is undecided, as in the interpreter (user decision
 * 2026-10-23 for the NaN case; before it a NaN link was undecided). A
 * chain with an operand that has effects is declined: a middle operand
 * belongs to two links, and the lowering would evaluate it once per link.
 */
export function compileAbsentRelation(
  ce: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  nullLiteral: TargetSource
): TargetSource {
  const dialect = conditionDialectOf(target);
  if (args.length <= 2) {
    const effects = args.filter(
      (a) => !isAbsenceSymbol(a) && a.isPure !== true
    );
    if (effects.length === 0) return nullLiteral;
    return dialect.bind(
      effects.map(() => tempVar(target)),
      nullLiteral,
      effects.map((a) => compileValueOperand(a, target))
    );
  }
  if (args.some((a) => a.isPure !== true))
    throw new Error(
      `Could not compile \`${h}\`: a chained comparison with an absent ` +
        `operand and an operand that has effects. The chain is decided link ` +
        `by link, and an operand shared by two links would be evaluated ` +
        `twice.`
    );
  const links: Expression[] = [];
  for (let i = 0; i + 1 < args.length; i++)
    links.push(ce._fn(h, [args[i], args[i + 1]]));
  const nodes: ConditionNode[] = [];
  for (const link of links) {
    const node = core.conditionNode(link, true, target);
    if (node === null)
      throw new Error(
        `Could not compile \`${h}\`: a link of a chained comparison with ` +
          `an absent operand has no three-valued lowering.`
      );
    nodes.push(node);
  }
  return kleeneCondition(
    {
      negate: false,
      test: {
        kind: 'connective',
        expr: ce._fn('And', links),
        op: 'And',
        operands: nodes,
      },
    },
    target,
    dialect
  );
}

/** True when `a` is a written absence symbol, `Missing` or `Undefined`. */
export function isAbsenceSymbol(a: Expression): boolean {
  return isSymbol(a, 'Missing') || isSymbol(a, 'Undefined');
}

/**
 * True when the value of `a` may be absent in an OBJECT domain: its type
 * has a `missing` arm and, without it, is not a number (`string | missing`,
 * a restricted point), or it is an APPLICATION whose type is a top type,
 * `any` or `unknown`, which admits the absent value without an arm of its
 * own: the element of a bare `list`, `g(x)[1]` for `g: (unknown) -> list`,
 * is typed `any`, and at `x = []` its value is `undefined`; without the
 * guard, `_SYS.eq` answered `NaN` for `g(x)[1] = 1` where the interpreter
 * answers `Missing` (ROADMAP CE-386). A SYMBOL of a top type is not such
 * an operand: a declared `x: any` or `x: unknown` is read as the scalar
 * the host passes (user decisions of 2026-08-08 for `unknown` and
 * 2026-10-17 for `any`, Tycho ledger row 379), `Equal(u, 1)` keeps the
 * plain scalar form, and an `If` over it keeps its plain branches. The
 * Kleene `Equal`/`NotEqual` guard answers the target's object null for
 * such an operand when it is absent.
 */
export function isObjectDomainMissingOperand(a: Expression): boolean {
  const t = compilationType(a);
  if ((t === 'any' || t === 'unknown') && isFunction(a)) return true;
  if (!typeContainsMissing(t)) return false;
  const stripped = resolveTypeForCompilation(stripMissingFromType(t));
  // A bare absence type (`missing`, an element read whose every value is
  // absent) is guarded too: its value is whichever absence its producer
  // emits, and the guard reads only the object null as absent, so a
  // numeric absence (`NaN`) still compares as IEEE says.
  if (stripped === 'never') return true;
  return !isSubtype(stripped, 'number');
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
 * True when an operand of a branch comparison may carry a value the
 * comparison cannot decide.
 *
 * Every operand that holds a number qualifies, whatever its declared type.
 * A `real` or `integer` type does not survive a missing input: the caller
 * may leave a free symbol out of the object the compiled function reads its
 * variables from, `undefined` becomes NaN as soon as it enters arithmetic,
 * and `2 * undefined > 0` is an ordinary `false`. So `If(2r > 0, 1, -1)`
 * must test `2r` even though `r` is declared `real` and a `real` is never
 * NaN. Testing every numeric operand adds one comparison per operand, whose
 * cost is not measurable, so there is nothing to gain by exempting the types
 * that exclude NaN.
 *
 * An operand that does not hold a number — a boolean, a string — is never
 * the NaN value, but a SYMBOL of that type is an input the caller can leave
 * out, and `undefined === true` is an ordinary `false`. So such a symbol
 * qualifies too, and gets only the absence test (`operandDecidedConjuncts`
 * emits `!== undefined` for a read of the vars object, and no NaN test for
 * it). Without it, `If(c = True, 5, -1)` took the else arm for an
 * unsupplied `c`, where the interpreter has no value (ROADMAP CE-569). Any
 * other operand that does not hold a number needs no test, and neither does
 * a complex one: the JavaScript target represents it as a `{ re, im }`
 * object.
 *
 * The one numeric exemption is a name the emitted code itself binds to the
 * successive values of a range with a finite literal start and step
 * (`isDecidedLoopIndex`): the loop computes every value it ever holds, so it
 * is a finite number at every read and no caller can leave it out.
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
 * One symbol node for each variable that the compiled code of `expr` reads
 * off the vars object EVERY time `expr` is evaluated: the inputs whose
 * absence makes a comparison of `expr` undecided. Each node is the first
 * occurrence of its name, taken from the expression that reads it, so no
 * symbol is boxed (and declared) for the test.
 *
 * - A variable that nothing binds or assigns (`unknowns`) is an input.
 * - A symbol with a value (an assignment `a := \sin x`) is compiled from
 *   that value, so the inputs of the value are inputs of `expr`. So are
 *   the inputs of the body of a user function that `expr` calls. Each
 *   value and body is walked once, which also stops a value or a function
 *   that refers to itself.
 * - A read of a local of a block being compiled, of a variable outside
 *   it that the block assigns, and a call of a function that the block
 *   assigns, add the read itself and every caller input that the whole
 *   block reads (`blockInputs`, user decision 2026-10-30).
 * - Only the CONDITION of a nested `If`, the first condition of a `Which`,
 *   and the condition of a `When` are read every time. An arm, and a later
 *   condition of a `Which`, are read only when they are selected, so their
 *   variables are left to the nested conditional itself: with
 *   `If(If(x > 0, y, 1) > 0, 1, 0)` and `x = -1`, `y` is never read and
 *   the answer is 1. When an arm that reads an unsupplied variable IS
 *   selected, its value is NaN (or `undefined` for a bare read). A nested
 *   conditional whose result may be absent (no else arm, no default) is
 *   then caught by its own absence and NaN tests (`operandMayBeAbsent`);
 *   for any other, the comparison decides false, as for any NaN operand.
 * - The operands of `Coalesce`, `IsMissing` and `AssertPresent` are not
 *   inputs: those operators give a defined answer for an absent operand (a
 *   fallback, a verdict, a raised error). The exception is `AssertPresent`
 *   on a target with no `raise` (a shader): there the assertion compiles
 *   as the identity (user decision P5), the absent value flows on, so its
 *   operand stays an input.
 *
 * A name the target itself binds to a loop index with literal bounds
 * (`isDecidedLoopIndex`) is never absent and is left out.
 *
 * A name bound by a node of `expr` itself (a `Sum` index, a comprehension
 * variable, a `Block` local, a parameter of a function literal) is not
 * followed to a global of the same name: with `k := 2m` in the engine,
 * `Sum(k, k, 1, 3)` reads no `m`, so `m` is not tested. The bound names
 * are those `boundVariableNamesInOperand` reports for each operand
 * (`binders.ts`); a name that `unknowns` reports free stays an input even
 * when a scope lists it (a `Block` declares the free symbols of its body
 * in its own scope, `D` scopes its variable).
 */
export function operandInputNodes(
  expr: Expression,
  target?: CompileTarget<Expression>
): Expression[] {
  const engine = expr.engine;
  const found = new Map<string, Expression>();
  const add = (name: string, node: Expression): void => {
    if (!found.has(name) && !isDecidedLoopIndex(name, target?.boundVars))
      found.set(name, node);
  };
  // A block local (`blockLocalOf`): the read itself, and every caller
  // input of the block that holds it (`blockInputs`).
  const addLocal = (local: LocalEntry, node: Expression | undefined) => {
    if (node !== undefined) add(local.name, node);
    if (CompilerState._directInputsOnly) return;
    // A local that no caller input can reach (a loop counter, a
    // constant) needs no test of the inputs of its block.
    if (!localDependsOnInputs(local, target)) return;
    for (const input of blockInputs(local.frame, target))
      if (isSymbol(input)) add(input.symbol, input);
  };
  // The names whose value or function body was already walked.
  const followed = new Set<string>();
  // The nodes already visited, for each set of bound names: a value built
  // from shared subtrees (a block local assigned `t := s + s` with `s`
  // itself shared) is walked once per node, not once per path, so the
  // walk stays linear in the size of the expression.
  const visitedUnder = new Map<ReadonlySet<string>, Set<Expression>>();
  const collect = (root: Expression): void => {
    const names = new Set(root.unknowns);
    const visit = (e: Expression, bound: ReadonlySet<string>): void => {
      let visited = visitedUnder.get(bound);
      if (visited === undefined) {
        visited = new Set();
        visitedUnder.set(bound, visited);
      }
      if (visited.has(e)) return;
      visited.add(e);
      if (isSymbol(e)) {
        const s = e.symbol;
        const local = blockLocalOf(e);
        // A variable outside the block that the block assigns is a local
        // for this rule, also when it has an engine value.
        if (local?.outer === true) {
          addLocal(local, e);
          return;
        }
        if (names.has(s)) {
          if (local !== undefined) addLocal(local, e);
          else add(s, e);
          return;
        }
        // A name that `unknowns` reports free is an input whatever a
        // scope says (a `Block` auto-declares every free symbol of its
        // body in its own scope, and `D` scopes its variable, so
        // `boundVariableNames` lists them too). The bound set decides only
        // whether a name that is NOT free is followed to a global's value.
        if (bound.has(s)) return;
        if (followed.has(s)) return;
        followed.add(s);
        const value = engine._getSymbolValue(s);
        if (value !== undefined) collect(value);
        return;
      }
      if (!isFunction(e)) return;
      const h = e.operator;
      if (
        h === 'Coalesce' ||
        h === 'IsMissing' ||
        (h === 'AssertPresent' && target?.absence?.raise !== undefined)
      )
        return;
      // The operands of a binder see the names it binds, from the operand
      // where each name comes into scope (a later clause of a
      // comprehension sees an earlier index; the body sees every index).
      const binds = boundVariableNames(e);
      const binders =
        binds.length === 0 ? undefined : declaredBinders(e, 'post');
      const boundIn = (i: number): ReadonlySet<string> => {
        if (binds.length === 0) return bound;
        const inScope = boundVariableNamesInOperand(e, i, binders);
        if (inScope.length === 0) return bound;
        const next = new Set(bound);
        for (const n of inScope) next.add(n);
        return next;
      };
      if (h === 'If' || h === 'Which') {
        if (e.nops > 0) visit(e.ops[0], boundIn(0));
        return;
      }
      if (h === 'When') {
        if (e.nops > 1) visit(e.ops[1], boundIn(1));
        return;
      }
      // The value of a `Block` is its last statement. When that statement
      // reads no local of the block (each of its free variables is free
      // in the block), the earlier statements do not change the value:
      // `Block(a := n, 1) > 0` reads no input, and is `True` in the
      // interpreter with `n` absent. A later read of `a` is tested where
      // it is read.
      if (h === 'Block' && e.nops > 0 && !containsEarlyReturn(e)) {
        const last = e.ops[e.nops - 1];
        const free = new Set(e.unknowns);
        if (last.unknowns.every((n) => free.has(n))) {
          visit(last, boundIn(e.nops - 1));
          return;
        }
      }
      if (!followed.has(h)) {
        followed.add(h);
        const literal = userFunctionLiteral(engine, h);
        if (literal !== undefined) collect(literal);
      }
      // A call of a function that the block assigns, to a local or to a
      // variable outside the block (`g := t ↦ t + n`, then `g(1)`): every
      // caller input of that block. The locals are matched by name, which
      // can only add inputs.
      for (const local of blockLocalsNamed(h)) addLocal(local, undefined);
      e.ops.forEach((x, i) => visit(x, boundIn(i)));
    };
    visit(root, new Set());
  };
  collect(expr);
  return [...found.values()];
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
 * The run-time tests that an already-emitted numeric operand holds a value a
 * comparison can decide. There are two, and an operand takes only the ones
 * it needs:
 *
 * - `a === a` is false for exactly one value, NaN. It is produced for every
 *   numeric operand the compiler has not already reduced to a literal,
 *   whatever its declared type — `mayBeUndecided` explains why a `real` type
 *   earns no exemption.
 * - `a !== undefined` catches a free symbol the caller left out of the
 *   object the compiled function reads its variables from.
 *   `undefined === undefined` is true, so the NaN test alone cannot see a
 *   missing variable, and every comparison against `undefined` is `false` —
 *   which would make `If(x > 0, 1, -1)` take the else arm for an unsupplied
 *   `x`. It is produced only when the operand compiled to a read of that
 *   object, the only fragment whose value can be `undefined`: arithmetic
 *   over a missing variable is already NaN, and a literal is neither.
 *
 * Both are plain comparisons, with no function call, and together they cost
 * no more than either one alone. `code` appears in the result up to three
 * times, which is why the caller passes the NAME of a costly operand here
 * rather than the operand's own source (`withConditionOperands`,
 * `kleeneRelationLeaf`): an operand with effects is always bound, so the
 * name is what gets repeated, never the effect (an impure operand reaches
 * the analysis only when the caller can bind — `conditionDecidability`). A
 * fragment that is not a single token is parenthesized, because `===`
 * binds looser than most operators an operand may contain.
 *
 * A NaN operand decides every branch relation (user decisions 2026-10-20
 * and 2026-10-23), so an operand that cannot be absent takes no NaN test,
 * only the absence tests. An operand that may be absent (`present` is
 * given) keeps the NaN test: in compiled numeric code NaN is also the
 * absence marker of such an operand. A nested else-less `If` or a
 * default-less `Which` with a numeric result answers NaN when it selects
 * no arm, where the interpreter answers `Missing`, so
 * `If(If(c > 0, 1) > 0, 1, 0)` at `c = -1` must take no arm (the
 * interpreter's absent-condition error), not the else arm.
 */
export function operandDecidedConjuncts(
  code: TargetSource,
  target: CompileTarget<Expression>,
  decided: DecidedNumberTest = DECIDED_NUMBER_JS,
  present?: DecidedNumberTest,
  operand?: Expression
): TargetSource[] {
  // A fragment the compiler already reduced to a finite numeric literal
  // holds that number at every call, so it can decide every comparison it
  // takes part in and needs no test. This is what keeps `x > 0` down to one
  // guarded operand.
  if (code.length > 0 && Number.isFinite(Number(code))) return [];
  const atom = ATOMIC_FRAGMENT.test(code) ? code : `(${code})`;
  // `present` tests that an operand which may hold the object null does
  // not (`operandMayBeAbsent`). It comes first: Python's NaN test raises on
  // `None`, and the conjunction stops at the first false conjunct.
  const conjuncts: TargetSource[] = [];
  if (present !== undefined) conjuncts.push(present(atom));
  if (present !== undefined) conjuncts.push(decided(atom));
  if (isOmittableRead(code, target))
    conjuncts.push(presenceTest(atom, operand));
  return conjuncts;
}

/**
 * True when `code` reads a value that the caller can leave out, and that
 * is then `undefined`: a read of the vars object (`isVarsObjectRead`), a
 * lambda parameter listed in `CompileTarget.omittableParams`, or a block
 * local that may not be assigned yet (`isUnsetLocalRead`).
 */
export function isOmittableRead(
  code: TargetSource,
  target: CompileTarget<Expression>
): boolean {
  return (
    isVarsObjectRead(code, target) ||
    target.omittableParams?.has(code) === true ||
    // The test of such a local is written in JavaScript
    // (`presenceTest`), and only the JavaScript targets compile a local
    // that may still be `undefined`.
    ((target.language === 'javascript' ||
      target.language === 'interval-javascript') &&
      isUnsetLocalRead(code))
  );
}

/**
 * The test that the vars-object read `code` of the operand `operand`
 * holds a value a comparison can decide: `typeof code === 'boolean'` for
 * an operand of type `boolean`, `code !== undefined` otherwise. The entry
 * check of `run()` accepts any value for a variable declared `boolean`
 * (a value that is not a boolean leaves a condition on it undecided), so
 * such a read is tested for being a boolean: `c = True` with `c = 1` has
 * no value, as `If(c, …)` takes no arm for it. A variable declared with a
 * number type, or `string`, refuses a value of another type at entry, so
 * only the unsupplied value remains to test.
 */
export function presenceTest(
  code: TargetSource,
  operand: Expression | undefined
): TargetSource {
  if (
    operand !== undefined &&
    isSymbol(operand) &&
    isSubtype(operand.type.type, 'boolean')
  )
    return `typeof ${code} === 'boolean'`;
  return `${code} !== undefined`;
}

/**
 * True when `code` is a plain read of one binding off the target's vars
 * object (`_.x` on the JavaScript family). That is the only emitted fragment
 * whose value can be `undefined` at run time: it is what an absent entry of
 * the caller's vars object reads as. A target that binds free symbols some
 * other way declares no `varsObjectName` and answers `false`.
 */
export function isVarsObjectRead(
  code: TargetSource,
  target: CompileTarget<Expression>
): boolean {
  const vars = target.varsObjectName;
  if (vars === undefined || !code.startsWith(`${vars}.`)) return false;
  return /^[\w$]+$/.test(code.slice(vars.length + 1));
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
 * The reads of the vars object (`_.x`) that a comparison over `args`
 * needs to test for `undefined`: one for each variable that an operand
 * reads every time it is evaluated (`operandInputNodes`, the same
 * variables a branch condition tests), on the `javascript` target, except
 * the reads already tested around the code being emitted
 * (`isPresentRead`). A literal, a local, a parameter and a loop index are
 * not vars-object reads. An operand that `mayBeUndecided` exempts (a
 * complex value) is not tested, as in a branch condition. Empty on every
 * other target.
 */
export function unsuppliedReads(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): { code: string; test: string }[] {
  if (
    target.language !== 'javascript' ||
    (target.varsObjectName === undefined &&
      target.omittableParams === undefined)
  )
    return [];
  const reads: { code: string; test: string }[] = [];
  for (const op of args) {
    if (isNumber(op) || isString(op)) continue;
    if (!mayBeUndecided(op, target)) continue;
    // An operand with a `missing` arm has its own absence lowering
    // (`absentComparisonGuard`, the Kleene `Equal`/`NotEqual` guard).
    if (typeContainsMissing(compilationType(op))) continue;
    for (const s of operandInputNodes(op, target)) {
      const code = core.compile(s, target);
      if (
        isOmittableRead(code, target) &&
        !isPresentRead(code, target) &&
        !reads.some((r) => r.code === code)
      )
        reads.push({ code, test: presenceTest(code, s) });
    }
  }
  return reads;
}

/**
 * The presence tests `tests` of a comparison over `args`, with the escape
 * that a NaN operand decides the comparison: the interpreter answers
 * `False` for `NaN = y` (`True` for `NaN ≠ y`) while `y` has no value,
 * as it does for every comparison with a NaN operand (user decisions
 * 2026-10-20 and 2026-10-23). When two or more reads are tested and an
 * operand is itself a numeric vars-object read (`_.x`), the tests become
 * one: `((_.x !== undefined && _.y !== undefined) || _.x !== _.x)`. The
 * comparison then runs with `_.y` unsupplied only when `_.x` is NaN, and
 * gives the IEEE answer, `false` (`true` for `≠`). With one read the
 * escape is not needed: a NaN read is present. A computed operand or a
 * block local that is NaN (`x + 1` with `x = NaN`) is tested when its own
 * reads are present, as in a comparison whose value is the result
 * (`nanEscapeTerms`): `(_.x !== undefined && (_.x + 1) !== (_.x + 1))`.
 * Otherwise the tests are returned as they are.
 */
export function withNanEscape(
  args: ReadonlyArray<Expression>,
  tests: ReadonlyArray<TargetSource>,
  target: CompileTarget<Expression>
): TargetSource[] {
  const joined = tests.join(' && ');
  if (tests.length < 2) return tests.length === 0 ? [] : [joined];
  // The reads that `tests` test for a value (`presenceTest`).
  const readCodes: string[] = [];
  for (const t of tests) {
    const m =
      /^(\S+) !== undefined$/.exec(t) ?? /^typeof (\S+) === 'boolean'$/.exec(t);
    if (m !== null) readCodes.push(m[1]);
  }
  // `Equal` stands for any relation here: a complex operand is not given
  // its ordering escape in a branch condition.
  const terms = nanEscapeTerms('Equal', args, readCodes, target);
  if (terms.length === 0) return [joined];
  return [`((${joined}) || ${terms.join(' || ')})`];
}

/**
 * The argument lists whose comparison `unsuppliedComparisonGuard` is
 * emitting: the comparison inside the guard reaches `compileExpr` again
 * with the same list, and must then take its own lowering.
 */
export const _guardEmitting = new WeakSet<ReadonlyArray<Expression>>();

/**
 * The comparisons, and the `And`/`Or` of them, whose value only a truth
 * test reads (`withTruthOnly`): `Boole`, a selecting predicate. There an
 * unsupplied variable needs no test, because the plain comparison already
 * gives `false` for it, which the consumer reads as it reads `undefined`.
 */
export const _truthOnly = new WeakSet<Expression>();

/**
 * Mark `expr` as read only by a truth test (`_truthOnly`), when the plain
 * comparison is `false` for an unsupplied variable: an ordering (`0 <
 * undefined` is `false`) or an `Equal` (its own lowering tests two
 * operands that may both be `undefined`), over numeric operands that read
 * an absent value as NaN (see `markTruthOnlyNode`). `NotEqual` is not marked:
 * `undefined !== 0` is `true`, so it keeps its test. An `And`/`Or` is
 * marked when each operand can be and none has effects
 * (`truthOnlyEligible`): the plain `&&`/`||` of such comparisons is then
 * `false` exactly when the three-valued value is `false` or has no
 * value. A `Not` is not entered: `!false` is `true`. Called by the
 * lowerings whose consumer reads only truth.
 *
 * The mark holds only while `fn` runs, and is then removed: the same
 * expression object compiled later as a value (`compile(c)` after
 * `compile(Boole(c))`) keeps its test.
 */
export function withTruthOnly<T>(expr: Expression | undefined, fn: () => T): T {
  const added: Expression[] = [];
  markTruthOnlyNode(expr, added);
  try {
    return fn();
  } finally {
    for (const node of added) _truthOnly.delete(node);
  }
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

/**
 * The recursion of `withTruthOnly`: true when `expr` was marked. Each node
 * added to the mark set is pushed on `added`, so the caller can remove it.
 * Whether `expr` can be marked is decided before any node is marked
 * (`truthOnlyEligible`): a connective that is not marked keeps its
 * three-valued lowering, and an operand marked inside it would give that
 * lowering `false` for an absent read where it needs `undefined`.
 */
export function markTruthOnlyNode(
  expr: Expression | undefined,
  added: Expression[]
): boolean {
  if (!truthOnlyEligible(expr)) return false;
  const install = (e: Expression): void => {
    if (!isFunction(e)) return;
    if (e.operator === 'Block') return install(e.ops[e.nops - 1]);
    for (const node of [e, e.canonical])
      if (!_truthOnly.has(node)) {
        _truthOnly.add(node);
        added.push(node);
      }
    if (e.operator === 'And' || e.operator === 'Or') e.ops.forEach(install);
  };
  install(expr!);
  return true;
}

/**
 * True when a truth test can read the plain value of `expr`
 * (`markTruthOnlyNode`).
 *
 * - A `Block` (the body of a function literal) is read through its last
 *   statement, its value.
 * - A relation qualifies only over numeric operands that each read an
 *   absent value as NaN or `undefined` (`readsAbsenceAsNaN`): its plain
 *   value is then `false` for an absent read. Not over a string
 *   (`_SYS.eqt(undefined, undefined)` is `true`) or a boolean, not over
 *   `Boole(x > 0) = 0`, which is `true` for an absent `x`, and not
 *   `NotEqual`.
 * - An `And`/`Or` qualifies when each operand qualifies and none has
 *   effects. The plain `&&` stops at the first `false` operand, also one
 *   that is `false` because a variable is absent, where the interpreter
 *   evaluates the next operand: `Boole(And(x > 0, Random() < 0.5))` at
 *   `x` absent draws in the interpreter.
 */
export function truthOnlyEligible(expr: Expression | undefined): boolean {
  if (expr === undefined || !isFunction(expr)) return false;
  const h = expr.operator;
  if (h === 'Block') return truthOnlyEligible(expr.ops[expr.nops - 1]);
  if (BRANCH_RELATIONS.has(h))
    return (
      h !== 'NotEqual' &&
      expr.ops.every(
        (op) =>
          scalarOperandKind(op) === 'number' &&
          !core.isComplexValued(op) &&
          readsAbsenceAsNaN(op)
      )
    );
  if (h === 'And' || h === 'Or')
    return expr.ops.every((op) => op.isPure === true && truthOnlyEligible(op));
  return false;
}

/**
 * The lowering of a comparison `h(args)` (`<`, `≤`, `>`, `≥`, `=`, `≠`,
 * chained or not) whose VALUE is the result, when an operand reads a
 * variable the caller can leave out of the vars object (`unsuppliedReads`),
 * or `undefined` when there is none.
 *
 * The interpreter has no value for `x > 0` while `x` has none, and a
 * branch condition already reads such a comparison as undecided (it tests
 * `_.x !== undefined`). The plain comparison gave `false` for an
 * unsupplied `x` (`0 < undefined`), and `true` for `x ≠ 0` (user decision
 * 2026-10-30: such a comparison has no value, `undefined`).
 *
 * Over numbers the lowering is `((0 < _.x) || ((_.x !== undefined) ?
 * false : undefined))`: the comparison runs first, and its `true` is the
 * answer with no test. Only a `false` pays the tests, one per variable
 * read (`typeof _.c === 'boolean'` for a `boolean` variable, see
 * `presenceTest`). `NotEqual` is the mirror image, `((_.x !== 0) &&
 * ((_.x !== undefined) ? true : undefined))`, because `undefined !== 0` is
 * `true`. The comparison is emitted as it would be without the tests, so
 * an `Equal` of two variables keeps its own test that both are not
 * `undefined` (`undefined === undefined` is `true`). The comparison runs
 * first only when each operand reads an absent value as NaN or
 * `undefined` (`readsAbsenceAsNaN`). Over a string or a boolean operand
 * the comparison may call a helper that does not accept `undefined`, and
 * an operand such as `Boole(x > 0)` reads an absent `x` as a number, so
 * there the tests come first: `((_.s !== undefined) ? (cmp) : undefined)`,
 * and the comparison inside is emitted with the reads marked as tested
 * (`withPresentReads`). With an operand that has effects, the comparison
 * still runs first, and its bound value is then tested. An operand of
 * type `unknown` compiles to the same scalar comparison and is tested
 * too (user decision 2026-10-30: an unsupplied variable gives no value,
 * whatever its declared type).
 *
 * A NaN operand decides the comparison (user decisions 2026-10-20 and
 * 2026-10-23), also while another variable has no value: the interpreter
 * answers `False` for `NaN = y`. A NaN literal decides a pair with no test
 * at all. Otherwise the tests pass when an operand is NaN, or, for an
 * ordering, a complex operand is not real (`withNanTerms`), and the
 * comparison gives its IEEE answer.
 *
 * A chain whose links read different variables, or that has a link
 * between two literals, is the three-valued `And` of its links, each with
 * its own tests, so that a link that is `false` decides the chain
 * (`Less(5, 0, w)` is `False` while `w` has no value). A computed operand
 * of such a chain is bound once first (`bindExpr`), and each link reads
 * the temporary. A chain with an operand that has effects at index 2 or
 * later is lowered pair by pair (`lazyChain`): each operand that is not a
 * literal or a symbol is bound to a temporary just before the first pair
 * that reads it, and is evaluated only when no pair before it is
 * `false`, also after a pair with no value, as the interpreter does.
 * `Less(x, 1, Random())` with `x` absent draws once, and is `False`,
 * since the draw is less than 1.
 *
 * A comparison that a truth test reads (`withTruthOnly`) takes none of
 * this. A branch condition does not come through here with untested
 * reads: `withConditionOperands` and `kleeneRelationLeaf` mark the reads
 * they test before they emit the comparison.
 */
export function unsuppliedComparisonGuard(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  emit: () => string,
  node?: Expression
): string | undefined {
  if (!BRANCH_RELATIONS.has(h)) return undefined;
  if (_guardEmitting.has(args)) return undefined;
  if (node !== undefined && _truthOnly.has(node)) return undefined;
  // A NaN literal operand decides a pair whatever the other operand
  // holds: the interpreter answers `False` for `NaN < x` and `True` for
  // `NaN ≠ x` while `x` has no value. The plain comparison gives that
  // IEEE answer, so a pair takes no test. A chain with one is split
  // below, and each link that holds the literal is such a pair.
  const nanLiteral = args.some((a) => isNanLiteral(a));
  if (nanLiteral && args.length === 2) return undefined;
  // Scalar operands only: a comparison with a collection operand is
  // element-wise, or compares whole collections, and keeps its own
  // lowering. An operand of type `unknown` (an undeclared variable)
  // compiles to the same scalar comparison (`0 < _.u`, `_.u === 0`), so
  // it is tested too, unless the target sends it to its collection
  // equality dispatch (`collectionEqualityOperand`).
  const kinds = args.map((a) => scalarOperandKind(a));
  // An operand of a top type that may hold a list at run time (a call of
  // a block-local function, `gg(1)`) compiles to the run-time dispatch
  // (`_SYS.bcast`, `_SYS.eq`), which reads an absent value as a value.
  // Such a comparison takes the tests first, so it has no value while a
  // variable it reads has none. An operand of a collection type keeps
  // its own lowering.
  if (!guardTakesOperands(args)) return undefined;
  const dispatched =
    kinds.some((k) => k === undefined) ||
    ((h === 'Equal' || h === 'NotEqual') &&
      target.collectionEqualityOperand !== undefined &&
      // A text operand is a collection of characters in the lattice, but
      // it compares by content (`_SYS.eqt`), not through the dispatch.
      args.some(
        (a, i) =>
          kinds[i] === 'number' &&
          !isNumber(a) &&
          target.collectionEqualityOperand!(a)
      ));
  const reads = unsuppliedReads(args, target);
  if (reads.length === 0) return undefined;
  // A branch condition that reads a local of a block (`poisonSlot`): the
  // tests of every caller input of the block are too strict, so where
  // they fail while the reads of the comparison itself pass, the whole
  // block gives no value.
  const poison =
    node !== undefined && CompilerState._poisonConditions.has(node)
      ? poisonSlot(args, reads, target)
      : undefined;
  const otherwise =
    poison === undefined
      ? 'undefined'
      : poison.direct === ''
        ? poison.code
        : `((${poison.direct}) ? ${poison.code} : undefined)`;
  if (dispatched)
    return testsFirst(
      args,
      reads,
      reads.map((r) => r.test).join(' && '),
      target,
      emit,
      otherwise
    );
  const atomic = (a: Expression) => isSymbol(a) || isNumber(a) || isString(a);

  if (args.length > 2) {
    // A link that does not read every tested variable can decide `false`
    // while one of the others has no value (`x < y + 1 < 2` at `y = 2`,
    // `x` unsupplied; `x < 5 < 1`; `x < NaN < y`). Then the chain is the
    // three-valued `And` of its links. When every link reads every tested
    // variable, one test around the plain chain is the same answer
    // (`-1 < x < 1`, `0.1 < x + 1 < 0.9`).
    const readsOf = args.map((a) =>
      unsuppliedReads([a], target).map((r) => r.code)
    );
    const partialLink =
      nanLiteral ||
      args.some(
        (_, i) =>
          i > 0 &&
          reads.some(
            (r) =>
              !readsOf[i - 1].includes(r.code) && !readsOf[i].includes(r.code)
          )
      );
    const lateEffect = args.some(
      (a, i) => i >= 2 && a.isPure !== true && !atomic(a)
    );
    const bound = args.filter((a, i) => !atomic(a) && args.indexOf(a) === i);
    // A node with effects that occurs twice (`Less(q, q, 1)` with
    // `q = x + Random()`) is evaluated once per occurrence by the
    // interpreter: one temporary cannot stand for both draws, so such a
    // chain keeps its own lowering.
    const repeatedEffect = bound.some(
      (a) => a.isPure !== true && args.filter((b) => b === a).length > 1
    );
    // An operand with effects at index 2 or later is evaluated by the
    // interpreter only when the pairs before it are not `False`, also
    // after an undecided pair (`Less(x, 1, Random())` with `x` absent
    // draws, and is `False`). The chain is then lowered pair by pair
    // (`lazyChain`).
    if (lateEffect && !repeatedEffect && target.bindExpr !== undefined)
      return lazyChain(h, args, target, poison !== undefined);
    if (
      partialLink &&
      !lateEffect &&
      !repeatedEffect &&
      (bound.length === 0 || target.bindExpr !== undefined)
    )
      return withBoundOperands(
        bound,
        target,
        () => {
          const ce = args[0].engine;
          const links = args.slice(1).map((b, i) => ce._fn(h, [args[i], b]));
          // The links of a condition are conditions too (`poisonSlot`).
          if (poison !== undefined)
            for (const link of links) CompilerState._poisonConditions.add(link);
          return core.compile(ce._fn('And', links), target);
        },
        node
      );
  }

  const emitBare = (): string => {
    _guardEmitting.add(args);
    try {
      return emit();
    } finally {
      _guardEmitting.delete(args);
    }
  };
  const numeric = kinds.every((k) => k === 'number');
  // The comparison runs first only when it cannot give a wrong `true`
  // for an absent read: each operand then reads an absent value as NaN
  // or `undefined` (`readsAbsenceAsNaN`), which no ordering or `Equal`
  // holds true of. `Boole(x > 0) = 0` reads an absent `x` as the number
  // 0, so its `true` at `x` unsupplied would be wrong; it, and every
  // comparison over a string or a boolean (whose helper may not accept
  // `undefined`, and `_SYS.eqt(undefined, undefined)` is `true`), takes
  // the tests first: `((tests) ? (cmp) : undefined)`, the comparison
  // inside emitted with the reads marked as tested (`withPresentReads`).
  if (!numeric || !args.every((a) => readsAbsenceAsNaN(a))) {
    const tests = numeric
      ? withNanTerms(h, args, reads, target, node)
      : reads.map((r) => r.test).join(' && ');
    return testsFirst(args, reads, tests, target, emit, otherwise);
  }
  const test = withNanTerms(h, args, reads, target, node);
  const cmp = emitBare();
  return h === 'NotEqual'
    ? `((${cmp}) && ((${test}) ? true : ${otherwise}))`
    : `((${cmp}) || ((${test}) ? false : ${otherwise}))`;
}

/**
 * The emission that makes the whole run give no value, for a branch
 * condition over `args` that reads a local of a block, or `undefined`
 * when the condition reads no local of a block being compiled, or when
 * the strict tests test only the reads of the comparison itself.
 *
 * Such a comparison tests every caller input of the block
 * (`blockInputs`), which is too strict: the test can fail where the
 * interpreter decides the comparison. In `a := 5; If(x > 0, a := n + 1);
 * b := 0; If(a < 1, b := 1, b := 2); b` at `x = -1`, `n` absent, the
 * interpreter takes the second branch and gives 2. Taking no branch gave
 * the definite value 0. So when the comparison is not `true` (`false`
 * for `≠`) and the strict tests fail, but the reads of the comparison
 * itself pass (`direct`: its vars-object reads and its locals, without
 * the inputs of their blocks), the run gives the absence marker of its
 * result (user decision 2026-10-30: a compiled result is never a
 * definite value that the interpreter does not give). When the direct
 * reads fail, the interpreter has no value for the comparison either, and
 * the branch takes no arm, as before.
 *
 * `code` throws the run-wide marker object `_SYS.noValue`, which the
 * compiled result catches at its top (`catchNoValue`): the whole run then
 * gives the absence marker of its result. The statements after the
 * condition, inner or outer, cannot give a value that the interpreter
 * does not give, since none of them reaches the result. A function
 * literal that runs during the run is covered the same way; one that
 * could run after the run has returned (the result can hold a function)
 * declines.
 */
export function poisonSlot(
  args: ReadonlyArray<Expression>,
  reads: ReadonlyArray<{ code: string; test: string }>,
  target: CompileTarget<Expression>
): { code: string; direct: string } | undefined {
  const frames = _localValueFrames;
  let outer = -1;
  const seen = new Set<Expression>();
  const visit = (e: Expression): void => {
    if (seen.has(e)) return;
    seen.add(e);
    const locals: LocalEntry[] = [];
    if (isSymbol(e)) {
      const local = blockLocalOf(e);
      if (local !== undefined) locals.push(local);
    } else if (isFunction(e)) {
      locals.push(...blockLocalsNamed(e.operator));
      e.ops.forEach(visit);
    }
    for (const local of locals) {
      const i = frames.indexOf(local.frame);
      if (i >= 0 && (outer < 0 || i < outer)) outer = i;
    }
  };
  args.forEach(visit);
  if (outer < 0) return undefined;
  const prev = CompilerState._directInputsOnly;
  CompilerState._directInputsOnly = true;
  let direct: { code: string; test: string }[];
  try {
    direct = unsuppliedReads(args, target);
  } finally {
    CompilerState._directInputsOnly = prev;
  }
  // When every read that the strict tests test is a direct read, a
  // failed test is a failed direct read: no marker is needed.
  if (reads.every((r) => direct.some((d) => d.code === r.code)))
    return undefined;
  const parents = _compileParents;
  const root = parents[0];
  if (
    parents.some((p) => isFunction(p, 'Function')) &&
    (root === undefined ||
      mayHoldFunctionType(root.type.type) ||
      mayReturnFunction(root))
  )
    throw new Error(
      'Could not compile a branch condition that reads a block local ' +
        'in a function literal: where the test of the inputs of the ' +
        'block fails, the whole run has no value, and the function could ' +
        'run after the run has returned.'
    );
  // The marker skips everything after the condition: an effect there (a
  // `Random` draw, a host call) would not run, where the interpreter runs
  // it.
  if (root === undefined || hasEffectNode(root))
    throw new Error(
      'Could not compile a branch condition that reads a block local: ' +
        'where the test of the inputs of the block fails, the whole run ' +
        'has no value, and the run has an effect that must still happen.'
    );
  CompilerState._noValueUsed = true;
  return {
    code: '(() => { throw _SYS.noValue; })()',
    direct: direct.map((r) => r.test).join(' && '),
  };
}

/**
 * True when the value of `expr` could be, or hold, a function literal of
 * the compilation, so that the function could run after the run has
 * returned (`poisonSlot`). The value is followed through the last
 * statement and the `Return`s of a block, the arms of a conditional, the
 * elements of a list or a tuple, the values of a local and the bodies of
 * a function that the block assigns. Any other value counts when its
 * type is a function type.
 */
export function mayReturnFunction(expr: Expression): boolean {
  const isFunctionType = (t: Type): boolean => {
    const r = resolveTypeForCompilation(stripMissingFromType(t));
    return (
      r !== 'never' &&
      r !== 'unknown' &&
      r !== 'any' &&
      isSubtype(r, 'function')
    );
  };
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e)) {
      const local = blockLocalOf(e);
      if (local !== undefined) return local.values.some(visit);
      return isFunctionType(e.type.type);
    }
    if (!isFunction(e)) return false;
    const h = e.operator;
    if (h === 'Function') return true;
    if (h === 'Block') {
      const returns: Expression[] = [];
      const collect = (x: Expression): void => {
        if (!isFunction(x) || x.operator === 'Function') return;
        if (x.operator === 'Return' && x.nops > 0) returns.push(x.ops[0]);
        x.ops.forEach(collect);
      };
      e.ops.forEach(collect);
      return (e.nops > 0 && visit(e.ops[e.nops - 1])) || returns.some(visit);
    }
    if (h === 'If') return e.ops.slice(1).some(visit);
    if (h === 'Which') return e.ops.filter((_, i) => i % 2 === 1).some(visit);
    if (h === 'List' || h === 'Tuple') return e.ops.some(visit);
    const named = blockLocalsNamed(h);
    if (named.length > 0)
      return named.some((local) =>
        local.values.some(
          (v) => isFunction(v, 'Function') && v.nops > 0 && visit(v.ops[0])
        )
      );
    return isFunctionType(e.type.type);
  };
  return visit(expr);
}

/**
 * True when a value of type `t` could be, or hold, a function: anything
 * but a number, a boolean, a string or a collection of those. `unknown`
 * and `any` could.
 */
export function mayHoldFunctionType(t: Type): boolean {
  const r = resolveTypeForCompilation(stripMissingFromType(t));
  if (r === 'never') return false;
  return ![
    'number',
    'boolean',
    'string',
    'collection<number>',
    'collection<boolean>',
    'collection<string>',
    'collection<collection<number>>',
  ].some((safe) => isSubtype(r, safe));
}

/**
 * True when `root` has a node with an effect of its own: a node that is
 * not pure while its operands are (`Random()`, a host call). An
 * assignment and a jump are not counted: they change only the state of
 * the run. Neither is a call of a function that the block assigns.
 */
export function hasEffectNode(root: Expression): boolean {
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (!isFunction(e) || seen.has(e)) return false;
    seen.add(e);
    if (e.ops.some(visit)) return true;
    // A call of a function that the block assigns has the effects of its
    // body, which is walked where the function is assigned.
    return (
      e.isPure === false &&
      ![
        'Assign',
        'Declare',
        'Break',
        'Continue',
        'Return',
        'Function',
      ].includes(e.operator) &&
      blockLocalsNamed(e.operator).length === 0 &&
      e.ops.every((op) => op.isPure !== false)
    );
  };
  return visit(root);
}

/**
 * The JavaScript code `js` of the whole result of `expr`, with a catch of
 * the run-wide marker `_SYS.noValue` when a comparison of the compilation
 * can throw it (`poisonSlot`): the run then gives the absence marker of
 * its result, NaN for a number and `undefined` otherwise. Unchanged when
 * no comparison throws it. Clears the record.
 */
export function catchNoValue(expr: Expression, js: string): string {
  if (!CompilerState._noValueUsed) return js;
  CompilerState._noValueUsed = false;
  const r = resolveTypeForCompilation(stripMissingFromType(expr.type.type));
  const absent =
    r !== 'never' && r !== 'unknown' && r !== 'any' && isSubtype(r, 'number')
      ? 'NaN'
      : 'undefined';
  return (
    `(() => { try { return ${js}; } catch (_noValue) { ` +
    `if (_noValue === _SYS.noValue) return ${absent}; throw _noValue; } })()`
  );
}

/** Forget a record of `_SYS.noValue` (`catchNoValue`) of a compilation
 * whose code is not used. */
export function clearNoValue(): void {
  CompilerState._noValueUsed = false;
}

/**
 * True when `unsuppliedComparisonGuard` lowers a comparison over `args`:
 * each operand is a scalar (`scalarOperandKind`), or an operand of a top
 * type that may hold a list at run time and compiles to the run-time
 * dispatch (a call of a block-local function, `gg(1)`). A symbol that is
 * a constant (`Undefined`) is not such an operand.
 */
export function guardTakesOperands(args: ReadonlyArray<Expression>): boolean {
  return args.every(
    (a) =>
      scalarOperandKind(a) !== undefined ||
      (!(isSymbol(a) && a.isConstant) &&
        isTopTypedOperand(a) &&
        isPossiblyCollectionTyped(a))
  );
}

/**
 * A chain `h(args)` as the three-valued `And` of its pairs, evaluated in
 * order as the interpreter evaluates it: each operand that is not a
 * literal or a symbol is bound to a temporary just before the first pair
 * that reads it, inside the branch where the pairs before it are not
 * `false`. So an operand with effects is evaluated once, after an
 * undecided pair too, and never after a pair that is `false`. Each pair
 * is the comparison of two operands, with its own tests
 * (`unsuppliedComparisonGuard`):
 * `((_l) => _l === false ? false : ((_r) => _l === true ? _r : (_r ===
 * false ? false : undefined))(rest))(pair)`.
 */
export function lazyChain(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** The chain is a branch condition that reads a block local
   * (`poisonSlot`): so are its pairs. */
  condition = false
): string {
  const ce = args[0].engine;
  const atomic = (a: Expression) => isSymbol(a) || isNumber(a) || isString(a);
  // Bind `a` to a temporary around `body` (which may read it through its
  // alias), unless it is a literal or a symbol.
  const bound = (a: Expression, body: () => string): string => {
    if (atomic(a) || _codeAliases.has(a)) return body();
    const code = compileValueOperand(a, target);
    const temp = tempVar(target);
    _codeAliases.set(a, temp);
    try {
      return target.bindExpr!([[temp, code]], body());
    } finally {
      _codeAliases.delete(a);
    }
  };
  const from = (i: number): string =>
    bound(args[i], () => {
      const link = ce._fn(h, [args[i - 1], args[i]]);
      if (condition) CompilerState._poisonConditions.add(link);
      const pair = core.compile(link, target);
      if (i === args.length - 1) return pair;
      const l = tempVar(target);
      const r = tempVar(target);
      return (
        `((${l}) => ${l} === false ? false : ((${r}) => ${l} === true ? ${r} : ` +
        `(${r} === false ? false : undefined))(${from(i + 1)}))(${pair})`
      );
    });
  return bound(args[0], () => from(1));
}

/**
 * The tests-first form of `unsuppliedComparisonGuard`:
 * `((tests) ? (cmp) : undefined)`, the comparison emitted with the reads
 * marked as tested (`withPresentReads`). An operand with effects (a
 * `Random` draw) is evaluated by the interpreter whether or not the
 * comparison has a value, so then the comparison runs first and its
 * value is bound, then tested: `((_tv1) => (tests) ? _tv1 : undefined)(cmp)`.
 */
export function testsFirst(
  args: ReadonlyArray<Expression>,
  reads: ReadonlyArray<{ code: string }>,
  tests: string,
  target: CompileTarget<Expression>,
  emit: () => string,
  /** The value when the tests fail (`poisonSlot`). */
  otherwise = 'undefined'
): string {
  const emitBare = (): string => {
    _guardEmitting.add(args);
    try {
      return emit();
    } finally {
      _guardEmitting.delete(args);
    }
  };
  if (args.some((a) => a.isPure !== true) && target.bindExpr !== undefined) {
    const temp = tempVar(target);
    return target.bindExpr(
      [[temp, emitBare()]],
      `((${tests}) ? ${temp} : ${otherwise})`
    );
  }
  const body = withPresentReads(
    target,
    reads.map((r) => r.code),
    emitBare
  );
  return `((${tests}) ? (${body}) : ${otherwise})`;
}

/** True when the type of `a` is a top type (`unknown`, `any`), apart
 * from `missing`. */
export function isTopTypedOperand(a: Expression): boolean {
  const t = resolveTypeForCompilation(stripMissingFromType(compilationType(a)));
  return t === 'unknown' || t === 'any';
}

/** True when `a` is the number literal NaN. */
export function isNanLiteral(a: Expression): boolean {
  return isNumber(a) && Number.isNaN(a.re) && a.im === 0;
}

/**
 * The kind of a scalar comparison operand, for
 * `unsuppliedComparisonGuard`: `'number'` for a number literal, an
 * operand of a numeric type, or an operand of type `unknown`/`any` (an
 * undeclared variable, which compiles to the scalar comparison; not a
 * constant symbol such as the written absence `Undefined`);
 * `'other'` for a string or a boolean; `undefined` for any other type (a
 * collection), which keeps its own lowering.
 */
export function scalarOperandKind(
  a: Expression
): 'number' | 'other' | undefined {
  if (isNumber(a)) return 'number';
  if (isString(a)) return 'other';
  const t = resolveTypeForCompilation(stripMissingFromType(compilationType(a)));
  // A written absence (`Undefined`, `Missing`) or another constant symbol
  // of a top type is not a variable: it keeps its own lowering
  // (`absentComparisonGuard`).
  // An operand that may hold a list at run time (a top-typed application
  // such as `Sin(y)` with `y` a top-typed block local,
  // `isPossiblyCollectionTyped`) compiles to the element-wise broadcast,
  // not to the scalar comparison, and keeps that lowering too.
  if (t === 'unknown' || t === 'any')
    return (isSymbol(a) &&
      (a.symbol === 'Undefined' || a.symbol === 'Missing' || a.isConstant)) ||
      isPossiblyCollectionTyped(a)
      ? undefined
      : 'number';
  if (t === 'never') return undefined;
  if (isSubtype(t, 'number')) return 'number';
  if (isSubtype(t, 'number | boolean | string')) return 'other';
  return undefined;
}

/**
 * The operators whose JavaScript lowering reads an absent (`undefined`)
 * or NaN operand as NaN: arithmetic and the elementary functions
 * (`undefined + 1`, `Math.sin(undefined)` and `Math.max(undefined, 1)` are
 * `NaN`). `Boole`, `Count`, `Length` and the like read an absent value
 * as a number, so they are not here.
 */
export const ABSENCE_AS_NAN_OPERATORS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'Exp',
  'Ln',
  'Log',
  'Lb',
  'Lg',
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Sinh',
  'Cosh',
  'Tanh',
  'Abs',
  'Sign',
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Max',
  'Min',
]);

/**
 * True when the compiled value of the comparison operand `a` is NaN or
 * `undefined` whenever a variable it reads is absent: a literal, a
 * variable, or an `ABSENCE_AS_NAN_OPERATORS` application of such operands.
 * Then a comparison over `a` cannot be `true` for an absent read, and may
 * run before the tests for one (`unsuppliedComparisonGuard`).
 *
 * A symbol that stands for a value is read through that value: a block
 * local through every value the block assigns to it (`blockLocalOf`), a
 * symbol with an engine value through that value. `a := Boole(x > 0)`,
 * then `a = 0`, is `true` for an absent `x`, so it does not qualify.
 * `Max` and `Min` qualify only over scalar operands: over a list the
 * lowering reads the list (`Max(L)` with `L` absent throws).
 *
 * A value can read its own local (`a := a + n` in a loop), or another
 * local that reads it back. The answers are therefore computed over the
 * whole graph of the symbols reachable from `a`: each symbol's values are
 * walked once, which records whether they qualify apart from the symbols
 * they read, and which symbols those are. A symbol whose own values do
 * not qualify is `false`, and so is every symbol that reads it, found by
 * following the readers back. Every other symbol is `true` (the greatest
 * fixpoint: `a := a + n` qualifies). Each node is read once per walk, and
 * each symbol once, so the cost is linear in the reachable values. The
 * answer of a local is final and is cached on it.
 */
export function readsAbsenceAsNaN(a: Expression): boolean {
  type Key = LocalEntry | string;
  const valuesOf = new Map<Key, ReadonlyArray<Expression>>();
  const keyOf = (e: Expression & { symbol: string }): Key | undefined => {
    const local = blockLocalOf(e);
    if (local !== undefined) {
      valuesOf.set(local, local.values);
      return local;
    }
    const value = e.engine._getSymbolValue(e.symbol);
    if (value === undefined) return undefined;
    valuesOf.set(e.symbol, [value]);
    return e.symbol;
  };
  // Whether `root` qualifies apart from the symbols it reads, which are
  // added to `refs`. A local whose answer is already known counts as
  // that answer.
  const walk = (root: Expression, refs: Set<Key>): boolean => {
    const memo = new Map<Expression, boolean>();
    const read = (e: Expression): boolean => {
      const known = memo.get(e);
      if (known !== undefined) return known;
      let answer: boolean;
      if (isNumber(e) || isString(e)) answer = true;
      else if (isSymbol(e)) {
        const key = keyOf(e);
        if (key === undefined) answer = true;
        else if (typeof key === 'object' && key.absenceAsNaN !== undefined)
          answer = key.absenceAsNaN;
        else {
          refs.add(key);
          answer = true;
        }
      } else if (!isFunction(e) || !ABSENCE_AS_NAN_OPERATORS.has(e.operator))
        answer = false;
      else if (
        (e.operator === 'Max' || e.operator === 'Min') &&
        !e.ops.every(
          (op) =>
            isNumber(op) ||
            (isSubtype(compilationType(op), 'number') &&
              !isPossiblyCollectionTyped(op))
        )
      )
        answer = false;
      else answer = e.ops.every(read);
      memo.set(e, answer);
      return answer;
    };
    return read(root);
  };
  const rootRefs = new Set<Key>();
  if (!walk(a, rootRefs)) return false;
  // Every symbol reachable from `a`, with its own verdict and its readers.
  const own = new Map<Key, boolean>();
  const readers = new Map<Key, Key[]>();
  const work = [...rootRefs];
  const met = new Set<Key>(work);
  while (work.length > 0) {
    const key = work.pop()!;
    const refs = new Set<Key>();
    own.set(
      key,
      valuesOf.get(key)!.every((v) => walk(v, refs))
    );
    for (const r of refs) {
      const list = readers.get(r);
      if (list === undefined) readers.set(r, [key]);
      else list.push(key);
      if (!met.has(r)) {
        met.add(r);
        work.push(r);
      }
    }
  }
  // A `false` reaches every symbol that reads it.
  const answer = new Map(own);
  const falses = [...met].filter((k) => !answer.get(k));
  while (falses.length > 0) {
    const k = falses.pop()!;
    for (const reader of readers.get(k) ?? [])
      if (answer.get(reader)) {
        answer.set(reader, false);
        falses.push(reader);
      }
  }
  for (const [key, value] of answer)
    if (typeof key === 'object') key.absenceAsNaN = value;
  return [...rootRefs].every((k) => answer.get(k));
}

/**
 * Run `fn` with each operand of `operands` bound once to a temporary, in
 * operand order: `compile()` emits the temporary for it (`_codeAliases`),
 * and the result is wrapped in the bindings (`bindExpr`). The
 * initializers are compiled before any alias is installed. When `parent`
 * is the node whose operands these are, each initializer is compiled in
 * the CSE region of its operand edge (`withCseOperand`), so a repeated
 * subexpression inside it is still bound once.
 */
export function withBoundOperands(
  operands: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  fn: () => string,
  parent?: Expression
): string {
  if (operands.length === 0) return fn();
  const parentOps =
    parent !== undefined && isFunction(parent) ? parent.ops : undefined;
  const codes = operands.map((a) => {
    const index = parentOps?.indexOf(a) ?? -1;
    const compileIt = () => compileValueOperand(a, target);
    return index < 0
      ? compileIt()
      : withCseOperand(parent, index, target, compileIt);
  });
  const temps = operands.map(() => tempVar(target));
  try {
    operands.forEach((a, i) => _codeAliases.set(a, temps[i]));
    return target.bindExpr!(
      operands.map((_, i) => [temps[i], codes[i]] as [string, string]),
      fn()
    );
  } finally {
    for (const a of operands) _codeAliases.delete(a);
  }
}

/**
 * True when a NaN value of the numeric operand `a` decides a comparison
 * while a tested read `reads` has no value: one of the reads is not a
 * read of `a` itself.
 */
export function nanCanDecide(
  a: Expression,
  reads: ReadonlyArray<{ code: string }>,
  target: CompileTarget<Expression>
): boolean {
  if (scalarOperandKind(a) !== 'number' || core.isComplexValued(a))
    return false;
  const own = operandInputNodes(a, target).map((s) => core.compile(s, target));
  return reads.some((r) => !own.includes(r.code));
}

/**
 * The presence tests of a comparison `h(args)` (`reads`), with the
 * escapes that decide it while another variable has no value:
 * `(_.x !== undefined && _.y !== undefined) || _.x !== _.x`. The escapes
 * are read only when a test fails (`||`), so a call with every variable
 * supplied pays none of them.
 *
 * - An operand that is a numeric vars-object read is NaN-tested as it is
 *   (`_.x !== _.x`), whether or not its own read is tested here: a read
 *   that an enclosing branch tested still holds its NaN.
 * - Any other operand that `nanCanDecide` admits (a local such as `a` in
 *   `a := n + 1; a < m`, a parameter, a computed operand) is NaN-tested
 *   only when its own reads are present, since an absent read makes it
 *   NaN too: `(_.n !== undefined && a !== a)`. A computed operand is
 *   tested through its temporary when a chain bound it
 *   (`withBoundOperands`); otherwise its code is repeated in the escape,
 *   which is safe because it is pure, and costs only on the call that
 *   reaches the escape. An operand with effects is not tested.
 * - For an ordering, a complex operand that is not real decides `false`
 *   (`Less(√n, m)` at `n = -1`): `(_.n !== undefined &&
 *   !_SYS.cisreal(…))` (`complexIsReal` of the target). Not for `Equal`
 *   and `NotEqual`, where `i = m` has no value while `m` has none.
 */
export function withNanTerms(
  h: string,
  args: ReadonlyArray<Expression>,
  reads: ReadonlyArray<{ code: string; test: string }>,
  target: CompileTarget<Expression>,
  parent?: Expression
): string {
  const joined = reads.map((r) => r.test).join(' && ');
  const unique = nanEscapeTerms(
    h,
    args,
    reads.map((r) => r.code),
    target,
    parent
  );
  if (unique.length === 0) return joined;
  return `(${joined}) || ${unique.join(' || ')}`;
}

/**
 * The escapes of `withNanTerms`: one term per operand of `h(args)` whose
 * value decides the comparison while one of the tested reads `reads` (their
 * codes) has no value. Shared by the comparison whose value is the result
 * and by a branch condition (`withNanEscape`).
 */
export function nanEscapeTerms(
  h: string,
  args: ReadonlyArray<Expression>,
  readCodes: ReadonlyArray<string>,
  target: CompileTarget<Expression>,
  parent?: Expression
): string[] {
  const reads = readCodes.map((code) => ({ code }));
  const terms: string[] = [];
  const ordering = h !== 'Equal' && h !== 'NotEqual';
  const parentOps =
    parent !== undefined && isFunction(parent) ? parent.ops : undefined;
  const codeOf = (a: Expression): string => {
    if (isSymbol(a) || _codeAliases.has(a)) return core.compile(a, target);
    const index = parentOps?.indexOf(a) ?? -1;
    const compileIt = () => compileValueOperand(a, target);
    return index < 0
      ? compileIt()
      : withCseOperand(parent, index, target, compileIt);
  };
  const ownPresent = (a: Expression): string[] =>
    operandInputNodes(a, target)
      .map((s) => core.compile(s, target))
      .filter((c) => isOmittableRead(c, target))
      .map((c) => `${c} !== undefined`);
  const term = (own: string[], escape: string): string =>
    own.length === 0 ? escape : `(${own.join(' && ')} && ${escape})`;
  for (const a of args) {
    if (isNumber(a)) continue;
    const pureOrBound = isSymbol(a) || a.isPure === true || _codeAliases.has(a);
    if (!pureOrBound) continue;
    if (core.isComplexValued(a)) {
      if (!ordering || target.complexIsReal === undefined) continue;
      const own = ownPresent(a);
      if (!reads.some((r) => !own.includes(`${r.code} !== undefined`)))
        continue;
      terms.push(term(own, `!${target.complexIsReal(codeOf(a))}`));
      continue;
    }
    if (!nanCanDecide(a, reads, target)) continue;
    const code = codeOf(a);
    if (isSymbol(a) && isVarsObjectRead(code, target)) {
      terms.push(`${code} !== ${code}`);
      continue;
    }
    terms.push(term(ownPresent(a), `(${code}) !== (${code})`));
  }
  return [...new Set(terms)];
}

/**
 * The lowering of a scalar comparison `h(args)` (`<`, `≤`, `>`, `≥`, `=`,
 * `≠`, chained or not) with an operand that may be absent at run time, or
 * `undefined` when no operand may be absent, or the target has no object
 * absence (the GPU targets: there an absent number is `NaN`, and the
 * comparison reads it with IEEE arithmetic).
 *
 * A comparison with an absent operand is absent (`Missing`) in the
 * interpreter, in a numeric slot (`number | missing`) too (user decision
 * 2026-10-23, ROADMAP CE-93). The host passes an absent value as the
 * target's absent object (`undefined` in JavaScript, `None` in Python),
 * where the comparison operators would answer `false` (JavaScript) or
 * raise (Python). The operands are bound to temporaries, in operand order,
 * so each is evaluated once, and the comparison is the absent object when
 * one that may be absent is. Such an operand read from the host is absent
 * when it is the absent object: a `NaN` there is a value, and keeps the
 * IEEE reading (`false`), as in the interpreter (ROADMAP CE-386 reads it
 * so in `Equal`). A computed one (a nested `If` with no else branch) is
 * absent when it is `NaN`, the absence marker of compiled numeric code. A
 * chain is the `And` of its links, each guarded, so a link that is `false`
 * decides it, as in the interpreter; a chain with an impure operand keeps
 * the ordinary lowering.
 */
export function absentComparisonGuard(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  emit: () => string
): string | undefined {
  const object = target.absence?.object;
  if (object === undefined || target.bindExpr === undefined) return undefined;
  if (
    h !== 'Less' &&
    h !== 'LessEqual' &&
    h !== 'Greater' &&
    h !== 'GreaterEqual' &&
    h !== 'Equal' &&
    h !== 'NotEqual'
  )
    return undefined;
  const mayBeAbsent = (a: Expression): boolean => {
    if (_codeAliases.has(a)) return false;
    const t = compilationType(a);
    return typeContainsMissing(t) && numericMissingSlot(t);
  };
  if (!args.some(mayBeAbsent)) return undefined;
  // Scalar numbers only: a collection operand keeps its own lowering
  // (element-wise, or the whole-collection equality of a chain).
  if (
    !args.every(
      (a) => isNumber(a) || isSubtype(compilationType(a), 'number | missing')
    )
  )
    return undefined;
  // A chain (`0 < w < 2`) is the `And` of its links, each guarded on its
  // own: the interpreter stops at the first link that is `False`, so
  // `Less(5, 0, w)` is `False` with `w` absent, and the connective reads
  // an absent link by the Kleene rule (`guardConnectiveAbsence`). An
  // operand shared by two links is read twice, so the chain is compiled
  // this way only when every operand is pure. With an impure operand the
  // chain does not compile: the interpreter evaluates the operands in
  // order and goes on past an absent link, which neither this form nor the
  // ordinary lowering reproduces.
  if (args.length > 2) {
    if (args.some((a) => a.isPure !== true))
      throw new Error(
        `Could not compile \`${h}\`: a chained comparison with an operand ` +
          `that may be absent and an operand with an effect. The ` +
          `interpreter evaluates it instead.`
      );
    const ce = args[0].engine;
    const links = args.slice(1).map((b, i) => ce._fn(h, [args[i], b]));
    return core.compile(ce._fn('And', links), target);
  }
  // Every operand that is not a literal is bound, in operand order, so each
  // is evaluated once and in the interpreter's order, also when another one
  // is absent. The initializers are compiled before any alias is installed:
  // an alias in scope while a later initializer compiles would name a
  // temporary that the initializer cannot see. A node that is both
  // operands (`w = w`) is bound once, which is right for a pure one. An
  // impure one is evaluated each time it appears in the interpreter, and
  // the temporary of a node cannot stand for two evaluations of it, so
  // that comparison does not compile.
  const operands: Expression[] = [];
  for (const a of args) {
    if (isNumber(a)) continue;
    if (operands.includes(a)) {
      if (a.isPure !== true)
        throw new Error(
          `Could not compile \`${h}\`: the same operand with an effect ` +
            `appears twice beside an operand that may be absent. The ` +
            `interpreter evaluates it instead.`
        );
      continue;
    }
    operands.push(a);
  }
  const codes = operands.map((a) => compileValueOperand(a, target));
  const temps = operands.map(() => tempVar(target));
  // A symbol (an input, a parameter, a local) is absent when it is the
  // target's absent object (`undefined`, `None`): a `NaN` there is a
  // value, and keeps the IEEE reading, as in the interpreter (ROADMAP
  // CE-386 reads it so in `Equal`). A computed value that may be absent
  // (an `If` with no else branch) is `NaN` in compiled numeric code when
  // it is absent, so it is tested with the target's numeric absence test,
  // as the condition of a branch tests it (`operandDecidedConjuncts`). A
  // local that holds such a computed value is read as a symbol: that case
  // is not told apart.
  const tests = operands.flatMap((a, i) => {
    if (!mayBeAbsent(a)) return [];
    if (isSymbol(a)) return [object.isAbsent(temps[i])];
    const numeric = target.absence?.numeric.isAbsent;
    return [numeric ? numeric(temps[i]) : object.isAbsent(temps[i])];
  });
  try {
    // An alias (not an override): the analyses still read the operand as
    // it is, so a complex operand keeps the realness rule of the head.
    operands.forEach((a, i) => _codeAliases.set(a, temps[i]));
    const body = emit();
    const absent = tests.join(target.language === 'python' ? ' or ' : ' || ');
    return target.bindExpr(
      operands.map((_, i) => [temps[i], codes[i]] as [string, string]),
      target.language === 'python'
        ? `(${object.nullLiteral} if (${absent}) else (${body}))`
        : `((${absent}) ? ${object.nullLiteral} : (${body}))`
    );
  } finally {
    for (const a of operands) _codeAliases.delete(a);
  }
}

/**
 * Is the `missing` arm of the type of `expr` there only because an operand
 * is a number that may be absent (`number | missing`)? True for a
 * comparison whose operands with a `missing` arm are all such numbers, and
 * for `And`, `Or`, `Not` and `Xor` of operands that are each such a
 * comparison or have no `missing` arm.
 *
 * A comparison with an absent operand is `Missing` in the interpreter
 * (ROADMAP CE-93), so its type has a `missing` arm. On a target with no
 * object domain (the GPU targets), an absent number IS `NaN`, and the
 * comparison reads it with IEEE arithmetic (`false`), as it did before:
 * such a comparison still compiles there, with no guard.
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
  // The vars-object reads the conjuncts test: the comparison below is
  // emitted inside that test, so it does not test them again
  // (`unsuppliedComparisonGuard`).
  const tested: string[] = [];
  try {
    const conjuncts: TargetSource[] = [];
    for (const op of test.operands) {
      const code = core.compile(op, target);
      const present = operandMayBeAbsent(op)
        ? (x: TargetSource) => `${dialect.not}(${dialect.isUndecided(x)})`
        : undefined;
      const inline = operandDecidedConjuncts(
        code,
        target,
        dialect.decidedNumber,
        present,
        op
      );
      // No test at all: the operand is a constant the compiler already
      // folded, so it decides every comparison it takes part in.
      if (inline.length === 0) continue;
      if (isOmittableRead(code, target)) tested.push(code);
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
        ...operandDecidedConjuncts(name, target, dialect.decidedNumber, present)
      );
    }
    const compare = withPresentReads(target, tested, () =>
      core.compile(test.expr, target)
    );
    const value = negate ? `${dialect.not}(${compare})` : `(${compare})`;
    // A NaN operand decides the relation even while another variable has
    // no value (`withNanEscape`); JavaScript family only, the spelling of
    // the escape.
    const tests =
      dialect === CONDITION_DIALECT_JS && isFunction(test.expr)
        ? withNanEscape(test.expr.ops, conjuncts, target)
        : conjuncts;
    const body =
      tests.length === 0
        ? value
        : dialect.ternary(
            tests.join(` ${dialect.and} `),
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
  // The vars-object reads the conjuncts test: `fn` emits the condition
  // inside that test, so a comparison in it does not test them again
  // (`unsuppliedComparisonGuard`).
  const tested: string[] = [];
  try {
    const conjuncts: TargetSource[] = [];
    for (const op of operands) {
      const code = core.compile(op, target);
      const present = operandMayBeAbsent(op)
        ? (x: TargetSource) => `${dialect.not}(${dialect.isUndecided(x)})`
        : undefined;
      const inline = operandDecidedConjuncts(
        code,
        target,
        dialect.decidedNumber,
        present,
        op
      );
      // No test at all: the operand is a constant the compiler already
      // folded, so it decides every comparison it takes part in.
      if (inline.length === 0) continue;
      if (isOmittableRead(code, target)) tested.push(code);
      if (!canBind || ATOMIC_FRAGMENT.test(code) || _codeOverrides.has(op)) {
        conjuncts.push(...inline);
        continue;
      }
      const name = tempVar(target);
      bindings.push([name, code]);
      _codeOverrides.set(op, name);
      installed.push(op);
      conjuncts.push(
        ...operandDecidedConjuncts(name, target, dialect.decidedNumber, present)
      );
    }
    return {
      value: withPresentReads(target, tested, () => fn(conjuncts)),
      bindings,
    };
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
    (conjuncts) => ({
      code: core.compile(cond, target),
      // A NaN operand decides the relation even while another variable
      // has no value (`withNanEscape`). The escape reads the operands of
      // the relation the analysis tested (`decidability.test.expr`), not
      // of `cond`, which may be a `Not` of it: `If(Not(x < y), 1, 2)` at
      // `x = NaN` takes the first arm, as in the interpreter.
      conjuncts: isFunction(decidability.test.expr)
        ? withNanEscape(decidability.test.expr.ops, conjuncts, target)
        : conjuncts,
    }),
    CONDITION_DIALECT_JS
  );
  return { ...value, bindings, negate: false };
}

/**
 * The names of the caller inputs of `expr` (`refs`, the names that the
 * code reads off the vars object) that the code iterates, spreads,
 * reduces or indexes as a collection. The JavaScript runner tests each one
 * at entry: when the caller leaves one out, the run has no value
 * (`checkEntry` and `entryNoValue` in `javascript-runtime.ts`).
 *
 * A name is in the list when a symbol of that name, whose type is a
 * collection with no `missing` arm (`list<number>`, `matrix<real>`,
 * `string`), is:
 * - the domain of an `Element` clause: the source of a `Loop`, of a
 *   `Comprehension`, of a big operator, or the collection of a membership
 *   test;
 * - an operand of an operator that reads a whole collection: an operator
 *   whose missing-value behavior is `propagate`, at a position where it
 *   propagates (`Length`, `Map`, `Join`, `Take`, `Determinant`), an
 *   operator that handles or passes through a `missing` operand and is
 *   not lazy (`First`, `At`, `Max`, `Mean`), and the one-operand `Sum`
 *   and `Product`.
 *
 * A read is not counted when:
 * - an element-wise (broadcastable) operator makes it (`L + 1`): its
 *   lowering gives `undefined` for an absent operand;
 * - an operator only holds the value (`COLLECTION_HOLDING_HEADS`), or a
 *   control-flow head reads it (`Assign`, `Block`, `If`);
 * - a binder around the read binds the name. The binders are the
 *   parameters of a function literal, for its body, and the indices of
 *   the clauses of a `Sum`, `Product`, `Integrate`, `Loop` or
 *   `Comprehension`: its body sees every index, the collection of a clause
 *   is read outside the clause (in a `Comprehension`, it sees the indices
 *   of the clauses before it), and the conditions of a clause see its own
 *   index. A parameter `L` of one function does not hide a free `L`
 *   elsewhere in the expression. These scopes are those of
 *   `analyzeReferences`, with two differences: the variable of an
 *   indefinite `Integrate(…, Limits(x, Nothing, Nothing))` is bound here,
 *   where `analyzeReferences` reports it as a free input (it is a number,
 *   never a collection input); and a block local is not a binder here,
 *   it goes through the rule for assigned names below.
 *
 * A test for an absent value does not exempt an input. With
 * `If(IsMissing(L), 0, Sum(L))`, `L` is required: the run has no value
 * without `L`, where the interpreter gives 0 for `L` = `Missing` (the
 * value that an absent input stands for). The runner does not know
 * which branch the run takes, and a compiled result must never be a value
 * that the interpreter does not give. An input that the code only tests
 * (`IsMissing(L)`) has no counted read and is not required.
 *
 * Three cases reach a caller input through another name:
 * - the body of a user function that the expression calls, or passes as
 *   a callback, is walked as part of the expression: an engine-assigned
 *   function (`userFunctionLiteral`) and a block-local function literal.
 *   Each body is walked once, in its own scope, with its parameters bound.
 *   With `k := t ↦ Sum(y)`, `f(k(1))` requires `y`;
 * - the value of a symbol that the compiler folds into the code (an
 *   engine-assigned value, `S := Sum(L)`) is walked as part of the
 *   expression, once per symbol: `S + 1` requires `L`. The value is
 *   walked with no name bound, so a name in it counts as free: that can
 *   require an input that a binder around the folded symbol shadows,
 *   which is stricter, and allowed;
 * - a name that the expression assigns (a block local `M`, or an input
 *   that the code writes) and iterates requires each caller collection
 *   input that a value assigned to it reads, at any depth: with `M ≔ L`,
 *   `Length(M)` requires `L`. The rule follows a local through the
 *   locals it is assigned from. It applies also to a bound name that the
 *   code assigns: with a parameter `M`, a body `M ≔ L; Length(M)`
 *   requires `L`. It is conservative: it requires `L` also when a later
 *   assignment replaces the value of `M` before the read, and it puts
 *   together the values of every variable of the same name.
 *
 * Each of these rules can require an input that the run does not reach,
 * and the run then has no value where the interpreter has one
 * (`entryNoValue` in `javascript-runtime.ts`). That is stricter, which is
 * allowed (user decision 2026-10-30).
 */
export function collectionReadInputs(
  expr: Expression,
  refs: ReadonlySet<string> | undefined
): string[] {
  if (refs === undefined || refs.size === 0) return [];
  const engine = expr.engine;
  // The scopes that each node was walked in, by a key: a node that is
  // reached again with the same key adds nothing. The key is the set of
  // the bound names that occur in the subtree of the node (`subtreeNames`),
  // sorted and joined. Only those names change what the walk of the node
  // finds: it tests the scope only for a symbol of the subtree, and the
  // walks that start from the node into a user-function body or a folded
  // value start in their own empty scope. Neither the identity of the
  // scope nor its whole content is a key that stays small: a binder makes
  // a new scope at each visit, and in an expression that shares a subtree
  // under several binders (a DAG), each path gives another scope, so such
  // a key walks the shared subtree once per path, an exponential count.
  const seen = new Map<Expression, Set<string>>();
  const rootScope: ReadonlySet<string> = new Set<string>();
  // The names of the symbols in the subtree of each node, computed once
  // per node.
  const namesMemo = new Map<Expression, ReadonlySet<string>>();
  const noNames: ReadonlySet<string> = new Set<string>();
  const subtreeNames = (e: Expression): ReadonlySet<string> => {
    const known = namesMemo.get(e);
    if (known !== undefined) return known;
    let names: ReadonlySet<string> = noNames;
    if (isSymbol(e)) names = new Set([e.symbol]);
    else if (isFunction(e)) {
      const all = new Set<string>();
      for (const op of e.ops) for (const n of subtreeNames(op)) all.add(n);
      if (all.size > 0) names = all;
    }
    namesMemo.set(e, names);
    return names;
  };
  const scopeKey = (e: Expression, scope: ReadonlySet<string>): string => {
    if (scope.size === 0) return '';
    const names = subtreeNames(e);
    const inside: string[] = [];
    for (const n of scope) if (names.has(n)) inside.push(n);
    return inside.sort().join('\u0000');
  };
  // The names that the expression assigns (`Assign`, `Declare`).
  const assigned = new Set<string>();
  // The free names that the code iterates, spreads, reduces or indexes.
  const iterated = new Set<string>();
  // The bound names (a parameter, an index) that the code iterates: when
  // the code also assigns such a name (`M ≔ L` in the body of a function
  // with the parameter `M`), the inputs that its assigned values read are
  // required.
  const iteratedBound = new Set<string>();
  // The names of the symbols of the expression whose type is a collection
  // with no `missing` arm.
  const collections = new Set<string>();
  // For a name that the expression assigns, free or bound, the names of the
  // symbols that its assigned values read. The values of every variable of
  // that name are put together, which is stricter, and allowed.
  const copies = new Map<string, Set<string>>();
  // The folded symbols whose value was walked.
  const foldedSeen = new Set<string>();
  // The names that a value reads are taken whatever binds them: a bound
  // name that is also an input counts as the input, which is stricter.
  const recordCopy = (target: Expression | undefined, value: Expression) => {
    if (target === undefined || !isSymbol(target)) return;
    let names = copies.get(target.symbol);
    if (names === undefined) copies.set(target.symbol, (names = new Set()));
    // Each node once: a value built from shared subtrees has few distinct
    // nodes but exponentially many paths.
    const visited = new Set<Expression>();
    const read = (x: Expression): void => {
      if (visited.has(x)) return;
      visited.add(x);
      if (isSymbol(x)) names!.add(x.symbol);
      else if (isFunction(x)) x.ops.forEach(read);
    };
    read(value);
  };
  const union = (
    scope: ReadonlySet<string>,
    more: ReadonlyArray<string>
  ): ReadonlySet<string> => {
    if (more.length === 0) return scope;
    const s = new Set(scope);
    for (const m of more) s.add(m);
    return s;
  };
  // The names that the index of a clause binds (a symbol, or the leaves
  // of a destructuring tuple).
  const indexNames = (p: Expression | undefined): string[] => {
    if (p === undefined) return [];
    if (isSymbol(p)) return p.symbol === '_' ? [] : [p.symbol];
    if (isFunction(p, 'Tuple')) return tuplePatternNames(p);
    return [];
  };
  // The literal of the user function `id`, or `undefined`. A literal that
  // cannot be compiled (`userFunctionLiteral` refuses it) is not walked:
  // the compilation declines in that case anyway.
  const userLiteral = (id: string): Expression | undefined => {
    try {
      return userFunctionLiteral(engine, id);
    } catch {
      return undefined;
    }
  };
  const isCollectionInput = (
    e: Expression
  ): e is Expression & {
    symbol: string;
  } => {
    if (!isSymbol(e)) return false;
    const t = e.type.type;
    if (typeContainsMissing(t)) return false;
    const r = resolveTypeForCompilation(t);
    return (
      r !== 'never' &&
      r !== 'unknown' &&
      r !== 'any' &&
      isSubtype(r, 'collection')
    );
  };
  // A read of a collection whose name no binder around it binds. A read of
  // a bound name is recorded in `iteratedBound`.
  const isFreeCollection = (
    e: Expression,
    scope: ReadonlySet<string>
  ): e is Expression & { symbol: string } => {
    if (!isCollectionInput(e)) return false;
    if (!scope.has(e.symbol)) return true;
    iteratedBound.add(e.symbol);
    return false;
  };
  const visit = (e: Expression, scope: ReadonlySet<string>): void => {
    let scopes = seen.get(e);
    if (scopes === undefined) seen.set(e, (scopes = new Set()));
    const key = scopeKey(e, scope);
    if (scopes.has(key)) return;
    scopes.add(key);
    if (isSymbol(e)) {
      if (scope.has(e.symbol)) return;
      if (isCollectionInput(e)) collections.add(e.symbol);
      // A user function passed as a value (a callback of `Map`), walked
      // in its own scope.
      const literal = userLiteral(e.symbol);
      if (literal !== undefined) {
        visit(literal, rootScope);
        return;
      }
      // A symbol whose value the compiler folds into the code: the value
      // is read where the symbol is (`analyzeReferences`).
      const value = engine._getSymbolValue(e.symbol);
      if (value !== undefined && !foldedSeen.has(e.symbol)) {
        foldedSeen.add(e.symbol);
        visit(value, rootScope);
      }
      return;
    }
    if (!isFunction(e)) return;
    const h = e.operator;
    const ops = e.ops;
    {
      // A call of a user function: its body is part of the run, in its
      // own scope.
      const literal = userLiteral(h);
      if (literal !== undefined) visit(literal, rootScope);
    }
    if (h === 'Function') {
      visit(ops[0], union(scope, functionLiteralBoundNames(ops.slice(1))));
      return;
    }
    if (
      h === 'Sum' ||
      h === 'Product' ||
      h === 'Integrate' ||
      h === 'Loop' ||
      h === 'Comprehension'
    ) {
      // The scopes of `analyzeReferences`: the body sees every index; the
      // collection of a clause is read outside the clause (a clause of a
      // `Comprehension` sees the indices of the clauses before it); the
      // conditions of a clause see its own index.
      const indices: string[] = [];
      let earlier = scope;
      for (const clause of ops.slice(1)) {
        if (!isFunction(clause)) {
          visit(clause, scope);
          continue;
        }
        const names = indexNames(clause.ops[0]);
        indices.push(...names);
        const outer = h === 'Comprehension' ? earlier : scope;
        const own = union(outer, names);
        clause.ops.slice(1).forEach((sub, i) => {
          const subScope =
            clause.operator === 'Element' && i >= 1 ? own : outer;
          visit(sub, subScope);
          if (
            clause.operator === 'Element' &&
            i === 0 &&
            isFreeCollection(sub, subScope)
          )
            iterated.add(sub.symbol);
        });
        if (h === 'Comprehension') earlier = own;
      }
      if (ops[0] !== undefined) visit(ops[0], union(scope, indices));
      if (!(h === 'Sum' || h === 'Product') || ops.length !== 1) return;
    } else ops.forEach((op) => visit(op, scope));
    if (h === 'Assign' || h === 'Declare') {
      const value = h === 'Assign' ? ops[1] : declareValueOperand(ops);
      if (isSymbol(ops[0])) {
        if (!scope.has(ops[0].symbol)) assigned.add(ops[0].symbol);
        if (value !== undefined) recordCopy(ops[0], value);
      }
      return;
    }
    if (h === 'Element') {
      // A membership test: the collection is searched.
      if (ops[1] !== undefined && isFreeCollection(ops[1], scope))
        iterated.add(ops[1].symbol);
      return;
    }
    if (COLLECTION_HOLDING_HEADS.has(h)) return;
    const reduction = (h === 'Sum' || h === 'Product') && ops.length === 1;
    if (CONTROL_FLOW_HEADS.has(h) && !reduction) return;
    if (ABSENCE_DISCHARGING_HEADS.has(h)) return;
    const def = lookupApplicable(h, engine.context.lexicalScope);
    if (!isOperatorDef(def)) return;
    const operator = def.operator;
    if (operator.broadcastable && !reduction) return;
    const behavior = operator.resolvedMissingBehavior;
    const handles =
      (behavior === 'handle' || behavior === 'pass-through') && !operator.lazy;
    if (!reduction && !handles && behavior !== 'propagate') return;
    ops.forEach((op, i) => {
      if (
        isFreeCollection(op, scope) &&
        (reduction || handles || operator.stripsMissingAt(i))
      )
        iterated.add(op.symbol);
    });
  };
  visit(expr, rootScope);
  // A caller input that is iterated is required, unless the expression
  // assigns it. A name with assigned values (free or bound) is followed
  // through those values.
  const required = new Set<string>();
  const followed = new Set<string>();
  const resolve = (n: string): void => {
    if (followed.has(n)) return;
    followed.add(n);
    if (!assigned.has(n) && refs.has(n) && collections.has(n)) required.add(n);
    for (const m of copies.get(n) ?? []) resolve(m);
  };
  for (const n of iterated) resolve(n);
  for (const n of iteratedBound)
    for (const m of copies.get(n) ?? []) resolve(m);
  return [...required];
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
