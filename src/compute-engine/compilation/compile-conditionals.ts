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
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { isSubtype, provablyAdmits } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { elementwiseMaskRank } from '../library/control-structures.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
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
  _truthOnly,
  absenceAxisForType,
  absenceKind,
  compileExactCondition,
  compileGuardTest,
  conditionDecidability,
  exactSelect,
  isObjectDomainMissingOperand,
  isVarsObjectRead,
  noBranchValue,
  unsuppliedReads,
  withNanEscape,
} from './compile-absence.js';
import { _codeAliases, withPresentReads } from './compiler-mode.js';
import {
  compilationType,
  isProvablyStringOperand,
} from './compiler-type-facts.js';
import { tempVar } from './compiler-naming.js';
import type { ConditionNode } from './compiler-types.js';

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
    // An arm runs only after the condition tested its vars-object reads
    // for `undefined`, so a comparison in the arm does not test them
    // again (`unsuppliedComparisonGuard`).
    const tested = testedReadsOf(decidability, target);
    return exactSelect(
      compiledCond,
      `(${withPresentReads(target, tested, () => arm(args[1], 1))})`,
      `(${withPresentReads(target, tested, () => arm(args[2], 2))})`,
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
 * A `When`. A case of `compileExpr`: it returns the code, or `undefined` when
 * `compileExpr` continues with its next case.
 */
export function compileExprWhen(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  node: Expression | undefined
): TargetSource | undefined {
  if (h === 'When') {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `When`: expected exactly 2 arguments (expr, cond)'
      );
    const fn = target.functions?.(h);
    if (fn) {
      if (typeof fn === 'function') {
        return fn(args, operandCompiler(node, target), target);
      }
      return `${fn}(${args.map((x) => core.compile(x, target)).join(', ')})`;
    }
    // Compile to a ternary: cond ? expr : <absent>. The masked branch is
    // the codomain's absence marker, the same value a `Which` that matched
    // no clause emits (`noBranchValue`, which says which domains get the
    // object null and why an unknown type keeps `NaN`). A complex-valued
    // arm keeps the masked branch in the same `{ re, im }` convention (see
    // `branchComplexCoercion`).
    const coerce = branchComplexCoercion([args[0]], target);
    const nan = noBranchValue(node, target, coerce !== undefined);
    // Special-case constant True/False conditions to avoid bare symbol refs
    if (isSymbol(args[1], 'True'))
      return `(${compileOp(node, 0, target, 0, args[0])})`;
    if (isSymbol(args[1], 'False')) return nan;
    // A list of conditions restricts element by element: `u\{[1, 2, 3] v <
    // 2\}` is `[u, Missing, Missing]` in the interpreter, one masked value
    // per condition; a list value is aligned with the conditions and
    // truncated to the shorter (`[10, 20]\{[v, 2v, 3v] < 2\}` is
    // `[10, Missing]`), and a point is one value, lifted whole at every
    // position. The run-time helper `_SYS.restrict` does exactly that; the
    // scalar guard below would refuse the collection-valued condition.
    // Whether the value is aligned or repeated is decided from its type:
    // a point (tuple-shaped) or a scalar is repeated, a list is aligned,
    // and a value that may be either at run time — a point-or-point-list
    // union, whose flat array could be a point or a list — fails closed.
    // Measured on the Tycho corpus (2026-09-15): 11 restriction rows in
    // four documents declined here.
    // A condition that MAY be a list (`B < 0` for `B:
    // broadcastable<number>`) takes the same helper, which reads a
    // condition that is not an array at run time as one scalar condition.
    // The scalar guard below would refuse it (`assertScalarCondition`).
    if (
      args[1].type.matches('collection<any>') ||
      mayBeCollectionCondition(args[1].type.type)
    ) {
      // A mask of rank 2 or more selects cell by cell at every level, as
      // the else-less `If(C, v)` does, on both routes (user decision
      // 2026-10-23, ROADMAP CE-223.1): `When(v, C)` compiles as that `If`
      // when the type proves the rank, and dispatches on the shape of the
      // mask at run time when the type does not give the rank (below).
      const maskRank = elementwiseMaskRank([args[1].type.type]);
      if (maskRank !== undefined && maskRank >= 2)
        return core.compileExpr(
          args[0].engine,
          'If',
          [args[1], args[0]],
          0,
          target,
          undefined
        );
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
          `Could not compile \`When\`: a restriction by a list of conditions over ` +
            `a value that may be a list or a point at run time (type ` +
            `'${valueType.toString()}'): a list is aligned with the ` +
            `conditions and a point is repeated, and a flat array cannot ` +
            `tell the two apart.`
        );
      // The conditions compile first, as in the scalar case below.
      //
      // A literal list of scalar conditions compiles each cell to `true`
      // exactly when that condition is decided true (`compileGuardTest`),
      // as the scalar case below selects. Its plain code answered `true`
      // for an input the caller did not supply (`undefined !== 0`), so
      // `When(5, [x ≠ 0, ¬(x > 0)])` gave `[5, 5]` where the interpreter
      // has no value in either cell (ROADMAP CE-569).
      const conds =
        isFunction(args[1], 'List') &&
        args[1].ops.every(
          (cell) =>
            cell.type.matches('boolean') &&
            !mayBeCollectionCondition(cell.type.type)
        )
          ? `[${args[1].ops
              .map((cell) => {
                // An ordering relation over symbols and number literals
                // keeps its plain code: it is `false` when undecided.
                const d = conditionDecidability(cell, true, target);
                return d === null || isFalsyWhenUndecided(d, target)
                  ? core.compile(cell, target)
                  : compileGuardTest(cell, target);
              })
              .join(', ')}]`
          : core.compile(args[1], target);
      const val = compileOp(node, 0, target, 0, args[0]);
      // The absence at each position is decided from what one position
      // holds — a list element, or the whole value — not from the node's
      // own type, the list of results. A missing number is the numeric
      // absence (`NaN`); a missing POINT and a missing string are the
      // object null (`undefined` on JavaScript), as a single missing point
      // is. The element-wise `Which` gives the same cells (its selection
      // helper takes the absence of the cell type, `_SYS.selectAbsent`), so
      // the two forms of the same selection agree.
      const held: Type = list
        ? (collectionElementType(valueType.type) ?? 'unknown')
        : valueType.type;
      const nullLiteral = target.absence?.object?.nullLiteral;
      const absent =
        coerce !== undefined
          ? '({ re: NaN, im: NaN })'
          : nullLiteral !== undefined &&
              absenceKind([held], target) === 'object'
            ? nullLiteral
            : 'NaN';
      const zip = runtimeZip ? 'null' : String(list);
      if (maskRank === 1)
        return `_SYS.restrict(${conds}, ${val}, ${zip}, ${absent})`;
      // The type does not give the rank of the mask: a mask with a list
      // of conditions in it at run time takes the selection of the
      // else-less `If(C, v)`, any other the restriction above. The mask
      // and the value are bound once, and each branch reads the bindings
      // (`_codeAliases`).
      const c = tempVar(target);
      const v = tempVar(target);
      const installed: Array<[Expression, string | undefined]> = [];
      let nested: string;
      try {
        for (const [op, name] of [
          [args[1], c],
          [args[0], v],
        ] as const) {
          installed.push([op, _codeAliases.get(op)]);
          _codeAliases.set(op, name);
        }
        nested = core.compileExpr(
          args[0].engine,
          'If',
          [args[1], args[0]],
          0,
          target,
          undefined
        );
      } finally {
        for (const [op, previous] of installed.reverse()) {
          if (previous === undefined) _codeAliases.delete(op);
          else _codeAliases.set(op, previous);
        }
      }
      return (
        `((${c}, ${v}) => _SYS.isNestedMask(${c}) ? (${nested}) : ` +
        `_SYS.restrict(${c}, ${v}, ${zip}, ${absent}))(${conds}, ${val})`
      );
    }
    // The VALUE is the conditional position here (the single condition is
    // eager) — see the `When` entry of the lazy-operand inventory. The
    // condition compiles first, the order of the CSE harvest walk
    // (`operandEmissionOrder`, `cse.ts`), so the value arm can read a
    // temporary that the condition binds.
    //
    // The value is selected only when the condition is decided TRUE (see
    // "Branch conditions that cannot be decided"). A condition read by its
    // value (a boolean input `c`, a call) must be exactly `true`: before,
    // `When(x, c)` with `c = 1` selected `x`. A condition that is false
    // or undecided gives the same masked value, so the plain conditional
    // expression is enough when the plain code of the condition is falsy
    // whenever the condition is undecided (`isFalsyWhenUndecided`): an
    // ordering relation between symbols and number literals, or an
    // `And`/`Or` of them. Any other condition is tested for being decided
    // first. Before, `When(5, x ≠ 0)` answered `5` for an `x` the caller
    // did not supply (`undefined !== 0` is `true`), where the interpreter
    // has no value (ROADMAP CE-569).
    //
    // A condition read by its value that is not provably boolean-valued
    // (an undeclared `b`, `x/y`) takes the same strict test: a value that
    // is not a boolean selects nothing, as in `If`, and the interpreter
    // holds such a `When` unevaluated. Before, the run-time guard of the
    // target (`_SYS.cond`) raised for it.
    const decidability = conditionDecidability(
      args[1],
      target.bindExpr !== undefined,
      target
    );
    if (decidability === null || isFalsyWhenUndecided(decidability, target)) {
      // An undecided comparison here reads as `false`, which masks the
      // value as the undecided answer does, so the comparisons of the
      // condition need no test of their own for an unsupplied variable
      // (`unsuppliedComparisonGuard`).
      const cond = withPresentReads(
        target,
        decidability === null ? [] : falsyReadsOf(decidability, target),
        () => guardCondition(args[1], target)
      );
      const val = compileOp(node, 0, target, 0, args[0]);
      return `((${cond}) ? (${val}) : ${nan})`;
    }
    const compiledCond = compileExactCondition(args[1], decidability, target);
    const val = compileOp(node, 0, target, 0, args[0]);
    // A condition read by its value: the value is selected only when the
    // condition is exactly `true` (`false` under a negation). The false
    // and the undecided answers are the same masked value, so one strict
    // comparison is enough, and the condition is evaluated once.
    if (compiledCond.conjuncts === 'value')
      return `((${compiledCond.code}) === ${
        compiledCond.negate ? 'false' : 'true'
      } ? (${val}) : ${nan})`;
    return exactSelect(compiledCond, `(${val})`, nan, nan, target);
  }
  return undefined;
}

