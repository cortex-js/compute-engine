// If, Which and When expressions, Kleene value connectives, and the reads a
// condition tests.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { hasTupleOrStringArm, isTupleShapedType } from '../collection-utils.js';
import {
  collectionElementType,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { isSubtype, provablyAdmits } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { isSymbol, isFunction } from '../boxed-expression/type-guards.js';
import { mayHoldRestriction } from '../boxed-expression/conditional-value.js';
import type { CompileTarget, OperandCompiler, TargetSource } from './types.js';
import {
  assertNoStatementOperand,
  compileValueOperand,
} from './compile-statements.js';
import {
  compileOp,
  compileOpValue,
  operandAt,
  operandCompiler,
} from './compile-cse.js';
import {
  BRANCH_RELATIONS,
  assertNoContradictedScalarOperand,
  assertScalarCondition,
  booleanClaim,
  conditionDialectOf,
  guardCondition,
  liveSelectionArms,
  mayBeCollectionCondition,
  withCseOperand,
} from './compile-conditions.js';
import { branchComplexCoercion } from './compile-shapes.js';
import { core } from './compiler-core-hooks.js';
import {
  absenceAxisForType,
  absenceKind,
  compileExactCondition,
  compileGuardTest,
  conditionDecidability,
  exactSelect,
  nanPointLiteral,
  unmatchedCellLiteral,
  noBranchValue,
} from './compile-absence.js';
import {
  compilationType,
  isProvablyStringOperand,
} from './compiler-type-facts.js';
import { tempVar } from './compiler-naming.js';

/**
 * An `If` in statement form. A case of `compileExpr`: it returns the code, or
 * `undefined` when `compileExpr` continues with its next case.
 */
export function compileExprIf(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined,
  selectionHead: string
): TargetSource | undefined {
  if (selectionHead === 'If') {
    // A condition that may be an indexed collection at run time selects
    // ELEMENT-WISE: `If(c, t, f)` is the two-clause `Which(c, t, True, f)`
    // (see the `Which` branch below and `target.selection`). Consulted BEFORE
    // the target's `functions` entry, so a target that has both — GPU,
    // interval-js — gets the hook first. `null` — every condition provably
    // scalar — keeps the `functions` entry / ternary below unchanged.
    // The clause list handed to `selection` is in `Which` shape, so its
    // positions are NOT the `If` node's operand indices: 0 → 0 (condition),
    // 1 → 1 (then), 2 is the synthesized `True` (no edge), 3 → 2 (else).
    const selectionOperandUnder =
      (t: CompileTarget<Expression>): OperandCompiler<Expression> =>
      (expr, opIndex) => {
        if (opIndex === undefined || opIndex === 2)
          return compileValueOperand(expr, t);
        return compileOpValue(node, opIndex === 3 ? 2 : opIndex, t, 0, expr);
      };
    const selection = target.selection?.(
      [args[0], args[1], engine.True, args[2]],
      selectionOperandUnder(target),
      target,
      selectionOperandUnder
    );
    if (selection !== null && selection !== undefined) return selection;
    assertScalarCondition(args[0], target);
    // Mixed real/complex arms: coerce every real arm to the `{re, im}`
    // convention, so the node has one representation whichever arm runs
    // (`branchComplexCoercion`; Tycho item 60). The coercion, like
    // `isComplexValued` of the node, reads only the arms that
    // `liveSelectionArms` keeps: a dead arm is not emitted, so it does not
    // decide the representation.
    const coerce = branchComplexCoercion(
      node !== undefined && isFunction(node, 'If')
        ? liveSelectionArms(node)
        : [args[1], args[2]],
      target
    );
    // Both arms are conditionally evaluated: each is its own region, so a
    // temporary bound inside an arm is never hoisted out of it (§7.3).
    const arm = (v: Expression, i: number): TargetSource => {
      const code = compileOp(node, i, target, 0, v);
      assertNoStatementOperand(v, code, target);
      return coerce ? coerce(v, code) : code;
    };
    // A condition whose TYPE is the value `true` or `false` (a proven
    // comparison such as `Equal(a, a)` over a NaN-free `a`) selects its
    // arm at compile time: the other arm and the test are not emitted.
    const claim = booleanClaim(args[0]);
    if (claim !== undefined) return claim ? arm(args[1], 1) : arm(args[2], 2);
    const fn = target.functions?.(h);
    if (fn) {
      if (typeof fn === 'function') {
        return fn(args, operandCompiler(node, target), target);
      }
      return `${fn}(${args.map((x) => core.compile(x, target)).join(', ')})`;
    }
    // A condition that is not exactly `true` or `false` when the compiled
    // function runs selects neither arm; the value is then the absence
    // marker for the result type, which for a number is NaN. See the
    // "Branch conditions that cannot be decided" comment on
    // `conditionDecidability`. A condition decidable by construction reports
    // `null` and gets the plain conditional expression below.
    const decidability = conditionDecidability(
      args[0],
      target.bindExpr !== undefined,
      target
    );
    if (decidability === null)
      return `((${core.compile(
        args[0],
        target
      )}) ? (${arm(args[1], 1)}) : (${arm(args[2], 2)}))`;
    const compiledCond = compileExactCondition(args[0], decidability, target);
    return exactSelect(
      compiledCond,
      `(${arm(args[1], 1)})`,
      `(${arm(args[2], 2)})`,
      noBranchValue(node, target, coerce !== undefined),
      target
    );
  }
  return undefined;
}

/**
 * A `Which`, and an `If` read as one. A case of `compileExpr`: it returns the
 * code, or `undefined` when `compileExpr` continues with its next case.
 */
export function compileExprWhich(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined,
  selectionHead: string
): TargetSource | undefined {
  if (selectionHead === 'Which') {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Could not compile `Which`: expected even number of arguments (condition/value pairs)'
      );
    // A condition that may be an indexed collection at run time selects
    // ELEMENT-WISE (`np.select`, R1–R4 of
    // `docs/BROADCAST-MODEL.md`): the target lowers
    // the whole clause list to its own selection helper. Consulted BEFORE the
    // target's `functions` entry (as in the `If` branch above), so a target
    // that has both — GPU, interval-js — gets the hook first. `null` — every
    // condition provably scalar — keeps the `functions` entry / ternary chain
    // below unchanged.
    const selection = target.selection?.(
      args,
      operandCompiler(node, target),
      target,
      (derived) => operandCompiler(node, derived)
    );
    if (selection !== null && selection !== undefined) return selection;
    const fn = target.functions?.(selectionHead);
    if (fn) {
      if (typeof fn === 'function') {
        return fn(args, operandCompiler(node, target), target);
      }
      return `${fn}(${args.map((x) => core.compile(x, target)).join(', ')})`;
    }
    // Compile to chained ternaries. When arms mix real and complex values,
    // coerce every arm — including the no-match NaN default — to the complex
    // convention (Tycho item 60: a constant base-case arm in a
    // complex-valued recursion compiled to a plain number, NaN-poisoning
    // every consumer of the `{ re, im }` slots).
    const coerce = branchComplexCoercion(
      node !== undefined && isFunction(node, 'Which')
        ? liveSelectionArms(node)
        : args.filter((_x, i) => i % 2 === 1),
      target
    );
    // A position no clause matched, and a position whose condition is
    // undecided, answer the same thing: the codomain's absence marker (see
    // `noBranchValue`).
    const noBranch = noBranchValue(node, target, coerce !== undefined);
    // Every value arm, and every condition after the first, sits behind a
    // ternary test: each is its own region (§5.1(b)), so nothing binds
    // across an arm that may not be evaluated.
    //
    // The FIRST condition is compiled before its arm and before the
    // remaining clauses. It is the one operand evaluated unconditionally,
    // so it belongs to the enclosing region, and a subexpression it shares
    // with an arm is bound at that region's top when the condition is
    // emitted (the dominance rule of `cse.ts`) — an arm compiled earlier
    // would find no binding yet and emit the subexpression again. Every
    // later condition is its own region with no descendant arm, so its
    // order relative to the arms is immaterial.
    const compilePair = (i: number): string => {
      if (i >= args.length) return noBranch;
      const cond = args[i];
      const val = args[i + 1];
      // A condition proven `false` by its TYPE skips its clause BEFORE
      // the clause's value is compiled (see the `If` branch above): a
      // dead arm must neither cost compile time nor fail the compile
      // with a construct the target cannot lower.
      const claim = booleanClaim(cond);
      if (claim === false) return compilePair(i + 2);
      const compileArm = (): string => {
        const armCode = compileOp(node, i + 1, target, 0, val);
        return coerce ? coerce(val, armCode) : armCode;
      };
      // If condition is the symbol True, or proven `true` by its type,
      // it's the default branch.
      if (isSymbol(cond, 'True') || claim === true) {
        return `(${compileArm()})`;
      }
      // A condition that is not exactly `true` or `false` when the
      // compiled function runs selects no clause and ends the search. See
      // the "Branch conditions that cannot be decided" comment on
      // `conditionDecidability`. A condition decidable by construction
      // reports `null` and gets the plain chain of conditional
      // expressions below.
      const decidability = conditionDecidability(
        cond,
        target.bindExpr !== undefined,
        target
      );
      if (decidability === null) {
        const condCode =
          i === 0
            ? guardCondition(cond, target)
            : withCseOperand(node, i, target, () =>
                guardCondition(cond, target)
              );
        const valCode = compileArm();
        return `((${condCode}) ? (${valCode}) : ${compilePair(i + 2)})`;
      }
      if (i === 0) {
        const condCode = compileExactCondition(cond, decidability, target);
        const valCode = compileArm();
        return exactSelect(
          condCode,
          `(${valCode})`,
          compilePair(i + 2),
          noBranch,
          target
        );
      }
      // The arm and the remaining clauses are compiled BEFORE the region
      // below is opened: they belong to sibling regions, and a temporary
      // they bind must not land in this clause's wrapper. The condition and
      // its decidedness test, in contrast, must both be built inside that
      // wrapper — see `compileExactCondition`.
      const valCode = compileArm();
      const rest = compilePair(i + 2);
      return withCseOperand(node, i, target, () =>
        exactSelect(
          compileExactCondition(cond, decidability, target),
          `(${valCode})`,
          rest,
          noBranch,
          target
        )
      );
    };
    return compilePair(0);
  }
  return undefined;
}