/**
 * Is the plain JavaScript code of the branch condition `node` falsy
 * whenever the condition is undecided?
 *
 * An ordering relation (`<`, `≤`, `>`, `≥`) whose operands are number
 * literals and NUMERIC inputs that compile to a bare read of the vars
 * object (`_.x`) is `false` when an operand is `undefined` (an input the
 * caller did not supply): `undefined < 1` is `false`. Other operands do
 * not qualify:
 * - an operand computed from an input: arithmetic can turn `undefined`
 *   into a number (`_SYS.pow(undefined, 0)` and
 *   `_SYS.heaviside(undefined)` are `1`). An ASSIGNED symbol, and a
 *   symbol that the `vars` option maps to code, compile to such a
 *   computation, so the compiled code of each symbol is checked;
 * - a string input: the comparison reads `_SYS.ct(_.s)`, and an
 *   unsupplied `s` becomes the string `'undefined'`, which compares like
 *   any other string;
 * - a boolean input, or an input of unknown type, which can be a string.
 *
 * A NaN operand gives the IEEE value,
 * which is the decided answer. An `And` or an `Or` of such relations,
 * compiled to `&&` and `||`, is then falsy when its Kleene value is
 * undecided: an undecided operand reads as `false`, which only a `true`
 * operand of an `Or` overrides, and the Kleene `Or` is `true` then too.
 *
 * Not such a condition: a negation (`!undefined` is `true`), `Equal` and
 * `NotEqual` (`undefined !== 0` is `true`, `undefined === undefined` is
 * `true`), and a condition read by its VALUE (a boolean input, a call): a
 * caller can supply a value that is not a boolean, such as `1`, which is
 * truthy, where the interpreter has no value.
 */
/**
 * The vars-object reads (`_.x`) that the decidedness test of a lone
 * relation `node` tests for `undefined` (`withConditionOperands`). The
 * arms of the selection run only when the test passed. Empty for a
 * connective or a value-shaped condition, whose arms can run with such a
 * read undecided.
 */
export function testedReadsOf(
  node: ConditionNode,
  target: CompileTarget<Expression>
): string[] {
  if (node.test.kind !== 'operands') return [];
  const reads: string[] = [];
  for (const op of node.test.operands) {
    if (!isSymbol(op)) continue;
    const code = core.compile(op, target);
    if (isVarsObjectRead(code, target)) reads.push(code);
  }
  // With the NaN escape (`withNanEscape`), the arms can run while a read
  // is unsupplied: nothing is proven present.
  const expr = node.test.expr;
  if (
    isFunction(expr) &&
    withNanEscape(
      expr.ops,
      reads.map((r) => `${r} !== undefined`),
      target
    ).some((t) => t.includes(' || '))
  )
    return [];
  return reads;
}

/**
 * The vars-object reads of the relations of a condition that
 * `isFalsyWhenUndecided` admits: there an unsupplied variable makes the
 * comparison `false`, which the selection reads as it reads the undecided
 * answer.
 */
export function falsyReadsOf(
  node: ConditionNode,
  target: CompileTarget<Expression>
): string[] {
  if (node.test.kind === 'connective')
    return node.test.operands.flatMap((n) => falsyReadsOf(n, target));
  return testedReadsOf(node, target);
}