/**
 * The restriction `v\{C\}`, the single-branch `If(C, v)`, whose condition
 * `C` is a mask of rank 1 (a flat list of conditions) by its type, or may
 * be one, with `args` in the order `[v, C]`. The caller compiles every
 * other condition (a scalar, or a mask of rank 2 or more or of a rank that
 * the type does not give) as the selection of `If`.
 *
 * Only the JavaScript target compiles it, with the run-time helper
 * `_SYS.restrict`. Every other target declines: the conditional forms of
 * the GPU, interval and Python targets take a scalar condition only.
 */
export function compileExprRestriction(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource {
  if (target.language !== 'javascript')
    throw new Error(
      `Could not compile a restriction by a list of conditions on target ` +
        `'${target.language ?? 'unknown'}': its conditional forms take a ` +
        `scalar condition only.`
    );
  // A complex-valued arm keeps the masked cell in the `{ re, im }`
  // convention (see `branchComplexCoercion`).
  const coerce = branchComplexCoercion([args[0]], target);
  // A list of conditions restricts element by element: `u\{[1, 2, 3] v <
  // 2\}` is `[u, Missing, Missing]` in the interpreter, one masked value
  // per condition; a list value is aligned with the conditions and
  // truncated to the shorter (`[10, 20]\{[v, 2v, 3v] < 2\}` is
  // `[10, Missing]`), and a point is one value, lifted whole at every
  // position. The run-time helper `_SYS.restrict` does exactly that.
  // Whether the value is aligned or repeated is decided from its type:
  // a point (tuple-shaped) or a scalar is repeated, a list is aligned,
  // and a value that may be either at run time — a point-or-point-list
  // union, whose flat array could be a point or a list — fails closed.
  // Measured on the Tycho corpus (2026-09-15): 11 restriction rows in
  // four documents declined here.
  // A condition that MAY be a list (`B < 0` for `B:
  // broadcastable<number>`) takes the same helper, which reads a
  // condition that is not an array at run time as one scalar condition.
  const valueType = args[0].type;
  // A point is one value; so is a string, which the lattice reads as
  // an indexed collection of its characters but the restriction never
  // aligns with the conditions.
  const point =
    isTupleShapedType(valueType.type) || isProvablyStringOperand(args[0]);
  // A union with a point or string arm beside a list arm is neither:
  // a tuple and a string are indexed collections in the lattice, so
  // `indexed_collection<any>` alone would read such a union as a list.
  const list =
    !point &&
    !hasTupleOrStringArm(valueType.type) &&
    (valueType.matches('list<any>') ||
      valueType.matches('indexed_collection<any>'));
  // A scalar is repeated. Anything else — a value whose type is wide
  // (`unknown`, `broadcastable<number>`, a point-or-point-list union)
  // may hold a list or a point at run time, and a flat array cannot
  // tell the two apart — fails closed rather than guessing.
  const scalar =
    !point &&
    !list &&
    (valueType.matches('number') || valueType.matches('boolean'));
  // A value that is a scalar or a tensor of scalars
  // (`broadcastable<number>`, `broadcastable<boolean>`) cannot be a
  // point, so its array test at run time decides: an array is aligned
  // with the conditions, any other value is repeated (`zip` is `null`
  // for `_SYS.restrict`). (ROADMAP CE-223.3.)
  const runtimeZip =
    !point &&
    !list &&
    !scalar &&
    (isSubtype(valueType.type, 'broadcastable<number>') ||
      isSubtype(valueType.type, 'broadcastable<boolean>'));
  if (!point && !list && !scalar && !runtimeZip)
    throw new Error(
      `Could not compile a restriction by a list of conditions over ` +
        `a value that may be a list or a point at run time (type ` +
        `'${valueType.toString()}'): a list is aligned with the ` +
        `conditions and a point is repeated, and a flat array cannot ` +
        `tell the two apart.`
    );
  // The conditions compile first, as in the scalar `If`.
  //
  // A literal list of scalar conditions compiles each cell to `true`
  // exactly when that condition is decided true (`compileGuardTest`),
  // as the scalar `If` selects.
  const conds =
    isFunction(args[1], 'List') &&
    args[1].ops.every(
      (cell) =>
        cell.type.matches('boolean') &&
        !mayBeCollectionCondition(cell.type.type)
    )
      ? `[${args[1].ops
          .map((cell) => compileGuardTest(cell, target))
          .join(', ')}]`
      : core.compile(args[1], target);
  const val = compileOp(undefined, 0, target, 0, args[0]);
  // The absence at each position is decided from what one position
  // holds — a list element, or the whole value — not from the node's
  // own type, the list of results. A missing number is the numeric
  // absence (`NaN`); a missing POINT is a point whose coordinates are
  // all `NaN` (`nanPointLiteral`), as in the interpreter (selection rule
  // of 2026-11-02, `docs/BROADCAST-MODEL.md`); a missing boolean is
  // `false` and a missing colour has `NaN` channels
  // (`unmatchedCellLiteral`); any other value that is not a number is the
  // object null (`undefined` on JavaScript). The
  // element-wise `Which` gives the same cells (its selection helper
  // takes the absence of the cell type, `_SYS.selectAbsent`), so the
  // two forms of the same selection agree.
  //
  // A missing COMPLEX number is plain `NaN`, as the element-wise
  // `Which` gives it, not the complex value `{ re: NaN, im: NaN }`: a
  // discharge (`IsMissing`, `Coalesce`) tests `Number.isNaN`, which
  // reads an object as present, and must read this cell as absent
  // (R3 of the same plan).
  const held: Type = list
    ? (collectionElementType(valueType.type) ?? 'unknown')
    : valueType.type;
  const nullLiteral = target.absence?.object?.nullLiteral;
  const unmatched = nanPointLiteral([held]) ?? unmatchedCellLiteral([held]);
  const absent =
    unmatched ??
    (coerce === undefined &&
    nullLiteral !== undefined &&
    absenceKind([held], target) === 'object'
      ? nullLiteral
      : 'NaN');
  const zip = runtimeZip ? 'null' : String(list);
  return `_SYS.restrict(${conds}, ${val}, ${zip}, ${absent})`;
}

/**
 * An `AssertPresent`. A case of `compileExpr`: it returns the code, or
 * `undefined` when `compileExpr` continues with its next case.
 */
export function compileExprAssertPresent(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  if (h === 'AssertPresent') {
    if (args.length !== 1)
      throw new Error(
        'Could not compile `AssertPresent`: expected exactly one argument'
      );
    const operand = args[0];
    const t = compilationType(operand);
    if (provablyAdmits('nothing', t))
      throw new Error(
        `Could not compile \`AssertPresent\`: target '${target.language ?? 'unknown'}' ` +
          `cannot distinguish a possible 'Nothing' input from an absent datum.`
      );
    const code = compileValueOperand(operand, target);
    // A restriction (`If(c, 3)`) is absent where its
    // condition fails, whatever its type says, and so is an expression that
    // contains one: it is never proved present.
    const proved =
      !typeContainsMissing(t) &&
      !isSubtype('nan', resolveTypeForCompilation(t)) &&
      resolveTypeForCompilation(t) !== 'unknown' &&
      !mayHoldRestriction(operand);
    if (proved) return code;
    const raise = target.absence?.raise;
    if (raise === undefined) return code;
    const axis = absenceAxisForType(t, target, 'AssertPresent');
    if (axis.coalesce === undefined)
      throw new Error(
        `Could not compile \`AssertPresent\`: target '${target.language ?? 'unknown'}' cannot ` +
          `discharge absence (no 'coalesce' capability).`
      );
    const message = JSON.stringify(
      `expected-present: ${operand.toString()} is absent`
    );
    // "The value unless absent, else the fallback" is the target's
    // `coalesce`, with the raise as the fallback: the operand is bound once
    // by that spelling, and the fallback is reached only on the absent
    // branch, so the raise fires only then.
    return axis.coalesce(code, raise(message));
  }
  return undefined;
}

/**
 * The three-valued (Kleene) value of an `And`, `Or` or `Not` in VALUE
 * position, or `undefined` when the plain infix lowering applies.
 *
 * The plain lowering is the target's `&&`/`||`/`!` (JavaScript) or
 * `and`/`or`/`not` (Python). These decide by truthiness and return an
 * operand, so an absent operand (`undefined` or `None`, the spelling of
 * `Missing`) gives the wrong answer: with `M` absent, `M && false` is
 * `undefined` where the interpreter answers `False` (a `false` operand
 * settles an `And`), `M || false` is `false` where it answers `Missing`,
 * and `!M` is `true` where it answers `Missing`. The Kleene tables:
 *
 * - `And` is `false` when one operand is `false`, `true` when every operand
 *   is `true`, and undecided otherwise. `Or` is the mirror image.
 * - `Not` is undecided exactly when its operand is.
 *
 * The undecided value is the target's object null (`undefined`, `None`).
 *
 * The lowering is lazy, like the condition lowering (`kleeneCondition`):
 * each operand is bound before the next one is written, and an operand that
 * follows a settling one (`false` in an `And`, `true` in an `Or`) is never
 * evaluated. An operand that follows an undecided one is evaluated, because
 * the table needs it.
 *
 * Applied only when every operand is a boolean or absent, on the targets
 * with an object null (JavaScript, Python), and one of these is true:
 *
 * - an operand's static type has a `missing` arm;
 * - on JavaScript, an operand is not proven a DECIDED boolean
 *   (`isDecidedBooleanValue`): an element read out of a list, a call.
 *
 * A connective whose every operand is proven a decided boolean keeps the
 * plain infix lowering, with no extra code.
 */
export function kleeneValueConnective(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node?: Expression
): TargetSource | undefined {
  if (h !== 'And' && h !== 'Or' && h !== 'Not') return undefined;
  if (target.language !== 'javascript' && target.language !== 'python')
    return undefined;
  if (args.length === 0 || (h === 'Not' && args.length !== 1)) return undefined;
  // A caller-supplied lowering of the head (an identifier other than the
  // target's own keyword) takes responsibility for its operands.
  const opMap = target.operators?.(h);
  if (
    opMap !== undefined &&
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]) &&
    !['and', 'or', 'not'].includes(opMap[0])
  )
    return undefined;
  /** The arms of `a`'s type: `missing`, or a boolean. `undefined` when an
   * arm is anything else. */
  const arms = (a: Expression): string[] | undefined => {
    const r = resolveTypeForCompilation(a.type.type);
    const types = typeof r !== 'string' && r.kind === 'union' ? r.types : [r];
    const out: string[] = [];
    for (const b of types) {
      const t = resolveTypeForCompilation(b);
      if (t === 'missing') out.push('missing');
      else if (t === 'never') continue;
      else if (isSubtype(t, 'boolean')) out.push('boolean');
      else return undefined;
    }
    return out;
  };
  const operandArms = args.map(arms);
  if (operandArms.some((a) => a === undefined)) return undefined;
  if (
    !operandArms.some((a) => a!.includes('missing')) &&
    (target.language !== 'javascript' ||
      args.every((a) => isDecidedBooleanValue(a, target)))
  )
    return undefined;
  // A call whose declared `boolean` result its body contradicts (it answers
  // a list) is refused here as in the plain lowering, which reaches the
  // same check later in `compileExpr`.
  assertNoContradictedScalarOperand(args[0].engine, h, args);
  const d = conditionDialectOf(target);
  // Each operand is compiled in the common-subexpression region of its
  // edge (`withCseOperand`), as the plain lowering compiles it
  // (`compileOp`) and as the condition lowering does (`kleeneConnective`):
  // an operand after the first is evaluated only when the ones before it
  // did not settle the result, so a subexpression shared inside it is
  // bound there, and never outside the binding that may not be entered.
  // The operand is read off `node` when there is one (`operandAt`), as
  // `compileOp` reads it: the common-subexpression plan is keyed by the
  // nodes of that tree, and `args` can hold other objects for them.
  const code = (a: Expression, i: number) =>
    withCseOperand(node, i, target, () =>
      compileValueOperand(
        node !== undefined ? (operandAt(node, i) ?? a) : a,
        target
      )
    );
  if (h === 'Not') {
    const k = tempVar(target);
    return d.bind([k], d.kleeneOfValue(k, true), [code(args[0], 0)]);
  }
  const settles = h === 'And' ? d.isFalse : d.isTrue;
  const settled = h === 'And' ? d.falseValue : d.trueValue;
  const unsettled = h === 'And' ? d.isTrue : d.isFalse;
  const other = h === 'And' ? d.trueValue : d.falseValue;
  const names = args.map(() => tempVar(target));
  // Every operand was reached and none settled the result: it is the other
  // decided value when every operand holds it, undecided otherwise.
  let body = d.ternary(
    names.map((k) => `(${unsettled(k)})`).join(` ${d.and} `),
    other,
    d.undecided
  );
  // The operands are compiled in their order, before the nesting is
  // assembled from the last one out: a subexpression shared with an
  // earlier operand is bound where that operand first meets it, as the
  // plain lowering binds it (compiled from the last operand first, the
  // shared `Math.sin(_.x)` of `And(sin x < 1, sin x > 0)` was computed
  // twice).
  const codes = args.map((a, i) => code(a, i));
  for (let i = args.length - 1; i >= 0; i--)
    body = d.bind([names[i]], d.ternary(settles(names[i]), settled, body), [
      codes[i],
    ]);
  return body;
}

/**
 * True when the compiled value of `a` is always `true` or `false` on the
 * JavaScript target, whatever the caller passes. Proven for:
 *
 * - the symbols `True` and `False`;
 * - a symbol of type `boolean`: the host supplies every input with a value
 *   of its declared type;
 * - a comparison (`Less`, `LessEqual`, `Greater`, `GreaterEqual`, `Equal`,
 *   `NotEqual`) whose operands have no `missing` arm, are not an
 *   application of a top type (`any` or `unknown`: its value can be a
 *   collection, and `Equal` over it lowers to a run-time dispatch whose
 *   value is not always a boolean). Its compiled value is a JavaScript
 *   comparison, which is a boolean: a NaN operand gives `false` (`true`
 *   for `NotEqual`). The host supplies every input, so an input that the
 *   caller leaves out is not considered;
 * - an `And`, `Or` or `Not` whose every operand is proven.
 *
 * Anything else is not proven: a symbol of another type, an element read
 * out of a list (`undefined` past the
 * end), a call. A connective over such an operand takes the Kleene
 * lowering of `kleeneValueConnective`. Being wrong here in the cautious
 * direction costs only code size: the Kleene value of a decided boolean
 * is that boolean.
 */
export function isDecidedBooleanValue(
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (isSymbol(a, 'True') || isSymbol(a, 'False')) return true;
  if (isSymbol(a)) return isSubtype(a.type.type, 'boolean');
  if (!isFunction(a)) return false;
  const h = a.operator;
  if (BRANCH_RELATIONS.has(h))
    return a.ops.every((x) => {
      const t = compilationType(x);
      return (
        !typeContainsMissing(t) &&
        !((t === 'any' || t === 'unknown') && isFunction(x))
      );
    });
  if (h === 'And' || h === 'Or' || h === 'Not')
    return a.ops.every((x) => isDecidedBooleanValue(x, target));
  return false;
}