export function isFalsyWhenUndecided(
  node: ConditionNode,
  target: CompileTarget<Expression>
): boolean {
  if (node.negate) return false;
  const t = node.test;
  if (t.kind === 'operands')
    return (
      isFunction(t.expr) &&
      ['Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(
        t.expr.operator
      ) &&
      t.expr.ops.every(
        (op) =>
          isNumber(op) ||
          (isSymbol(op) &&
            op.type.matches('number') &&
            isVarsObjectRead(core.compile(op, target), target))
      )
    );
  if (t.kind === 'connective')
    return t.operands.every((n) => isFalsyWhenUndecided(n, target));
  return false;
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
    const proved =
      !typeContainsMissing(t) &&
      !isSubtype('nan', resolveTypeForCompilation(t)) &&
      resolveTypeForCompilation(t) !== 'unknown';
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
 * An `Equal` or `NotEqual` with an operand that may be absent. A case of
 * `compileExpr`: it returns the code, or `undefined` when `compileExpr`
 * continues with its next case.
 */
export function compileExprMissingEquality(
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): TargetSource | undefined {
  const isObjectDomainMissing = isObjectDomainMissingOperand;
  if (
    (h === 'Equal' || h === 'NotEqual') &&
    target.absence !== undefined &&
    args.length === 2 &&
    args.some(isObjectDomainMissing) &&
    // A STRING participant is not a collection FOR THIS PURPOSE: it matches
    // `collection` in the lattice (its elements are its grapheme clusters)
    // but compares as ONE value on both the interpreter and the compiled
    // side, which is exactly the shape this scalar Kleene guard handles.
    args.every(
      (a) =>
        isProvablyStringOperand(a) ||
        (!a.isCollection && !a.type.matches('collection<any>'))
    )
  ) {
    if (target.absence.object === undefined)
      throw new Error(
        `Could not compile \`${h}\`: an absent (Kleene) boolean has no object representation on ` +
          `target '${target.language ?? 'unknown'}'. Discharge the operands ` +
          `with 'Coalesce' first.`
      );
    // The absent operand of this guard is the OBJECT null (`undefined`):
    // the absent value of a slot whose type admits an object. A NUMERIC
    // absence, `NaN` (an index past the end of a list of numbers), is a
    // number that compares as IEEE says, `False` for `Equal` and `True`
    // for `NotEqual`, on both routes. The test is therefore the object
    // axis's, whatever the operand's domain: the numeric axis's test
    // (`absenceAxisForType`) reads `NaN` as absent too, which is right for
    // `IsMissing` and `Coalesce` and wrong here. With `g := t ↦ [t, 2t]`
    // and `x: any`, the operand `g(x)[5]` is typed
    // `missing | number | vector<2>`, a mixed domain, and at `x = 3` its
    // value is `NaN`: the numeric test answered `Missing` for
    // `g(x)[5] = 1` where the interpreter answers `False` (ROADMAP CE-386,
    // landed 2026-10-23); at `x = "a"` the value is `undefined` and both
    // routes answer `Missing`.
    const objectAxis = target.absence.object;
    if (objectAxis.isAbsent === undefined)
      throw new Error(
        `Could not compile \`${h}\`: target '${target.language ?? 'unknown'}' cannot test ` +
          `absence (no 'isAbsent' capability).`
      );
    const isAbsent = objectAxis.isAbsent;
    // Each operand is compiled once, here. An operand that is an
    // application (a call, an element read) or that is impure (`Random()`)
    // is BOUND to a temporary that the absence tests and the inner
    // comparison read, as the parameter of a function called at once with
    // the operand's code. Without the binding the operand's code was
    // spliced into each test and into the comparison: an impure operand
    // drew twice, an operand after an absent one was not evaluated at all
    // (the interpreter evaluates both operands, and a skipped draw moves
    // every later draw of a seeded sequence), and an element read was
    // computed twice. A symbol or a literal is spliced as it is, so the
    // code of the common case does not change.
    const codes = args.map((a) => compileValueOperand(a, target));
    const bindings: { name: string; code: TargetSource }[] = [];
    const operandCodes = args.map((a, i) => {
      if (a.isPure !== false && !isFunction(a)) return codes[i];
      const name = tempVar(target);
      bindings.push({ name, code: codes[i] });
      return name;
    });
    const operandCode = (i: number): TargetSource => operandCodes[i];
    const guardOf = (i: number): TargetSource => isAbsent(operandCode(i));
    // The inner (both-present) comparison. For operands whose stripped
    // type is wholly STRING, the target's `Equal` codegen is the numeric
    // tolerance kernel — silently `false` for any pair of present strings
    // (`Math.abs("x" - "y")` is NaN), and now declined by the string gate.
    // The faithful inner for strings is STRICT equality: the interpreter
    // compares strings exactly (no tolerance), so `===` (`==` on word-chain
    // targets, i.e. Python) is the interpreter's own semantics. Everything
    // not wholly-string keeps the target's `Equal` codegen, with its gates.
    const strippedOf = (a: Expression): Type =>
      resolveTypeForCompilation(stripMissingFromType(compilationType(a)));
    const allString = args.every((a) => isSubtype(strippedOf(a), 'string'));
    let inner: TargetSource;
    if (allString) {
      const [a, b] = args.map((_e, i) => operandCode(i));
      const pyOp = h === 'Equal' ? '==' : '!=';
      const jsOp = h === 'Equal' ? '===' : '!==';
      inner =
        target.chainOp === 'and'
          ? `(${a}) ${pyOp} (${b})`
          : `(${a}) ${jsOp} (${b})`;
    } else {
      const eqFn = target.functions?.(h);
      if (typeof eqFn !== 'function')
        throw new Error(
          `Could not compile \`${h}\`: target '${target.language ?? 'unknown'}' has no equality ` +
            `codegen for the guarded (Kleene) form.`
        );
      // The target's equality codegen compiles each operand through this
      // function: an operand of the pair reads its bound code.
      inner = eqFn(
        args,
        (e) => {
          const i = args.indexOf(e);
          return i >= 0 ? operandCode(i) : compileValueOperand(e, target);
        },
        target
      );
    }
    const nullLit = target.absence.object.nullLiteral;
    // A word-`chainOp` target (Python: `and`) spells logical-or `or` and the
    // conditional `X if C else Y`; a C-style target uses `||` and `C ? X : Y`.
    const pythonic = target.chainOp === 'and';
    const guard = `${guardOf(0)} ${pythonic ? 'or' : '||'} ${guardOf(1)}`;
    const guarded = pythonic
      ? `(${nullLit} if (${guard}) else ${inner})`
      : `((${guard}) ? ${nullLit} : ${inner})`;
    if (bindings.length === 0) return guarded;
    const names = bindings.map((b) => b.name).join(', ');
    const values = bindings.map((b) => b.code).join(', ');
    return pythonic
      ? `(lambda ${names}: ${guarded})(${values})`
      : `((${names}) => ${guarded})(${values})`;
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
 *   (`isDecidedBooleanValue`). A symbol declared `boolean` is not: the
 *   caller can leave it out (`undefined`) or pass a value that is not a
 *   boolean (`1`). The plain `!_.c` gave `true` for an unsupplied `c` and
 *   `false` for `c = 1`, where the interpreter keeps `¬c` unevaluated; the
 *   Kleene value is `undefined`, the absence marker of a boolean result.
 *   (Python keeps the plain lowering for such an operand: its variables
 *   are the parameters of the compiled function, and there is no
 *   unsupplied value to read.)
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
 * - a comparison (`Less`, `LessEqual`, `Greater`, `GreaterEqual`, `Equal`,
 *   `NotEqual`) whose operands have no `missing` arm, are not an
 *   application of a top type (`isObjectDomainMissingOperand`), and read
 *   no variable that the caller can leave out (`unsuppliedReads`: a
 *   literal, a local, a loop index, or a read already tested around the
 *   code). Its compiled value is a JavaScript comparison, which is a
 *   boolean: a NaN operand gives `false` (`true` for `NotEqual`). A
 *   comparison with an operand that may be absent compiles to `undefined`
 *   when it is absent (`absentComparisonGuard`,
 *   `unsuppliedComparisonGuard`), so it is not proven;
 * - an `And`, `Or` or `Not` whose every operand is proven.
 *
 * Anything else is not proven: a symbol (the caller can leave it out or
 * pass any value), an element read out of a list (`undefined` past the
 * end), a call. A connective over such an operand takes the Kleene
 * lowering of `kleeneValueConnective`. Being wrong here in the cautious
 * direction costs only code size: the Kleene value of a decided boolean
 * is that boolean.
 */
export function isDecidedBooleanValue(
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  // Read only by a truth test (`withTruthOnly`): its plain value is
  // `false` where the three-valued one has no value, which that test
  // reads alike.
  if (_truthOnly.has(a)) return true;
  if (isSymbol(a, 'True') || isSymbol(a, 'False')) return true;
  if (!isFunction(a)) return false;
  const h = a.operator;
  if (BRANCH_RELATIONS.has(h))
    return (
      a.ops.every(
        (x) =>
          !typeContainsMissing(compilationType(x)) &&
          !isObjectDomainMissingOperand(x)
      ) && unsuppliedReads(a.ops, target).length === 0
    );
  if (h === 'And' || h === 'Or' || h === 'Not')
    return a.ops.every((x) => isDecidedBooleanValue(x, target));
  return false;
}

/**
 * Make a broadcast connective's scalar body absence-aware.
 *
 * `_SYS.bcast` represents an empty or mismatched position as NaN, but the
 * connectives lower to raw JavaScript `!`, `&&` and `||`, which coerce it:
 * `!NaN` is `true` and `NaN || false` is `false`, so an error position came
 * back out as an ordinary — and wrong — truth value once a second connective
 * consumed it. The interpreter instead ABSORBS (`And(False, <error>)` is
 * `False`, `Or(True, <error>)` is `True`) and otherwise propagates the error.
 * This reproduces both halves: a dominant operand wins, else any absent
 * operand makes the result absent, else the head's own codegen runs.
 *
 * Only the connectives need it. An ordering already agrees — `NaN < 3` is
 * `false`, which is how the interpreter reads a NaN operand (IEEE). What it
 * cannot distinguish is a NaN that stands for an ERROR rather than a numeric
 * NaN; separating those needs a sentinel carried through nested broadcasts,
 * recorded as residue in ROADMAP.md rather than papered over here.
 *
 * Also used by the JavaScript target's own connective lowering
 * (`compileJSCollectionBoolean`), which builds the same closure by hand.
 */
export function guardConnectiveAbsence(
  h: string,
  params: ReadonlyArray<string>,
  body: string
): string {
  if (h !== 'And' && h !== 'Or' && h !== 'Not') return body;
  // An absent operand is `NaN` (a numeric slot) or `undefined` (the
  // absent object: an element of unknown type read out of a list, or an
  // ordering on one, ROADMAP CE-368).
  const absent = params
    .map((p) => `(${p} !== ${p} || ${p} === undefined)`)
    .join(' || ');
  if (h === 'Not') return `((${absent}) ? NaN : ${body})`;
  const dominant = h === 'And' ? 'false' : 'true';
  const wins = params.map((p) => `${p} === ${dominant}`).join(' || ');
  return `((${wins}) ? ${dominant} : ((${absent}) ? NaN : ${body}))`;
}
