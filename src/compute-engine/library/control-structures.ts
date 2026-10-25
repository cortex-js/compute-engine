import { markCallableHome } from '../boxed-expression/binders.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import {
  applicable,
  declareAssignmentLocals,
  enterNestedBodyScopes,
  evaluateStatements,
  evaluateStatementsAsync,
  exitNestedBodyScopes,
  resolveEscapingLambda,
} from '../function-utils.js';
import type { CallbackSupply } from '../boxed-expression/callback-arity.js';
import { canonicalCallbackOperand } from './collections.js';
import { MACHINE_PRECISION } from '../numerics/numeric.js';
import {
  isInFunctionBody,
  recordAssignmentLocals,
  recordLaterDeclarationLocals,
} from '../assignment-locals.js';
import {
  runWithEvaluationEffects,
  withEvaluationEffects,
} from '../effects-registry.js';
import { checkConditions } from '../boxed-expression/rules.js';
import {
  indexingSetSites,
  rangeElementIndexType,
} from '../boxed-expression/binding-sites.js';
import {
  collectTuplePattern,
  tuplePatternNames,
} from '../boxed-expression/tuple-pattern.js';
import {
  broadcastCellType,
  broadcastElementType,
  collectionElementType,
  functionResult,
  resolveTypeAlias,
  resolveTypeForCompilation,
  widen,
  stripMissingFromType,
  stripNumericRanges,
} from '../../common/type/utils.js';
import {
  broadcastLengthMismatch,
  hasTupleOrStringArm,
  isBroadcastableCollection,
  isEnumerableSource,
  isFiniteBroadcastParticipant,
  isUnresolvedCollectionOperand,
  isTuple,
  isTupleShapedType,
  typeCouldBeCollection,
  typeCouldBeUnkeyedCollection,
  isCollectionShaped,
  isWalkableFiniteCollection,
  mayCarryDimensions,
} from '../collection-utils.js';
import { parseType } from '../../common/type/parse.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
  isValidType,
} from '../../common/type/primitive.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  cannotHoldAList,
  isSubtype,
  provablyAdmits,
  provablyDisjoint,
} from '../../common/type/subtype.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import { isPolymorphicType, paramAt } from '../../common/type/instantiate.js';
import { functionLiteralDeclaredSignature } from '../boxed-expression/function-literal.js';
import { isGenericTarget } from '../multi-clause.js';
import { canonInstallSkipped } from '../clause-identity.js';
import {
  CancellationError,
  checkDeadline,
  run,
  runAsync,
} from '../../common/interruptible.js';
import type {
  Expression,
  OperandDescriptor,
  OperandStructure,
  TypeHandlerContext,
  SymbolDefinitions,
  OperatorDefinition,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  CollectionHandlers,
  BoxedValueDefinition,
  BoxedDefinition,
} from '../global-types.js';
import {
  errorValue,
  surplusOperandError,
} from '../boxed-expression/error-value.js';
import {
  isErrorTypedOperand,
  isErrorTypedWithoutErrorValue,
} from '../boxed-expression/error-typed-operand.js';
import { noteFailedWalk } from '../boxed-expression/incomplete-walks.js';
import {
  resolvesToSystemBinding,
  deriveApplicationOf,
  describeBoundSymbol,
} from '../boxed-expression/operand-descriptor.js';
import {
  isFunction,
  isNumber,
  isSymbol,
  isString,
  sym,
} from '../boxed-expression/type-guards.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { widenAssignedType } from '../boxed-expression/boxed-value-definition.js';
import {
  elementMemoFillTo,
  ELEMENT_MEMO_CAP,
} from '../boxed-expression/collection-element-memo.js';
import { evaluateMatch } from '../boxed-expression/match-dispatch.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';
import { isNearTiePair } from './relational-operator.js';
import { isExactConstantExpression } from '../boxed-expression/compare.js';
import {
  assignLoopIndex,
  bindIndexAuthoritatively,
  substituteBinderValues,
} from './utils.js';
import { journalCheckpointMapEntry } from '../checkpoint-journal.js';
import { scopeActivationTemplate } from '../boxed-expression/ambient-chain.js';
import { noteScopeDeclaration } from '../scope-declaration-count.js';
import {
  asyncEvaluationOf,
  topLevelEvaluationEpoch,
} from '../boxed-expression/evaluation-epoch.js';
import { smallCount } from '../boxed-expression/collection-count.js';
import {
  coarsenEvidenceType,
  markDeclaredLocal,
  registerEvidenceSite,
  withEvidenceSession,
} from './assignment-evidence.js';

/**
 * The supertype a `When` condition is checked against to be typed as a MASK
 * (one boolean per cell of the value). The `evaluate` handler zips a
 * condition whose value is a finite collection of boolean cells, whatever
 * kind of collection it is: a list, a set, a tuple, an indexed collection. So
 * the test is against the `collection<boolean>` family, which admits all of
 * them, and not against `list<boolean>` or `indexed_collection<boolean>`: a
 * `set<boolean>` condition was typed as a scalar condition while its value
 * was a list of cells. A string condition is not a mask: its elements are
 * characters, not booleans. A `missing` cell is not admitted: such a cell
 * does not activate the zip at runtime, so the condition keeps the scalar
 * typing.
 */
const BOOLEAN_MASK_TYPE = parseType('collection<boolean>')!;

/**
 * The collection types whose values are always FINITE: a list (and a
 * dimensioned `vector`, `matrix` or tensor, which are lists), a dictionary, a
 * record, and a `range`. A `Range` whose length is not known to be finite
 * (`Range(1, ∞)`, `Range(1, n)`) is typed `indexed_collection<integer>`, not
 * `range`. A `set` is not in this family: `Integers` is a `set<integer>` and
 * has no end.
 */
const FINITE_COLLECTION_TYPE = parseType(
  'list<any> | dictionary<any> | range'
)!;

/**
 * Whether a restriction carrier of type `type` is an ORDERED collection that
 * a mask condition zips element by element: a list, a vector, a matrix, a
 * range or any other `indexed_collection<T>`, finite or not. A type with a
 * tuple arm (a point) or a string arm is excluded, also when that arm is one
 * arm of a union such as `tuple<number, number> | list<tuple<number,
 * number>>`: such types are indexed collections, but a value of the tuple
 * or string arm is one value under a restriction, never zipped. A `set`, a
 * dictionary and a record are not indexed and are excluded too.
 *
 * A mask condition of length `k` pairs such a carrier with the mask over the
 * MASK's length: cell `i` is element `i` of the carrier where the mask is
 * true, and the absence marker of that element where it is false. The
 * carrier is read at the first `k` positions only, so an infinite carrier
 * such as `Range(1, ∞)` is never materialized (user decision 2026-09-29).
 *
 * The `evaluate` handler of `When` and `whenCollectionHandlers` both call
 * this predicate with the static type of the carrier OPERAND as written (a
 * symbol's declared type, not the type of the value it holds), so the held
 * form and the evaluated form decide the same way.
 */
function isOrderedCarrierType(type: Type): boolean {
  return (
    isSubtype(type, INDEXED_COLLECTION_SHAPE_TYPE) && !hasTupleOrStringArm(type)
  );
}

/**
 * Whether the value `value` held by a restriction carrier whose operand has
 * the static type `carrierType` is ONE value that a list of conditions never
 * splits into its elements. A string is always one value. A tuple (a point)
 * is one value, except when the carrier's static type is ordered
 * (`isOrderedCarrierType`): a symbol declared `indexed_collection<number>`
 * that holds `(1, 2)` is a collection of numbers by its declaration, so the
 * tuple is zipped with the mask. The compiled `_SYS.restrict` agrees: it
 * aligns an array with the mask and masks any other value whole, and a
 * string is not an array at run time.
 */
function isAtomicCarrierValue(carrierType: Type, value: Expression): boolean {
  if (isString(value)) return true;
  return isTuple(value) && !isOrderedCarrierType(carrierType);
}

/**
 * The first `k` elements of the ORDERED carrier `value`, read with ONE
 * iterator that stops after `k` elements, so an infinite or very long
 * carrier is never materialized and a lazy view (a `Filter`, a `Map`) calls
 * its function once per element read.
 *
 * - When the iterator ends before `k` elements, the carrier is SHORTER than
 *   the mask, and the elements read are returned: the restriction is
 *   truncated to the carrier's length, as for a finite carrier.
 * - When the elements cannot be read, the result is `undefined` and the
 *   restriction is held whole. This is the case for a carrier that cannot be
 *   enumerated (a valueless symbol, a range with a free or infinite lower
 *   bound), and for a walk that stops at the iteration limit (a `Filter`
 *   whose predicate rejects too many elements in a row): that stop is not a
 *   proof that the carrier has no more elements. The same rule decides a
 *   missed element read (`isProvablyOutOfRange`, `library/collections.ts`):
 *   a miss is decided only when it is proven.
 */
function orderedCarrierPrefix(
  value: Expression,
  k: number
): Expression[] | undefined {
  if (!isEnumerableSource(value)) return undefined;
  const elems: Expression[] = [];
  if (k <= 0) return elems;
  try {
    for (const elem of value.each()) {
      if (elem === undefined) return undefined;
      elems.push(elem);
      if (elems.length >= k) break;
    }
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  }
  return elems;
}

/**
 * The definition of `Block`. It belongs to the `core` library (`CORE_LIBRARY`,
 * `core.ts` lists it), not to `control-structures`: `Function` is in `core`
 * and canonicalizing a function literal needs `Block`, so an engine built
 * with `core` but without `control-structures` must still have it. The
 * handlers stay in this file because they share their statement-position
 * helpers with `Loop` and the other control structures.
 */
export const BLOCK_DEFINITION: OperatorDefinition = {
  description:
    'Evaluate a sequence of expressions in a local scope, **sequentially**. ' +
    'Each operand is evaluated in order; later operands observe side effects ' +
    "(`Assign`, `Declare`) of earlier operands. The block's value is the " +
    'value of the last expression. Short-circuiting heads (`Return`, ' +
    '`Break`, `Continue`) terminate the sequence early.\n\n' +
    'IMPORTANT — consumers translating *simultaneous* action tuples (e.g. ' +
    'Desmos `(a → 1, b → a + 1)` where `b` reads the *pre-action* `a`) must ' +
    'rewrite to a snapshot-then-commit Block: bind each RHS to a fresh temp ' +
    'first, then assign the temps to the LHS symbols. See ' +
    '`doc/84-reference-control-structures.md` for the canonical recipe.',
  lazy: true,
  scoped: true,
  signature: '(unknown*) -> unknown',
  // A SEQUENCER that RETURNS its last value: a statement is evaluated, a
  // bare function value is not auto-applied, so no position ever applies a
  // function-valued operand. Statement APPLICATIONS are untouched — their
  // effects reach the block through the `effectsOf` recursion into the
  // operand's own effects, not through the latent term this suppresses, so
  // `Block(Assign(x, 1), Random())` is still `{random, scope}`.
  //
  // The only term that changes is the latent half of a build-and-return
  // block, where the two channels DISAGREED: `Block(() ↦ Random())`
  // reported `{random}` at runtime while `(() ↦ Block(() ↦ Random()))`
  // already typed a PURE outer arrow — the inference treats `Block` as
  // non-projecting through its `acceptsCallable` gate. Annotating aligns
  // the runtime channel with the inference, matches the store/select/return
  // precedent (`List`, `If`, `Which`, `Assign`, `Declare`), and releases a
  // seed frame that a surviving build-and-return block owes no draws to.
  invokes: false,
  type: (args, context) => {
    if (args.length === 0)
      return BoxedType.forResult('nothing', context.engine._typeResolver);
    return BoxedType.forResult(
      args[args.length - 1].type,
      context.engine._typeResolver
    );
  },
  canonical: canonicalBlock,
  evaluate: evaluateBlock,
  evaluateAsync: evaluateBlockAsync,
};

/**
 * True when the branch of a conditional is typed `unknown` because of the
 * types of its operands, not because it reaches a function whose result is
 * still being derived: an untyped symbol (`untypedSymbolArm`), or an
 * application of a library operator whose `unknown` operands are such
 * branches too, or that has none (`At(s, 1)` with `s` a parameter typed
 * `indexed_collection<any>`). Such a branch makes the result of the
 * conditional `unknown`. With `f := (n, s) ↦ If(n = 0, s[1], [1, 2])`,
 * `f(0, [7])` is `7`, and the conditional was typed `vector<integer^2>`, by
 * its other branch alone (CE-447).
 *
 * The exclusions of `untypedSymbolArm` stay: an application of a function
 * that is not a library operator (a recursive call, typed `unknown` while
 * the signature it reads is derived), and a `Return`, `Break` or `Continue`,
 * which gives no value in place. A `Block` and a nested conditional are
 * excluded too, since their last statement or branch can be such a call.
 * The walk stops at a depth of 8.
 */
function untypedArm(
  branch: OperandDescriptor,
  engine: TypeHandlerContext['engine'],
  depth = 0
): boolean {
  if (branch.type !== 'unknown') return false;
  const s = branch.structureOf?.();
  if (s?.kind === 'symbol') return true;
  if (s?.kind !== 'application' || s.callee !== undefined || depth >= 8)
    return false;
  if (NOT_A_VALUE_IN_PLACE.has(s.head)) return false;
  if (!resolvesToSystemBinding(engine, s.head)) return false;
  return s.children.every(
    (c) => c.type !== 'unknown' || untypedArm(c, engine, depth + 1)
  );
}

/** The heads whose `unknown` type `untypedArm` does not read as the type
 * of a value given in place. */
const NOT_A_VALUE_IN_PLACE = new Set([
  'Return',
  'Break',
  'Continue',
  'Block',
  'If',
  'Which',
]);

export const CONTROL_STRUCTURES_LIBRARY: SymbolDefinitions[] = [
  {
    // A condition expression tests for one or more conditions of an expression.
    // Two forms:
    //   ['Condition', value, "positive"]  — tests value against named condition(s)
    //   ['Condition', predicate]          — set-builder predicate (e.g. x > 0)
    Condition: {
      description: 'Test whether a value satisfies one or more conditions.',
      lazy: true,
      signature: '(expression, symbol?) -> boolean',
      evaluate: ([value, conds], { engine }) => {
        let conditions: string[] = [];
        if (isSymbol(conds)) {
          conditions = [conds.symbol];
        } else if (isFunction(conds, 'And')) {
          conditions = conds.ops.map((op) => sym(op) ?? '');
        }
        if (checkConditions(value, conditions)) return engine.True;
        return engine.False;
      },
    },

    If: {
      description:
        '`If(c, e1, e2)` evaluates to `e1` when `c` is `True` and to `e2` otherwise; without `e2` it is `Missing` when `c` is `False`. Only the selected expression is evaluated.\n' +
        'When `c` is a list of booleans (`L < 3` with `L` a list), the selection is made at each position and the value is a list: `If([True, False, True], 1, 0)` is `[1, 0, 1]`, and with `L = [1, 3, 5]`, `If(L < 3, L, 0)` is `[1, 0, 0]`. `If(c, e1, e2)` is then `Which(c, e1, True, e2)`: see `Which` for the rules of element-wise selection.',
      lazy: true,
      // Selects among its operands, so an error in an operand it does not
      // choose does not bubble (`docs/ERROR-MODEL.md` §3).
      selectsOperands: true,
      signature: '(expression, expression, expression?) -> any',
      // A SELECTOR: the condition is tested and one branch is evaluated and
      // RETURNED — no position ever applies a function-valued operand. So
      // `If(c, randomF, pureF)` has no `random`: the draw fires at whatever
      // invokes the selected result. The branches are held may-evaluate
      // positions, so their own (production) effects still contribute
      // unchanged — `If(c, Random(), 0)` is still `{random}`.
      invokes: false,
      // The else branch is optional: `If(cond, expr)` evaluates to `Missing`
      // when the condition is false — the position-preserving absent datum,
      // never `Nothing`, whose splicing erasure must not answer a failed
      // selection (ERROR-MODEL §1; no-selection ruling 2026-08-27, shared
      // with `Which`).
      // The handler reads only the operands' TYPES, so it is declared on the
      // descriptor shape and cannot touch engine state while deriving.
      type: ([cond, ifTrue, ifFalse], context) => {
        // A type read must never crash, whatever the application looks like.
        // The parse and box routes both admit a malformed `If` with no
        // branch at all, which reaches this handler with `ifTrue`
        // undefined; it answers `unknown` rather than dereferencing a
        // missing operand — the same hardening `When` carries.
        if (ifTrue === undefined)
          return BoxedType.forResult('unknown', context.engine._typeResolver);
        // A condition that is provably a mask (a collection of condition
        // values, of any rank) selects element-wise (see
        // `evaluateElementwiseSelection`): the result is a list that follows
        // the mask, of the branches' types at the depth of its cells.
        const shape = elementwiseConditionShape([cond?.type]);
        const armList = [ifTrue, ifFalse]
          .filter((x) => x !== undefined)
          .map((x) => x.type);
        if (shape)
          return BoxedType.forResult(
            elementwiseResultType(
              armList,
              shape,
              // The else branch IS the default clause: without one, unselected
              // positions are the no-match cell (`noMatchCell`).
              ifFalse !== undefined
            ),
            context.engine._typeResolver
          );
        // A condition that is only POSSIBLY a boolean collection selects
        // element-wise for some of its runtime values and picks a single arm
        // for the others, so the result is `broadcastable` of the element-wise
        // cell type, joined with each arm that this type does not admit
        // (`possiblyElementwiseResultType`). Without an else branch the scalar
        // outcome is `Missing`, which `broadcastable` does not cover, so keep
        // that arm.
        if (possiblyElementwiseCondition([cond?.type])) {
          const broadcast = possiblyElementwiseResultType(
            armList,
            ifFalse !== undefined
          );
          return BoxedType.forResult(
            ifFalse !== undefined
              ? broadcast
              : reduceType({ kind: 'union', types: [broadcast, 'missing'] }),
            context.engine._typeResolver
          );
        }
        // Without an else branch a false condition yields `Missing`, and that
        // arm must survive in the type, so build the union explicitly rather
        // than through `widen` (which joins toward a common supertype and
        // would dissolve the absence marker into a top type).
        const scalar: Type =
          ifFalse === undefined
            ? reduceType({
                kind: 'union',
                types: [ifTrue.type, 'missing'],
              })
            : untypedArm(ifTrue, context.engine) ||
                untypedArm(ifFalse, context.engine)
              ? 'unknown'
              : widen(ifTrue.type, ifFalse.type);
        // A condition that is a scalar or a mask (`boolean | list<boolean>`,
        // `scalarOrMaskConditionShape`) gives the scalar result or the
        // element-wise result of its masks: with `c := [True, False]`,
        // `If(c, 1, 0)` is `[1, 0]`.
        const mixed = scalarOrMaskConditionShape([cond?.type]);
        // A whole-collection comparison that is undecided (`[1, 2] = [1,
        // Missing]`) selects no branch, and the `If` is `Missing`
        // (`evaluateCondition`). Such a condition is typed `boolean |
        // missing`, so the result keeps a `missing` arm.
        const undecided = mayBeUndecidedCondition([cond]);
        if (mixed)
          return BoxedType.forResult(
            withUndecidedArm(
              reduceType({
                kind: 'union',
                types: [
                  scalar,
                  elementwiseResultType(armList, mixed, ifFalse !== undefined),
                ],
              }),
              undecided
            ),
            context.engine._typeResolver
          );
        // A condition whose type cannot be read and that may hold a list (an
        // operand of type `unknown`) can be a mask of any rank at run time:
        // with `c := [True, False]`, `If(c, 1, 0)` is `[1, 0]`. The result is
        // the scalar result or the element-wise result for a mask of unknown
        // rank.
        if (cond !== undefined && unreadableConditionMayBeMask(cond.type))
          return BoxedType.forResult(
            withUndecidedArm(
              reduceType({
                kind: 'union',
                types: [
                  scalar,
                  elementwiseResultType(armList, {}, ifFalse !== undefined),
                ],
              }),
              undecided
            ),
            context.engine._typeResolver
          );
        return BoxedType.forResult(
          withUndecidedArm(scalar, undecided),
          context.engine._typeResolver
        );
      },
      canonical: (ops, { engine }) => {
        // The condition (op 0) is an ordinary expression, checked for a
        // provably non-boolean type (`conditionOperand`); the then/else
        // branches (ops 1+) are statement positions, so reject a bare
        // `Break`/`Continue` symbol there.
        const xs = ops.map((op, i) =>
          i === 0
            ? conditionOperand(engine, op.canonical)
            : canonicalStatement(engine, op)
        );
        // The condition and the then branch are required. A missing one is
        // an `Error("missing")` operand in its place, as `checkArity()` does
        // for other operators: the expression is invalid, and its evaluate
        // handler is never called with an absent operand.
        while (xs.length < 2) xs.push(engine.error('missing'));
        return engine._fn('If', xs);
      },
      // A surplus operand after the else branch is refused, as for any
      // built-in operator: the whole call is the `unexpected-argument` error
      // (`surplusOperandError`), whatever the condition.
      evaluate: (ops, options) =>
        surplusOperandError(options.engine, 'If', ops, options.expression, 3) ??
        evaluateIf(ops, options),
      evaluateAsync: async (ops, options) =>
        surplusOperandError(options.engine, 'If', ops, options.expression, 3) ??
        evaluateIfAsync(ops, options),
    },

    Loop: {
      description:
        'Imperative loop, evaluated **for effect**. `Loop(body)` repeatedly ' +
        'evaluates `body` until it yields a `Break` or `Return`. ' +
        '`Loop(body, Element(x, coll), …)` iterates `body` in nested ' +
        'iteration over the Element clauses (later clauses see earlier ' +
        'bindings; independent clauses produce a Cartesian product). The loop ' +
        'value is `Nothing`, or the value carried by a `Break`/`Return`. For a ' +
        'value-producing comprehension use `Comprehension` or `Map`.',
      lazy: true,
      // The index of each `Element` clause (from operand 1) is this operator's
      // BOUND variable: the framework declares it in the loop's own scope
      // before the clauses and body are canonicalized against it.
      scoped: indexingSetSites(1),
      signature: '(body:expression, iterators:expression*) -> any',
      // The handler reads the body's inert STRUCTURE (does it contain a
      // value-carrying `Return`/`Break`?), never the body expression, so it is
      // declared on the descriptor shape.
      type: ([body], context) => {
        if (!body)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        // A `Loop` is evaluated for effect: its value is `Nothing` unless the
        // body can short-circuit with a value (`Break v` / `Return`).
        return BoxedType.forResult(
          loopBodyYieldsValue(body.structureOf?.()) ? 'unknown' : 'nothing',
          context.engine._typeResolver
        );
      },
      canonical: (ops, options) => canonicalLoopLike('Loop', ops, options),
      // While the loop runs, its own scope (the index) and the scopes nested
      // in its body are marked as in use, so that a function literal
      // evaluated in the body captures the current index value and the
      // current body locals instead of reading the shared scopes later (see
      // `captureNestedLocals`, `function-utils.ts`).
      evaluate: (ops, { engine: ce, expression }) => {
        const nested = enterNestedBodyScopes(expression, {
          includeRoot: true,
          save: false,
        });
        try {
          return run(
            runLoop(ops[0], ops.slice(1), ce),
            ce._timeRemaining,
            ce._deadlineFrame
          );
        } finally {
          exitNestedBodyScopes(ce, nested);
        }
      },
      evaluateAsync: async (
        ops,
        {
          engine: ce,
          signal,
          effects,
          expression,
          _contextStack,
          _precisionWindow,
        }
      ) => {
        const nested = enterNestedBodyScopes(expression, {
          includeRoot: true,
          save: false,
        });
        try {
          return await runAsync(
            // The loop body is evaluated synchronously, and `runAsync`
            // suspends this handler between time slices: every step must run
            // with the host capability registry and the context stack (the
            // scope of the loop index) this evaluation captured.
            withEvaluationEffects(
              ce,
              effects,
              runLoop(ops[0], ops.slice(1), ce),
              _contextStack,
              _precisionWindow
            ),
            ce._timeRemaining,
            signal,
            ce._deadlineFrame
          );
        } finally {
          exitNestedBodyScopes(ce, nested);
        }
      },
    },

    Comprehension: {
      description:
        'Value-producing comprehension: evaluate `body` in nested iteration ' +
        'over one or more `Element` clauses and collect the results into a ' +
        'list. Later clauses see earlier bindings; ' +
        'independent clauses produce a Cartesian product. A clause with a ' +
        'third operand, `Element(x, xs, cond)`, is a guard: only the ' +
        'elements for which `cond` evaluates to `True` are visited.',
      lazy: true,
      // See `Loop`: each `Element` clause's index is a bound variable of this
      // node.
      scoped: indexingSetSites(1),
      signature: '(body:expression, iterators:expression+) -> list',
      // The handler reads the body operand's type, and the type of the index
      // of each `Element` clause.
      type: ([body, ...clauses], context) => {
        if (!body)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        // Result is a list of body.type values (`list<T>` since 2026-09-29;
        // it was `indexed_collection<T>`, which a symbol declared `list`
        // refused). The body's type may itself be parametric (e.g. a tuple):
        // wrap it in list<...>. The type says nothing about the length: a
        // comprehension over an unbounded source is a lazy list, as a `Map`
        // over it is.
        //
        // The index of a clause over a range with integer literal bounds has
        // a ranged type (`integer<1..16>`, see `indexingSetSite` in
        // `binding-sites.ts` and `canonicalLoopLike`). That type is there for
        // the body: it proves the sign of `√((k − 0.5)/16)`, so the body
        // types `real` and compiles without the complex lane. It is not a
        // statement about the list: the element type is the type of the
        // body with each such index typed `integer`
        // (`bodyTypeWithoutIndexRanges`), so `[k for k in 1..16]` is
        // `list<integer>`, not `list<integer<1..16>>`.
        const elements = bodyTypeWithoutIndexRanges(body, clauses, context);
        return BoxedType.forResult(
          { kind: 'list', elements },
          context.engine._typeResolver
        );
      },
      canonical: (ops, options) =>
        canonicalLoopLike('Comprehension', ops, options),
      // A `Comprehension` is a LAZY indexed collection, like `Range`/`Map`: it
      // has no `evaluate` handler, so `evaluate()` returns the comprehension
      // itself. Its `.count`/`.type`/collection-ness are answered without
      // walking elements (see the `collection` handler below); elements are
      // materialized only when actually indexed or iterated. Binding an unread
      // comprehension is therefore O(1), rather than materializing its whole
      // domain up front.
      collection: comprehensionCollectionHandlers(),
    },

    // `Break`/`Continue` are inert: they have no `evaluate` handler, so they
    // evaluate to themselves (with their operands evaluated) and are
    // intercepted structurally by `Loop`/`Block`. They are NOT `lazy`: the
    // optional `Break` value must be evaluated in the loop context so a value
    // referencing the loop variable is concrete (mirrors `Return`).
    Break: {
      description:
        'Exit the enclosing loop immediately, optionally with a value ' +
        '(`Break(v)`) that becomes the loop value.',
      signature: '(value:any?) -> nothing',
    },

    Continue: {
      description: 'Skip to the next iteration of the enclosing loop.',
      signature: '() -> nothing',
    },

    When: {
      description:
        'Conditional/restriction value. `When(e, cond)` evaluates to:\n' +
        '  - `e` when `cond` evaluates to `True`\n' +
        '  - the absence marker of the type of `e` when `cond` evaluates to `False` (the "masking rule"): `NaN` for a number, `Missing` — the position-preserving absent datum, the answer a selection with no selected branch gives — for a point, a list, a string or a value not provably numeric; consumers like 2D plotters skip masked points\n' +
        '  - `When(e, cond_simplified)` when `cond` is indeterminate (holds)\n' +
        'Stacked restrictions canonicalize: `When(When(e, c1), c2)` → `When(e, And(c1, c2))`.\n' +
        'Compiles to ternary `(cond) ? (e) : NaN` in JS and GLSL.',
      lazy: true,
      signature: '(expression, boolean) -> any',
      type: ([expr, cond], context) => {
        // A list/vector-of-booleans condition broadcasts: the result is a
        // list whose element type is `expr`'s type (see the broadcast branch
        // in `evaluate`). Lazy operators bypass the generic list-broadcast
        // typing wrapper, so lift the type here explicitly — but only when the
        // condition's *declared* type is a list/vector of booleans. A scalar
        // or unknown boolean condition keeps `expr`'s type.
        //
        // A false condition masks the value to `Missing`, and that arm must
        // survive in the type — as it does for a `Which` with no default
        // clause and for the else-less `If` (no-selection ruling of
        // 2026-08-27; `When` aligned 2026-09-09). The union is built
        // explicitly rather than through `widen`, which joins toward a
        // common supertype and would dissolve the absence marker into a top
        // type. Only a condition that is the literal `True` symbol can never
        // mask, so only that case keeps `expr`'s bare type.
        //
        // A type read must never crash, whatever the application looks
        // like, so a malformed arity-0 `When` answers `unknown` here. (An
        // earlier version of this handler dereferenced `expr.type`
        // unconditionally and threw on that input.)
        if (expr === undefined)
          return BoxedType.forResult('unknown', context.engine._typeResolver);
        // The handler reads operand VIEWS (the descriptor route), so the
        // literal is recognized through `structureOf`, exactly as the `Which`
        // type handler finds its default clause.
        const condStructure = cond?.structureOf?.();
        if (condStructure?.kind === 'symbol' && condStructure.name === 'True')
          return BoxedType.forResult(expr.type, context.engine._typeResolver);
        // The mask test accepts any collection of booleans, not only a
        // `list` (see `BOOLEAN_MASK_TYPE`): the `evaluate` handler zips every
        // finite collection of boolean cells, so a condition typed
        // `set<boolean>` or `indexed_collection<boolean>` is a mask as much
        // as a `list<boolean>` is.
        // A mask of rank 2 or more, or a mask whose rank the type does not
        // give, selects cell by cell at every level, as the else-less
        // `If(cond, expr)` does (see the `evaluate` handler), so the result
        // has the type of that `If`.
        const shape =
          cond === undefined
            ? undefined
            : elementwiseConditionShape([cond.type]);
        if (shape !== undefined && shape.rank !== 1)
          return BoxedType.forResult(
            elementwiseResultType([expr.type], shape, false),
            context.engine._typeResolver
          );
        if (cond !== undefined && isSubtype(cond.type, BOOLEAN_MASK_TYPE)) {
          // Built structurally, not from a type STRING: a literal element
          // type (`When(1, [c1, c2])` types `list<1 | missing>`) has no
          // string spelling the parser accepts inside a union.
          //
          // A list-valued `expr` is zipped with the mask, cell by cell (see
          // the broadcast branch in `evaluate`), so the cells of the result
          // are the CELLS of `expr`, not `expr` itself:
          // `[10,20,30]{[1,2,3] > 2}` is `[Missing, Missing, 30]`, a
          // `list<integer | missing>`. A scalar `expr` is masked whole in
          // every cell.
          //
          // The `evaluate` handler zips a finite collection value that is
          // not a tuple (a point is one value) and not a string (atomic
          // under restriction), and it zips an ORDERED carrier
          // (`isOrderedCarrierType`) whatever its length, reading only the
          // elements the mask needs. When the elements of an ordered
          // carrier cannot be read (a valueless symbol, a range with a free
          // bound), the restriction is held whole, so its value is typed by
          // this handler. Otherwise each cell is the WHOLE value. A type
          // with a tuple or a string arm (`tuple<number, number> |
          // list<tuple<number, number>>`) is not ordered: it takes the join
          // branch below, because its value can be one point. The type
          // follows the same rule:
          // - a carrier that is finite by type (`FINITE_COLLECTION_TYPE`: a
          //   `list<T>`, a `vector`, a `matrix`, a `dictionary`, a `record`,
          //   a `range`) or ordered by type (`indexed_collection<T>`, which
          //   can be infinite, such as `Range(1, ∞)`) is always zipped, so
          //   each cell has its ELEMENT type `T`. `When(Range(1, ∞),
          //   [True, False])` evaluates to `[1, NaN]` (a masked number is
          //   `NaN`);
          // - a carrier of an UNORDERED collection type that is not finite
          //   by type (`collection<T>`, `set<T>`) can hold an infinite set,
          //   such as `Integers`, which has no first element and is not
          //   zipped: each cell is then the whole value. So a cell can be
          //   either an element (a finite set is zipped) or the whole value,
          //   and its type is the JOIN of the element type and the carrier
          //   type. `When(Integers, [True, False])` evaluates to
          //   `[Integers, Missing]`, which the element type `integer` alone
          //   does not admit;
          // - a tuple, a string or a scalar value is never zipped, so each
          //   cell has the type of the whole value.
          // The result is a `list` whatever the carrier is, because the
          // value the `evaluate` handler builds is a `List`.
          const zippable =
            isSubtype(expr.type, COLLECTION_SHAPE_TYPE) &&
            !isTupleShapedType(expr.type) &&
            !isSubtype(expr.type, 'string');
          const element = zippable
            ? (collectionElementType(expr.type) ?? 'unknown')
            : undefined;
          const cell: Type =
            element === undefined
              ? expr.type
              : isSubtype(expr.type, FINITE_COLLECTION_TYPE) ||
                  // An ordered type that admits a STRING value
                  // (`indexed_collection<character>`) takes the join branch:
                  // a string is one value under a restriction, never zipped
                  // (`isAtomicCarrierValue`), so a cell can be the whole
                  // string, which the element type `character` does not
                  // admit.
                  (isOrderedCarrierType(expr.type) &&
                    !isSubtype('string', expr.type))
                ? element
                : reduceType({
                    kind: 'union',
                    // A masked numeric element of a zipped finite set is
                    // `NaN`, so a numeric element arm is `number`, the type
                    // that admits `NaN`, as the zipped branch above answers
                    // `list<number>`: `When({1, 2}, [True, False])` is
                    // `[1, NaN]`.
                    types: [
                      isNumericValueType(element) ? 'number' : element,
                      expr.type,
                    ],
                  });
          // A masked NUMERIC cell is `NaN` (`maskedValue`), so the cells are
          // numbers, `list<number>`: the materialized list the mask answers
          // (`[NaN, NaN, 30]`) is typed by the `List` handler, which joins a
          // `NaN` cell and an integer cell to `number`. Any other cell keeps
          // its `missing` arm.
          return BoxedType.forResult(
            {
              kind: 'list',
              elements: isNumericValueType(cell)
                ? 'number'
                : reduceType({ kind: 'union', types: [cell, 'missing'] }),
            },
            context.engine._typeResolver
          );
        }
        // A NUMERIC value masks to `NaN` (`maskedValue`), so its type is its
        // own tier with the `nan` arm, `integer | nan` for `When(1, c)`, and
        // no `missing` arm (user decision 2026-09-25; it was
        // `integer | missing`). The tier is kept — rather than absorbed to
        // `number` — so that the value stays admitted where the tier matters:
        // an element read of a restricted row is typed
        // `integer | missing | nan` by `At`, and a declared range or an
        // assumption reads the held literal back through it.
        if (isNumericValueType(expr.type))
          return BoxedType.forResult(
            withNanArm(expr.type),
            context.engine._typeResolver
          );
        // A list-like value keeps its own type under the `missing` arm,
        // `missing | vector<integer^2>` for `When([1,2], c)`: while the
        // condition is undecided the value is the held `When` itself (never a
        // copy of the cells into a `List` of `When`s — see the `evaluate`
        // handler), whose type is this one, and when the condition is decided
        // the value is the whole list or `Missing`. The cells the held form
        // enumerates are restricted cells, `When(elem, c)`, each typed
        // `elem | missing`; an element access carries that arm through its
        // own marker (`At`, `First`). A LITERAL list of restricted cells,
        // `[1{c}, 2{c}]`, is a different value, typed `list<integer | missing>`
        // by the `List` type handler.
        return BoxedType.forResult(
          reduceType({ kind: 'union', types: [expr.type, 'missing'] }),
          context.engine._typeResolver
        );
      },
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return null;
        const [expr, cond] = args;
        // Canonicalize stacked restrictions:
        //   When(When(e, c1), c2)  →  When(e, And(c1, c2))
        if (isFunction(expr, 'When')) {
          const inner = expr.op1.canonical;
          const innerCond = expr.op2.canonical;
          // Build the merged condition through canonical `And`, not `_fn`:
          // canonical `And` flattens and validates its operands (in written
          // order — since 2026-08-15 `And` is a short-circuit form and no
          // longer sorts; see `canonicalShortCircuit` in `logic.ts`).
          // Building with `_fn` skipped canonicalization altogether, which
          // at the time (when `And` still sorted) left the conjunction in
          // authored order while `.json` (which goes through `structural`)
          // sorted — so `x{a}{b}` and `x{b}{a}` serialized to identical
          // MathJSON while `isSame`/`hash` disagreed, and `ce.box(e.json)`
          // was not `isSame` to `e` (Tycho item-153 seed, the 11
          // `differs-json-equal` rows). Every view of the tree must come
          // from the same canonical construction.
          return ce._fn('When', [
            inner,
            ce.function('And', [innerCond, cond.canonical]),
          ]);
        }
        return ce._fn('When', [expr.canonical, cond.canonical]);
      },
      evaluate: ([expr, cond], options) => {
        const ce = options.engine;
        // The numeric request is forwarded to the guard, as the value is
        // given it below: a comparison in the guard then reads an exact
        // operand exactly, as at the top level (see `evaluateIf`).
        const c = cond.evaluate(
          options.numericApproximation
            ? { numericApproximation: true }
            : undefined
        );

        // Desmos-style broadcast: a finite indexed collection of booleans
        // masks element-by-element (one masked branch per element). This
        // mirrors the boolean-mask branch of `At` in `collections.ts`. Lazy
        // operators bypass the generic broadcast machinery, so handle it here.
        if (c.isCollection && isWalkableFiniteCollection(c)) {
          const conds = Array.from(c.each()) as Expression[];
          // A cell is a boolean condition when it types `boolean` — or
          // `broadcastable<boolean>`, the type of a comparison whose broadcast
          // outcome is not statically settled (`h(x) ≤ 1` with `h`
          // undeclared; see `comparisonResultType`,
          // `library/relational-operator.ts`). Such a cell is a scalar
          // relation here (it is one element of the materialized mask) and
          // is held exactly like an undecided `boolean` one; gating on
          // `boolean` alone left `x{h(x) ≤ [1,2,3]}` un-broadcast as
          // `When(x, [h(x) ≤ 1, …])`.
          // An EMPTY list of conditions masks nothing: the answer is the
          // empty list, as the element-wise `Which` answers it. (Before, the
          // empty list fell through to the branch below and distributed the
          // value into held restrictions, `[10{[]}, 20{[]}, …]`.)
          // A mask of rank 2 or more (a list with a list of conditions in
          // it, such as `M < 0` over a matrix `M`) selects cell by cell at
          // every level, as `If` and `Which` do (user decision 2026-10-23,
          // ROADMAP CE-223.1): `When(v, C)` is the else-less `If(C, v)`. A
          // cell that no condition selects is the masked value of the cell
          // (`NaN` for a number, `Missing` otherwise), and a value of lower
          // rank than the mask is an `incompatible-dimensions` error. When
          // the selection cannot be computed now, the restriction is held.
          const mask = conditionCells(c);
          if (
            mask !== undefined &&
            mask.cells.some((cell) => typeof cell !== 'string')
          )
            return (
              evaluateElementwiseSelection(
                ce,
                [{ cond, arm: expr }],
                { cond: c, mask },
                options
              ) ?? ce._fn('When', [expr, c])
            );
          if (
            conds.every(
              (ci) =>
                ci.type.matches('boolean') ||
                possiblyElementwiseCondition([ci.type.type])
            )
          ) {
            // If `expr` itself evaluates to a finite indexed collection, zip
            // elementwise (expr_i masked by c_i); otherwise mask the scalar
            // `expr` by each c_i. Different lengths truncate to the shorter,
            // matching `At`'s mask alignment. A tuple is ONE value — a point
            // restricted by a list of conditions is that point at every true
            // position, as `Which` answers — so it is never zipped: with the
            // zip, `(1, 2){[1, 2, 3] < 2}` answered `[1, Missing]`, the
            // point's coordinates masked cell by cell. A string is one value
            // too (the lattice reads it as a collection of its characters).
            //
            // A carrier whose static type is ORDERED (`isOrderedCarrierType`:
            // a list, a vector, a range, an `indexed_collection<T>`) is
            // zipped whatever its length, over the MASK's length (user
            // decision 2026-09-29): `When(Range(1, ∞), [True, False])` is
            // `[1, NaN]`, not `[Range(1, ∞), Missing]`. Only the first `k`
            // elements are read, with one iterator
            // (`orderedCarrierPrefix`), so an infinite carrier or a lazy
            // view over one is never materialized. The static type of such
            // a restriction is `list<missing | T>`, or `list<number>` when
            // `T` is numeric, from the element type `T` alone, so the value
            // must be the zipped cells:
            // - a TUPLE value held by a symbol declared with an ordered type
            //   (`P: indexed_collection<number>` assigned `(1, 2)`) is
            //   zipped too, as the declaration says it is a collection of
            //   elements (`isAtomicCarrierValue`). A tuple whose own type
            //   says so is still one value, as above, and a STRING is one
            //   value whatever the declaration;
            // - a carrier with fewer elements than the mask follows the
            //   finite rule: the result is truncated to the shorter length;
            // - when the elements cannot be read — a valueless symbol
            //   declared `list<number>`, a range with a free bound such as
            //   `Range(1, n)`, a lazy `Filter` whose walk stops at the
            //   iteration limit — the whole restriction is held
            //   unevaluated, `When(carrier, mask)`, which is typed by the
            //   type handler. Before, each cell was the whole carrier
            //   (`[P, Missing, P]`), a value the element-only type does not
            //   admit. The held form does not present as a collection
            //   (`isCollection` is false, `count` is undefined) until the
            //   carrier's elements can be read, as a restriction whose mask
            //   is not resolved is held.
            const ev = expr.evaluate(options);
            const ordered = isOrderedCarrierType(expr.type.type);
            const atomic = isAtomicCarrierValue(expr.type.type, ev);
            let zip = false;
            let elems: Expression[] = [];
            if (ordered && !atomic) {
              const prefix = ev.isCollection
                ? orderedCarrierPrefix(ev, conds.length)
                : undefined;
              if (prefix === undefined) return ce._fn('When', [expr, c]);
              elems = prefix;
              zip = true;
            } else if (
              !atomic &&
              ev.isCollection &&
              isWalkableFiniteCollection(ev)
            ) {
              // An unordered finite carrier (a finite set), or a carrier
              // whose static type is not ordered but whose value is a finite
              // collection: every element is read.
              elems = Array.from(ev.each()) as Expression[];
              zip = true;
            } else if (
              !atomic &&
              ev.isCollection &&
              ev.isFiniteCollection === true
            ) {
              // A finite carrier whose elements cannot be computed
              // (`QuotientRing(Integers, 5)`, `Linspace(a, 1, 3)` with a
              // symbolic `a`). It is a collection of elements, so the scalar
              // lifting below does not apply, and its elements cannot be
              // zipped with the mask: hold the restriction unevaluated, as
              // the ordered-carrier branch above does.
              return ce._fn('When', [expr, c]);
            }
            const n = zip ? Math.min(conds.length, elems.length) : conds.length;
            const result: Expression[] = [];
            for (let i = 0; i < n; i++) {
              const ci = conds[i];
              const cis = sym(ci);
              // The per-element expression: the zipped element, or the scalar.
              const elem = zip ? elems[i] : ev;
              if (cis === 'True') result.push(elem);
              else if (cis === 'False') result.push(maskedValue(ce, elem));
              // Indeterminate (symbolic boolean): hold `When` on the element.
              else result.push(ce._fn('When', [zip ? elems[i] : expr, ci]));
            }
            return ce._fn('List', result);
          }
        }

        const cs = sym(c);
        if (cs === 'True') return expr.evaluate(options);
        // A false guard masks the value to the absence marker of the VALUE'S
        // type (`maskedValue`, user decision 2026-09-25): `NaN` for a number,
        // `Missing` — the position-preserving absent datum — for a point, a
        // list or a value not provably numeric. Before, every value masked to
        // `Missing` (ruling of 2026-09-09), the one place the engine spelled
        // an absent number as `Missing`; a numeric operator over it answered
        // `NaN` (`2·Missing` is `NaN`), so `2·x{c}`, threaded to `2x{c}`,
        // answered `Missing` on the held route and `NaN` when evaluated
        // fresh. The compiled code has always emitted `NaN` for a masked
        // number.
        if (cs === 'False') return maskedValue(ce, expr);
        // A guard that evaluates to `Undefined` masks (decision 9): no value,
        // treated as not-True rather than held.
        if (cs === 'Undefined') return maskedValue(ce, expr);

        // Indeterminate scalar condition over a collection value: the
        // restriction stays ONE held `When` over the evaluated collection,
        // and its `collection` handlers (`whenCollectionHandlers`) present it
        // as a collection whose elements are the restricted cells, so
        // `isCollection`, `count` and `each()` agree with `.type` (Tycho item
        // 66). The cells are NOT copied into a `List` of `When`s, whatever
        // the size (user decision 2026-09-25): a copy forgot that the cells
        // came from one restriction, so the copied form re-evaluated to
        // `[Missing, Missing]` once the condition failed, where the same
        // expression evaluated fresh — and its compiled code — answered the
        // whole-list `Missing`. Held, the two routes agree. (Before, a
        // collection of at most `MAX_SIZE_EAGER_COLLECTION` elements was
        // copied, mirroring `PointList`, and a larger one was held.) The type
        // check gates the extra `evaluate` so a scalar `When` keeps its held
        // form unchanged.
        // A `Tuple` is excluded: it is a fixed-arity structure (a point), not a
        // list to broadcast over, so a restricted point must stay a point
        // rather than degrade to a `List`. Mirrors `PointList`'s
        // `isListComponent` predicate in `collections.ts`.
        // A tuple-typed value is excluded before it is evaluated: evaluating
        // it here would force every component of a value the restriction is
        // meant to keep held, changing the lazy guard semantics for a shape
        // that can never enter the distribution path anyway.
        // A STRING is excluded for the same reason a tuple is: it is an
        // indexed collection of characters, but it is atomic under
        // element-wise distribution, so `When("ab", c)` must stay a restricted
        // string rather than become a list of restricted characters.
        // A CONDITION that is collection-typed but carries no value yet is a
        // MASK that cannot be read yet, not the scalar guard this branch
        // handles: `When([1,2], B)` for a valueless `B: list<boolean>` stays
        // held with `B` unread; the list-condition branch above zips the mask
        // once it resolves (Tycho item 221).
        if (
          expr.type.matches('collection<any>') &&
          !isTupleShapedType(expr.type.type) &&
          !expr.type.matches('string') &&
          !isUnresolvedCollectionOperand(c)
        ) {
          const ev = expr.evaluate(options);
          if (isFiniteBroadcastParticipant(ev)) return ce._fn('When', [ev, c]);
        }

        // Indeterminate: hold
        return ce._fn('When', [expr, c]);
      },
      collection: whenCollectionHandlers(),
    },

    Which: {
      description:
        '`Which(c1, e1, c2, e2, …)` evaluates to the value of the first `e` whose condition `c` is `True`, and to `Missing` when no condition is `True`. A last clause with the condition `True` is the default. Only the selected expression is evaluated.\n' +
        'Element-wise selection: when a condition is a list of booleans (`L < 3` with `L` a list), the selection is made at each position, as `numpy.select` does, and the value is a list. At each position, the first clause whose condition is `True` there gives the value: an expression that is a list gives its element at that position, any other expression gives its own value. With `L = [1, 3, 5]`, `Which(L < 2, 10, L < 4, L, True, 0)` is `[10, 3, 0]`.\n' +
        '  - A condition that is not a list applies to every position.\n' +
        '  - Every list must have the length of the condition, else the value is an `incompatible-dimensions` error.\n' +
        '  - A position that no clause selects holds `NaN` when every expression is a number, `Missing` otherwise.\n' +
        '  - A condition that is a list of lists (a comparison of a matrix) selects at every level; an expression with fewer levels than the condition is an `incompatible-dimensions` error, one with more levels is taken whole at each position.',
      keywords: ['piecewise'],
      lazy: true,
      // Selects among its operands, so an error in an operand it does not
      // choose does not bubble (`docs/ERROR-MODEL.md` §3).
      selectsOperands: true,
      signature: '(expression+) -> unknown',
      // A SELECTOR, like `If`: conditions are tested, the first matching arm is
      // evaluated and RETURNED, and no position applies a function-valued
      // operand. Held-position (production) effects are unaffected.
      invokes: false,
      // The handler reads the operands' types plus one structural fact — a
      // literal `True` condition names the default clause — so it is declared
      // on the descriptor shape and cannot touch engine state.
      type: (args, context) => {
        // The operands are strictly PAIRED, so an odd count is a malformed
        // call, and the `canonical` handler below turns such a call into an
        // `Error`. An odd list still reaches this handler on the structural
        // route, which skips canonicalization — but that expression
        // canonicalizes when it is evaluated, so its VALUE is that same
        // `Error`. The one route that reads an odd list as a working
        // selection is `ce._fn('Which', …)`, which tags the node canonical
        // without running the handler; that is internal engine construction,
        // not something user input reaches. Report what every user-reachable
        // route produces.
        if (args.length % 2 !== 0)
          return BoxedType.forResult('error', context.engine._typeResolver);
        let arms = args.filter((_, i) => i % 2 === 1);
        let conds = args.filter((_, i) => i % 2 === 0);
        // Only the REACHABLE clauses contribute: a literal `True` condition is
        // the default clause, and evaluation never looks past it. The walk must
        // stop there too, or `Which(True, 1, [True, False], 2)` — which
        // evaluates to the scalar `1` — would be typed element-wise by a
        // condition that is never even evaluated.
        const dflt = conds.findIndex((c) => {
          const st = c?.structureOf?.();
          return st?.kind === 'symbol' && st.name === 'True';
        });
        if (dflt >= 0) {
          conds = conds.slice(0, dflt + 1);
          arms = arms.slice(0, dflt + 1);
        }
        // A condition that is provably a mask (a collection of condition
        // values, of any rank) selects element-wise (see
        // `evaluateElementwiseSelection`): the result is a list that follows
        // the masks, of the arms' types at the depth of their cells.
        const shape = elementwiseConditionShape(conds.map((c) => c?.type));
        if (shape) {
          const elementwise = elementwiseResultType(
            arms.map((x) => x.type),
            shape,
            // A literal `True` condition is the default clause: it matches
            // every position, so the `NaN` no-match cell is unreachable.
            dflt >= 0
          );
          // A clause before the first mask whose condition is a scalar
          // `True` at run time selects its arm WHOLE (`evaluateWhich`), so
          // the result is that arm or the element-wise list: with
          // `x := 1`, `Which(x > 0, 5, [True, False], 1, True, 0)` is `5`.
          // An untyped symbol arm makes that outcome unknown, as for the
          // scalar typing (`untypedSymbolArm`).
          const whole = arms
            .slice(0, shape.firstMask)
            .map((x): Type =>
              untypedArm(x, context.engine) ? 'unknown' : x.type
            );
          // A clause before the first mask whose condition is an undecided
          // whole-collection comparison makes the `Which` `Missing`
          // (`evaluateWhich`).
          if (mayBeUndecidedCondition(conds.slice(0, shape.firstMask)))
            whole.push('missing');
          return BoxedType.forResult(
            whole.length === 0
              ? elementwise
              : reduceType({ kind: 'union', types: [elementwise, ...whole] }),
            context.engine._typeResolver
          );
        }
        // A condition that is only POSSIBLY a boolean collection selects
        // element-wise for some of its runtime values and picks a single arm
        // for the others: `broadcastable` of the element-wise cell type,
        // joined with each arm that this type does not admit
        // (`possiblyElementwiseResultType`), covers both.
        // Without a literal-`True` default clause no arm may be selected and
        // the value is `Missing` — keep that arm in the type, as the
        // else-less `If` does, and outside `widen` (which joins toward a
        // common supertype and would dissolve the absence marker). The
        // possibly-element-wise branch carries the arm too: such a condition
        // may resolve to a scalar `False` at runtime, and the `Which` then
        // answers the scalar `Missing`.
        if (possiblyElementwiseCondition(conds.map((c) => c?.type))) {
          const broadcast = possiblyElementwiseResultType(
            arms.map((x) => x.type),
            dflt >= 0
          );
          return BoxedType.forResult(
            dflt >= 0
              ? broadcast
              : reduceType({ kind: 'union', types: [broadcast, 'missing'] }),
            context.engine._typeResolver
          );
        }
        if (arms.length === 0)
          return BoxedType.forResult('missing', context.engine._typeResolver);
        // An untyped symbol among the values makes the result unknown, as
        // for `If` (`untypedSymbolArm`).
        const armType = arms.some((x) => untypedArm(x, context.engine))
          ? 'unknown'
          : widen(...arms.map((x) => x.type));
        const scalar: Type =
          dflt >= 0
            ? armType
            : reduceType({ kind: 'union', types: [armType, 'missing'] });
        // When the only condition that is not a scalar is a scalar or a mask
        // (`boolean | list<boolean>`, `scalarOrMaskConditionShape`), the
        // result is the scalar result or the element-wise result of its
        // masks, which reads every reachable arm as the evaluation does.
        // When another condition is not a scalar either, the scalar typing
        // above is kept.
        const mixed = scalarOrMaskConditionShape(conds.map((c) => c?.type));
        // An undecided whole-collection comparison makes the `Which`
        // `Missing` (`evaluateWhich`), also when a default clause follows.
        const undecided = mayBeUndecidedCondition(conds);
        // Otherwise, when a condition that is not a scalar cannot be read
        // and may hold a list (two conditions of type `boolean |
        // list<boolean>`, an operand of type `unknown`), it can be a mask of
        // any rank at run time, and the element-wise result for a mask of
        // unknown rank is added to the scalar result.
        const shapeOfMasks =
          mixed ??
          (conds.some(
            (c) => c !== undefined && unreadableConditionMayBeMask(c.type)
          )
            ? {}
            : undefined);
        if (shapeOfMasks)
          return BoxedType.forResult(
            withUndecidedArm(
              reduceType({
                kind: 'union',
                types: [
                  scalar,
                  elementwiseResultType(
                    arms.map((x) => x.type),
                    shapeOfMasks,
                    dflt >= 0
                  ),
                ],
              }),
              undecided
            ),
            context.engine._typeResolver
          );
        return BoxedType.forResult(
          withUndecidedArm(scalar, undecided),
          context.engine._typeResolver
        );
      },
      canonical: (args, options) => {
        // The operands are strictly PAIRED `(condition, value)`, so the
        // count must be even. An unconditional default clause is written as
        // a literal `True` condition — that is what the LaTeX `cases` parser
        // emits for a row that carries no condition
        // (`\begin{cases} x & x>0 \\ -x \end{cases}` boxes as
        // `Which(0 < x, x, "True", -x)`), and what the `type` handler above
        // reads to decide that no clause after it is reachable. There is no
        // trailing-default form, so an odd operand count is a malformed
        // call. Report it: answering `Nothing` turned a malformed call into
        // an ordinary value, which hid the mistake — `Which(True, 1, 2)` and
        // `Which(False, 1, 2)` both came back `Nothing`.
        if (args.length % 2 !== 0)
          return options.engine.error(
            '`Which` takes alternating condition and value operands, so it ' +
              'needs an even number of operands. Write an unconditional ' +
              'default clause as a `True` condition: `Which(cond, a, True, b)`'
          );
        // The even positions are conditions, checked for a provably
        // non-boolean type (`conditionOperand`); the odd positions are the
        // values, canonicalized as written.
        return options.engine._fn(
          'Which',
          args.map((x, i) =>
            i % 2 === 0
              ? conditionOperand(options.engine, x.canonical)
              : x.canonical
          )
        );
      },
      evaluate: (ops, options) => evaluateWhich(ops, options),
      evaluateAsync: (ops, options) => evaluateWhichAsync(ops, options),
    },

    // Structural pattern matching (Epsil `match`). See
    // `docs/LANGUAGE-MODEL.md` and
    // `boxed-expression/match-dispatch.ts`.
    Match: {
      description:
        'Structural pattern match. `Match(subject, MatchCase(pattern, body), …)` ' +
        'evaluates `subject` once, then selects the first case whose pattern ' +
        'matches (structurally, `isSame`-like) and whose guard holds, applying ' +
        'its body to the captured values. Unlike `Which`, `Match` always ' +
        'decides: a symbolic subject that is not structurally a case still ' +
        'falls through to a wildcard case. No matching case yields ' +
        '`Error("match-no-case", subject)`.',
      lazy: true,
      // `Match` is the rescue construct (error-propagation design §2, rung 1):
      // it decides on an ERROR subject instead of freezing with it, restoring
      // the pinned "always decides" totality. The subject is matched
      // structurally on whatever it evaluated to, so an error fails every
      // literal/shape case and falls through to `_`, a binding, or `...`.
      inspectsErrors: true,
      signature: '(expression, expression+) -> unknown',
      // The handler reads each case's inert structure (its head and the type
      // of its last child), never an operand expression.
      type: (ops, context) => {
        // Result is the widened type of the case bodies (the last operand of
        // each `MatchCase`), mirroring `If`/`Which`. Bodies reference capture
        // names free at this scope, so most resolve to `unknown` — widen is a
        // best-effort hint.
        const bodyTypes: Type[] = [];
        for (const c of ops.slice(1)) {
          const st = c?.structureOf?.();
          if (st?.kind !== 'application' || st.head !== 'MatchCase') continue;
          if (st.children.length < 2) continue;
          bodyTypes.push(st.children[st.children.length - 1].type);
        }
        if (bodyTypes.length === 0)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        return BoxedType.forResult(
          widen(...bodyTypes),
          context.engine._typeResolver
        );
      },
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.Nothing;
        // Canonicalize the subject (op 0); keep each case's pattern/guard/body
        // raw (via the `MatchCase` canonical handler) so wildcards are not
        // mangled by canonicalization before matching.
        return ce._fn('Match', [
          ops[0].canonical,
          ...ops.slice(1).map((c) => c.canonical),
        ]);
      },
      evaluate: (ops, options) => evaluateMatch(ops, options),
    },

    // A single match case: `MatchCase(pattern, body)` or
    // `MatchCase(pattern, guard, body)`. Inert data (`holdAll`): the operands
    // are kept raw — the pattern holds engine wildcards (`_x`, `__x`, …) as-is,
    // and the guard/body are lowered to `Function` closures at match time.
    MatchCase: {
      description:
        'A case of a `Match`: `MatchCase(pattern, body)` or ' +
        '`MatchCase(pattern, guard, body)`. The pattern holds engine ' +
        'wildcards; the body references the bound capture names.',
      lazy: true,
      signature: '(expression, expression, expression?) -> nothing',
      // Keep the operands raw (do not canonicalize the pattern): return a
      // canonical-tagged node whose operands are preserved verbatim.
      canonical: (ops, { engine: ce }) =>
        ce._fn('MatchCase', ops, { canonical: true }),
    },

    // Marker for a pinned computed expression inside a pattern: `Pin(expr)`
    // matches the *value* of `expr` (evaluated in the enclosing lexical scope
    // at match time), not its structure. Inert (resolved by `Match`).
    Pin: {
      description:
        'Inside a `Match` pattern, `Pin(expr)` matches the value of `expr` ' +
        '(evaluated at match time) rather than its structure.',
      lazy: true,
      signature: '(expression) -> nothing',
    },

    // Marker for top-level or-alternatives in a `MatchCase` pattern:
    // `Alternatives(p1, p2, …)`. Binding-free by contract. Inert (expanded by
    // `Match` into consecutive virtual cases sharing the guard and body).
    Alternatives: {
      description:
        'Inside a `Match` pattern, `Alternatives(p1, p2, …)` matches if any ' +
        'alternative matches. Alternatives must be binding-free.',
      lazy: true,
      signature: '(expression+) -> nothing',
      canonical: (ops, { engine: ce }) =>
        ce._fn('Alternatives', ops, { canonical: true }),
    },

    FixedPoint: {
      examples: [
        'FixedPoint(x => (x + 2 / x) / 2, 1.0)',
        'FixedPoint(Cos, 1.0)',
      ],
      description: [
        'Apply a function repeatedly, starting from an initial value, until two successive values are the same: `FixedPoint(f, x)` is the first of `f(x)`, `f(f(x))`, … that `f` maps to itself.',
        'Two values are the same when they are structurally identical, or when they are numbers, one of them a float, that agree to the working precision (their difference is at most a few units of the last digit, relative to their size), or when they are lists or tuples of the same length whose elements are the same. A sequence of exact values stops only when two of them are identical.',
        'Without a maximum, the call stays unevaluated when the iteration cannot converge: when a value contains the previous one (`FixedPoint(Cos, 1)`: `Cos(1)` is exact, and `Cos(Cos(1))` nests it), or when an exact number gains digits at each step. Start from a float (`FixedPoint(Cos, 1.0)`), or evaluate with `N`, for a numeric fixed point.',
        'The optional third argument is the maximum number of applications, a positive integer. It defaults to the engine iteration limit, and then the call stays unevaluated if the iteration has not converged by that limit (raise `ce.iterationLimit` for a slower one). An Epsil program has no iteration limit unless the host sets one, so there an iteration that does not converge stops only at a maximum or at a time limit. When an explicit maximum is reached, the last value is returned.',
      ],
      complexity: 8200,
      // The callback slot is the bare `function` primitive, as for `Iterate`:
      // the result type of the function is the type of the result, which the
      // signature grammar cannot relate to the initial value. The type
      // handler reads it instead.
      signature: '(function, initial: any, maxIterations: integer?) -> unknown',
      // The result is a value of the function (the loop applies it at least
      // once), so its type is the function's result type. A function whose
      // result type is not known gives the declared `unknown`. `widen` is
      // not used: it drops an `unknown` operand, which would type the result
      // as the initial value.
      type: ([f], { engine }) => {
        const result = functionResult(f?.type);
        if (result === undefined || result === 'unknown') return undefined;
        return BoxedType.forResult(result, engine._typeResolver);
      },
      canonical: (ops, { engine: ce }) => {
        // Each problem is reported in the slot of the operand, as the
        // boxing validation does (`checkArity`): a missing operand is
        // `Error("missing")`, an extra one `Error("unexpected-argument")`.
        // The callback is checked as for the other callback operators
        // (`canonicalCallbackOperand`): a value that is not a function (`3`,
        // a string) and a function that cannot take one argument are
        // errors, and an explicit function of no parameter (`() => 42`) is
        // accepted, as it ignores its arguments.
        const fnOp = ops[0];
        const fn =
          fnOp === undefined
            ? ce.error('missing')
            : (canonicalCallbackOperand(fnOp, {
                operator: 'FixedPoint',
                supply: FIXED_POINT_SUPPLY,
              }) ?? ce.typeError('function', fnOp.canonical.type.type, fnOp));
        return ce._fn('FixedPoint', [
          fn,
          ops[1]?.canonical ?? ce.error('missing'),
          ...ops.slice(2, 3).map((x) => x.canonical),
          ...ops
            .slice(3)
            .map((x) => ce.error('unexpected-argument', x.toString())),
        ]);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [fn, initial, maxOp] = ops;
        if (fn === undefined || initial === undefined) return undefined;
        let limit = ce.iterationLimit;
        if (maxOp !== undefined) {
          // A maximum that is not a number yet (a symbol with no value)
          // leaves the call unevaluated.
          if (!isNumber(maxOp)) return undefined;
          if (!maxOp.isInteger || maxOp.re < 1)
            return ce.error('expected-positive-integer', maxOp.toString());
          limit = maxOp.re;
        }
        const f = applicable(fn);
        let x = numericApproximation ? initial.N() : initial;
        // Without a maximum, an iteration that cannot converge leaves the
        // call unevaluated (`isDivergingFixedPointStep`): `Cos(1)` stays
        // exact, so the values nest (`Cos(Cos(1))`, …), and Newton's
        // iteration on exact rationals doubles its digits at each step.
        // Either one would run to the iteration limit on values whose cost
        // grows at each step. With a maximum, the caller bounds the work, and
        // the last value is returned as the description says.
        const sizeBound =
          maxOp === undefined
            ? Math.max(FIXED_POINT_MIN_SIZE_BOUND, 8 * x.toString().length)
            : undefined;
        const epsilon = fixedPointEpsilon(ce.precision);
        for (let i = 0; i < limit; i++) {
          checkDeadline(ce._deadlineFrame);
          let y = f([x]);
          // A function that cannot be applied leaves the call unevaluated.
          if (y === undefined) return undefined;
          if (numericApproximation) y = y.N();
          if (y.operator === 'Error') return y;
          if (isSameFixedPointValue(x, y, epsilon)) return y;
          if (
            sizeBound !== undefined &&
            isDivergingFixedPointStep(x, y, sizeBound)
          )
            return undefined;
          x = y;
        }
        // The default limit is a budget, not a bound the caller asked for: a
        // value that has not converged is not a fixed point (`x ↦ 1 - x`
        // from 0.3 cycles forever), so the call stays unevaluated, as
        // `Any` does over an unbounded source. An explicit maximum returns
        // the last value.
        return maxOp === undefined ? undefined : x;
      },
    },
  },
];

/** The smallest bound, in characters of the printed value, on the size of
 * an exact number of `FixedPoint` (see `isDivergingFixedPointStep`). */
const FIXED_POINT_MIN_SIZE_BOUND = 512;

/** `FixedPoint` applies its function to the previous value alone. */
const FIXED_POINT_SUPPLY: CallbackSupply = {
  count: 1,
  describes: 'the previous value',
};

/**
 * The relative difference under which two floats of `FixedPoint` are the
 * same, for the engine precision `precision` (in decimal digits).
 *
 * At machine precision, the last 7 bits of the two floats may differ (as for
 * the `SameQ` of Mathematica): `2^-46`, about `1.4e-14`. At a higher
 * precision, the last 2 decimal digits may differ: `10^-(precision - 2)`.
 * The test is relative: the absolute engine tolerance (`1e-10`) stopped the
 * iteration for √(1e-24) at five times the root, and returned a value with
 * only 10 correct digits of the 21 printed.
 */
function fixedPointEpsilon(precision: number): number {
  return precision <= MACHINE_PRECISION ? 2 ** -46 : 10 ** -(precision - 2);
}

/**
 * Whether two successive values of `FixedPoint` are the same, which ends the
 * iteration:
 *
 * - they are structurally identical (`isSame`);
 * - they are number literals, one of them a float, whose difference is at
 *   most `epsilon` times the larger magnitude (`fixedPointEpsilon`). Two
 *   exact numbers must be identical: a sequence of exact rationals that
 *   converges never has two equal terms;
 * - they are lists or tuples of the same length whose elements are the same
 *   by these rules, so a vector iteration stops as a scalar one does.
 */
function isSameFixedPointValue(
  a: Expression,
  b: Expression,
  epsilon: number
): boolean {
  if (a.isSame(b)) return true;
  if (isNumber(a) && isNumber(b)) {
    if (a.isExact && b.isExact) return false;
    const d = b.sub(a);
    if (!isNumber(d)) return false;
    // A `NaN` or an infinite difference compares false.
    return (
      Math.hypot(d.re, d.im) <=
      epsilon * Math.max(Math.hypot(a.re, a.im), Math.hypot(b.re, b.im))
    );
  }
  if (
    isFunction(a) &&
    isFunction(b) &&
    a.operator === b.operator &&
    (a.operator === 'List' || a.operator === 'Tuple') &&
    a.nops === b.nops
  )
    return a.ops.every((x, i) => isSameFixedPointValue(x, b.ops[i], epsilon));
  return false;
}

/**
 * Whether the step from `x` to `y` shows that the iteration of `FixedPoint`
 * cannot converge, so that the call stays unevaluated:
 *
 * - `y` contains `x` as a proper part: the function did not evaluate to a
 *   new value, but wrapped the previous one (`Cos(1)` from `1`,
 *   `Sqrt(1 + Sqrt(2))` from `Sqrt(2)`), and each step nests it again;
 * - `y` is an exact number whose printed form is longer than `sizeBound`
 *   characters: the terms of an exact iteration that converges to an
 *   irrational number gain digits at each step.
 *
 * A float, a string and a collection of floats have a fixed size and are
 * never cut short.
 */
function isDivergingFixedPointStep(
  x: Expression,
  y: Expression,
  sizeBound: number
): boolean {
  if (isNumber(y)) return y.isExact && y.toString().length > sizeBound;
  if (!isFunction(y)) return false;
  return y.ops.some((op) => containsSubexpression(op, x));
}

/** Whether `e` is `part`, or has it as a part at any depth. */
function containsSubexpression(e: Expression, part: Expression): boolean {
  if (e.isSame(part)) return true;
  return isFunction(e) && e.ops.some((op) => containsSubexpression(op, part));
}

/**
 * Whether a value of type `t` masks to `NaN`: its type, less any `missing`
 * arm, is a number. A value that is not provably numeric (`unknown`, a point,
 * a list, a string) masks to `Missing`, exactly as `absentScalarMarker`
 * (`boxed-expression/validate.ts`) reads the codomain of an application.
 */
function isNumericValueType(t: Type): boolean {
  const present = stripMissingFromType(t);
  return present !== 'never' && isSubtype(present, 'number');
}

/** `t` less any `missing` arm, joined with `nan`: the type of a masked
 * numeric value. */
function withNanArm(t: Type): Type {
  return reduceType({
    kind: 'union',
    types: [stripMissingFromType(t), 'nan'],
  });
}

/**
 * The value a false restriction answers for `expr`: the absence marker of
 * the value's own type, `NaN` for a number and `Missing` otherwise (user
 * decision 2026-09-25). One rule for absence, then: every operator answers
 * the marker of its codomain for an absent operand (`docs/ERROR-MODEL.md`,
 * §2 rule 4), and a restriction answers the marker of its value. Before,
 * `When` masked every value to `Missing`, so a masked NUMBER read as
 * `Missing` on the route that held the restriction and as `NaN` on the route
 * that evaluated it fresh (`2·x{c}` versus `2·Missing`).
 */
function maskedValue(ce: ComputeEngine, expr: Expression): Expression {
  return isNumericValueType(expr.type.type) ? ce.NaN : ce.Missing;
}

/**
 * Lazy indexed-collection handlers for a held `When(value, cond)` (Tycho
 * item 66).
 *
 * A restriction over a collection is elementwise: `When(L, c)` presents as
 * `[When(L1, c), …, When(Ln, c)]`. The `evaluate` handler keeps the `When`
 * held over the evaluated collection (it is never copied into a `List` of
 * `When`s: the copy forgot that its cells came from one restriction, user
 * decision 2026-09-25), and these handlers walk the wrapped value, re-wrapping
 * each element with the condition — so the held form is fully enumerable,
 * and `isCollection`/`count`/`each()` agree with `.type`.
 *
 * A `When` guarding a SCALAR is not a collection: `isCollection` reports
 * `false` and every other handler reports scalar, exactly as before.
 *
 * A MASK condition — a collection of booleans, such as `[1,2,3] > 2` — is
 * zipped with the value cell by cell, exactly as the `evaluate` handler zips
 * it: cell `i` is `When(L_i, c_i)`, and the length is the shorter of the two.
 * (Before, each element was re-wrapped with the WHOLE mask, so a broadcast
 * that walked these handlers, such as `Sin(L{m})` or `2·L{m}`, turned every
 * element into a list and answered a matrix.) A mask with no known length (a
 * symbol with no value), or a condition whose shape is not settled (a
 * comparison typed `broadcastable<boolean>`), cannot be zipped here, so the
 * `When` does not present as a collection until evaluation resolves it.
 */
function whenCollectionHandlers(): CollectionHandlers {
  // The wrapped collection value, or `undefined` when `When` guards a scalar.
  // The predicate matches the `evaluate` handler's distribution rule exactly —
  // in particular a `Tuple` (a point) is NOT list-like here, so a restricted
  // point presents as a scalar `When` wrapping the point rather than as a
  // 2-element collection.
  // Returns the wrapped collection, the number of restricted cells, and a
  // `restrict` closure that applies the condition to the element at 1-based
  // index `i` (the whole condition, or its cell `i` for a mask).
  const parts = (
    expr: Expression
  ):
    | {
        value: Expression;
        count: number | bigint | undefined;
        restrict: (elem: Expression, i: number) => Expression | undefined;
      }
    | undefined => {
    if (!isFunction(expr, 'When')) return undefined;
    const v = expr.op1;
    // A string is excluded alongside a tuple: both are indexed collections
    // that stay ATOMIC under element-wise restriction, so `When("ab", c)` is a
    // restricted string, not a collection of restricted characters. This must
    // agree with the distribution gate in `When`'s evaluate handler, which
    // excludes the same two kinds.
    // One exception, for a MASK condition only, again as the `evaluate`
    // handler decides: a TUPLE value held by a symbol declared with an
    // ORDERED collection type (`isOrderedCarrierType`) is zipped. The two
    // sites call the same predicates (`isOrderedCarrierType`,
    // `isAtomicCarrierValue`) with the same inputs: the static type of the
    // carrier operand as written, and the value it holds. For a symbol, that
    // value is the symbol's value, so a symbol declared `tuple<number,
    // number> | list<number>` that holds `(1, 2)` is one point here, as it
    // is when the restriction is evaluated.
    if (!v.isCollection) return undefined;
    const held = (isSymbol(v) ? v.value : undefined) ?? v;
    const atomic = isTuple(held) || isString(held);
    const cond = expr.op2;
    const ce = expr.engine;
    if (isAtomicCarrierValue(v.type.type, held)) return undefined;
    if (possiblyElementwiseCondition([cond.type.type])) return undefined;
    if (!cond.type.matches('collection<any>')) {
      if (atomic) return undefined;
      return {
        value: v,
        // A `bigint` count (a finite count that is not a safe integer)
        // passes through: the walk reads the value's own walk.
        count: v.count,
        restrict: (elem) => ce._fn('When', [elem, cond]),
      };
    }
    // A mask: zip it with the value, to the shorter length. The mask (and
    // the value) can be an infinite collection, such as `Range(1, ∞)`, which
    // cannot be read in full. An in-order walk (the iterator) reads each
    // cell once, from one iterator of the mask, and keeps it. A request
    // that skips ahead of the cells read so far (a single `at(i)`) looks up
    // that one cell with `at()` instead of reading and keeping `i` cells.
    // A count can be a `bigint` (a finite count that is not a safe integer).
    // The shorter length uses `<`, which compares a `bigint` and a `number`
    // correctly (`Math.min()` throws for a `bigint`), and `restrict` only
    // compares a cell index with it.
    const vn = v.count;
    const cn = cond.count;
    if (vn === undefined || cn === undefined) return undefined;
    const n = cn < vn ? cn : vn;
    const mask: Expression[] = [];
    let cells: Iterator<Expression> | undefined;
    return {
      value: v,
      count: n,
      restrict: (elem, i) => {
        if (i < 1 || i > n) return undefined;
        let ci: Expression | undefined;
        if (i <= mask.length) ci = mask[i - 1];
        else if (i === mask.length + 1) {
          cells ??= cond.each()[Symbol.iterator]();
          const next = cells.next();
          if (!next.done) {
            mask.push(next.value);
            ci = next.value;
          }
        } else ci = cond.at(i);
        return ci === undefined ? undefined : ce._fn('When', [elem, ci]);
      },
    };
  };
  const value = (expr: Expression): Expression | undefined =>
    parts(expr)?.value;

  return {
    isCollection: (expr) => value(expr) !== undefined,

    isLazy: (expr) => value(expr) !== undefined,

    count: (expr) => parts(expr)?.count,

    isEmpty: (expr) => {
      const p = parts(expr);
      if (p === undefined) return undefined;
      if (p.count !== undefined) return p.count === 0;
      return p.value.isEmptyCollection;
    },

    isFinite: (expr) => value(expr)?.isFiniteCollection,

    isEnumerable: (expr) => value(expr)?.isEnumerableCollection,

    elttype: (expr) => {
      const v = value(expr);
      if (!v) return undefined;
      // The element type of the wrapped collection, with NO `missing` arm:
      // `integer` for `[1,2]{c}`, a `vector<integer^2>` row for a restricted
      // matrix. This handler must never answer wider than the collection's
      // own type (`typeSaturatedSubsetOf`, `collection-utils.ts` relies on
      // that), and that type, `missing | vector<integer^2>`, says the cells
      // are integers whenever the collection is present. The cells the
      // handlers enumerate are restricted cells, `When(elem, cond)`, each
      // typed `elem | missing`: absent exactly when the collection is, since
      // they carry its condition. An element access adds its own marker
      // (`At(M{c}, 2)` is `missing | vector<integer^2>`).
      return collectionElementType(v.type.type) ?? 'unknown';
    },

    iterator: (expr) => {
      const p = parts(expr);
      if (!p) return undefined;
      const iter = p.value.each();
      let i = 0;
      return {
        next: () => {
          const result = iter.next();
          const cell = result.done ? undefined : p.restrict(result.value, ++i);
          if (cell === undefined)
            return { value: undefined, done: true as const };
          return { value: cell, done: false as const };
        },
      };
    },

    at: (expr, index) => {
      // Negative indexes are normalized by the caller; string keys (records)
      // do not apply to a restricted indexed collection.
      if (typeof index !== 'number') return undefined;
      const p = parts(expr);
      const elem = p?.value.at(index);
      return elem ? p!.restrict(elem, index) : undefined;
    },

    indexWhere: (expr, predicate) => {
      const p = parts(expr);
      if (p === undefined) return undefined;
      // The value's own walk does not pass the index, so count the cells here.
      let i = 0;
      return p.value.indexWhere((elem) => {
        const cell = p.restrict(elem, ++i);
        return cell !== undefined && predicate(cell);
      });
    },
  };
}

/**
 * The catchable error for a scalar condition that evaluated to the `Missing`
 * symbol (an absent guard). Distinct from an UNDECIDED condition, which leaves
 * the conditional inert: absence is a runtime DATA state that can never become
 * decidable, so branching on it is a genuine fault and yields an error
 * expression the host can render or catch.
 */
/**
 * The relational heads whose operands a branch condition compares.
 *
 * An undefined numeric operand (`NaN`, `Indeterminate`) of a relation gives
 * the relation its IEEE 754 value, and a branch on it uses that value as it
 * uses any other: an ordered comparison (`Less`, `LessEqual`, `Greater`,
 * `GreaterEqual`) or an `Equal` is `False`, so the branch takes its next arm,
 * as in Desmos (user decision 2026-10-20, Tycho rows 411 and 413); a
 * `NotEqual` is `True`, so the branch takes its first arm (user decision
 * 2026-10-23; from 2026-09-03 to that date it took no arm).
 */
const BRANCH_RELATIONS: ReadonlySet<string> = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);

/**
 * A branch condition after evaluation: `value` is what the condition
 * evaluates to — exactly what `cond.canonical.evaluate()` answers, errors,
 * element-wise lists and inert symbolic forms included — and `undecided` is
 * `true` when that value selects no arm although it is not symbolic.
 *
 * One shape carries the flag: the absent marker `Missing` that a
 * whole-collection comparison answers when its element recursion meets a
 * pair with no answer (user ruling of 2026-09-21). That marker reports an
 * undecided comparison, not absent condition DATA, which is why it takes no
 * arm instead of raising the absent-condition error a `Missing` condition
 * otherwise raises. The marker survives `Not` and the connectives through
 * their ordinary Kleene evaluation, so the flag has to survive them too.
 */
type EvaluatedCondition = { value: Expression; undecided: boolean };

/**
 * Evaluate the condition of an `If`/`Which` for branch selection.
 *
 * A relation with an undefined numeric operand (`NaN`, `Indeterminate`) has
 * its IEEE 754 value, and the branch uses that value as it uses any other:
 * `If(0/0 > 0, 1, 0)` is `0` and `If(0/0 ≠ 0, 1, 0)` is `1` (user decisions
 * 2026-10-20, Tycho rows 411 and 413, and 2026-10-23; from
 * 2026-09-03 to those dates such a condition selected no arm). The compiled
 * lanes take the same arm (`BaseCompiler.conditionDecidability`).
 *
 * The walk reproduces the ordinary evaluation of the condition and adds
 * nothing but the flag:
 * - A relation evaluates its operands left to right and then itself over
 *   the values; an error in an operand propagates through the relation as
 *   it always did, and a collection-shaped operand gives the element-wise
 *   list the relation always gave (a NaN CELL then takes the else cell on
 *   both lanes, measured 2026-09-03 — `evaluateElementwiseSelection` owns
 *   that contract). Only the `Missing` of a whole-collection comparison is
 *   flagged.
 * - `And`/`Or` keep their short-circuit contract (`evaluateShortCircuit`,
 *   `library/logic.ts`): operands are evaluated left to right and the walk
 *   stops at the first decider (`False` for `And`, `True` for `Or`) or the
 *   first error, so an operand a decided one guards is never evaluated. A
 *   flagged operand does not stop the walk: it decides nothing. The
 *   survivors are then combined three-valued, as the compiled lowering
 *   does: a decided `False` decides an `And` whatever its siblings are, a
 *   decided `True` decides an `Or`; all-decided survivors fold with a flag
 *   if any of them was flagged; a survivor that is still symbolic (a
 *   relation with a free variable) keeps the whole connective inert, spelled
 *   with the ORIGINAL sub-conditions so that a later binding can still
 *   decide it and the flagged evidence is not folded away; a collection-shaped
 *   survivor hands the connective to its ordinary element-wise evaluation.
 *   `Nand`, `Nor` and `Implies` are the same walk through their `And`/`Or`
 *   spelling, `Not` flips its operand and keeps the flag.
 * - Anything else evaluates as before, unflagged. `Xor` and the remaining
 *   heads are not three-valued here: a flag under them is lost.
 *
 * `numericApproximation` is the numeric request of the `If`/`Which` that
 * holds the condition. It is forwarded to every evaluation of the walk, so
 * that the condition is decided as the same condition is decided at the top
 * level under `.N()`. This matters in the body of a user function under
 * `.N()`: a parameter is bound to the float of the argument, and only a
 * function that jumps (a comparison, `Floor`) evaluated with the numeric
 * request reads the exact argument again (`exactRealValueOf`,
 * `constraint-subject.ts`). Evaluated exactly, `x < 25` for
 * `x := (25! − 1)/24!` read the float `25` and was `False`.
 */
function evaluateCondition(
  cond: Expression,
  numericApproximation?: boolean
): EvaluatedCondition {
  const c = cond.canonical;
  const ce = c.engine;
  const options = numericApproximation
    ? { numericApproximation: true }
    : undefined;
  if (!isFunction(c)) return { value: c.evaluate(options), undecided: false };
  const op = c.operator;

  if (BRANCH_RELATIONS.has(op)) {
    const ops: Expression[] = [];
    for (const x of c.ops) {
      const v = x.evaluate(options);
      ops.push(v);
      // An error operand decides the relation (it propagates); the
      // remaining operands are not demanded.
      if (errorValue(v) !== undefined) break;
    }
    // Under the numeric request, the relation decides a near tie from its
    // operands AS WRITTEN: it evaluates them again exactly (a pure
    // expression, the recorded argument of a parameter) or compares an
    // exact constant such as `π` by its exact form
    // (`exactPairAtNearTie`, `relational-operator.ts`). The float of an
    // operand has lost that information: the float of `(25! − 1)/24!` is
    // `25`, and `25 < 25` is `False`. So an operand whose value is a float
    // is given to the relation as written when it can change the result:
    // its float is at a near tie with the value of an adjacent operand
    // (`isNearTiePair`), or it is an exact constant expression, whose float
    // can be wrong by much more than the tolerance when its terms cancel
    // (`√(10⁶⁰ + 10⁴⁰) − 10³⁰`). The relation then evaluates it again. Two
    // conditions keep this safe:
    // - Every operand of the relation must be pure (`isTransitivelyPure`).
    //   An operand with an effect is not run twice, and it can change what
    //   another operand as written reads: with `x := 0.5` and `r()` that
    //   assigns `x = 10` and returns 1, `x < r()` must compare `0.5 < 1`,
    //   not `10 < 1`.
    // - Far from a tie, the values already computed are compared. An
    //   operand is then evaluated once only: in a recursive function such
    //   as `g(n) := If(n < 1, 0, If(g(n − 1) > 5, 1, 2))`, a second
    //   evaluation of `g(n − 1)` at each level can make the cost
    //   exponential.
    let relationOps = ops;
    if (
      numericApproximation &&
      ops.length === c.nops &&
      c.ops.every((x) => isTransitivelyPure(x))
    ) {
      relationOps = ops.map((v, i) =>
        isInexactRealNumber(v) &&
        (isExactConstantExpression(c.ops[i]) ||
          (i > 0 && isNearTiePair(ops[i - 1], v)) ||
          (i + 1 < ops.length && isNearTiePair(v, ops[i + 1])))
          ? c.ops[i]
          : v
      );
    }
    const value = ce.function(op, relationOps).evaluate(options);
    const s = sym(value);
    // A whole-collection comparison (two or more collection operands) answers
    // the absent marker `Missing` when its element recursion meets a pair
    // with no answer — an absent cell on either side (user ruling of
    // 2026-09-21, `library/relational-operator.ts`). That marker reports an
    // UNDECIDED comparison, not absent condition DATA, so the branch takes no
    // arm. A scalar `Missing` condition keeps its own answer, the catchable
    // absent-condition error: there the condition itself is the absent datum.
    // A NaN operand is not flagged: the relation's IEEE value (`True` for
    // `NotEqual`, `False` for the others) selects the arm.
    return {
      value,
      undecided:
        s === 'Missing' && ops.filter((x) => x.isCollection).length >= 2,
    };
  }

  if (op === 'And' || op === 'Or')
    return evaluateConnective(c, op, c.ops, numericApproximation);
  if (op === 'Nand' && c.nops >= 1)
    return negateCondition(
      evaluateConnective(c, 'And', c.ops, numericApproximation)
    );
  if (op === 'Nor' && c.nops >= 1)
    return negateCondition(
      evaluateConnective(c, 'Or', c.ops, numericApproximation)
    );
  if (op === 'Implies' && c.nops === 2)
    return evaluateConnective(
      c,
      'Or',
      [ce.function('Not', [c.op1]), c.op2],
      numericApproximation
    );
  if (op === 'Not' && c.nops === 1)
    return negateCondition(evaluateCondition(c.op1, numericApproximation));

  return { value: c.evaluate(options), undecided: false };
}

/** True when `x` is a finite real number literal that is not exact (a
 *  float). */
function isInexactRealNumber(x: Expression): boolean {
  return isNumber(x) && !x.isExact && !x.isComplex && x.isFinite === true;
}

/**
 * `Not` of an evaluated condition: the flag survives a value that is still
 * one of the shapes it describes — a decided `True`/`False`, or the absent
 * marker `Missing`, which `Not` reproduces (`Not(Missing)` is `Missing`).
 * Dropping the flag on the marker made the interpreter raise the
 * absent-condition error for `Which(Not(<undecided comparison>), …)` where
 * the compiled lane took no arm.
 */
function negateCondition(inner: EvaluatedCondition): EvaluatedCondition {
  const ce = inner.value.engine;
  if (errorValue(inner.value) !== undefined) return inner;
  const value = ce.function('Not', [inner.value]).evaluate();
  const s = sym(value);
  return {
    value,
    undecided:
      inner.undecided && (s === 'True' || s === 'False' || s === 'Missing'),
  };
}

/**
 * The three-valued, short-circuiting walk of an `And`/`Or` branch condition
 * — see `evaluateCondition`. `node` is the connective as written (its
 * original operands are kept for the inert spelling); `ops` are the
 * operands to walk, which differ from `node.ops` only for the `Implies`
 * spelling. `numericApproximation` is the numeric request of the walk (see
 * `evaluateCondition`).
 */
function evaluateConnective(
  node: Expression,
  op: 'And' | 'Or',
  ops: ReadonlyArray<Expression>,
  numericApproximation?: boolean
): EvaluatedCondition {
  const ce = node.engine;
  const decider = op === 'And' ? 'False' : 'True';
  const survivors: { original: Expression; result: EvaluatedCondition }[] = [];
  for (const x of ops) {
    const r = evaluateCondition(x, numericApproximation);
    if (errorValue(r.value) !== undefined) return r;
    if (sym(r.value) === decider && !r.undecided)
      return { value: ce.symbol(decider), undecided: false };
    survivors.push({ original: x, result: r });
  }
  // A collection-shaped survivor: the element-wise contract of the
  // connective, over the evaluated values, unflagged.
  if (survivors.some((s) => isCollectionShaped(s.result.value)))
    return {
      value: ce
        .function(
          op,
          survivors.map((s) => s.result.value)
        )
        .evaluate(
          numericApproximation ? { numericApproximation: true } : undefined
        ),
      undecided: false,
    };
  // A symbolic survivor keeps the connective inert, spelled with the
  // original sub-conditions (a flagged survivor folded to its value would
  // decide the connective the wrong way).
  // A survivor that is already FLAGGED is not symbolic: its value is the
  // absent marker `Missing` of an undecided whole-collection comparison,
  // which the connective folds by the ordinary Kleene table (`And(Missing,
  // True)` is `Missing`). Treating it as symbolic left the whole `Which`
  // inert where the compiled lane took no arm.
  // A survivor that evaluated to the absent marker `Missing` is not symbolic
  // either: it is a value. With no deciding survivor and no symbolic one,
  // the Kleene table gives `Missing` (`And(True, Missing)`,
  // `Or(False, Missing)`), so the condition is absent, as `Not(Missing)` and
  // a comparison with an absent operand already are.
  const symbolic = survivors.some((s) => {
    const v = sym(s.result.value);
    return (
      v !== 'True' && v !== 'False' && v !== 'Missing' && !s.result.undecided
    );
  });
  if (symbolic)
    return {
      value: ce.function(
        op,
        survivors.map((s) =>
          s.result.undecided ? s.original.canonical : s.result.value
        )
      ),
      undecided: false,
    };
  if (
    survivors.some(
      (s) => sym(s.result.value) === 'Missing' && !s.result.undecided
    )
  )
    return { value: ce.symbol('Missing'), undecided: false };
  // Every survivor is the non-deciding value (`True` for `And`, `False`
  // for `Or`), or a flagged value: the connective folds to the
  // non-deciding value, flagged if any survivor was flagged.
  return {
    value: ce.symbol(op === 'And' ? 'True' : 'False'),
    undecided: survivors.some((s) => s.result.undecided),
  };
}

/**
 * The canonical form of an `If`/`Which` condition: the condition itself, or
 * an `incompatible-type` error operand when its static type PROVES it is
 * not a boolean.
 *
 * A condition that is a number, a string, or a symbol declared with a type
 * disjoint from `boolean` (`If(10, a, b)`, `Which("banana", 1, True, 2)`,
 * `If(n, a, b)` for `n: integer`) can never select a branch, so the mistake
 * is reported at boxing, exactly as a wrong-typed argument to `Sin` is: the
 * condition becomes `Error(incompatible-type, boolean, <type>)`, which the
 * evaluate handlers then propagate as the condition's error, because the
 * condition is a demanded operand (`docs/ERROR-MODEL.md` §3 "Propagation").
 *
 * Everything that is NOT proven non-boolean is left alone, because it may
 * still resolve: a symbol of unknown type (an undeclared `Tru` is a free
 * variable that may be assigned later), a relation with free variables, a
 * `missing`-admitting type (an absent condition is a catchable runtime
 * error, not a boxing error), and a collection or possibly-collection type
 * whose cells could be condition values (a list of booleans selects
 * element-wise, `docs/BROADCAST-MODEL.md` §"The rule").
 *
 * The element-wise carrier is narrow — an indexed or broadcastable
 * collection whose cells are `True`/`False`/`Missing` (`conditionCells`) —
 * so a collection type is exempt only when its cell type could overlap
 * `boolean | missing`. A tuple (a point binds whole and never selects), a
 * set, a dictionary or a record, a string (its cells are characters), and an
 * indexed collection with provably non-boolean cells (`list<number>`,
 * `range`, `number | list<number>`) are refused like a scalar. A bare kind
 * or an `unknown`-element collection (`list`, `list<unknown>`) stays inert.
 */
function conditionOperand(ce: ComputeEngine, cond: Expression): Expression {
  const t = cond.type;
  if (!cond.isValid || t.isUnknown) return cond;
  // A condition that holds an error value (`w` after `w := Ln("a")`) is
  // kept: its evaluation gives that error, as an argument of an eager
  // operator does (`isErrorTypedOperand()`). The type `error` is disjoint
  // from `boolean`, so the refusals below would replace it with a new error.
  if (isErrorTypedOperand(cond)) return cond;
  // A condition of type `error` that does not hold an error value (a symbol
  // declared `error` with no value, or `g(2)` with `g: (number) -> error`)
  // is kept too, as a parameter typed `boolean` keeps it
  // (`overlapAdmission()` in `validate.ts`: the type `error` overlaps every
  // type). Its evaluation does not select a branch.
  if (isErrorTypedWithoutErrorValue(cond)) return cond;
  const type = t.type;
  const refuse = () => ce.typeError('boolean', t, cond);
  if (isSubtype(type, 'string') || isTupleShapedType(type)) return refuse();
  if (typeCouldBeCollection(type) || typeCouldBeUnkeyedCollection(type)) {
    const r = resolveTypeAlias(type);
    const kind = typeof r === 'string' ? r : r.kind;
    if (kind === 'set' || kind === 'dictionary' || kind === 'record')
      return refuse();
    // The cell type, every rank unwrapped and a union descended per arm; a
    // bare kind answers `unknown`, which nothing is disjoint from. An EMPTY
    // collection types its cells `never`, which is disjoint from everything,
    // yet it has no cell to contradict a condition and broadcasts to an
    // empty result, so it is not refused.
    const cell = broadcastCellType(type);
    if (
      cell !== 'never' &&
      provablyDisjoint(cell, 'boolean') &&
      provablyDisjoint(cell, 'missing')
    )
      return refuse();
    return cond;
  }
  if (isSubtype('missing', type)) return cond;
  if (!provablyDisjoint(type, 'boolean')) return cond;
  return refuse();
}

function absentConditionError(ce: ComputeEngine): Expression {
  return ce.error(
    'The condition is absent (`Missing`). Discharge absence with ' +
      '`Coalesce()` or `IsMissing()` before branching'
  );
}

/**
 * The supertype every element-wise-eligible condition is checked against.
 *
 * The cells admitted at RUNTIME (`conditionCells`) are `True`/`False`/`Missing`
 * — an absent cell is a legitimate condition value (R4′) — so the static gate
 * must admit `missing` cells too, or `Which(["True", "Missing"], …)` would
 * evaluate element-wise while typing scalar. It stays a strict supertype of
 * those cells: a condition typing `list<unknown>`, or plain `unknown`, does not
 * match and keeps the scalar typing.
 */
const BOOLEAN_COLLECTION_TYPE = parseType(
  'indexed_collection<boolean | missing>'
);

/**
 * The cell type of `BOOLEAN_COLLECTION_TYPE`, used to recognize a
 * `broadcastable<boolean>` condition — one that is a boolean collection only
 * for some of its possible runtime values (`possiblyElementwiseCondition`).
 */
const CONDITION_CELL_TYPE = parseType('boolean | missing');

/**
 * The value of a condition at one node of an element-wise selection: a
 * condition value (`True`, `False` or `Missing`), or a list of such values
 * (`MaskList`).
 */
type MaskCell = 'True' | 'False' | 'Missing' | MaskList;

/**
 * A list-valued condition at one node of an element-wise selection: the
 * collection as evaluated (it is a participant of the length check, see
 * `broadcastLengthMismatch`) and its materialized elements.
 */
type MaskList = { value: Expression; cells: MaskCell[] };

/**
 * The materialized cells of a condition that activates the ELEMENT-WISE
 * selection path, or `undefined` when it does not.
 *
 * The gate (§3 of `docs/BROADCAST-MODEL.md`) is
 * deliberately narrow: an indexed collection (never a `Set`, never a tuple —
 * tuples are points, not lists) of statically known finite length whose cells
 * are ALL condition values (`True`/`False`/`Missing`) or themselves such
 * collections, so a mask can have any rank, and its rows can have different
 * lengths. A collection with a symbolic or non-boolean cell at any depth, or
 * one whose length is not yet known, does not activate it — the conditional
 * then keeps its existing behavior (inert, or the spell-check throw), so every
 * symbolic `Which` PRODUCER (Solve validity guards, the conditional-value
 * adopters) keeps round-tripping unreduced.
 */
function conditionCells(c: Expression): MaskList | undefined {
  if (!isBroadcastableCollection(c)) return undefined;
  if (!isWalkableFiniteCollection(c)) return undefined;
  const n = c.count;
  if (n === undefined || !Number.isFinite(n)) return undefined;
  const cells: MaskCell[] = [];
  for (const cell of Array.from(c.each()) as Expression[]) {
    const s = sym(cell);
    if (s === 'True' || s === 'False' || s === 'Missing') {
      cells.push(s);
      continue;
    }
    const nested = conditionCells(cell);
    if (nested === undefined) return undefined;
    cells.push(nested);
  }
  return { value: c, cells };
}

/**
 * Element-wise conditional selection: `np.select` semantics, ruled 2026-07-27
 * (`docs/BROADCAST-MODEL.md`).
 *
 * `clauses[0]`'s condition has already been evaluated and materialized by the
 * caller (that is what activated the gate) and arrives as `first`; it is never
 * drained twice. Per position `j` the selected clause is the first whose
 * condition is `True` at `j`; a scalar `True`/`False` condition lifts to every
 * position (R1). Arms are evaluated at most once, WHOLE, and only when
 * selection reaches them (R2); a list-valued arm is then indexed at `j`, a
 * scalar arm lifts. All list-valued participants — conditions and selected
 * arms — must share one length, checked with the same
 * `broadcastLengthMismatch` as `Add` (R3). A position no clause matches is
 * `NaN` when every arm is numeric and `Missing` otherwise (R4,
 * `noMatchCell`); a position whose condition cell is `Missing` is the same
 * catchable "condition is absent" error the scalar form produces (R4′).
 *
 * A mask of rank 2 or more (a list whose elements are lists of conditions,
 * such as `M < 3` over a matrix `M`) selects by the same rule at each level.
 * At a node of the mask where some condition is a list of length `n`, every
 * list-valued condition and every list-valued selected arm must have length
 * `n`, a scalar condition or a scalar arm lifts to each position, and each
 * position is a node one level down, where each list participant is replaced
 * by its element at that position. At a node where every condition is a
 * scalar, the first clause whose condition is `True` gives its arm's value at
 * that node WHOLE, even when that value is a list: so
 * `If([True, False], [[1], [2]], 0)` is `[[1], 0]`, and with
 * `M := [[1, 2], [3, 4]]`, `If(M < 3, M, 0)` is `[[1, 2], [0, 0]]`. An arm
 * of lower rank than the mask is refused, as `M + [10, 20]` is:
 * `If(M < 3, [10, 20], 0)` is `incompatible-dimensions`. The rows of a mask may
 * have different lengths: `If([[True], [False, True]], 7, 0)` is
 * `[[7], [0, 7]]`. The result is a nested `List` that follows the mask.
 *
 * The zip is EAGER — conditions are materialized once into plain arrays and
 * the selection is computed in a JS loop — never a stack of lazy broadcast
 * `Map`s, which costs ~8 µs per element per condition.
 *
 * Returns `undefined` when the expression must stay inert.
 */
function evaluateElementwiseSelection(
  ce: ComputeEngine,
  clauses: ReadonlyArray<{ cond: Expression; arm: Expression }>,
  first: { cond: Expression; mask: MaskList },
  options: Partial<EvaluateOptions> & { engine: ComputeEngine },
  noMatchArmTypes?: ReadonlyArray<Type>
): Expression | undefined {
  // 1/ Evaluate the conditions in clause order and materialize the
  // list-valued ones. Clauses after a lifted `True` are unreachable: their
  // conditions are not evaluated at all.
  const participants: Expression[] = [];
  // The value of each retained clause's condition at the top node: the
  // materialized mask of a list-valued condition, `'True'` for a lifted
  // scalar `True`, or `'Missing'` for a lifted scalar absent condition (an
  // all-`Missing` condition row).
  const selectors: MaskCell[] = [];
  const arms: Expression[] = [];
  for (let k = 0; k < clauses.length; k++) {
    const { cond, arm } = clauses[k];
    if (arm === undefined) return undefined;
    // The first clause's condition was evaluated and materialized by the
    // caller (it is what activated the gate): never drain it twice. The
    // numeric request of the selection is forwarded, as `evaluateCondition`
    // forwards it.
    const c =
      k === 0
        ? first.cond
        : cond.canonical.evaluate(
            options.numericApproximation
              ? { numericApproximation: true }
              : undefined
          );
    const s = sym(c);
    // `Undefined` is treated as not-True (decision 9), like `False`.
    if (s === 'False' || s === 'Undefined') continue;
    if (s === 'Missing') {
      // A lifted scalar ABSENT condition is an all-`Missing` condition row,
      // not a whole-expression error: absence is position-local (R4′) and a
      // scalar condition lifts to every position (R1). Every position still
      // undecided when this clause is reached becomes an absent-condition
      // error cell; positions already selected keep their value, and no later
      // clause can decide what absence left undecided — so the walk stops
      // here, exactly as a lifted `True` does.
      selectors.push('Missing');
      arms.push(arm);
      break;
    }
    if (s === 'True') {
      selectors.push('True');
      arms.push(arm);
      break;
    }
    const mask = k === 0 ? first.mask : conditionCells(c);
    if (mask === undefined) {
      // A condition of KNOWN infinite length is a genuine length mismatch
      // against the finite ones (R3: strict, lifted regime). Anything else —
      // a symbolic condition, a collection with a symbolic or non-boolean
      // cell, a collection whose length is not yet known — leaves the whole
      // expression inert (§3 gate), whatever its length: the gate must not
      // report a dimension error about a condition it never admitted.
      if (isBroadcastableCollection(c) && c.count === Infinity)
        return broadcastLengthMismatch(ce, [...participants, c]);
      return undefined;
    }
    participants.push(c);
    selectors.push(mask);
    arms.push(arm);
  }

  const mismatch = broadcastLengthMismatch(ce, participants);
  if (mismatch) return mismatch;

  // What stops the selection: an `incompatible-dimensions` error, which is
  // the value of the whole expression, or `'inert'` when an arm's elements
  // cannot be read now and the expression stays as it is.
  let failure: Expression | 'inert' | undefined;

  // 2/ Compute the selection, node by node of the mask. At a node where every
  // condition is a scalar, it is the index of the first clause whose
  // condition is `True` there, `NO_MATCH` when no condition is, and
  // `ABSENT_CONDITION` when the first condition that is not `False` is
  // `Missing`. At a node where some condition is a list, it is one selection
  // for each position, and the list-valued conditions there must have the
  // same length. The first clause's condition is the collection that
  // activated the gate, so the top node is always a list node.
  const reached = new Set<number>();
  const select = (node: ReadonlyArray<MaskCell>): SelectionNode | undefined => {
    let lists: MaskList[] | undefined;
    for (const s of node) if (typeof s !== 'string') (lists ??= []).push(s);
    if (lists === undefined) {
      for (let k = 0; k < node.length; k++) {
        if (node[k] === 'True') {
          reached.add(k);
          return k;
        }
        if (node[k] === 'Missing') return ABSENT_CONDITION;
      }
      return NO_MATCH;
    }
    const conds = lists.map((l) => l.value);
    if (conds.length > 1) {
      const nodeMismatch = broadcastLengthMismatch(ce, conds);
      if (nodeMismatch) {
        failure = nodeMismatch;
        return undefined;
      }
    }
    const positions: SelectionNode[] = [];
    const n = lists[0].cells.length;
    for (let j = 0; j < n; j++) {
      const child = select(
        node.map((s) => (typeof s === 'string' ? s : s.cells[j]))
      );
      if (child === undefined) return undefined;
      positions.push(child);
    }
    return { conds, positions };
  };
  const selection = select(selectors);
  if (selection === undefined || typeof selection === 'number')
    return failure === 'inert' ? undefined : failure;

  // 3/ Evaluate each REACHED arm once, as a whole expression (R2).
  const values: (Expression | Expression[])[] = [];
  // The evaluated value of each reached arm. Only the refusal of an arm of
  // lower rank than the mask reads it (`lowerRankArmError`), for its message.
  const armValues: Expression[] = [];
  for (let k = 0; k < arms.length; k++) {
    if (!reached.has(k)) continue;
    const value = arms[k].canonical.evaluate(options);
    armValues[k] = value;
    if (!isBroadcastableCollection(value)) {
      values[k] = value;
      continue;
    }
    const cells = selectionArmCells(ce, participants, value);
    if (cells === undefined) return undefined;
    if (!Array.isArray(cells)) return cells;
    values[k] = cells;
  }

  // 4/ Assemble the result, node by node. At a node one level down, the
  // value of an arm is its element at that position when the arm is a list
  // at the node above, and the arm itself when it is a scalar there (it
  // lifts). A list-valued arm at a list node is checked against the
  // list-valued conditions of that node, as at the top node. A position that
  // no clause selects holds the absence marker of the type of that position
  // (`noMatchCell`, which reads the arms at the depth of the position):
  // `NaN` when every arm puts a number there, `Missing` otherwise, as `When`
  // masks a cell by the type of its value. `noMatchArmTypes`, when given,
  // replaces the types of the arms of `clauses`: a `Which` whose first mask
  // comes after a scalar clause passes the types of all its reachable arms.
  const armTypes = noMatchArmTypes ?? clauses.map(({ arm }) => arm.type.type);
  const noMatch: Expression[] = [];
  const pick = (v: Expression | Expression[] | undefined, j: number) =>
    Array.isArray(v) ? v[j] : v;
  const assemble = (
    node: SelectionList,
    here: ReadonlyArray<Expression | Expression[] | undefined>,
    depth: number
  ): Expression | undefined => {
    const result: Expression[] = [];
    for (let j = 0; j < node.positions.length; j++) {
      const child = node.positions[j];
      if (child === ABSENT_CONDITION) result.push(absentConditionError(ce));
      else if (child === NO_MATCH)
        result.push((noMatch[depth] ??= noMatchCell(ce, armTypes, depth)));
      else if (typeof child === 'number') result.push(pick(here[child], j)!);
      else {
        const next: (Expression | Expression[] | undefined)[] = [];
        for (let k = 0; k < arms.length; k++) {
          const v = pick(here[k], j);
          if (v === undefined || !isBroadcastableCollection(v)) {
            // An arm that is a list at the node above and a scalar at this
            // list node has a lower rank than the mask: it is refused
            // (`lowerRankArmError`).
            if (v !== undefined && Array.isArray(here[k])) {
              failure = lowerRankArmError(ce, participants, armValues[k]);
              return undefined;
            }
            next[k] = v;
            continue;
          }
          const cells = selectionArmCells(ce, child.conds, v);
          if (cells === undefined || !Array.isArray(cells)) {
            failure = cells ?? 'inert';
            return undefined;
          }
          next[k] = cells;
        }
        const list = assemble(child, next, depth + 1);
        if (list === undefined) return undefined;
        result.push(list);
      }
    }
    return ce._fn('List', result);
  };
  const result = assemble(selection, values, 1);
  if (result === undefined) return failure === 'inert' ? undefined : failure;
  return result;
}

/**
 * The value of an element-wise selection with an arm of LOWER rank than the
 * mask: an `incompatible-dimensions` error, as `Add` refuses two tensors of
 * different shapes. With `M := [[1, 2], [3, 4]]`, `M + [10, 20]` and
 * `If(M < 3, [10, 20], 0)` are both `incompatible-dimensions` with the
 * message `2x2 vs 2`. An arm of higher rank is not refused: at a node where
 * every condition is a scalar, the selected arm's value is taken whole
 * (`If([True, False], [[1], [2]], 0)` is `[[1], 0]`). The message names the
 * shape of the mask of highest rank among `conds`, the list-valued
 * conditions, and the shape of `arm`, as `Add` writes them (`2x2`), or a
 * length when a value has no uniform shape.
 */
function lowerRankArmError(
  ce: ComputeEngine,
  conds: ReadonlyArray<Expression>,
  arm: Expression
): Expression {
  const shapeOf = (x: Expression): string =>
    x.shape.length > 0 ? x.shape.join('x') : String(x.count);
  const mask = conds.reduce((a, b) =>
    b.shape.length > a.shape.length ? b : a
  );
  return ce.error(
    'incompatible-dimensions',
    `${shapeOf(mask)} vs ${shapeOf(arm)}`
  );
}

/** A selection at a node of the mask where no clause selects. */
const NO_MATCH = -1;
/** A selection at a node of the mask where the deciding condition is
 * `Missing`. */
const ABSENT_CONDITION = -2;

/**
 * The selection at one node of the mask of an element-wise selection: the
 * index of the selected clause, `NO_MATCH` or `ABSENT_CONDITION` at a node
 * where every condition is a scalar, or a `SelectionList` at a node where
 * some condition is a list.
 */
type SelectionNode = number | SelectionList;

/**
 * The selection at a node of the mask where some condition is a list: the
 * list-valued conditions at that node (the participants of the length check
 * of a list-valued arm there) and the selection at each position.
 */
type SelectionList = { conds: Expression[]; positions: SelectionNode[] };

/**
 * The elements of `value`, the value of a selected arm at a node of an
 * element-wise selection where `value` is a list and `conds` are the
 * list-valued conditions. The result is the materialized elements when the
 * arm has the length of the conditions, an `incompatible-dimensions` error
 * when it does not, and `undefined` when its elements cannot be read now (the
 * selection then stays inert).
 */
function selectionArmCells(
  ce: ComputeEngine,
  conds: ReadonlyArray<Expression>,
  value: Expression
): Expression[] | Expression | undefined {
  // A list-valued arm is a participant too: check its length before
  // materializing it, so an unbounded arm errors rather than hanging.
  const armMismatch = broadcastLengthMismatch(ce, [...conds, value]);
  if (armMismatch) return armMismatch;
  if (!isWalkableFiniteCollection(value)) return undefined;
  const cells = Array.from(value.each()) as Expression[];
  // The arm's length may only have become known by materializing it (a
  // `Filter` reports `count === undefined`): re-check through the shared
  // predicate so the diagnostic cannot drift.
  const sizeMismatch = broadcastLengthMismatch(ce, [
    ...conds,
    ce._fn('List', cells),
  ]);
  if (sizeMismatch) return sizeMismatch;
  return cells;
}

/**
 * What the TYPE of one condition of a conditional says about its shape:
 *
 * - `scalar`: a boolean or an absent condition (it lifts to every position
 *   of a mask), and a type that is never a mask (a tuple, which is refused
 *   at boxing, and `error`).
 * - `mask`: provably a mask. `rank` and `dimensions` are given when they are
 *   known. A type with dimensions (`list<boolean^3>`, or
 *   `matrix<boolean^(2x2)>` for `M < 3` over a 2×2 matrix `M`) has its rank and
 *   dimensions. A collection of condition values without dimensions
 *   (`list<boolean>`, `indexed_collection<boolean>`) has rank 1: a literal
 *   condition types `list<boolean^n>`, a declared or derived one
 *   `indexed_collection<boolean>`, and `indexed_collection<boolean>` is the
 *   supertype both are checked against. A type that may be a mask of any
 *   rank (`isPossiblyNestedBooleanMask`: `tensor<boolean>`,
 *   `list<boolean | list<any>>`, a ragged mask) has an unknown rank, and so
 *   has a union of masks of different ranks
 *   (`matrix<boolean^(2x2)> | list<boolean^3>`).
 * - `possible`: a mask for some values and a scalar for others
 *   (`broadcastable<boolean>`).
 * - `unreadable`: any other type (`unknown`, `any`, a union with such an
 *   arm, and a union of a scalar and a mask such as `boolean | list<boolean>`).
 *   At run time such a condition can be a scalar or a mask of any rank.
 *
 * The depth cap stops a walk through a self-referential type.
 */
type ConditionShape =
  | { kind: 'scalar' }
  | { kind: 'mask'; rank?: number; dimensions?: number[] }
  | { kind: 'possible' }
  | { kind: 'unreadable' };

function conditionShape(t: Readonly<Type>, depth = 0): ConditionShape {
  if (t === 'error' || isSubtype(t, CONDITION_CELL_TYPE))
    return { kind: 'scalar' };
  if (typeof t !== 'string') {
    if (
      t.kind === 'list' &&
      Array.isArray(t.dimensions) &&
      t.dimensions.length > 0 &&
      isSubtype(t.elements, CONDITION_CELL_TYPE)
    )
      return {
        kind: 'mask',
        rank: t.dimensions.length,
        dimensions: t.dimensions,
      };
    // A tuple is a subtype of `indexed_collection`, but runtime lifts tuples
    // whole (tuple-atomic): a tuple-typed condition never activates the
    // element-wise path, so it must not flip the static shape either.
    if (t.kind === 'tuple') return { kind: 'scalar' };
    if (
      t.kind === 'broadcastable' &&
      isSubtype(t.elements, CONDITION_CELL_TYPE)
    )
      return { kind: 'possible' };
    if (t.kind === 'union' && depth < 8) {
      const shapes = t.types.map((x) => conditionShape(x, depth + 1));
      if (shapes.some((s) => s.kind === 'unreadable'))
        return { kind: 'unreadable' };
      const masks = shapes.filter((s) => s.kind === 'mask');
      if (masks.length === shapes.length) return mergeMaskShapes(masks);
      // A union of a scalar and a mask (`boolean | list<boolean>`) is a mask
      // for some values only. It is read as `unreadable`, not `possible`: on
      // its own it keeps the scalar typing, as before masks of any rank
      // evaluated, and beside a mask it makes the rank unknown.
      if (masks.length > 0 || shapes.some((s) => s.kind === 'possible'))
        return { kind: 'unreadable' };
      return { kind: 'scalar' };
    }
  }
  if (isSubtype(t, BOOLEAN_COLLECTION_TYPE)) return { kind: 'mask', rank: 1 };
  if (isPossiblyNestedBooleanMask(t)) return { kind: 'mask' };
  return { kind: 'unreadable' };
}

/**
 * The shape of a set of masks: their common rank, `undefined` when one rank
 * is not known or two ranks differ, and their common dimensions, `undefined`
 * when two masks have different dimensions. A mask of rank 1 without
 * dimensions does not invalidate the dimensions of another one: at run time
 * both have the same length or the selection is a dimension error.
 */
function mergeMaskShapes(
  masks: ReadonlyArray<{ rank?: number; dimensions?: number[] }>
): { kind: 'mask'; rank?: number; dimensions?: number[] } {
  let rank: number | undefined;
  let dimensions: number[] | undefined;
  let dimensionsDisagree = false;
  for (const m of masks) {
    if (m.rank === undefined) return { kind: 'mask' };
    if (rank === undefined) rank = m.rank;
    else if (rank !== m.rank) return { kind: 'mask' };
    const dims = m.dimensions;
    if (dims === undefined) continue;
    if (dimensions === undefined) dimensions = dims;
    else if (
      dimensions.length !== dims.length ||
      dimensions.some((d, i) => d !== dims[i])
    )
      dimensionsDisagree = true;
  }
  return {
    kind: 'mask',
    rank,
    dimensions: dimensionsDisagree ? undefined : dimensions,
  };
}

/**
 * The rank of the masks of an element-wise conditional whose conditions have
 * the types `conds`, when every condition that may be a mask is provably one
 * of that rank (`elementwiseConditionShape`), and `undefined` otherwise. A
 * compiled selection reads it to keep the code of a flat mask unchanged.
 */
export function elementwiseMaskRank(
  conds: ReadonlyArray<Type | undefined>
): number | undefined {
  return elementwiseConditionShape(conds)?.rank;
}

/**
 * The shape of an element-wise conditional, from the TYPES of its conditions
 * (`conditionShape`): `undefined` when no condition is provably a mask (the
 * scalar typing, or the typing of a condition that is only possibly a mask,
 * applies), otherwise:
 *
 * - `rank` and `dimensions`: the shape of the masks (`mergeMaskShapes`). The
 *   rank is not known when a condition is only possibly a mask, or when the
 *   shape analysis cannot read a condition (a condition of type `unknown`):
 *   at run time such a condition can be a mask of any rank, and the
 *   selection then follows its shape.
 * - `firstMask`: the index of the first condition that is provably a mask.
 *   A clause before it whose condition is `True` at run time selects its arm
 *   WHOLE, so the result type joins those arms.
 */
function elementwiseConditionShape(
  conds: ReadonlyArray<Type | undefined>
): { rank?: number; dimensions?: number[]; firstMask: number } | undefined {
  const shapes = conds.map((t): ConditionShape =>
    t === undefined ? { kind: 'scalar' } : conditionShape(t)
  );
  const firstMask = shapes.findIndex((s) => s.kind === 'mask');
  if (firstMask < 0) return undefined;
  if (shapes.some((s) => s.kind === 'possible' || s.kind === 'unreadable'))
    return { firstMask };
  const { rank, dimensions } = mergeMaskShapes(
    shapes.filter((s) => s.kind === 'mask')
  );
  return { rank, dimensions, firstMask };
}

/**
 * True when `t` is a list whose leaves are conditions (`boolean` or
 * `missing`), at any depth, with lists of unknown contents allowed beside
 * them: `list<boolean | list<any>>`, `list<list<boolean^2> | list<boolean^1>>`
 * (a mask whose rows have different lengths), or `tensor<boolean>`. A
 * comparison over a collection whose elements may be lists (a bare
 * `indexed_collection`) is typed `list<boolean | list<any>>`, because the
 * comparison maps a nested element at its leaves.
 *
 * Such a mask selects element-wise whatever the rank of its value, so the
 * rank of the result is not known statically: the selection is typed
 * `list<C | list<any>>` (`elementwiseResultType`), which holds a flat result
 * and a nested one.
 */
function isPossiblyNestedBooleanMask(t: Readonly<Type>): boolean {
  if (typeof t === 'string' || t.kind !== 'list') return false;
  return maskLeaves(t.elements, 0) === 'condition';
}

/**
 * What the leaves of a mask element are: `'condition'` when some leaf is a
 * condition and every other leaf is a list of unknown contents, `'list'` when
 * every leaf is a list of unknown contents, `'other'` otherwise. The depth cap
 * stops a walk through a self-referential alias.
 */
function maskLeaves(
  t: Readonly<Type>,
  depth: number
): 'condition' | 'list' | 'other' {
  if (depth > 8) return 'other';
  if (isSubtype(t, CONDITION_CELL_TYPE)) return 'condition';
  if (t === 'list') return 'list';
  if (typeof t === 'string') return 'other';
  if (t.kind === 'union') {
    let result: 'condition' | 'list' = 'list';
    for (const arm of t.types) {
      const leaves = maskLeaves(arm, depth + 1);
      if (leaves === 'other') return 'other';
      if (leaves === 'condition') result = 'condition';
    }
    return result;
  }
  if (t.kind !== 'list') return 'other';
  if (t.elements === 'any' || t.elements === 'unknown') return 'list';
  return maskLeaves(t.elements, depth + 1);
}

/**
 * The type an arm contributes to the element-wise result.
 *
 * Only arms that would actually be INDEXED at runtime contribute their element
 * type. Runtime lifts anything that is not an `isBroadcastableCollection`
 * WHOLE — a tuple in particular is one element, not a row (the tuple-atomic
 * convention) — so `broadcastElementType` must not be applied to it: it unwraps
 * tuples, sets, dictionaries and records, which would declare `list<T>` for a
 * `Which` that produces `list<tuple<…>>`.
 */
function armElementType(t: Readonly<Type>): Type {
  // The unparameterized ORDERED collection names are indexed at runtime like
  // their parameterized forms, so they contribute their element type too: a
  // `range` arm contributes `integer` (its members are indices), and a bare
  // `list` or `indexed_collection` contributes `unknown`. Returning the name
  // itself put the whole collection type where a cell type belongs
  // (`Which(P > 1, P, True, 0)` for `P: range` typed `list<integer | range>`).
  if (typeof t === 'string')
    return t === 'range' || t === 'list' || t === 'indexed_collection'
      ? broadcastElementType(t)
      : t;
  if (t.kind === 'union')
    return widen(...t.types.map((x) => armElementType(x)));
  // The selection indexes a list arm position by position, so a position
  // holds an ELEMENT of the arm: a row of a matrix, `U | tensor<U>` for a
  // tensor of unknown rank (`collectionElementType`). The broadcast cell
  // (`broadcastElementType`) is a leaf of a tensor, not its element:
  // `If([True, False, True], [[1], [2], [3]], 0)` is `[[1], 0, [3]]`, and
  // read by its cells the arm typed the result `vector<integer^3>`.
  if (t.kind === 'list' || t.kind === 'indexed_collection')
    return collectionElementType(t) ?? broadcastElementType(t);
  return t as Type;
}

/**
 * The type an arm puts at a position `depth` levels down in an element-wise
 * selection: `armElementType` applied `depth` times, which stops at a type
 * that is not a list. Under a mask of rank 2, a matrix arm puts its cells
 * there, a vector arm its elements (each one lifts to a row of the mask),
 * and a scalar arm itself.
 */
function armTypeAtDepth(t: Readonly<Type>, depth: number): Type {
  let result = t as Type;
  for (let i = 0; i < depth; i++) {
    const next = armElementType(result);
    if (next === result) break;
    result = next;
  }
  return result;
}

/**
 * The CELL type of an arm, for a selection whose condition is only possibly
 * a mask (`possiblyElementwiseResultType`): the rank of such a mask is not
 * known statically, so the result is a `broadcastable` of the cells of the
 * arms, and `broadcastable<T>` is defined only for a `T` that cannot hold a
 * list (`docs/TYPE-SYSTEM.md`, "Lists, tensors and `broadcastable`"). So a
 * `broadcastable<T>` arm contributes `T`, a tensor (`tensor<U>`, or a list
 * with dimensions) contributes its cells `U`, and any other list contributes
 * the cell type of its elements. A scalar or a tuple contributes itself
 * (`armElementType`). The depth cap stops a walk through a self-referential
 * type.
 */
function armCellType(t: Readonly<Type>, depth = 0): Type {
  if (depth > 8 || typeof t === 'string') return armElementType(t);
  if (t.kind === 'union')
    return widen(...t.types.map((x) => armCellType(x, depth + 1)));
  if (t.kind === 'broadcastable') return t.elements;
  if (t.kind === 'list' && t.dimensions !== undefined) return t.elements;
  const element = armElementType(t);
  return element === t ? element : armCellType(element, depth + 1);
}

/**
 * True when the no-match cell of an element-wise selection, at a position
 * `depth` levels down, is `NaN`: every arm puts a number there
 * (`armTypeAtDepth`). Otherwise the no-match cell is `Missing`.
 */
function noMatchIsNaN(arms: ReadonlyArray<Type>, depth: number): boolean {
  return isNumericValueType(
    widen(...arms.map((t) => armTypeAtDepth(t, depth)))
  );
}

/**
 * The type of ONE CELL of an element-wise selection: the join of the arms'
 * element types (a list-valued arm contributes its ELEMENT type, since it is
 * indexed position-wise; a scalar arm contributes its own type, since it
 * lifts). `depth` is the number of list levels between the result and the
 * cell: the rank of the mask. Under a mask of rank 2, an arm contributes its
 * type two levels down (`armTypeAtDepth`). `contributions`, when given,
 * replaces the types the arms contribute (the possibly element-wise selection
 * passes their cells, `armCellType`); the no-match rule below still reads the
 * arms at `depth`, as the evaluation does (`noMatchCell`).
 *
 * `hasDefault` — a clause whose condition is literally `True` (for `If`, an
 * else branch) — decides whether the no-match cell can occur. Without one, a
 * position no clause matches is `NaN` when every arm is numeric (R4,
 * `noMatchCell`), and `finite_*` types EXCLUDE NaN under the non-finite
 * typing convention: the element type must therefore join in `number`, the
 * narrowest type that admits NaN, or a consumer
 * dispatching on `.type.matches()` would be promised a `integer` cell
 * and handed a `NaN`. WITH a default clause the no-match cell is unreachable
 * and the exact join is kept — widening unconditionally would hand every
 * element-wise conditional an over-wide union, which breaks that same
 * dispatch.
 */
function elementwiseCellType(
  arms: ReadonlyArray<Type>,
  hasDefault: boolean,
  depth = 1,
  contributions: ReadonlyArray<Type> = arms.map((t) => armTypeAtDepth(t, depth))
): Type {
  if (hasDefault) return widen(...contributions);
  // The no-match cell is the absence marker of the type of the position
  // (`noMatchCell`): `NaN` when every arm is numeric, so the cell joins in
  // `number`, the narrowest type that admits `NaN`; `Missing` otherwise, so
  // the cell keeps a `missing` arm. The union is built explicitly: `widen`
  // joins toward a common supertype and would dissolve the absence marker.
  const joined = widen(...contributions);
  if (noMatchIsNaN(arms, depth)) return widen(joined, 'number');
  return reduceType({ kind: 'union', types: [joined, 'missing'] });
}

/**
 * The result type of a selection whose condition is only POSSIBLY a boolean
 * collection (`possiblyElementwiseCondition`): `broadcastable` of the
 * element-wise cell type, joined with every arm that this type does not
 * already admit.
 *
 * At runtime such a condition can also be a scalar boolean, and the
 * selection then returns one arm WHOLE. A scalar arm, or a list arm whose
 * elements are in the cell type, is admitted by `broadcastable<cell>`. An
 * arm whose element type is `unknown` is not: `widen` treats `unknown` as
 * "no information" and drops it from the cell. With `u: list` and
 * `p: tuple<integer>`, `If(u[2] != 0, p, u)` was typed
 * `broadcastable<tuple<integer>>`, while for `u = [1, 0, 3]` it returns
 * `[1, 0, 3]` (issue #454).
 *
 * The cell type is the join of the CELLS of the arms (`armCellType`), so
 * that the result is never a `broadcastable` of a list type: with
 * `B: broadcastable<number>`, `If(B < 0, -B, B)` is a
 * `broadcastable<number>`, not a `broadcastable<broadcastable<number>>`.
 * A value whose mask has a lower rank than an arm is not a tensor, and the
 * list arm added below holds it.
 */
function possiblyElementwiseResultType(
  arms: ReadonlyArray<Type>,
  hasDefault: boolean
): Type {
  const broadcast: Type = {
    kind: 'broadcastable',
    elements: elementwiseCellType(
      arms,
      hasDefault,
      1,
      arms.map((t) => armCellType(t))
    ),
  };
  const missed = arms.filter((t) => !isSubtype(t, broadcast));
  // When an element of an arm can be a list (a matrix, a tensor, a
  // `broadcastable`, a value of unknown type), the mask can have a lower
  // rank than the arm at run time, and the selection then puts a row of the
  // arm beside a cell: with `C := [-1, 1]` and `B := [[1, 2], [3, 4]]`,
  // `If(C < 0, B, 0)` is `[[1, 2], 0]`, which is not a tensor.
  // `list<cell | list<any>>`, a list whose elements are cells or lists of
  // any depth, holds that value. A scalar arm and a vector arm cannot give
  // such a value.
  if (arms.some((t) => !cannotHoldAList(armElementType(t))))
    missed.push({
      kind: 'list',
      elements: reduceType({
        kind: 'union',
        types: [broadcast.elements, { kind: 'list', elements: 'any' }],
      }),
    });
  if (missed.length === 0) return broadcast;
  return reduceType({ kind: 'union', types: [broadcast, ...missed] });
}

/**
 * The value of a position that no clause of an element-wise selection
 * selects, given the types of all the arms of the selection: the absence
 * marker of the type of the position, `NaN` when every arm puts a number
 * there and `Missing` otherwise (a point, a list, a string, a value that is
 * not provably numeric). A list arm puts its element there, a scalar or a
 * point arm puts itself (`armElementType`). This is the rule `When` applies
 * to a cell it masks (`maskedValue`), so `Which([1, 5] < 3, (1, 2))` and
 * `When((1, 2), [1, 5] < 3)` are both `[(1, 2), Missing]`, and
 * `Which([1, 5] < 3, 7)` and `When(7, [1, 5] < 3)` are both `[7, NaN]`
 * (user decision 2026-10-17). The rule reads the types of the arms and not
 * their values: an arm that no position reaches is not evaluated.
 *
 * `depth` is the number of list levels between the result and the position:
 * 1 under a mask of rank 1, 2 for a cell of a mask of rank 2. An arm puts
 * its type that many levels down there (`armTypeAtDepth`), so with
 * `M := [[1, 2], [3, 4]]`, `If(M < 3, M)` is `[[1, 2], [NaN, NaN]]`.
 */
function noMatchCell(
  ce: ComputeEngine,
  arms: ReadonlyArray<Type>,
  depth = 1
): Expression {
  return noMatchIsNaN(arms, depth) ? ce.NaN : ce.Missing;
}

/**
 * True when a condition is only POSSIBLY a boolean collection: its type is
 * `broadcastable<boolean>`, the union `boolean | list<boolean>`
 * the engine gives a comparison whose broadcast outcome it cannot settle
 * statically — `C = U_1` with `C` declared `indexed_collection` and `U_1`
 * top-typed is `[True,False,True]` when `U_1` turns out to be a scalar and the
 * single boolean of a whole-collection compare when it turns out to be a
 * collection (`library/relational-operator.ts`, `comparisonResultType`).
 *
 * Such a condition takes the element-wise selection path at runtime only in
 * the first case, so neither the element-wise list type nor the scalar join of
 * the arms is honest on its own: the result is `broadcastable` of the same
 * cell type the element-wise path would produce.
 *
 * The test reads the `kind` of the type (`conditionShape`), not a subtype
 * relation: `matches('broadcastable<boolean>')` would also accept a plain
 * scalar `boolean` condition, since a scalar is a member of the union that
 * `broadcastable<T>` abbreviates.
 */
function possiblyElementwiseCondition(
  conds: ReadonlyArray<Type | undefined>
): boolean {
  return conds.some(
    (t) => t !== undefined && conditionShape(t).kind === 'possible'
  );
}

/**
 * True when a condition of type `t` cannot be read (`conditionShape` is
 * `unreadable`: `unknown`, `any`, a union of a scalar and a mask) and may
 * hold a list. At run time such a condition can be a mask of any rank, and
 * the selection is then element-wise. A condition that cannot hold a list (a
 * number, which the canonical form refuses) is not read as a mask.
 */
function unreadableConditionMayBeMask(t: Type): boolean {
  return conditionShape(t).kind === 'unreadable' && !cannotHoldAList(t);
}

/**
 * True when one of the conditions `conds` states that it may be `missing`,
 * the value of a whole-collection comparison that is undecided (`[1, 2] =
 * [1, Missing]`, typed `boolean | missing`). Such a condition selects no
 * clause, and the `If` or `Which` is `Missing` (`evaluateCondition`). An
 * `unknown` arm and the type `any` state nothing (`provablyAdmits`): such a
 * condition is not a comparison whose type is known.
 *
 * A comparison is undecided only when two or more of its operands are
 * collections (`evaluateCondition`). A comparison with at most one operand
 * that can hold a list (`At(s, 2) = 0`) that is `Missing` has an absent
 * operand: the `If` or `Which` is then the absent-condition error, which the
 * type does not show. So such a comparison adds no `missing` arm.
 */
function mayBeUndecidedCondition(
  conds: ReadonlyArray<OperandDescriptor | undefined>
): boolean {
  return conds.some((c) => {
    if (c === undefined) return false;
    const t = c.type;
    if (t === 'any' || !provablyAdmits('missing', t)) return false;
    const s = c.structureOf?.();
    if (s?.kind === 'application' && BRANCH_RELATIONS.has(s.head))
      return s.children.filter((x) => !cannotHoldAList(x.type)).length >= 2;
    return true;
  });
}

/** The type `t` with a `missing` arm when `undecided` is true. */
function withUndecidedArm(t: Type, undecided: boolean): Type {
  return undecided ? reduceType({ kind: 'union', types: [t, 'missing'] }) : t;
}

/**
 * The shape of the masks of a selection whose only condition that is not a
 * scalar has a union type whose options are each a scalar condition type or
 * a mask type, with at least one of each (`boolean | list<boolean>`), and
 * `undefined` otherwise. A union that has an option of unreadable type or a
 * `broadcastable` option is not read here.
 *
 * At run time such a condition is a scalar or a mask, so the result type is
 * the union of the scalar result type and of the element-wise result type of
 * this shape. Each option is typed on its own: a `broadcastable` result type
 * would also admit a scalar cell, which the selection cannot give when every
 * arm is a list.
 *
 * Only a selection where every other condition is a scalar is read, so that
 * the element-wise result has the rank of this condition's masks. Clauses
 * before this condition that select at run time give their arm whole, which
 * the scalar result type holds.
 */
function scalarOrMaskConditionShape(
  conds: ReadonlyArray<Type | undefined>
): { rank?: number; dimensions?: number[] } | undefined {
  const shapes = conds.map((t): ConditionShape =>
    t === undefined ? { kind: 'scalar' } : conditionShape(t)
  );
  const others = shapes.filter((s) => s.kind !== 'scalar');
  if (others.length !== 1) return undefined;
  const t = conds[shapes.indexOf(others[0])];
  if (t === undefined || typeof t === 'string' || t.kind !== 'union')
    return undefined;
  const options = t.types.map((x) => conditionShape(x, 1));
  if (!options.every((s) => s.kind === 'scalar' || s.kind === 'mask'))
    return undefined;
  const masks = options.filter((s) => s.kind === 'mask');
  if (masks.length === 0 || masks.length === options.length) return undefined;
  const { rank, dimensions } = mergeMaskShapes(masks);
  return { rank, dimensions };
}

/**
 * The type of an element-wise selection, given the shape of its masks
 * (`elementwiseConditionShape`).
 *
 * - When the rank `k` of the masks is known, the result is a list of rank
 *   `k` of `elementwiseCellType` read `k` levels down: with dimensions when
 *   the masks have known common dimensions and the cell can carry them, and
 *   otherwise `k` nested plain lists (`list<C>` for a mask of rank 1 whose
 *   length is not provable). With `M := [[1, 2], [3, 4]]`, `If(M < 3, M, 0)`
 *   is a `matrix<integer^(2x2)>`.
 * - When the rank is not known, the result is `list<C | list<any>>`, a list
 *   whose elements are cells or lists of any depth, with `C` the cell type
 *   one level down: an element of the result is a cell when the mask is flat
 *   at that position and a list when it is not. This is the type
 *   `broadcastShapedResultType` (`common/type/utils.ts`) gives a broadcast
 *   of unknown depth.
 */
function elementwiseResultType(
  arms: ReadonlyArray<Type>,
  shape: { rank?: number; dimensions?: number[] },
  hasDefault: boolean
): Type {
  if (shape.rank === undefined)
    return {
      kind: 'list',
      elements: reduceType({
        kind: 'union',
        types: [
          elementwiseCellType(arms, hasDefault),
          { kind: 'list', elements: 'any' },
        ],
      }),
    };
  const rank = shape.rank;
  const elements = elementwiseCellType(arms, hasDefault, rank);
  // The union-free clause (tensor-unification design §D3 rule 2): a
  // dimensioned `list` type IS the tensor claim (`isTensor` is exactly
  // `dimensions !== undefined`), and a heterogeneous cell population never
  // qualifies — the `List` shape analysis (`shapedListTypeD`,
  // `collections.ts`) declines the shape for it. Claiming a
  // dimension here for a union element type would promise a shape no
  // evaluated value can ever carry, breaking the value-vs-declared
  // assignability invariant (`evaluated.type.matches(declared)`) for the
  // no-default mixed case, whose no-match cell joins in `number`. A length
  // is written only for a cell that may carry a dimension
  // (`mayCarryDimensions`: a cell that cannot be a list), so a selection of
  // numbers, booleans or points keeps its length; a selection of lists is
  // a plain list.
  const dimensions = shape.dimensions;
  const shaped =
    dimensions !== undefined &&
    dimensions.length === rank &&
    (typeof elements === 'string' || elements.kind !== 'union') &&
    mayCarryDimensions(elements);
  if (shaped) return { kind: 'list', elements, dimensions: [...dimensions] };
  let result: Type = elements;
  for (let i = 0; i < rank; i++) result = { kind: 'list', elements: result };
  return result;
}

/** Evaluate an `If` expression. */
function evaluateIf(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression | undefined {
  const [cond, ifTrue, ifFalse] = ops;
  const engine = options.engine;
  // The numeric request of the `If` is forwarded to the condition and to the
  // selected branch, so that a function that jumps in them (`Floor`, a
  // comparison) reads an exact operand exactly, as it does at the top level.
  // In the body of a user function under `.N()`, a parameter is bound to the
  // float of the argument, and only such a function evaluated with the
  // numeric request reads the exact argument again (`exactRealValueOf`,
  // `constraint-subject.ts`).
  const armOptions = options.numericApproximation
    ? { numericApproximation: true }
    : undefined;
  const { value: evaluated, undecided } = evaluateCondition(
    cond,
    options.numericApproximation
  );
  // The condition is the one operand `If` ALWAYS demands, so an error
  // in it propagates — the dual obligation of the demanded-operands
  // rule (`docs/ERROR-MODEL.md` §3), which this handler owns because a
  // lazy operator is not pre-absorbed. Answering here also keeps the
  // error a value: a lazy operator's handler faults are re-thrown
  // rather than converted to an `Error` expression, so an error condition
  // that reached the typo throw at the end of this handler would escape
  // as a host exception.
  const condError = errorValue(evaluated);
  if (condError !== undefined) return condError;
  // An undecided whole-collection comparison (`evaluateCondition`) selects
  // no arm: the value is `Missing`, the position-preserving absent
  // datum that an else-less `If` and a `Which` with no selected clause
  // already answer (no-selection ruling 2026-08-27). The compiled
  // lanes answer their numeric spelling of the same marker, `NaN`.
  // Unlike a free-variable condition this can never resolve, so the
  // node is not held inert; unlike an absent condition it is not a
  // program defect, so it is not an error.
  if (undecided) return engine.Missing;
  const evaluatedCond = sym(evaluated);
  if (evaluatedCond === 'True')
    return ifTrue?.evaluate(armOptions) ?? engine.Missing;
  if (evaluatedCond === 'False')
    return ifFalse?.evaluate(armOptions) ?? engine.Missing;
  // An ABSENT condition (the `Missing` symbol) is a legitimate runtime
  // data state, not a program defect: it is Kleene-undecidable, so
  // branching is an error — but a catchable error EXPRESSION (R's
  // `if (NA)` stance), never the typo throw below. Discharge with
  // `Coalesce`/`IsMissing` before branching. (§3.D residual, resolved
  // 2026-07-24.)
  if (evaluatedCond === 'Missing') return absentConditionError(engine);
  // A LIST-VALUED condition selects element-wise: `If(c, a, b)` is the
  // two-clause `Which(c, a, True, b)` (see
  // `evaluateElementwiseSelection`). Without an else branch the
  // unselected positions are the no-match cell (`NaN` for a numeric arm,
  // `Missing` otherwise: `noMatchCell`), not `Nothing`:
  // an element-wise result preserves positions (R4).
  const mask = conditionCells(evaluated);
  if (mask !== undefined && ifTrue !== undefined) {
    const clauses = [{ cond, arm: ifTrue }];
    if (ifFalse !== undefined)
      clauses.push({ cond: engine.True, arm: ifFalse });
    return evaluateElementwiseSelection(
      engine,
      clauses,
      { cond: evaluated, mask },
      options
    );
  }
  // Every other condition leaves the `If` UNEVALUATED. That covers an
  // undecided boolean — a relation with free variables (`x = 4` stays
  // symbolic under evaluate()), a symbol with no value — and equally a
  // condition that is not a boolean at all (the number 10, a misspelled
  // symbol, a list of numbers). An undecidable conditional is a symbolic
  // expression, not a program defect: it may become decidable once its
  // variables are bound, and a host exception thrown from here escapes
  // past every caller that only asked for a value. (User ruling
  // 2026-08-31, shared with `evaluateWhich` so the two cannot diverge.)
  //
  // The node is rebuilt around the EVALUATED condition (the held arms
  // untouched): `If` is `lazy`, and a lazy handler that returns
  // `undefined` hands the framework the ORIGINAL node, discarding the
  // condition's evaluation — `If(C = U[1], …)` kept `U[1]` where its
  // condition had already read `10`, and inside a big operator's loop
  // the condition kept the INDEX symbol rather than the value the loop
  // had assigned (see `evaluateBigOpTerm`, `library/utils.ts`). The
  // `isSame` guard keeps this a fixpoint: an unchanged condition returns
  // `undefined` as before, so the rebuilt node evaluates to itself.
  return evaluated.isSame(cond)
    ? undefined
    : engine._fn('If', [evaluated, ...ops.slice(1)]);
}

/**
 * The asynchronous twin of `evaluateIf`. The condition is awaited through
 * the asynchronous route — where a relation awaits an asynchronous-only
 * operand of its own before it compares — and the selected arm is awaited
 * the same way, so an operator with only an `evaluateAsync` handler works in
 * either position. Everything else — the error, `NaN` and absent-condition
 * verdicts, the element-wise selection, the hold of an undecided condition —
 * is `evaluateIf` on the evaluated condition, so the two cannot diverge.
 */
async function evaluateIfAsync(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Promise<Expression | undefined> {
  const [cond, ifTrue, ifFalse] = ops;
  const engine = options.engine;
  const evalOptions = {
    numericApproximation: options.numericApproximation,
    materialization: options.materialization,
    signal: options.signal,
    _effects: options._effects,
    _contextStack: options._contextStack,
    _precisionWindow: options._precisionWindow,
  };
  const evaluated =
    cond === undefined ? undefined : await cond.evaluateAsync(evalOptions);
  // The synchronous fallbacks below run after the `await` above, so the
  // arms they evaluate must be given this evaluation's host capability
  // registry and context stack explicitly (`runWithEvaluationEffects`).
  const fallback = (ops: ReadonlyArray<Expression>) =>
    options._effects === undefined
      ? evaluateIf(ops, options)
      : runWithEvaluationEffects(
          engine,
          options._effects,
          () => evaluateIf(ops, options),
          options._contextStack,
          options._precisionWindow
        );
  if (evaluated === undefined) return fallback(ops);
  const { value, undecided } = evaluateCondition(evaluated);
  if (errorValue(value) === undefined && !undecided) {
    const decided = sym(value);
    if (decided === 'True')
      return ifTrue === undefined
        ? engine.Missing
        : ifTrue.evaluateAsync(evalOptions);
    if (decided === 'False')
      return ifFalse === undefined
        ? engine.Missing
        : ifFalse.evaluateAsync(evalOptions);
  }
  return fallback([evaluated, ...ops.slice(1)]);
}

/**
 * The asynchronous twin of `evaluateWhich`: each guard is awaited through the
 * asynchronous route, in order, and a selected arm is awaited the same way;
 * a guard that is not a plain `True`/`False` hands the remaining clauses to
 * `evaluateWhich` with the evaluated guard in place, which owns every other
 * verdict.
 */
async function evaluateWhichAsync(
  args: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Promise<Expression | undefined> {
  const engine = options.engine;
  const evalOptions = {
    numericApproximation: options.numericApproximation,
    materialization: options.materialization,
    signal: options.signal,
    _effects: options._effects,
    _contextStack: options._contextStack,
    _precisionWindow: options._precisionWindow,
  };
  // The synchronous fallbacks below run after an `await`, so the arms they
  // evaluate must be given this evaluation's host capability registry and
  // context stack explicitly (`runWithEvaluationEffects`).
  const fallback = (args: ReadonlyArray<Expression>) =>
    options._effects === undefined
      ? evaluateWhich(args, options)
      : runWithEvaluationEffects(
          engine,
          options._effects,
          () => evaluateWhich(args, options),
          options._contextStack,
          options._precisionWindow
        );
  let i = 0;
  while (i < args.length - 1) {
    const evaluated = await args[i].evaluateAsync(evalOptions);
    const { value, undecided } = evaluateCondition(evaluated);
    if (errorValue(value) !== undefined || undecided)
      return fallback([...args.slice(0, i), evaluated, ...args.slice(i + 1)]);
    const guard = sym(value);
    if (guard === 'True') {
      if (!args[i + 1]) return engine.Missing;
      return args[i + 1].evaluateAsync(evalOptions);
    }
    if (guard !== 'False' && guard !== 'Undefined')
      return fallback([...args.slice(0, i), evaluated, ...args.slice(i + 1)]);
    i += 2;
  }
  return fallback(args);
}

function evaluateWhich(
  args: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression | undefined {
  let i = 0;
  while (i < args.length - 1) {
    // The guard is evaluated with the numeric request of the `Which`, as the
    // selected arm is (see `evaluateIf`).
    const { value: evaluated, undecided } = evaluateCondition(
      args[i],
      options.numericApproximation
    );
    // A guard `Which` reaches is DEMANDED, so an error in it propagates —
    // the same obligation `If` discharges for its condition (see the comment
    // there): a lazy operator owns propagation for what it demands, and an
    // error left to reach the typo throw below would escape as a host
    // exception rather than as a value.
    const condError = errorValue(evaluated);
    if (condError !== undefined) return condError;
    // An undecided whole-collection comparison (`evaluateCondition`)
    // selects no clause, and falling through to a later clause would decide
    // what the comparison left undecided: the whole `Which` answers `Missing`, its
    // no-selection value (see the `If` handler for the reasoning and the
    // compiled lanes' `NaN` spelling of it).
    if (undecided) return options.engine.Missing;
    const cond = sym(evaluated);
    if (cond === 'True') {
      // A selected clause with no arm has no value to answer: `Missing`, the
      // position-preserving absent datum (no-selection ruling 2026-08-27).
      if (!args[i + 1]) return options.engine.Missing;
      return args[i + 1].evaluate(options);
    } else if (cond !== 'False' && cond !== 'Undefined') {
      // An ABSENT guard (the `Missing` symbol) is Kleene-undecidable: this
      // clause can neither be taken nor skipped (falling through to a later
      // clause would decide what absence left undecided), so the `Which` is
      // a catchable error EXPRESSION — not the typo throw below. (§3.D
      // residual, resolved 2026-07-24.)
      if (cond === 'Missing') return absentConditionError(options.engine);
      // A LIST-VALUED condition selects element-wise (§3 of
      // `docs/BROADCAST-MODEL.md`). Every earlier
      // clause fell through (its condition was a scalar `False`/`Undefined`),
      // so it can never select and the remaining clauses carry the whole
      // selection.
      const mask = conditionCells(evaluated);
      if (mask !== undefined) {
        const clauses: { cond: Expression; arm: Expression }[] = [];
        for (let k = i; k < args.length - 1; k += 2)
          clauses.push({ cond: args[k], arm: args[k + 1] });
        // The no-match cell is read from the types of ALL the reachable arms
        // of the `Which`, the arms of the clauses before this one included,
        // up to and including the first clause whose condition is a literal
        // `True` (the default clause). The type handler of `Which` and the
        // compiled selection read the same arms, so the three agree: with
        // `x := -1`, `Which(x > 0, "s", [True, False], 1)` is
        // `[1, Missing]`, because the string arm is not numeric.
        const reachableArmTypes: Type[] = [];
        for (let k = 0; k < args.length - 1; k += 2) {
          reachableArmTypes.push(args[k + 1].type.type);
          if (sym(args[k]) === 'True') break;
        }
        const result = evaluateElementwiseSelection(
          options.engine,
          clauses,
          { cond: evaluated, mask },
          options,
          reachableArmTypes
        );
        if (result) return result;
      }
      // Every other condition leaves the WHOLE `Which` unevaluated: an
      // undecided boolean (`x = 4` with a free `x`, which stays symbolic under
      // evaluate()), and equally a condition that is not a boolean at all (a
      // number, a misspelled symbol, a list of numbers). Picking a later
      // branch would be wrong once the condition becomes decidable, and an
      // undecidable conditional is a symbolic expression rather than a program
      // defect — never a host exception. (User ruling 2026-08-31, shared with
      // the `If` handler so the two cannot diverge.)
      //
      // Rebuilt around the EVALUATED condition, arms and later clauses
      // untouched — same reason as `If`: `Which` is `lazy`, and returning
      // `undefined` would hand back the ORIGINAL node with the condition's
      // evaluation discarded (`Which(C = U[1], …)` kept `U[1]` where the
      // condition had read `10`; in a big-op loop it kept the index symbol
      // in place of the assigned value). The earlier clauses (already decided
      // `False`/`Undefined`) are carried over AS WRITTEN: the held node stays
      // a faithful copy of the original conditional, so nothing is lost if the
      // undecided condition later resolves. Fixpoint-guarded with `isSame`.
      return evaluated.isSame(args[i])
        ? undefined
        : options.engine._fn('Which', [
            ...args.slice(0, i),
            evaluated,
            ...args.slice(i + 1),
          ]);
    }
    // `False` — or `Undefined` (decision 9), treated as not-True — falls
    // through to the next clause.
    i += 2;
  }

  // No clause selected: `Missing`, the position-preserving absent datum
  // (no-selection ruling 2026-08-27, shared with the else-less `If` and,
  // since 2026-09-09, with the masking answer of the `When` operator).
  return options.engine.Missing;
}

/**
 * The block scopes whose bindings at the start of their first run are
 * recorded: each binding that the sweep kept at that time carries the
 * `_blockTemplate` mark. On the asynchronous route the key is the block
 * scope itself (the template), not the activation that the run uses.
 */
const recordedBlockScopes = new WeakSet<Scope>();

/**
 * What the sweep knows of the bindings that the runs of a block made (the
 * bindings of the block scope that have no `_blockTemplate` mark and no
 * `_declaredByStatement` mark: the implicit locals of its assignments).
 *
 * - `epoch`: the top-level evaluation of the last run
 *   (`topLevelEvaluationEpoch`, `boxed-expression/evaluation-epoch.ts`).
 * - `key`: the function call of the last run (`callActivationKey`).
 * - `saved`: for each other run key and each top-level evaluation, the
 *   bindings that the runs of the block made with that key in that
 *   evaluation, kept while a run of another key or evaluation (a recursive
 *   call) uses the block scope. They are put back only for a run of the same
 *   key and the same evaluation. A run of another evaluation is a new
 *   top-level evaluation, or an asynchronous evaluation that runs at the
 *   same time, which has its own number: its runs between two parts of this
 *   evaluation do not reset the locals of this evaluation. One key can have
 *   runs of several evaluations that alternate: each statement after the
 *   first of an asynchronous program block is a new top-level evaluation on
 *   the same frames (`beginAsyncStatement`, `evaluation-epoch.ts`), and an
 *   `evaluateAsync()` that an earlier statement started and did not await
 *   can still run. The outer map is weak: the entry of a call goes away with
 *   the scope of the call, so a sum of many calls (`Sum(g(k), k, 1, 10^5)`)
 *   does not keep an entry for each call. A call whose runs made no binding
 *   has no entry. `TOP_LEVEL_RUN` keeps the entry of one evaluation only.
 */
type BlockRunState = {
  epoch: number;
  key: object;
  saved: WeakMap<object, Map<number, Map<string, BoxedDefinition>>>;
};

/** Keyed by the block scope (the template on the asynchronous route). */
const blockRunStates = new WeakMap<Scope, BlockRunState>();

/** The key of a run of a synchronous top-level evaluation that is not inside
 * a function call. The number of the synchronous top-level evaluation of an
 * engine only grows, so a run with this key and an older number never comes
 * again (`sweepCanonicalizationBindings`). */
const TOP_LEVEL_RUN = {};

/**
 * The function call that the current run of a block is part of: the scope
 * of the innermost call frame on the evaluation-context stack (the
 * `freshScope` that `makeLambda` in `function-utils.ts` makes for each call
 * and pushes as a `'call'` frame).
 *
 * Outside any call, the key of the asynchronous evaluation that the run is
 * part of: the outermost activation on the stack (a copy of the scope of a
 * scoped node, made for one asynchronous evaluation of the node,
 * `asyncScopeActivation`, `boxed-expression/boxed-function.ts`), other than
 * the current scope. Before each asynchronous evaluation had its own number
 * (`topLevelEvaluationEpoch`), asynchronous evaluations that ran at the same
 * time shared one, and without this key, a run in one of them read the
 * locals of a run in another: `Promise.all` of three `evaluateAsync()` of
 * one `Sum` of a block gave `3t + 6`, `3t + 15` and `3t + 24`.
 *
 * When there is neither, the asynchronous evaluation whose context stack is
 * in place (`asyncEvaluationOf`, `boxed-expression/evaluation-epoch.ts`), or
 * `TOP_LEVEL_RUN` for a synchronous evaluation.
 */
function callActivationKey(ce: ComputeEngine): object {
  const stack = ce._evalContextStack;
  for (let i = stack.length - 1; i >= 0; i--)
    if (stack[i].name === 'call') return stack[i].lexicalScope;
  const current = ce.context.lexicalScope;
  for (const frame of stack)
    if (
      frame.lexicalScope !== current &&
      scopeActivationTemplate(frame.lexicalScope) !== undefined
    )
      return frame.lexicalScope;
  return asyncEvaluationOf(stack) ?? TOP_LEVEL_RUN;
}

/**
 * Prepare the block scope that is the current lexical scope for a new run of
 * the block. Shared by the synchronous and asynchronous block evaluators.
 *
 * - The canonicalization-time bookkeeping is removed: see the comment in
 *   `evaluateBlock`, which is the reason for this part of the sweep.
 * - An assignment to a name that has no binding in the scope chain
 *   (`x ≔ x + 1` with `x` not declared) makes a binding in the block scope
 *   with the assigned value: an implicit local of the block. As a variable of
 *   a JavaScript or Python function, this local keeps its value from one run
 *   of the block to the next inside one evaluation (the iterations of a loop
 *   whose body is the block: `Loop(Block(t ≔ t + 1; …), 1..3)` ends with
 *   `t + 3`), and starts with no value in a new top-level evaluation and in
 *   a new function call. Before, it also kept its value from one top-level
 *   evaluation to the next: `Block(x ≔ x + 1; 2x)` gave `2(x + 1)`, then
 *   `2(x + 2)`.
 *
 *   So, at the start of a run in a new top-level evaluation, the bindings
 *   that the runs of the block made are removed. At the start of a run in
 *   another function call, or in another evaluation, they are set aside for
 *   the call and the evaluation that made them, and the bindings of the new
 *   call and evaluation (if a run of the block in that call and evaluation
 *   made some) are put back. A run of another evaluation can come between
 *   two runs of one evaluation when the two are asynchronous evaluations
 *   that run at the same time, each with its own number. A recursive call that
 *   runs the block again then does not reset the locals of the calls around
 *   it for their next runs. The block scope is one object for all the
 *   calls. When the block is in the body of a function literal, an
 *   application of the literal that starts while another one runs saves the
 *   bindings and values of the block scope, and puts them back when it ends
 *   (`enterNestedBodyScopes`, `function-utils.ts`). So after a recursive
 *   call, the enclosing run reads its own locals again.
 *
 *   A binding that the block scope held before its first run (a function
 *   clause installed at canonicalization) is kept, and so is a local of a
 *   `Declare` statement (`_declaredByStatement`), which `createBlockLocals`
 *   (`function-utils.ts`) replaces at each run. An assignment to a name
 *   declared outside the block writes that outer binding and makes nothing
 *   here.
 *
 * On the asynchronous route the current scope is an activation: a copy of
 * the block scope made for this run (`asyncScopeActivation`,
 * `boxed-expression/boxed-function.ts`). The copy holds what the block scope
 * held when the run started, so a binding of the activation is kept only
 * when the binding of the same name in the block scope carries the mark, or
 * when the run is in the same evaluation and call as the last synchronous
 * run. The locals that an asynchronous run makes stay out of the block scope:
 * they are kept for the next asynchronous run of the same evaluation and
 * call in `asyncRunLocals` (`beginAsyncRun`, `endAsyncRun`).
 */
function sweepCanonicalizationBindings(ce: ComputeEngine): void {
  const scope = ce.context.lexicalScope;
  const template = scopeActivationTemplate(scope) ?? scope;
  type Marks = { _declaredByStatement?: boolean; _blockTemplate?: boolean };
  const isValueless = (def: BoxedDefinition): boolean =>
    'value' in def && def.value.value === undefined;
  if (!recordedBlockScopes.has(template)) {
    recordedBlockScopes.add(template);
    for (const def of template.bindings.values())
      if (!isValueless(def)) (def as Marks)._blockTemplate = true;
  }
  const remove = (name: string, def: BoxedDefinition): void => {
    // Checkpoint journal (funnel 4): the sweep removes bindings by direct
    // map surgery.
    journalCheckpointMapEntry(ce, scope.bindings, name, name, 'declare');
    scope.bindings.delete(name);
    // A binding with a value changed what the name resolves to in this
    // scope, so its removal is counted as a declaration of the scope
    // (`noteScopeDeclaration`).
    if (!isValueless(def)) noteScopeDeclaration(scope);
  };
  // The bindings that the runs of the block made
  const madeByRuns = new Map<string, BoxedDefinition>();
  for (const [name, def] of [...scope.bindings]) {
    if ((def as Marks)._declaredByStatement === true) continue;
    if (isValueless(def)) remove(name, def);
    else if (
      (template.bindings.get(name) as Marks | undefined)?._blockTemplate !==
      true
    )
      madeByRuns.set(name, def);
  }

  const epoch = topLevelEvaluationEpoch(ce);
  const key = callActivationKey(ce);
  const state = blockRunStates.get(template);
  // An asynchronous run: the bindings that the activation copied from the
  // block scope were made by synchronous runs. They are kept only for a run
  // of the same evaluation and call, and the state of the synchronous runs is
  // not changed. The locals of the earlier asynchronous runs come from
  // `asyncRunLocals` (`beginAsyncRun`).
  if (scope !== template) {
    if (state === undefined || state.epoch !== epoch || state.key !== key)
      for (const [name, def] of madeByRuns) remove(name, def);
    return;
  }
  if (state === undefined) {
    for (const [name, def] of madeByRuns) remove(name, def);
    blockRunStates.set(template, { epoch, key, saved: new WeakMap() });
    return;
  }
  if (state.key === key && state.epoch === epoch) return;
  // A run of another key (another function call), or of another top-level
  // evaluation. The bindings of the last run are set aside for its key and
  // evaluation. A synchronous top-level evaluation with no call
  // (`TOP_LEVEL_RUN`) does not come back once a newer one runs, so its
  // entry replaces the one of an older evaluation, and none is kept when
  // the new run is of a newer such evaluation.
  if (
    madeByRuns.size > 0 &&
    !(state.key === TOP_LEVEL_RUN && key === TOP_LEVEL_RUN)
  ) {
    let byEpoch = state.saved.get(state.key);
    if (byEpoch === undefined || state.key === TOP_LEVEL_RUN) {
      byEpoch = new Map();
      state.saved.set(state.key, byEpoch);
    }
    byEpoch.set(state.epoch, madeByRuns);
  }
  for (const [name, def] of madeByRuns) remove(name, def);
  const byEpoch = state.saved.get(key);
  const restored = byEpoch?.get(epoch);
  if (key === TOP_LEVEL_RUN) state.saved.delete(key);
  else byEpoch?.delete(epoch);
  if (restored !== undefined)
    for (const [name, def] of restored) {
      if (scope.bindings.has(name)) continue;
      journalCheckpointMapEntry(ce, scope.bindings, name, name, 'declare');
      scope.bindings.set(name, def);
      noteScopeDeclaration(scope);
    }
  state.key = key;
  state.epoch = epoch;
}

/**
 * The implicit locals that the asynchronous runs of a block made, keyed by
 * the block scope, then by the run key (`callActivationKey`) of the
 * evaluation and call that the runs are part of, then by the number of the
 * evaluation of the runs (`topLevelEvaluationEpoch`). One run key can have
 * runs of several evaluations that alternate: each statement after the
 * first of an asynchronous program block is a new top-level evaluation on
 * the same frames (`beginAsyncStatement`, `evaluation-epoch.ts`), and an
 * `evaluateAsync()` that an earlier statement started and did not await can
 * still run. The map of run keys is weak, so the entries of a call or an
 * evaluation go away with its scope.
 */
const asyncRunLocals = new WeakMap<
  Scope,
  WeakMap<object, Map<number, Map<string, BoxedDefinition>>>
>();

/** An asynchronous run of a block, from `beginAsyncRun` to `endAsyncRun`. */
type AsyncRun = {
  activation: Scope;
  template: Scope;
  epoch: number;
  key: object;
};

/**
 * Whether `def`, the binding of `name` in a scope of a block, is an implicit
 * local that a run of the block made: not a binding that the block scope
 * held before its first run (its `_blockTemplate` mark), not a `let` or
 * `const` local (`_declaredByStatement`, which `createBlockLocals` makes
 * again at each run), and not a binding with no value.
 */
function isImplicitRunLocal(
  template: Scope,
  name: string,
  def: BoxedDefinition
): boolean {
  type Marks = { _declaredByStatement?: boolean; _blockTemplate?: boolean };
  return (
    (def as Marks)._declaredByStatement !== true &&
    !('value' in def && def.value.value === undefined) &&
    (template.bindings.get(name) as Marks | undefined)?._blockTemplate !== true
  );
}

/**
 * At the start of an asynchronous run of a block, after
 * `sweepCanonicalizationBindings`, put in the activation of the run (a copy
 * of the block scope made for the run, `asyncScopeActivation`,
 * `boxed-expression/boxed-function.ts`) the implicit locals that the last
 * asynchronous run of the same evaluation and call made. Return the run, for
 * `endAsyncRun`, or `undefined` when the run is not in an activation, or is
 * part of no call and no asynchronous evaluation that can run the block
 * again (`TOP_LEVEL_RUN`).
 *
 * An implicit local keeps its value from one run of the block to the next
 * inside one evaluation and one function call (see
 * `sweepCanonicalizationBindings`). A synchronous run writes it into the
 * block scope itself. An asynchronous run writes it into its activation, and
 * the next run copies the block scope, not that activation. So the locals
 * are kept here between the runs. Without this, each asynchronous run
 * started with no value for the local: with an operator that has only an
 * `evaluateAsync` handler in the body, `Sum(Block(t ≔ t + 1; …; t), k, 1, 3)`
 * gave `3t + 3` with `evaluateAsync()` and `3t + 6` with `evaluate()`. They
 * are not written into the block scope, because an asynchronous evaluation
 * that runs at the same time copies the block scope too, and must not read
 * them.
 */
function beginAsyncRun(ce: ComputeEngine): AsyncRun | undefined {
  const activation = ce.context.lexicalScope;
  const template = scopeActivationTemplate(activation);
  if (template === undefined) return undefined;
  const key = callActivationKey(ce);
  if (key === TOP_LEVEL_RUN) return undefined;
  const run: AsyncRun = {
    activation,
    template,
    epoch: topLevelEvaluationEpoch(ce),
    key,
  };
  const stored = asyncRunLocals.get(template)?.get(key)?.get(run.epoch);
  if (stored === undefined) return run;
  // Replace the implicit locals that the activation holds (the sweep kept
  // the ones that the synchronous runs of this evaluation and call made)
  // with the ones of the last asynchronous run.
  const bindings = activation.bindings;
  const write = (name: string, def: BoxedDefinition | undefined): void => {
    // Checkpoint journal (funnel 4): a direct write of the scope map, as in
    // `sweepCanonicalizationBindings`.
    journalCheckpointMapEntry(ce, bindings, name, name, 'declare');
    if (def === undefined) bindings.delete(name);
    else bindings.set(name, def);
    noteScopeDeclaration(activation);
  };
  for (const [name, def] of [...bindings])
    if (!stored.has(name) && isImplicitRunLocal(template, name, def))
      write(name, undefined);
  for (const [name, def] of stored)
    if (bindings.get(name) !== def) write(name, def);
  return run;
}

/**
 * At the end of an asynchronous run of a block, keep the implicit locals of
 * its activation for the next asynchronous run of the same evaluation and
 * call (see `beginAsyncRun`).
 */
function endAsyncRun(run: AsyncRun | undefined): void {
  if (run === undefined) return;
  let byKey = asyncRunLocals.get(run.template);
  if (byKey === undefined) {
    byKey = new WeakMap();
    asyncRunLocals.set(run.template, byKey);
  }
  let byEpoch = byKey.get(run.key);
  if (byEpoch === undefined) {
    byEpoch = new Map();
    byKey.set(run.key, byEpoch);
  }
  const locals = new Map<string, BoxedDefinition>();
  for (const [name, def] of run.activation.bindings)
    if (isImplicitRunLocal(run.template, name, def)) locals.set(name, def);
  byEpoch.set(run.epoch, locals);
}

/**
 * Give each assignment local of the block whose scope is the current
 * lexical scope a binding with no value in that scope, when the scope does
 * not bind the name yet (`declareAssignmentLocals`, `function-utils.ts`).
 * The sweep removed the binding that the canonicalization made, and without
 * this one an assignment to the local wrote a binding of the same name made
 * after the block was canonicalized. On the asynchronous route the current
 * scope is an activation of the block scope, which holds the record.
 */
function declareRunAssignmentLocals(ce: ComputeEngine): void {
  const scope = ce.context.lexicalScope;
  declareAssignmentLocals(ce, scopeActivationTemplate(scope) ?? scope, scope);
}

/** Evaluate a Block expression. */
function evaluateBlock(
  ops: ReadonlyArray<Expression>,
  {
    engine: ce,
    numericApproximation,
  }: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression {
  if (ops.length === 0) return ce.Nothing;

  // The Block's canonicalization scope was pushed as the runtime scope
  // (scoped operator). Sweep stale canonicalization bookkeeping from it:
  // *inferred, valueless* bindings are auto-declared references and hoisted
  // `Declare`/`Assign` targets from the canonical pass. If left in place
  // they shadow the runtime chain — e.g. a function *parameter* referenced
  // from a Block nested inside the function body auto-declared a valueless
  // shadow here at canonicalization, hiding the call value in the lambda's
  // fresh scope. Runtime `Declare`/`Assign` statements re-create genuine
  // block-locals below; reads of everything else resolve by name up the
  // chain.
  //
  // The keep-test is "was this created by a `Declare` STATEMENT"
  // (`_declaredByStatement`, set by the `Declare` handler) — NOT "is its type
  // inferred". An auto-declared shadow inherits the DECLARED type of the outer
  // binding it shadows, so an *annotated* parameter read from a nested Block
  // left an explicitly-typed valueless shadow that the inferred-only test kept,
  // and it then hid the call value in the lambda's fresh scope:
  // `function s(k: number) { if 1 > 0 { k } else { 0 } }` returned the symbol
  // `k`, while the same function with a bare `k` returned the argument.
  // (Epsil wraps each `if` branch in a Block, which is why the conditional
  // shape surfaced it.) Locals from a previous evaluation of this block carry
  // the marker and are still kept — replaced when the statements start
  // (`createBlockLocals`, called by `evaluateStatements`).
  sweepCanonicalizationBindings(ce);
  declareRunAssignmentLocals(ce);

  // If the block's final value is a bare symbol bound to a user-defined
  // function literal (`helper(x) = …` → a block-local operator definition),
  // return the underlying `Function` literal so the function escapes the
  // block as a first-class value. Resolved here, while the block scope (which
  // holds the operator definition) is still the current lexical scope.
  //
  // The numeric request of the block is forwarded to its LAST statement,
  // whose value is the value of the block; the statements before it run
  // exactly, so that a value a later statement reads (`a := √2; a^2`) is
  // not rounded on the way. A jump in the last statement (`Floor(x)`) then
  // reads an exact operand exactly, as at the top level. This is also the
  // route of a user function under `.N()` whose body was parsed as one
  // inner block of several statements: in such a body a parameter is bound
  // to the float of the argument, and only a jump evaluated with the
  // request reads the exact argument again (`exactRealValueOf`,
  // `constraint-subject.ts`).
  //
  // A block that the host evaluates directly is a program: each of its
  // statements is its own top-level evaluation (`runsAsProgram`).
  return resolveEscapingLambda(
    ce,
    evaluateStatements(
      ce,
      ops,
      numericApproximation ? { numericApproximation: true } : undefined,
      runsAsProgram(ce, false)
    )
  );
}

/**
 * True when the `Block` whose evaluate handler runs now is a program: a
 * block that the host evaluates directly, the counterpart of a run of
 * `executeEpsil`, where each statement is its own top-level evaluation. Its
 * statements are then run with `program` set (`evaluateStatements`,
 * `evaluateStatementsAsync`, `function-utils.ts`), so that a statement that
 * reads a result of an earlier statement (`r ≔ fn(3)` before
 * `fn ≔ z ↦ 2z`, then `r`) resolves it as the next Epsil statement does.
 * A block in a statement or an operand of another expression (a `Sum` term,
 * a function body, a `do` block in an assignment) is not a program: its
 * statements run in the top-level evaluation of the enclosing expression.
 *
 * On the synchronous route, the evaluation of the block is the outermost
 * evaluation, and it is not a part of an asynchronous evaluation: the
 * engine's stack is in place, not the context stack of an asynchronous
 * evaluation (`asyncEvaluationOf`, `boxed-expression/evaluation-epoch.ts`).
 * A synchronous evaluation that the host starts while an asynchronous one is
 * pending is a program too. On the asynchronous route, no synchronous
 * evaluation is running, the host started the asynchronous evaluation that
 * the block is part of (it is not nested in another evaluation, and it is
 * not a statement of a program block), and the evaluation of the block is
 * the only pending `evaluateAsync()` call of that evaluation
 * (`AsyncEvaluation.pending`). Other asynchronous evaluations that run at
 * the same time are not counted.
 *
 * The outermost evaluation is not always at depth 1 (pending count 1 on the
 * asynchronous route). A `Block` that is not canonical (boxed with
 * `{ form: 'raw' }` or `{ form: 'structural' }`) is evaluated by its
 * canonical form: its own `evaluate()` counts one level, and the
 * `evaluate()` of its canonical form, which runs this handler, counts a
 * second one. Each such delegation raises a count while it runs:
 * `_delegatedEvaluations` on the synchronous route, and
 * `AsyncEvaluation.delegated` until the delegated evaluation settles on the
 * asynchronous route (`delegateEvaluation()`, `delegateEvaluationAsync()`,
 * `boxed-function.ts`). So the test is that every other evaluation that is
 * counted is a delegation: the depth (the pending count on the
 * asynchronous route) is 1 plus the count of delegations. A block nested in
 * another expression has one more evaluation counted, the evaluation of
 * that expression, which is not a delegation.
 *
 * A block that is a statement of a run of `executeEpsil` (a top-level `do`
 * block) is not a program: it is a nested block of the program that the
 * runner executes, as for `isProgramBlock()` at canonicalization.
 */
function runsAsProgram(ce: ComputeEngine, async: boolean): boolean {
  if (ce._epsilBatchId !== undefined) return false;
  const evaluation = asyncEvaluationOf(ce._evalContextStack);
  if (async)
    return (
      ce._evaluationDepth === 0 &&
      evaluation !== undefined &&
      evaluation.startedByHost &&
      evaluation.pending === 1 + evaluation.delegated
    );
  return (
    ce._evaluationDepth === 1 + ce._delegatedEvaluations &&
    evaluation === undefined
  );
}

/**
 * The asynchronous twin of `evaluateBlock`: the same scope sweep, then the
 * statements awaited in order (`evaluateStatementsAsync`), so a statement
 * holding an asynchronous-only application is evaluated instead of staying
 * inert in the block's value.
 */
async function evaluateBlockAsync(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Promise<Expression> {
  const ce = options.engine;
  if (ops.length === 0) return ce.Nothing;
  sweepCanonicalizationBindings(ce);
  // Before the first `await`, while the activation of this run is still the
  // current lexical scope.
  const run = beginAsyncRun(ce);
  declareRunAssignmentLocals(ce);
  // Read before the first `await`: the counts of running evaluations that
  // the test reads change while the statements run.
  const program = runsAsProgram(ce, true);
  let result: Expression;
  try {
    result = await evaluateStatementsAsync(
      ce,
      ops,
      options.signal,
      options._effects,
      options._contextStack,
      // The numeric request reaches the last statement only, as in
      // `evaluateBlock`.
      options.numericApproximation ? true : undefined,
      options._precisionWindow,
      program
    );
  } finally {
    endAsyncRun(run);
  }
  // `resolveEscapingLambda` reads the block scope as the current lexical
  // scope. It runs after an `await`, so the context stack of this evaluation
  // (which holds the block scope) must be put in place explicitly.
  return options._effects === undefined
    ? resolveEscapingLambda(ce, result)
    : runWithEvaluationEffects(
        ce,
        options._effects,
        () => resolveEscapingLambda(ce, result),
        options._contextStack,
        options._precisionWindow
      );
}

/**
 *
 *  Canonicalize a Block expression
 *
 * - Hoist any `Declare` expression to the top of the block
 * - Add a `Declare` expression for any `Assign` expression
 * - Error for any `Declare` expression that's an argument to a function
 *
 */

/**
 * The type of a CLOSED literal expression — a number, a string, or a
 * `List`/`Tuple` whose operands are closed literals — read by canonicalizing
 * it, which is side-effect free for such an expression (no symbol to bind,
 * no scope to write). `undefined` for anything else. Used by `canonicalBlock`
 * to hoist the static type of a `let` with a literal initial value, and by
 * the Epsil runner to tell whether an assignment gives its target a value
 * of static type (`prepareFunctionDeclarations()`, `execute-epsil.ts`).
 */
export function closedLiteralType(
  ce: ComputeEngine,
  value: Expression
): Type | undefined {
  const closed = (e: Expression): boolean =>
    isNumber(e) ||
    isString(e) ||
    ((isFunction(e, 'List') || isFunction(e, 'Tuple')) && e.ops.every(closed));
  if (!closed(value)) return undefined;
  const t = value.canonical.type;
  // Widened through the same table an assignment uses (`widenAssignedType`):
  // the literal `1` has the singleton type `1`, and a binding typed that
  // precisely would let a loop condition such as `i <= 3` fold to a constant
  // on the compile route; the assignment tier `integer` is the evidence the
  // program gives. A collection literal keeps its type (`list<never>` for
  // `[]`), which a later assignment joins with the assigned type.
  return t.isUnknown ? undefined : widenAssignedType(ce, t.type);
}

/**
 * The names that the `Declare` statements of the statement list `ops`
 * introduce, read without canonicalizing the statements, with the type of
 * each one when the statement states it.
 *
 * - `declaredNames`: the target of each `Declare`, and each leaf of a
 *   destructuring pattern (`let (a, b) = v`), in statement order. A name
 *   declared twice is listed twice.
 * - `declaredTypes`: the static type of a target, read from a positional
 *   type operand, from the literal `type` entry of an attributes dictionary,
 *   or from an initial value that is a closed literal (`closedLiteralType()`).
 * - `explicitlyDeclared`: the names of `declaredTypes` whose type the
 *   statement declares, not read from an initial value.
 *
 * `ops` may be non-canonical (the held operands of a `Block`, or the raw
 * statements of an Epsil program boxed with `{ canonical: false }`).
 * `canonicalBlock()` hoists these names into the block scope, and the Epsil
 * runner (`executeEpsil()`) declares the names of the statements before a
 * `function` statement before it installs the function.
 */
export function staticDeclarations(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): {
  declaredNames: string[];
  declaredTypes: Map<string, Type>;
  explicitlyDeclared: Set<string>;
} {
  const declaredNames: string[] = [];
  // The statically-readable declared type of each `Declare(name, "type")`
  // statement, keyed by name. The binding that `canonicalBlock()` hoists
  // carries this type from the CANONICAL pass on: `Declare` only registers
  // its type at
  // evaluation time, so without it a read of the local later in the block —
  // `Length(d)` after `Declare(d, "list<number>")` — types against a bare
  // `unknown` binding, and a compilation of the block (which never evaluates
  // the `Declare`) fails its operand type gates on a local whose type the
  // program states outright (Tycho item 235). Only a positional string or
  // symbol type operand is read; a computed type (an attributes dictionary,
  // a `TypeFrom(…)` expression) stays evaluation-time-only and the binding
  // stays `unknown`, as before.
  const declaredTypes = new Map<string, Type>();
  // The names in `declaredTypes` whose type is DECLARED, not read from a
  // literal initial value (see `markDeclaredLocal`).
  const explicitlyDeclared = new Set<string>();
  for (const statement of ops) {
    const op = typedStatement(statement);
    if (isFunction(op, 'Declare')) {
      const nameExpr = op.ops[0];
      // A destructuring `Declare((a, b), …)` (`let (a, b) = v`) introduces
      // each leaf of its pattern as a block local, as `Declare(a, …)` does
      // for `a`: the leaves are hoisted into the block scope and shadow a
      // same-named constant. Without this a leaf named `i` read later in
      // the block folded to the imaginary unit (`let (i, x) = (2, 3)` then
      // `i + 1` gave `1 + i`), and the `Declare` canonical handler found no
      // binding in the current scope to record the leaf's type on. The
      // pattern carries no type, so nothing else is read here.
      if (nameExpr && isFunction(nameExpr, 'Tuple')) {
        for (const name of tuplePatternNames(nameExpr))
          if (name !== 'Nothing') declaredNames.push(name);
        continue;
      }
      if (nameExpr && isSymbol(nameExpr)) {
        declaredNames.push(nameExpr.symbol);
        // The type may be the positional operand (`Declare(d, "list<…>")`)
        // or a literal `type` entry of an attributes dictionary
        // (`Declare(d, {type: "list<…>", value: …})`). The dictionary is
        // read STRUCTURALLY, from its raw key/value pairs — canonicalizing
        // it here would bind its value expressions in the enclosing scope,
        // before the block's own locals are hoisted (measured: it broke
        // `let doc = {name: …}`, whose Dictionary operand is data the
        // evaluate handler will bind later).
        let typeOp: Expression | undefined = op.ops[1];
        // The initial value, when the statement has one: the positional
        // operand after the type (`Declare(d, "list", [])`), or the literal
        // `value` entry of the attributes dictionary (`let d = []` in Epsil
        // is `Declare(d, {value: []})`).
        let valueOp: Expression | undefined = op.ops[2];
        if (typeOp !== undefined && typeOp.operator === 'Dictionary') {
          let entry: Expression | undefined = undefined;
          if (isFunction(typeOp)) {
            for (const pair of typeOp.ops) {
              if (!isFunction(pair) || pair.ops.length !== 2) continue;
              const key = isString(pair.ops[0])
                ? pair.ops[0].string
                : sym(pair.ops[0]);
              if (key === 'type') entry = pair.ops[1];
              else if (key === 'value') valueOp = pair.ops[1];
            }
          }
          typeOp = entry;
        }
        const source =
          typeOp === undefined
            ? undefined
            : isString(typeOp)
              ? typeOp.string
              : sym(typeOp);
        if (source !== undefined) {
          try {
            const parsed = parseType(source, ce._typeResolver);
            if (isValidType(parsed)) {
              declaredTypes.set(nameExpr.symbol, parsed);
              explicitlyDeclared.add(nameExpr.symbol);
            }
          } catch {
            // Not a type expression (e.g. a mistyped name): leave the
            // binding `unknown`; the `Declare` evaluate handler reports the
            // error on the routes that run it.
          }
        } else if (valueOp !== undefined) {
          // No declared type, but an initial value that is a CLOSED literal
          // (a number, a string, or a `List`/`Tuple` of such, nested): its
          // type is static evidence of the same standing as a declared type,
          // so it rides on the hoisted binding too. Without it the binding
          // stays `unknown` until the `Declare` runs, and the FIRST use of
          // the local in the block — `Length(queue)` in a loop condition,
          // `ListJoin(xs, [4])` behind the spread `[...xs, 4]` — infers the
          // callee's loose parameter type (`collection`, `collection<any>`)
          // onto it; the later `Assign` can only WIDEN that, so `let xs = []`
          // grown by a spread read as a `collection<any>` on the compile
          // route, which never runs the `Declare`, and the JavaScript
          // target's array-shape gate refused `Length(xs)` (Tycho item 332,
          // programs b and c). With the value's type hoisted (`list<nothing>`
          // for `[]`), the use narrows to the list and the assignment widens
          // its element type (`list<integer>`), so the compiled shape is the
          // one the program builds. Only a closed literal is read: an
          // expression that mentions a symbol would have to be bound here,
          // in the enclosing scope, before the block's own locals exist.
          const literalType = closedLiteralType(ce, valueOp);
          if (literalType !== undefined)
            declaredTypes.set(nameExpr.symbol, literalType);
        }
      }
    }
  }
  return { declaredNames, declaredTypes, explicitlyDeclared };
}

function canonicalBlock(
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
): Expression | null {
  const { engine: ce, scope } = options;
  // An empty block is canonical as it is: its type handler answers `nothing`
  // and its evaluate handler answers `Nothing`. Declining here (`null`) left
  // the node non-canonical and unbound, so neither handler ever ran and
  // `If(True, Block())` evaluated to the inert `Block()` itself, printed
  // `{}`, where the language documents `Nothing` as an empty block's value.
  if (ops.length === 0) return ce._fn('Block', [], { scope });

  // A `Declare(name, …)` introduces a block-local `name` that shadows any
  // same-named constant (`i`, `e`, `Pi`, …) for the rest of the block. Push
  // those names onto the engine's shadowed-parameter stack — the same
  // mechanism used for function-literal parameters — so that e.g.
  // `Add(i, 1)` after `Declare(i, …)` keeps `i` as an ordinary variable
  // instead of folding to the imaginary unit `1 + i`. The shadow is scoped to
  // this block: it is popped once the statements are canonicalized, so an `i`
  // outside the block is the imaginary unit again.
  const { declaredNames, declaredTypes, explicitlyDeclared } =
    staticDeclarations(ce, ops);

  // SAME-SCOPE RE-DECLARATION (ruled 2026-09-05): a `Declare` may not
  // re-declare a name this scope already binds — an earlier `Declare` of this
  // block, a parameter of the function literal whose body this block is, or
  // an index of the loop, comprehension or big operator whose body this block
  // is. Such a statement is a mistake in practice (a second `let` where an
  // assignment was meant), and the runtime cannot tell it from a re-run of
  // the same statement (a loop body on its second turn), so it silently
  // overwrote the binding. The statement canonicalizes to an error value
  // instead: the Epsil static pass reports it before the program runs, and
  // the compiler refuses the invalid block. Shadowing a name bound in an
  // OUTER scope — a nested block, a closure body, an `if` inside a loop body
  // — is ordinary lexical scoping and stays allowed.
  //
  // A function literal's parameters are known through the shadowed-parameter
  // stack: the literal pushes them before its body is canonicalized, with
  // the scope the literal is written in as the boundary, so this block is
  // the literal's own body exactly when its parent scope is that boundary. A
  // framework binder (`canonicalizeBinder`, `boxed-expression/box.ts`)
  // records its names on its own scope, which is the parent of its body
  // block's scope. A statement is accepted or refused WHOLE: a destructuring
  // `Declare((a, b), …)` with one colliding leaf declares nothing, so its
  // other leaves stay free for a later `Declare`. Only the names of accepted
  // statements are hoisted and shadowed below, so a read of a refused name
  // later in the block still reaches the binder's variable — while a name
  // whose FIRST declaration was accepted keeps its hoist even when a later
  // duplicate of it is refused.
  const refused = new Map<Expression, Expression>();
  const accepted = new Set<string>();
  {
    const parentBinderNames = scope?.parent?.binderNames;
    const redeclares = (name: string): boolean =>
      accepted.has(name) ||
      (ce._isShadowedParameter(name) &&
        scope !== undefined &&
        ce._shadowedParameterBoundary(name) === scope.parent) ||
      parentBinderNames?.has(name) === true;
    for (const statement of ops) {
      const op = typedStatement(statement);
      if (!isFunction(op, 'Declare')) continue;
      const target = op.ops[0];
      const names = (
        isSymbol(target)
          ? [target.symbol]
          : isFunction(target, 'Tuple')
            ? tuplePatternNames(target)
            : []
      ).filter((name) => name !== 'Nothing');
      const collision = names.find(redeclares);
      if (collision !== undefined)
        refused.set(statement, ce.error(['variable-redeclaration', collision]));
      else for (const name of names) accepted.add(name);
    }
  }
  const hoistedNames = declaredNames.filter((name) => accepted.has(name));

  // The names that this block hoists into its scope below, each with the
  // index of the first statement that declares it (a `Declare`, an `Assign`
  // or a `DefineFunction`). Kept only for the top-level block of a program
  // (`isProgramBlock()`): see `LATER_DECLARATIONS`.
  const firstDeclaration =
    scope !== undefined && isProgramBlock(ce, scope)
      ? new Map<string, number>()
      : undefined;
  // The index of the first statement that declares each name, read in one
  // pass over the statements.
  const firstIndex =
    firstDeclaration !== undefined ? firstDeclarationIndex(ops) : undefined;
  const noteHoisted = (name: string): void => {
    if (firstDeclaration === undefined || firstDeclaration.has(name)) return;
    const at = firstIndex?.get(name);
    if (at !== undefined) firstDeclaration.set(name, at);
  };
  // In the top-level block of a program, the `let` or `const` names of a
  // library constant (`i`, `e`, `Pi`, …) that a statement after the first
  // one declares. The block declares such a name, and makes it shadow the
  // constant, only when it reaches that statement. So a statement before
  // it, such as `function g() { i + 1 }`, reads the constant, as
  // `executeEpsil()` does when it canonicalizes one statement at a time.
  // The other names are declared before the first statement (see the hoist
  // below), so a function reads a name that a later `let` declares.
  const deferred = new Set(
    firstIndex === undefined
      ? []
      : hoistedNames.filter(
          (name) =>
            (firstIndex.get(name) ?? 0) > 0 && isLibraryConstant(ce, name)
        )
  );

  // Hoist the block's own locals into the block scope BEFORE canonicalizing
  // the statements. `Declare`/`Assign` only register their symbol at
  // *evaluation* time, so without this a reference to a block-local from a
  // nested scope (an inner `Block`, an `If` branch inside a `Loop` body, …)
  // finds no binding during canonicalization and auto-declares a valueless
  // shadow in the *inner* scope — which then permanently hides the enclosing
  // block's runtime binding (the canonicalization-scope-vs-runtime-scope
  // defect: `Block(Declare(k), Assign(k, 7), Block(k))` evaluated to `k`).
  //
  // - A top-level `Declare(name, …)` always introduces a block-local.
  // - A top-level `Assign(name, …)` introduces a block-local only when the
  //   name is not visible in the scope chain (assignment to a visible
  //   binding — including a constant, which errors at runtime — must keep
  //   binding upward).
  //
  // The hoisted binding is identical to an auto-declared one (inferred type,
  // no value), so the `Declare` evaluate handler upgrades it in place at
  // runtime exactly as it upgrades an auto-declared binding. A
  // statically-readable declared type rides on the binding (still marked
  // `inferred`, still valueless — both the evaluate-time upgrade and the
  // stale-binding hiding in `hideBodyScopeParams` key on that pair, so
  // runtime behavior is unchanged); it is what lets reads of the local later
  // in the block, and the compiler's operand type gates, see the type the
  // program declared.
  const hoistDeclared = (scope: Scope, name: string): void => {
    if (name === 'Nothing') return;
    const existing = scope.bindings.get(name);
    if (existing !== undefined) {
      markCallableHome(existing, scope);
      return;
    }
    const hoisted = ce._declareSymbolValue(
      name,
      { type: declaredTypes.get(name) ?? 'unknown', inferred: true },
      scope
    );
    // A block local, not a free symbol: see `_blockLocal`.
    if (isValueDef(hoisted)) {
      hoisted.value._blockLocal = true;
      markCallableHome(hoisted, scope);
      if (explicitlyDeclared.has(name)) markDeclaredLocal(hoisted.value);
    }
  };
  if (scope) {
    for (const name of hoistedNames) {
      if (deferred.has(name)) continue;
      if (name !== 'Nothing' && !scope.bindings.has(name)) {
        hoistDeclared(scope, name);
        noteHoisted(name);
      }
    }
    // The names that the `Assign` statements below make locals of the
    // block. Each run of the block gives each of them a new binding, so an
    // assignment to it never writes a binding of the same name made later
    // (`declareAssignmentLocals`, `function-utils.ts`).
    const assignmentLocals: string[] = [];
    // The assignment locals that a binding of an enclosing scope would have
    // taken, if a later statement of the top-level block of a program had
    // not declared it (`recordLaterDeclarationLocals`).
    const laterDeclarationLocals: string[] = [];
    // In the body of a function literal, the block also owns the names that
    // an assignment in a nested block of a statement writes (a branch of an
    // `if`, a loop body, a `do` block), as in Python
    // (`nestedAssignmentNames()`). The body is canonicalized before its
    // nested blocks, so the nested blocks find these bindings in the scope
    // chain and do not make locals of their own.
    const ownsNestedAssignments = isInFunctionBody();
    for (const statement of ops) {
      const op = typedStatement(statement);
      const target = isFunction(op, 'Assign') ? op.ops[0] : undefined;
      // A destructuring assignment `(x, y) := v` binds one local per pattern
      // leaf (nested patterns included, `_` positions bind nothing), on the
      // same rule as a plain symbol target: each leaf that is not visible in
      // the scope chain is a block-local. Without this the leaves were never
      // hoisted, so a read of one on a route that never evaluates — a
      // compile — saw no binding at all, and the `Assign` canonical handler
      // had no binding to record the leaf's type on.
      const names =
        target === undefined
          ? []
          : isFunction(target, 'Tuple')
            ? tuplePatternNames(target)
            : [sym(target)];
      if (ownsNestedAssignments) names.push(...nestedAssignmentNames(ce, op));
      for (const name of names) {
        if (!name || name === 'Nothing') continue;
        if (scope.bindings.has(name) || isDeclaredInScopeChain(ce, name))
          continue;
        // A parameter of an enclosing function literal is declared after
        // the body of that literal is canonicalized, so `lookupDefinition`
        // does not find it yet; the shadowed-parameter stack holds its name.
        // An assignment to it writes the parameter, and is not a local.
        if (isShadowedByEarlierDeclaration(ce, name)) continue;
        assignmentLocals.push(name);
        if (
          ce.lookupDefinition(name) !== undefined ||
          ce._isShadowedParameter(name)
        )
          laterDeclarationLocals.push(name);
        const hoisted = ce._declareSymbolValue(
          name,
          { type: 'unknown', inferred: true },
          scope
        );
        // A block local introduced by assignment: see `_blockLocal`.
        if (isValueDef(hoisted)) {
          hoisted.value._blockLocal = true;
          markCallableHome(hoisted, scope);
        }
        noteHoisted(name);
      }
    }
    recordAssignmentLocals(scope, assignmentLocals);
    recordLaterDeclarationLocals(scope, laterDeclarationLocals);
    // A one-step function definition written inside a block —
    // `DefineFunction(name, Function(…))`, the surface form `name(x) = …` —
    // is BLOCK-LOCAL, on the same rule as `Declare`: it binds in the block it
    // is written in, SHADOWS a same-named outer function instead of
    // overwriting it, and dies with the frame.
    //
    // Hoisting the name here is what makes that true. `defineFunctionClause`
    // (multi-clause.ts) installs onto the binding it finds by walking the
    // scope chain, so with no block-scope binding to find it reaches up: a
    // nested `sq(m) = m * m` left `sq` callable at top level once the
    // enclosing function was defined, and a nested definition of an existing
    // outer function replaced it permanently. The explicit two-step form
    // (`let sq; sq(m) = m * m`) already behaved correctly precisely because
    // the `Declare` hoist above gave it a block-scope binding to install on.
    //
    // Unconditional, unlike the `Assign` hoist: a visible outer binding is
    // exactly the case that must be shadowed rather than written through.
    // The exception is a name owned by a declared nominal type, whose
    // definition is a smart-CONSTRUCTOR definition: types are engine-global,
    // not scoped, so that definition must reach the type's constructor.
    //
    // The name is declared `function`-typed (not `unknown`) so that a call to
    // it later in the block resolves to this binding as an applicable
    // operator instead of deferring past it to the outer definition
    // (`lookupApplicable`, boxed-expression/lookup.ts).
    //
    // The type-registry check below is wider than the constructor test of
    // `isFunctionDeclarationStatement()`: it also leaves out a same-name
    // function of an ALIAS type. Such a definition is not made block-local,
    // so its clause still reaches the binding that the alias declaration
    // made.
    for (const statement of ops) {
      const op = typedStatement(statement);
      if (
        !isFunction(op, 'DefineFunction') ||
        !isFunctionDeclarationStatement(ce, op)
      )
        continue;
      const name = sym(op.ops[0]);
      if (!name || name === 'Nothing') continue;
      if (scope.bindings.has(name)) continue;
      if (ce._typeRegistry[name]?.def !== undefined) continue;
      ce._declareSymbolValue(name, { type: 'function', inferred: true }, scope);
      noteHoisted(name);
    }
  }

  // The names hoisted above that no statement before the current one
  // declares, for a top-level block of a program (`LATER_DECLARATIONS`).
  // Before each statement is canonicalized, the names that it declares
  // first are removed from the set.
  const later =
    firstDeclaration !== undefined && scope !== undefined
      ? new Set(firstDeclaration.keys())
      : undefined;
  if (later !== undefined) LATER_DECLARATIONS.set(scope!, later);
  // The same names, grouped by the index of the statement that declares
  // them first.
  const declaredFirstAt = new Map<number, string[]>();
  if (firstDeclaration !== undefined)
    for (const [name, at] of firstDeclaration) {
      const names = declaredFirstAt.get(at);
      if (names === undefined) declaredFirstAt.set(at, [name]);
      else names.push(name);
    }

  // The scope that encloses the block: the boundary of the shadow of its
  // names (`_shadowedParameterBoundary()`).
  const boundary = ce.context.lexicalScope;
  ce._pushShadowedParameters(
    hoistedNames.filter((name) => !deferred.has(name))
  );
  // The number of frames pushed for the names in `deferred`.
  let deferredFrames = 0;
  let statements: Expression[];
  try {
    // We canonicalize the statements in the local scope. A refused
    // re-declaration stands as its error value.
    // The evidence session re-reads the value type of every assignment
    // canonicalized in this block (nested blocks included) once all of them
    // are canonicalized, so that a read in a loop body sees the widening a
    // later assignment of the same loop records (`withEvidenceSession`).
    statements = withEvidenceSession(ce, () =>
      ce._inScope(scope, () =>
        ops.map((op, i) => {
          if (later !== undefined)
            for (const name of declaredFirstAt.get(i) ?? []) later.delete(name);
          // Declare the names in `deferred` that this statement declares
          // first, and make them shadow the library constants from here on.
          const declaredHere = [...deferred].filter(
            (name) => firstIndex?.get(name) === i
          );
          if (declaredHere.length > 0) {
            for (const name of declaredHere) hoistDeclared(scope!, name);
            ce._pushShadowedParameters(
              declaredHere,
              undefined,
              undefined,
              boundary
            );
            deferredFrames += 1;
          }
          return refused.get(op) ?? canonicalStatement(ce, op);
        })
      )
    );
  } finally {
    for (; deferredFrames > 0; deferredFrames -= 1) ce._popShadowedParameters();
    ce._popShadowedParameters();
    if (later !== undefined) LATER_DECLARATIONS.delete(scope!);
  }

  return ce._fn('Block', statements, { scope });
}

/**
 * The statement that the block operand `op` holds. A return-type annotation
 * of a function literal moves onto the last statement of its body, so that
 * statement is `Typed(statement, type)`
 * (`canonicalFunctionLiteralArguments()`, `function-utils.ts`). The type does
 * not change which names the statement declares or assigns, so the loops of
 * `canonicalBlock()` that find the block locals read through the wrapper.
 * Without this, `function f() -> integer { x = 2 }` did not make `x` a local
 * of the body, and its write was a `scope` write.
 */
function typedStatement(op: Expression): Expression {
  return isFunction(op, 'Typed') ? op.op1 : op;
}

/**
 * The names that an `Assign` in a nested block of the block statement `op`
 * writes, at any depth: in a branch of an `if`, in a loop body, in a `do`
 * block, or in the value of an assignment. `op` is not canonical. A part of
 * `op` that is canonical is not read: it was canonicalized in its own
 * scope, which decided then which binding each of its assignments writes.
 *
 * Some assignments write a binding that a nested construct makes, and not a
 * name of the enclosing block. Their names are not included:
 *
 * - an assignment in the body of a function literal: that body owns its
 *   names;
 * - an assignment to a name that a `let` or `const` (a `Declare`) or a
 *   `function` statement (a `DefineFunction`) of an enclosing nested block
 *   declares: the assignment writes that block local;
 * - an assignment to the index of a loop, of a comprehension or of a big
 *   operator (the symbol of an `Element` or `Limits` clause) in its body:
 *   the assignment writes the index;
 * - an assignment in an operand that the operator applies as a function or
 *   evaluates for each element after the statement has a value
 *   (`deferredOperands()`): the term of a `Table`, the callback of a `Map`,
 *   the term and the conditions of a comprehension. Such an operand is a
 *   function body of its own, or it is evaluated when the collection is read,
 *   which can be after the call of the function has returned.
 *
 * The term of a `Sum` or of a `Product`, and the body of a loop, are
 * evaluated again at each index while the statement is evaluated, so the
 * function body owns the names that they assign: the value of such a local
 * is kept from one index to the next.
 *
 * Thus in `function g(c) { if c { t = 1 }; t }`, the body of `g` owns `t`,
 * and a call of `g` with `c` false reads `t` before its first assignment.
 */
function nestedAssignmentNames(ce: ComputeEngine, op: Expression): string[] {
  const result: string[] = [];
  const walk = (e: Expression, bound: ReadonlySet<string>): void => {
    if (!isFunction(e) || e.operator === 'Function') return;
    // A part that is canonical already was canonicalized in its own scope,
    // which decided then which binding each of its assignments writes
    // (`lazyInexactElements()` in `library/core.ts` builds a function body
    // around the canonical parts of a collection). That decision does not
    // change.
    if (e !== op && e.isCanonical) return;
    let inner = bound;
    const bind = (names: ReadonlyArray<string>): void => {
      if (names.length === 0) return;
      inner = new Set([...inner, ...names]);
    };
    if (e.operator === 'Block') {
      for (const statement of e.ops) {
        const s = typedStatement(statement);
        if (isFunction(s, 'Declare') || isFunction(s, 'DefineFunction'))
          bind(
            isFunction(s.ops[0], 'Tuple')
              ? tuplePatternNames(s.ops[0])
              : [sym(s.ops[0])].filter((n) => n !== undefined)
          );
      }
    } else {
      for (const clause of e.ops)
        if (
          (isFunction(clause, 'Element') || isFunction(clause, 'Limits')) &&
          clause.ops[0] !== undefined
        )
          bind(
            isFunction(clause.ops[0], 'Tuple')
              ? tuplePatternNames(clause.ops[0])
              : [sym(clause.ops[0])].filter((n) => n !== undefined)
          );
    }
    if (e !== op && e.operator === 'Assign' && e.ops[0] !== undefined) {
      const target = e.ops[0];
      const names = isFunction(target, 'Tuple')
        ? tuplePatternNames(target)
        : [sym(target)];
      for (const name of names)
        if (name !== undefined && name !== 'Nothing' && !inner.has(name))
          result.push(name);
    }
    const deferred = deferredOperands(ce, e);
    if (deferred === 'all') return;
    e.ops.forEach((child, i) => {
      if (!deferred.has(i)) walk(child, inner);
    });
  };
  walk(op, new Set());
  return result;
}

/**
 * The positions of the operands of the expression `e`, not canonical, that
 * its operator does not evaluate in the order of the statement that holds
 * `e`, or `'all'` when this is true of every operand
 * (`nestedAssignmentNames()`). The operator definition gives them:
 *
 * - an operand whose parameter type in the signature of the operator is a
 *   function type (in one arm of an overloaded signature, at least): the
 *   operator applies the operand, or makes a function literal of it, as
 *   `Table` does with its term;
 * - every operand of an operator that binds an index (a `scoped` operator)
 *   and is a lazy collection, such as `Comprehension`: its term and its
 *   conditions are evaluated when an element is read.
 *
 * An operator with no definition has no such operand.
 */
function deferredOperands(
  ce: ComputeEngine,
  e: Expression
): ReadonlySet<number> | 'all' {
  const def =
    e.operator === undefined ? undefined : ce.lookupDefinition(e.operator);
  if (!isOperatorDef(def)) return NO_DEFERRED_OPERANDS;
  const operator = def.operator;
  if (operator.scoped && operator.collection !== undefined) return 'all';
  const signature = operator.signature?.type;
  if (signature === undefined || typeof signature !== 'object')
    return NO_DEFERRED_OPERANDS;
  const arms: FunctionSignature[] =
    signature.kind === 'signature'
      ? [signature]
      : signature.kind === 'intersection'
        ? signature.types.filter(
            (t): t is FunctionSignature =>
              typeof t === 'object' && t.kind === 'signature'
          )
        : [];
  let result: Set<number> | undefined;
  const count = isFunction(e) ? e.nops : 0;
  for (let i = 0; i < count; i++)
    if (arms.some((arm) => isFunctionParameterType(paramAt(arm, i)))) {
      result ??= new Set();
      result.add(i);
    }
  return result ?? NO_DEFERRED_OPERANDS;
}

const NO_DEFERRED_OPERANDS: ReadonlySet<number> = new Set();

/**
 * True when the parameter type `t` is a function type, or a union with a
 * function type arm (`Ordering` accepts a key function or a comparison
 * function): the operand is a function, not a value of the statement.
 */
function isFunctionParameterType(t: Type | undefined): boolean {
  if (t === undefined) return false;
  if (t === 'function') return true;
  if (typeof t !== 'object') return false;
  if (t.kind === 'signature') return true;
  if (t.kind === 'union') return t.types.some(isFunctionParameterType);
  return false;
}

/**
 * For the top-level block of a program, while one of its statements is
 * canonicalized: the names that the block hoisted into its scope and that no
 * earlier statement declares (with a `let`, a `const`, an assignment or a
 * `function` statement). The key is the scope of the block.
 *
 * `canonicalBlock()` declares all the names of a block in its scope before
 * it canonicalizes the statements, so that a forward reference finds its
 * binding. A function body decides at canonicalization which names it owns
 * (`isDeclaredInScopeChain()`): an assignment to a name that no enclosing
 * scope declares makes a local of the body. For a name in this set, the
 * hoisted binding does not count. Thus, in
 * `function g(k) { t = k + 1; t }; let t = 0; [g(1), g(2), t]`, `t` is a
 * local of `g`, and the value is `[2, 3, 0]`. This is also what
 * `executeEpsil()` gives, because it canonicalizes one top-level statement
 * at a time.
 *
 * A read of a name is not changed: it finds the hoisted binding, as before.
 * A block that is not the top-level block of a program (a function body, a
 * `do` block) declares its names when it starts, as documented in
 * `src/epsil/docs/declarations.md`.
 *
 * The Epsil runner uses the same set for its program scope
 * (`markLaterDeclarations()`, `laterDeclarationReached()`): before it
 * installs a `function` statement ahead of its turn, it declares the names
 * of the statements before that statement, and these names are later
 * declarations for the statements before them.
 */
const LATER_DECLARATIONS = new WeakMap<Scope, Set<string>>();

/**
 * Add `names` to the later declarations of `scope` (`LATER_DECLARATIONS`):
 * bindings of `scope` that a function body canonicalized from now on does
 * not count as declared, so an assignment to one of these names in the body
 * makes a local of the body. A read of the name still finds the binding.
 *
 * Used by the Epsil runner (`prepareFunctionDeclarations()`,
 * `execute-epsil.ts`) for the names that it declares in the program scope
 * before the statement that declares them runs. The runner removes each
 * name with `laterDeclarationReached()` before it boxes that statement.
 */
export function markLaterDeclarations(
  scope: Scope,
  names: Iterable<string>
): void {
  let later = LATER_DECLARATIONS.get(scope);
  for (const name of names) {
    if (later === undefined) {
      later = new Set();
      LATER_DECLARATIONS.set(scope, later);
    }
    later.add(name);
  }
}

/**
 * Remove `name` from the later declarations of `scope`
 * (`markLaterDeclarations()`): the statement that declares it is reached,
 * and from now on the binding counts as declared. The entry of `scope` is
 * removed when no name is left.
 */
export function laterDeclarationReached(scope: Scope, name: string): void {
  const later = LATER_DECLARATIONS.get(scope);
  if (later === undefined) return;
  later.delete(name);
  if (later.size === 0) LATER_DECLARATIONS.delete(scope);
}

/**
 * True when the standard library defines `name` as a constant (`i`, `e`,
 * `Pi`, `ExponentialE`, …): the system scope, where the library is
 * installed, binds it to a constant value definition.
 */
function isLibraryConstant(ce: ComputeEngine, name: string): boolean {
  const def = ce.contextStack[0]?.lexicalScope.bindings.get(name);
  return def !== undefined && isValueDef(def) && def.value.isConstant === true;
}

/**
 * True when `scope` is the scope of the top-level block of a program: a
 * block written directly in the global scope, outside `executeEpsil()`, and
 * not in a function literal or another block that is being canonicalized
 * (the body of a function literal written in the global scope is also a
 * block whose scope has the global scope as parent).
 *
 * `executeEpsil()` does not canonicalize the top-level block of its program,
 * only its statements, one at a time. A `do` block that is a top-level
 * statement of an Epsil program is a nested block in the program block, so
 * it is not a top-level block when `executeEpsil()` canonicalizes it.
 */
function isProgramBlock(ce: ComputeEngine, scope: Scope): boolean {
  return (
    ce._epsilBatchId === undefined &&
    !ce._hasShadowedParameterFrame() &&
    scope.parent !== null &&
    scope.parent === ce._evalContextStack[1]?.lexicalScope
  );
}

/** For each name that a statement of `ops` declares
 * (`statementDeclaredNames()`), the index of the first such statement. */
function firstDeclarationIndex(
  ops: ReadonlyArray<Expression>
): Map<string, number> {
  const result = new Map<string, number>();
  ops.forEach((op, i) => {
    for (const name of statementDeclaredNames(op))
      if (!result.has(name)) result.set(name, i);
  });
  return result;
}

/**
 * The names that cannot be bound: a definition of one of them installs
 * nothing and evaluates to the `absence-marker-binding` error. The same set
 * as `ABSENCE_MARKERS` in `library/core.ts`, which imports this file and so
 * cannot be imported here.
 */
const UNBINDABLE_NAMES: ReadonlySet<string> = new Set([
  'Nothing',
  'Missing',
  'Undefined',
]);

/**
 * True when the statement `statement` is a function declaration of its
 * statement list: a `DefineFunction(name, Function(…))` (the Epsil
 * `function g(k) { … }` and `g(k) = …`), where
 *
 * - `name` is a symbol and is not an absence marker (`Nothing`, `Missing`,
 *   `Undefined`), whose definition installs nothing;
 * - the second operand is a `Function` literal, the only clause that the
 *   `DefineFunction` canonical handler installs;
 * - `name` is not the constructor of a declared nominal type: such a
 *   definition is a smart-constructor definition, an assignment to the
 *   constructor of the type (`defineFunctionClause()`, `multi-clause.ts`),
 *   and takes effect when it runs. The same-name function of an ALIAS type
 *   is an ordinary function and is accepted.
 *
 * An assignment of a function literal (`g = (k) => …`) is not a function
 * declaration: it takes effect when it runs.
 *
 * A generic definition is a function declaration in this sense. The
 * compiler moves it to the front of the statement list as it moves the
 * others (`withDefineFunctionDeclares()`, `base-compiler.ts`), and the hoist
 * of function names in `canonicalBlock()` makes its name a local of the
 * block. But the interpreter installs it only when its statement runs
 * (`isHoistedFunctionDefinition()`).
 *
 * The statement is read structurally, so it may be non-canonical (the held
 * operands of a `Block`, a raw Epsil statement boxed with
 * `{ canonical: false }`).
 */
export function isFunctionDeclarationStatement(
  ce: ComputeEngine,
  statement: Expression
): boolean {
  if (!isFunction(statement, 'DefineFunction')) return false;
  const name = sym(statement.ops[0]);
  if (name === undefined || UNBINDABLE_NAMES.has(name)) return false;
  if (!isFunction(statement.ops[1], 'Function')) return false;
  const type = ce._typeRegistry[name];
  return type?.def === undefined || type.alias === true;
}

/**
 * True when the statement `statement` is a function declaration
 * (`isFunctionDeclarationStatement()`) that the interpreter makes available
 * in its whole statement list, before the first statement runs: the
 * `DefineFunction` canonical handler (`library/core.ts`) installs its clause
 * when the statement is canonicalized.
 *
 * A generic definition is not (`isGenericDefinition`). The canonical
 * handler installs no generic clause at canonicalization, and installs no
 * clause onto a name whose definition is generic already: rule G2 of the
 * generic functions (a generic function has one clause, and
 * `defineFunctionClause()` refuses any clause onto a generic definition)
 * would make the evaluation of the statement refuse its own clause if it
 * were installed ahead. So a generic definition takes effect when its
 * statement runs, and a call before it stays unresolved, on the whole-block
 * route and on the Epsil runner alike.
 *
 * Used by the Epsil runner to install a function before the first statement
 * of the program runs (`prepareFunctionDeclarations()`, `execute-epsil.ts`).
 */
export function isHoistedFunctionDefinition(
  ce: ComputeEngine,
  statement: Expression
): boolean {
  return (
    isFunctionDeclarationStatement(ce, statement) &&
    isFunction(statement, 'DefineFunction') &&
    !isGenericDefinition(ce, sym(statement.ops[0])!, statement.ops[1])
  );
}

/**
 * True when the definition of `name` by the `Function` literal `literal`
 * is one that the `DefineFunction` canonical handler (`library/core.ts`)
 * does not install at canonicalization, for the same three reasons, read
 * here without canonicalizing the literal:
 *
 * - the literal states its own generic signature (a return marker whose
 *   signature has a `where` clause, `function f<T>(x: T) -> T { x }`), which
 *   the handler reads as `isGenericClauseLiteral()` on the canonical
 *   literal;
 * - the definition that `name` resolves to is generic, or declares a generic
 *   signature (`isGenericTarget()`, `multi-clause.ts`);
 * - the handler skipped an earlier clause of that definition
 *   (`canonInstallSkipped()`, `clause-identity.ts`), and so skips the other
 *   clauses too.
 */
function isGenericDefinition(
  ce: ComputeEngine,
  name: string,
  literal: Expression
): boolean {
  const declared = functionLiteralDeclaredSignature(literal);
  if (declared !== undefined && isPolymorphicType(declared)) return true;
  const target = ce.lookupDefinition(name);
  return isGenericTarget(target) || canonInstallSkipped(target);
}

/** The names that the block statement `op` declares: the target of a
 * `Declare` or an `Assign` (each leaf of a destructuring pattern), or the
 * name of a `DefineFunction`. */
export function statementDeclaredNames(op: Expression): string[] {
  const statement = typedStatement(op);
  if (isFunction(statement, 'DefineFunction')) {
    const name = sym(statement.ops[0]);
    return name === undefined ? [] : [name];
  }
  if (!isFunction(statement, 'Declare') && !isFunction(statement, 'Assign'))
    return [];
  const target = statement.ops[0];
  if (isFunction(target, 'Tuple')) return tuplePatternNames(target);
  const name = sym(target);
  return name === undefined ? [] : [name];
}

/**
 * True when a scope of the current scope chain declares `name`, as the
 * engine looks it up (`lookupDefinition()`). A binding that the top-level
 * block of a program hoisted for a later statement does not count
 * (`LATER_DECLARATIONS`): the lookup continues in the enclosing scope.
 */
function isDeclaredInScopeChain(ce: ComputeEngine, name: string): boolean {
  for (let s: Scope | null = ce.context.lexicalScope; s; s = s.parent) {
    if (!s.bindings.has(name)) continue;
    if (LATER_DECLARATIONS.get(s)?.has(name)) continue;
    return true;
  }
  return false;
}

/**
 * True when `name` is on the shadowed-parameter stack
 * (`_pushShadowedParameters()`) because of a parameter or of a declaration
 * that is visible here. `canonicalBlock()` pushes the names of the `Declare`
 * statements of a block, with the enclosing scope of the block as the
 * boundary. When the innermost entry for `name` is that of a top-level block
 * of a program, and a later statement of that block declares `name`
 * (`LATER_DECLARATIONS`), the entry does not count. Nothing encloses such a
 * block, so no other entry can name a parameter.
 */
function isShadowedByEarlierDeclaration(
  ce: ComputeEngine,
  name: string
): boolean {
  if (!ce._isShadowedParameter(name)) return false;
  const boundary = ce._shadowedParameterBoundary(name);
  for (let s: Scope | null = ce.context.lexicalScope; s; s = s.parent)
    if (s.parent === boundary && LATER_DECLARATIONS.get(s)?.has(name))
      return false;
  return true;
}

/**
 * Canonicalize an expression in **statement position** (a `Block` operand, an
 * `If` branch, or a `Loop` body). A bare *symbol* `Break`/`Continue` (as
 * opposed to the function forms `Break()`/`Continue()`) is almost certainly a
 * mistake: the control-flow dispatch in `evaluateStatements`/`runLoop` only
 * recognizes the function form, so a bare symbol would silently canonicalize
 * to an ordinary variable reference. Flag it as an error instead. Bare
 * `Return` is intentionally left alone.
 */
function canonicalStatement(ce: ComputeEngine, op: Expression): Expression {
  if (isSymbol(op) && (op.symbol === 'Break' || op.symbol === 'Continue'))
    return ce.error(
      `\`${op.symbol}\` must be written as a function: \`${op.symbol}()\``,
      op.symbol
    );
  return op.canonical;
}

/**
 * True when a `Loop` body can short-circuit with a value — it structurally
 * contains a `Return`, or a `Break` carrying an operand. Used by the `Loop`
 * type handler: a for-effect loop is otherwise `nothing`.
 */
function loopBodyYieldsValue(structure: OperandStructure | undefined): boolean {
  if (structure === undefined) return false;
  switch (structure.kind) {
    case 'application':
      if (structure.head === 'Return') return true;
      if (structure.head === 'Break' && structure.children.length > 0)
        return true;
      return structure.children.some((c) =>
        loopBodyYieldsValue(c.structureOf?.())
      );
    // A `Tuple` and a `List` literal are applications of `Tuple`/`List` in
    // the expression tree, so their elements are searched too — neither head
    // is a short-circuit, only their contents can be.
    case 'tuple':
    case 'list-literal':
      return structure.elements.some((c) =>
        loopBodyYieldsValue(c.structureOf?.())
      );
    // A nested function literal's parameters are bare symbols, so only its
    // body can carry a short-circuit.
    case 'function-literal':
      return loopBodyYieldsValue(structure.body);
    default:
      return false;
  }
}

/**
 * The type of the body of a `Comprehension` as the element type of the list
 * it returns, without the bounds that a ranged index (`integer<1..16>`)
 * gives it: `[k² for k in 1..5]` is `list<integer<0..>>`, the type of the
 * square of an integer, not `list<integer<1..25>>`, and
 * `[√((k − 0.5)/16) for k in 1..16]` is `list<real>`.
 *
 * Two types are computed: the body type with its numeric ranges removed
 * (`stripNumericRanges`), and the body type derived again with each ranged
 * index typed without its range (`integer`). The second is used when it is
 * a subtype of the first, the first otherwise.
 *
 * Each node of the body that reads such an index is derived again from its
 * operands, through the type handler of its operator (`context.derive`).
 * When a node cannot be derived again (an operator with no type handler and
 * no signature), the numeric ranges are removed from the body type
 * instead (`stripNumericRanges`).
 *
 * A symbol is typed again only where it names the index of this
 * comprehension. A nested binder can bind the same name: in
 * `[[k for k in [0.5, 1.5]] for k in 1..16]` the inner `k` is a real, and
 * typing it `integer` would give `list<list<integer>>`. So the names that a
 * nested binder binds are removed from the substitution in the operands
 * where its binding is visible (see {@link LOOP_LIKE_BINDERS}).
 *
 * The derived descriptor of each node is kept for each set of names that
 * are still substituted. The body is a graph: `List(t, t)` holds the same
 * operand twice, and a body built from 24 such levels has 25 nodes but
 * 2^24 paths from the root. Without the memo, the derivation would visit
 * each path.
 */
function bodyTypeWithoutIndexRanges(
  body: OperandDescriptor,
  clauses: ReadonlyArray<OperandDescriptor>,
  context: TypeHandlerContext
): Type {
  const unranged = new Map<string, Type>();
  for (const clause of clauses) {
    const structure = clause.structureOf?.();
    if (structure?.kind !== 'application' || structure.head !== 'Element')
      continue;
    const index = structure.children[0];
    const indexStructure = index?.structureOf?.();
    if (indexStructure?.kind !== 'symbol') continue;
    const stripped = stripNumericRanges(index.type);
    if (stripped !== index.type) unranged.set(indexStructure.name, stripped);
  }
  if (unranged.size === 0) return body.type;
  let failed = false;

  // The names that are still substituted, with the key of that set of
  // names. A name is only ever removed from the substitution, and its type
  // is the same in every substitution, so the names alone identify it.
  type Substitution = {
    readonly types: ReadonlyMap<string, Type>;
    readonly key: string;
  };
  const substitutions = new Map<string, Substitution>();
  const substitutionOf = (types: ReadonlyMap<string, Type>): Substitution => {
    const key = [...types.keys()].sort().join('\u0000');
    let s = substitutions.get(key);
    if (s === undefined) {
      s = { types, key };
      substitutions.set(key, s);
    }
    return s;
  };
  const without = (
    s: Substitution,
    names: ReadonlySet<string>
  ): Substitution => {
    let types: Map<string, Type> | undefined;
    for (const name of names) {
      if (!s.types.has(name)) continue;
      types ??= new Map(s.types);
      types.delete(name);
    }
    return types === undefined ? s : substitutionOf(types);
  };

  // One memo for each substitution, keyed by the input descriptor.
  const memo = new Map<string, Map<OperandDescriptor, OperandDescriptor>>();
  const derive = (d: OperandDescriptor, s: Substitution): OperandDescriptor => {
    if (failed || s.types.size === 0) return d;
    let derivedIn = memo.get(s.key);
    if (derivedIn === undefined) {
      derivedIn = new Map();
      memo.set(s.key, derivedIn);
    }
    const cached = derivedIn.get(d);
    if (cached !== undefined) return cached;
    const result = deriveNode(d, s);
    derivedIn.set(d, result);
    return result;
  };

  const deriveNode = (
    d: OperandDescriptor,
    s: Substitution
  ): OperandDescriptor => {
    const structure = d.structureOf?.();
    if (structure === undefined) return d;
    if (structure.kind === 'symbol') {
      const t = s.types.get(structure.name);
      return t === undefined ? d : describeBoundSymbol(t, structure.name);
    }
    const operands = operandsOf(structure);
    if (operands === undefined) return d;
    const head = headOf(structure);
    if (LOOP_LIKE_BINDERS.has(head))
      return rebuild(d, structure, operands, deriveBinderOperands(operands, s));
    // Any other operator that binds names (a `Block`, a quantifier,
    // `NDSolveFunction`) is not typed again: the names it binds are not
    // read from its operand descriptors here, and a substitution into its
    // operands could replace a symbol that it binds.
    if (context.engine.lookupDefinition(head)?.operator?.scoped === true)
      return d;
    return rebuild(
      d,
      structure,
      operands,
      operands.map((x) => derive(x, s))
    );
  };

  // The operands of a binder in `LOOP_LIKE_BINDERS`. Operand 0 is the body,
  // which is inside every clause: each name that a clause binds is removed
  // from the substitution there. A clause sees the names of the clauses
  // BEFORE it ("later clauses see earlier bindings"), not its own: in
  // `Element(k, Range(1, k))`, the `k` of the range is the enclosing `k`.
  // Its index position is not substituted.
  const deriveBinderOperands = (
    operands: ReadonlyArray<OperandDescriptor>,
    s: Substitution
  ): OperandDescriptor[] => {
    const bound = operands.map((x, i) =>
      i === 0 ? new Set<string>() : clauseBoundNames(x)
    );
    const all = new Set<string>();
    for (const names of bound) for (const name of names) all.add(name);
    const result: OperandDescriptor[] = [derive(operands[0], without(s, all))];
    const before = new Set<string>();
    for (let i = 1; i < operands.length; i++) {
      const visible = without(s, before);
      result.push(
        deriveClause(operands[i], visible, without(visible, bound[i]))
      );
      for (const name of bound[i]) before.add(name);
    }
    return result;
  };

  // A clause: its first operand (the index, or the index pattern) is
  // derived with `own`, which does not substitute the names the clause
  // binds, and its other operands (the collection, the bounds) with
  // `visible`.
  const deriveClause = (
    d: OperandDescriptor,
    visible: Substitution,
    own: Substitution
  ): OperandDescriptor => {
    const structure = d.structureOf?.();
    const operands =
      structure === undefined ? undefined : operandsOf(structure);
    if (
      structure === undefined ||
      operands === undefined ||
      operands.length === 0
    )
      return derive(d, own);
    return rebuild(
      d,
      structure,
      operands,
      operands.map((x, i) => derive(x, i === 0 ? own : visible))
    );
  };

  const rebuild = (
    d: OperandDescriptor,
    structure: OperandStructure,
    operands: ReadonlyArray<OperandDescriptor>,
    derived: ReadonlyArray<OperandDescriptor>
  ): OperandDescriptor => {
    if (derived.every((x, i) => x === operands[i])) return d;
    const head = headOf(structure);
    const t = deriveApplicationOf(
      {
        head,
        callee: structure.kind === 'application' ? structure.callee : undefined,
      },
      derived,
      context
    );
    if (t === undefined) {
      failed = true;
      return d;
    }
    let rebuilt: OperandStructure | undefined;
    return {
      type: t,
      facts: describeBoundSymbol(t).facts,
      structureOf: () =>
        (rebuilt ??=
          structure.kind === 'application'
            ? { ...structure, children: derived }
            : structure.kind === 'tuple'
              ? { kind: 'tuple', arity: derived.length, elements: derived }
              : structure.kind === 'list-literal'
                ? { ...structure, elements: derived }
                : structure),
    };
  };

  const stripped = stripNumericRanges(body.type);
  const result = derive(body, substitutionOf(unranged));
  // Both types contain every value of the body. The derived one is kept
  // when it is the narrower: it has the sign of `k²`, which the stripped
  // type does not. The stripped one is kept otherwise: `√((k − 0.5)/16)`
  // derived over a plain `integer` index is `complex`, while the body,
  // over its ranged index, is `real`.
  if (failed || !isSubtype(result.type, stripped)) return stripped;
  return result.type;
}

/**
 * The operators whose operand 0 is a body and whose other operands are
 * clauses that can bind names: an `Element`, `Limits`, `Tuple`, `Triple`,
 * `Pair`, `Single` or `Set` clause binds the symbol (or the symbols of the
 * tuple pattern) in its first operand, and a bare symbol operand
 * (`Sum(body, n, 1, 10)`, `D(f, x)`) binds that symbol. These are the
 * operators declared with `indexingSetSites(1)`, `operandSites(1)` or
 * `operandsFrom(1)` (`boxed-expression/binding-sites.ts`).
 *
 * The names read here can include more than the operator binds: a symbol
 * bound of the flat spelling (`b` in `Integrate(f, x, 0, b)`), or the second
 * operand of `Series`. Such a name is then not typed again in the body, and
 * keeps its ranged type there. That type is narrower, but it is correct.
 */
const LOOP_LIKE_BINDERS: ReadonlySet<string> = new Set([
  'Comprehension',
  'Loop',
  'Sum',
  'Product',
  'Integrate',
  'CircularIntegrate',
  'ContourIntegrate',
  'D',
  'Series',
]);

/** The clauses that carry their index in their first operand. */
const INDEX_CLAUSE_HEADS: ReadonlySet<string> = new Set([
  'Element',
  'Limits',
  'Tuple',
  'Triple',
  'Pair',
  'Single',
  'Set',
]);

/** The head a structure is derived with by `context.derive`. */
function headOf(structure: OperandStructure): string {
  if (structure.kind === 'application') return structure.head;
  if (structure.kind === 'tuple') return 'Tuple';
  return 'List';
}

/** The operands of a structure that `context.derive` can derive again, or
 * `undefined` for a leaf or a function literal. */
function operandsOf(
  structure: OperandStructure
): ReadonlyArray<OperandDescriptor> | undefined {
  if (structure.kind === 'application') return structure.children;
  if (structure.kind === 'tuple' || structure.kind === 'list-literal')
    return structure.elements;
  return undefined;
}

/** The names that a clause of a binder in `LOOP_LIKE_BINDERS` binds. */
function clauseBoundNames(clause: OperandDescriptor): Set<string> {
  const names = new Set<string>();
  const structure = clause.structureOf?.();
  if (structure === undefined) return names;
  if (structure.kind === 'symbol' || isHoldStructure(structure)) {
    patternBoundNames(clause, names);
    return names;
  }
  if (INDEX_CLAUSE_HEADS.has(headOf(structure))) {
    const index = operandsOf(structure)?.[0];
    if (index !== undefined) patternBoundNames(index, names);
  }
  return names;
}

function isHoldStructure(structure: OperandStructure): boolean {
  return (
    structure.kind === 'application' &&
    structure.head === 'Hold' &&
    structure.children.length === 1
  );
}

/** The symbols of an index: a symbol, a held symbol, or the leaves of a
 * tuple pattern (`Element(Tuple(p, q), pairs)`). */
function patternBoundNames(d: OperandDescriptor, names: Set<string>): void {
  const structure = d.structureOf?.();
  if (structure === undefined) return;
  if (structure.kind === 'symbol') names.add(structure.name);
  else if (structure.kind === 'tuple')
    for (const x of structure.elements) patternBoundNames(x, names);
  else if (isHoldStructure(structure) && structure.kind === 'application')
    patternBoundNames(structure.children[0], names);
}

/**
 * Canonicalize a `Loop` or `Comprehension` expression. Both share the same
 * variadic `Element`-clause scope hygiene:
 *
 * - Push a fresh scope with `noAutoDeclare = true`, declare each Element's
 *   index variable in that scope, and canonicalize each clause + body inside
 *   the scope. Mirrors `canonicalBigop` so that free variables in the body
 *   and collection expressions are auto-declared in the enclosing scope, not
 *   leaking the iteration variable names.
 *
 * - A `Loop(body)` with no clauses is a valid bare (infinite) imperative loop;
 *   a `Comprehension(body)` with no clauses is invalid (`null`).
 *
 * - An iterator operand that is not an `Element` clause is not silently passed
 *   through (it would otherwise be ignored at runtime, producing a spurious
 *   infinite loop): it is replaced with an error expression so the whole
 *   expression is visibly invalid.
 */
function canonicalLoopLike(
  head: 'Loop' | 'Comprehension',
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
): Expression | null {
  const { engine: ce, scope } = options;
  if (ops.length === 0) return null;

  const body = ops[0];
  const iterators = ops.slice(1);

  if (iterators.length === 0) {
    // Bare form. `Loop(body)` is a valid infinite imperative loop;
    // `Comprehension(body)` needs at least one Element clause.
    if (head === 'Comprehension') return null;
    return ce._fn('Loop', [canonicalStatement(ce, body)]);
  }

  // Variadic Element form: bound names must not leak. The scope, its
  // `noAutoDeclare` flag, the push/pop around this handler and the declaration
  // of each Element index come from the binder hook in `box.ts` (`scoped:
  // indexingSetSites(1)`) — this used to be an independent copy of
  // `canonicalBigop`'s prologue. A defensive fallback for a caller that did
  // not come through the hook.
  const loopScope: Scope = scope ?? {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
  };

  // Canonicalize each Element clause in order. Earlier clauses declare their
  // index in `loopScope` before later clauses are canonicalized — so a later
  // collection expression referencing an earlier name binds to the loop-scoped
  // symbol rather than triggering auto-declaration in the enclosing scope.
  const canonicalIterators: Expression[] = iterators.map((it) => {
    if (!isFunction(it, 'Element')) {
      // Not an Element clause — flag as invalid rather than passing it
      // through (which would be ignored at runtime → infinite loop).
      return ce.error('unexpected-argument', it.toString());
    }
    const indexExpr = it.ops[0];
    const collExpr = it.ops[1];
    if (!indexExpr || !collExpr) {
      return ce._fn('Element', [
        (indexExpr ?? ce.error('missing')).canonical,
        (collExpr ?? ce.error('missing')).canonical,
      ]);
    }
    if (isSymbol(indexExpr) && indexExpr.symbol !== 'Nothing') {
      if (!ce.context.lexicalScope.bindings.has(indexExpr.symbol))
        ce.declare(indexExpr.symbol, 'unknown');
    }
    // A DESTRUCTURING loop variable — `for (p, q) in pairs { … }` — declares
    // one binding per pattern leaf, so the body's occurrences bind to this
    // loop's scope rather than auto-declaring in the enclosing one.
    if (isFunction(indexExpr, 'Tuple')) {
      for (const name of tuplePatternNames(indexExpr))
        if (!ce.context.lexicalScope.bindings.has(name))
          ce.declare(name, 'unknown');
    }
    const collCanonical = collExpr.canonical;
    // These clauses are rebuilt with `_fn`, which bypasses the `Element`
    // canonical handler — so nothing narrows the iterated operand. Yet
    // iterating over a not-yet-typed symbol is collection evidence in the same
    // way `Length(x)` or `x[i]` is: narrow it, so a function parameter whose
    // only use is `for c in cs` types as a collection (and the lambda
    // auto-broadcast then binds a collection argument whole instead of mapping
    // over it).
    // The guard reads an EFFECTIVE type, so it runs fact-blind together with
    // the write it gates: an assumption that gives the operand a type would
    // otherwise decide whether this contract-bearing narrowing happens at all.
    ce._withoutFacts(() => {
      if (
        isSymbol(collCanonical) &&
        collCanonical.valueDefinition?.inferredType &&
        collCanonical.type.type === 'unknown'
      )
        collCanonical._infer(() => 'collection', 'narrow');
    });
    // …and nothing typed the INDEX, either (the same bypass): the binder
    // hook declares each index `unknown`, and the body's arithmetic use
    // then widened it to `number` — so `for i in 1..3` typed `10 * i` as
    // `number`, wide enough to falsely refuse an `integer`-declared
    // protocol-property write. Narrow the fresh binding to the collection's
    // ELEMENT type when it is known, BEFORE the body canonicalizes against
    // it (the `Element` canonical handler's own inference, sets.ts, which
    // this `_fn` rebuild bypasses). `._infer()` accepts an explicit-`unknown`
    // binding and carries the machinery a raw `def.type` write skips (the
    // resolve-only guard, the inference state event, the same-type no-op
    // that preserves `BoxedType` identity). The collection type is resolved
    // first so an ALIAS (`type ints = list<integer>`) contributes its
    // element type too.
    // A destructuring pattern stays RAW, exactly as the `Declare`/`Assign`
    // destructuring targets do: canonicalizing it would fold a single-letter
    // leaf into the library constant of that name (`i` → `ImaginaryUnit`).
    //
    // A plain index is the binding THIS scope holds for the name. A clause
    // that is already canonical (a loop rebuilt from its canonical operands)
    // keeps its index bound to the ORIGINAL loop's scope: narrowing that
    // symbol left this scope's index `unknown`, so the body typed `10i` as
    // `number`, and the clause and the body denoted two different bindings
    // of one index (`canonicalIndexingSet`, `library/utils.ts`, does the same
    // for a `Sum`).
    const canonicalIndex = isFunction(indexExpr, 'Tuple')
      ? indexExpr
      : indexExpr.canonical;
    const idxCanonical = isSymbol(canonicalIndex)
      ? (ce._bindingSymbol(canonicalIndex.symbol, ce.context.lexicalScope) ??
        canonicalIndex)
      : canonicalIndex;
    // The element type is read fact-blind: the collection's EFFECTIVE type can
    // be narrowed by an assumption, and the index binding this write creates is
    // a contract that must not carry a fact the next statement can retract.
    let patternError: Expression | undefined;
    // The index of a `Loop` over a range with integer literal bounds
    // (`Element(j, Range(1, 100))`) is typed `integer<1..100>`, not the bare
    // `integer` element type of the range, as the index of a `Sum` over
    // `Limits(j, 1, 100)` is. The bounded type lets a compiled `Mod(j, 3)` in
    // the body use the plain `%` operator instead of the checked helper.
    // The index of a `Comprehension` is typed the same way: the ranged type
    // proves the sign of a body such as `√((k − 0.5)/16)`, so the compiled
    // body stays on the real lane. The `Comprehension` type handler removes
    // the numeric ranges from the element type of the list it returns, so
    // `[k for k in 1..100]` is `list<integer>`, not `list<integer<1..100>>`.
    const rangeIndex = rangeElementIndexType(idxCanonical, collCanonical, ops);
    const currentElementType = (): Type | undefined =>
      rangeIndex !== undefined
        ? parseType(rangeIndex)
        : collectionElementType(
            resolveTypeForCompilation(collCanonical.type.type)
          );
    // Bind the index (or each leaf of a destructuring pattern) from the
    // element type `elt` through `bindOne`. The leaves are looked up in the
    // scope current NOW, since the second read (below) runs outside it.
    const bindScope = ce.context.lexicalScope;
    const bindFromElement = (
      elt: Type | undefined,
      bindOne: (binding: Expression, type: Type) => void
    ): void => {
      if (elt === undefined || elt === 'any' || elt === 'unknown') return;
      if (isSymbol(idxCanonical)) {
        bindOne(idxCanonical, elt);
        return;
      }
      // A destructuring pattern (`for (p, q) in pairs`) binds each leaf to
      // the matching component of the element's TUPLE type — the only
      // element type the runtime destructuring accepts (`collectTuplePattern`
      // refuses anything but a `Tuple` value) — recursively for a nested
      // pattern. A leaf whose component type is not known, an element type
      // that is not a tuple, and the wildcard `_` are left as declared,
      // `unknown`, to be typed by use. A tuple type whose arity the pattern
      // does not match, and a name the pattern binds twice, are errors here:
      // the first would fail on every value at run time (the same check
      // `collectTuplePattern` makes), the second would write two
      // authoritative types onto one binding.
      //
      // An element type that is a UNION is read arm by arm: each arm that is
      // a tuple of the pattern's shape gives a type for each leaf, and a
      // leaf's type is the join of its types from those arms. An arm of
      // another shape is skipped, since a value of that arm fails the
      // destructuring at run time and binds nothing. A leaf that one of the
      // read arms leaves untyped stays untyped. When no arm fits, nothing is
      // bound and there is no error (as for any other element type that is
      // not a tuple), unless every arm that has the pattern's arity reports
      // an error, in which case the first arm's error stands.
      //
      // `readPattern` returns the leaf types and adds each name it meets to
      // `bound`; the bindings are written once the whole pattern is read.
      const readPattern = (
        pattern: Expression,
        elementType: Type,
        bound: Set<string>
      ): Map<string, Type> => {
        const leaves = new Map<string, Type>();
        if (patternError !== undefined) return leaves;
        // A component may be an alias or a nominal type of a tuple
        // (`list<tuple<integer, pt>>`): resolve it before reading its shape,
        // as the collection type itself was resolved above.
        const type = resolveTypeForCompilation(elementType);
        if (!isFunction(pattern, 'Tuple')) return leaves;
        if (typeof type !== 'string' && type.kind === 'union') {
          const arms = type.types
            .map((arm) => resolveTypeForCompilation(arm))
            .filter(
              (arm) =>
                typeof arm !== 'string' &&
                arm.kind === 'tuple' &&
                arm.elements.length === pattern.nops
            );
          const armLeaves: Map<string, Type>[] = [];
          let firstError: Expression | undefined;
          const armBound = new Set<string>();
          for (const arm of arms) {
            const b = new Set(bound);
            const read = readPattern(pattern, arm, b);
            if (patternError !== undefined) {
              firstError ??= patternError;
              patternError = undefined;
              continue;
            }
            armLeaves.push(read);
            for (const name of b) armBound.add(name);
          }
          if (armLeaves.length === 0) {
            patternError = firstError;
            return leaves;
          }
          for (const name of armBound) bound.add(name);
          for (const name of armLeaves[0].keys()) {
            const types = armLeaves.map((read) => read.get(name));
            if (types.some((t) => t === undefined)) continue;
            const joined = reduceType({
              kind: 'union',
              types: types as Type[],
            });
            if (joined !== undefined) leaves.set(name, joined);
          }
          return leaves;
        }
        if (typeof type === 'string' || type.kind !== 'tuple') return leaves;
        if (pattern.nops !== type.elements.length) {
          patternError = ce.typeError(
            parseType(
              `tuple<${Array(pattern.nops).fill('unknown').join(', ')}>`
            ),
            type,
            pattern
          );
          return leaves;
        }
        pattern.ops.forEach((leaf, i) => {
          if (patternError !== undefined) return;
          const component = type.elements[i].type;
          if (isFunction(leaf, 'Tuple')) {
            for (const [name, t] of readPattern(leaf, component, bound))
              leaves.set(name, t);
            return;
          }
          const name = sym(leaf);
          if (name === undefined || name === '_') return;
          if (bound.has(name)) {
            patternError = ce.error(
              'unexpected-argument',
              `duplicate name in destructuring pattern: ${name}`
            );
            return;
          }
          bound.add(name);
          if (component === 'any' || component === 'unknown') return;
          leaves.set(name, component);
        });
        return leaves;
      };
      const leaves = readPattern(idxCanonical, elt, new Set());
      if (patternError !== undefined) return;
      for (const [name, type] of leaves) {
        const binding = ce._bindingSymbol(name, bindScope);
        if (binding !== undefined) bindOne(binding, type);
      }
    };
    // The binding site is AUTHORITATIVE for the index's type: the element
    // type is evidence from the collection, not a guess. The helper also
    // takes the binding out of the fresh-inference set, so a body use that
    // contradicts the element type is an error (`bindIndexAuthoritatively`,
    // `library/utils.ts`, says why and how the removal is journaled).
    ce._withoutFacts(() =>
      bindFromElement(currentElementType(), (binding, type) =>
        bindIndexAuthoritatively(ce, binding, type)
      )
    );
    // The collection's type is read NOW, but it may read a local that a later
    // statement of an enclosing loop widens: `for t in [p, q, r]` where `p`
    // later holds a tuple of `number` elements. The index then claimed the
    // narrower element type, and the compiled complex lane read a `{re, im}`
    // element as a JavaScript number. So the enclosing block reads the
    // element type again after all its statements are canonicalized, and
    // widens the index to it (`withEvidenceSession`,
    // `library/assignment-evidence.ts`). A pattern error found on that
    // second read is ignored: the loop is already built. But when a later
    // read gives no type for an index (or a leaf) that the first read typed
    // — the element type became `unknown` or `any`, or is no longer a tuple
    // of the pattern's arity — the first, narrower type may no longer hold
    // for what the loop visits, so that index is widened to `unknown` (the
    // same write as `reset`) and the site reports a change. After that the
    // site writes nothing more for the rest of the session: `unknown` is
    // already the widest type.
    const indexBindings: Expression[] = [];
    ce._withoutFacts(() =>
      bindFromElement(currentElementType(), (binding) =>
        indexBindings.push(binding)
      )
    );
    if (patternError === undefined && indexBindings.length > 0) {
      const lost = new Set<string>();
      registerEvidenceSite(ce, {
        rejoin: (coarse) => {
          let changed = false;
          const saved = patternError;
          const typed = new Set<string>();
          ce._withoutFacts(() =>
            bindFromElement(currentElementType(), (binding, type) => {
              const name = sym(binding);
              if (name === undefined || lost.has(name)) return;
              typed.add(name);
              const before = binding.type.type;
              if (isSubtype(type, before)) return;
              binding._infer(
                () => (coarse ? coarsenEvidenceType(type) : type),
                'widen'
              );
              if (binding.type.type !== before) changed = true;
            })
          );
          patternError = saved;
          for (const binding of indexBindings) {
            const name = sym(binding);
            if (name === undefined || typed.has(name) || lost.has(name))
              continue;
            lost.add(name);
            if (binding.type.isUnknown) continue;
            binding._infer(() => 'unknown', 'replace');
            changed = true;
          }
          return changed;
        },
        reset: () => {
          for (const binding of indexBindings)
            binding._infer(() => 'unknown', 'replace');
        },
      });
    }
    // An optional GUARD, `Element(x, xs, cond)` — the three-operand indexing
    // set `Sum` and `Product` also take. It is canonicalized here, after the
    // index is declared, so its occurrences of the index bind to this loop's
    // scope, as the body's do. At run time an element is visited only when
    // the guard evaluates to `True` (`runNested`).
    const guard = it.ops[2];
    const guardCanonical =
      guard === undefined || sym(guard) === 'Nothing'
        ? undefined
        : guard.canonical;
    if (patternError !== undefined)
      return ce._fn('Element', [patternError, collCanonical]);
    return ce._fn(
      'Element',
      guardCanonical === undefined
        ? [idxCanonical, collCanonical]
        : [idxCanonical, collCanonical, guardCanonical]
    );
  });
  const canonicalBody: Expression = canonicalStatement(ce, body);

  return ce._fn(head, [canonicalBody, ...canonicalIterators], {
    scope: loopScope,
  });
}

/** Mutable state shared across the nested-iteration walker. */
interface LoopState {
  stopped: boolean;
  value?: Expression;
  count: number;
  /** The error value of a clause domain that stopped the walk (`runNested`).
   * It is not an element: a `Loop` takes it as its value, and a
   * `Comprehension` records a failed walk with it (`noteFailedWalk()`), so
   * that the error is the value of the whole comprehension. */
  domainError?: Expression;
}

/**
 * Imperative `Loop`, evaluated **for effect**.
 *
 * - `Loop(body)` — infinite loop: repeatedly evaluate `body` until it yields a
 *   `Break` (loop value = its operand, else `Nothing`) or a `Return`
 *   (propagated unchanged). Any other result (including `Continue`) just
 *   continues.
 * - `Loop(body, Element(x, coll), …)` — nested for-each for effect. No results
 *   are accumulated; normal completion returns `Nothing`.
 */
function* runLoop(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  ce: ComputeEngine
): Generator<Expression> {
  body ??= ce.Nothing;
  if (sym(body) === 'Nothing') return ce.Nothing;

  if (elements.length === 0) {
    // Bare infinite imperative loop.
    let i = 0;
    while (true) {
      const result = body.evaluate();
      if (isFunction(result, 'Break'))
        return result.ops.length > 0 ? result.op1 : ce.Nothing;
      if (result.operator === 'Return') return result;
      // An `Error` value — the body's statement list short-circuited on a
      // fault (see `evaluateStatements`). Stop and surface it as the loop's
      // value rather than iterating past it forever.
      if (result.operator === 'Error') return result;
      i += 1;
      yield result;
      if (i > ce.iterationLimit)
        throw new CancellationError({ cause: 'iteration-limit-exceeded' });
    }
  }

  const state: LoopState = { stopped: false, count: 0 };
  yield* runNestedElements(body, elements, ce, state, (result) => {
    if (isFunction(result, 'Break')) {
      state.stopped = true;
      // The break value is already evaluated in-context (Break is eager), so a
      // value referencing the loop variable is concrete.
      if (result.ops.length > 0) state.value = result.op1;
      return;
    }
    if (result.operator === 'Return') {
      // Return propagation: forward the Return expression unchanged.
      state.stopped = true;
      state.value = result;
      return;
    }
    if (result.operator === 'Error') {
      // A fault the body's statement list short-circuited on (see
      // `evaluateStatements`): stop, and the error is the loop's value —
      // iterating on would silently repeat (or compound) the fault.
      state.stopped = true;
      state.value = result;
      return;
    }
    // Any other result (including Continue) simply continues.
  });

  // A domain that evaluates to an error value (a local read before it has a
  // value, `for i in t { … }; t = [1]` in a function body) stopped the walk,
  // and the error is the value of the loop, as an error of the body is.
  if (state.domainError !== undefined) return state.domainError;
  if (state.stopped && state.value !== undefined) return state.value;
  return ce.Nothing;
}

/** The index variable names of a comprehension's `Element` clauses, in order
 * (the wildcard `Nothing` is skipped — it binds nothing; a destructuring
 * pattern contributes each of its leaves). */
function comprehensionIndexNames(
  elements: ReadonlyArray<Expression>
): string[] {
  const names: string[] = [];
  for (const el of elements) {
    if (!isFunction(el, 'Element')) continue;
    const idx = el.ops[0];
    if (idx && isSymbol(idx) && idx.symbol !== 'Nothing')
      names.push(idx.symbol);
    else if (isFunction(idx, 'Tuple')) names.push(...tuplePatternNames(idx));
  }
  return names;
}

/**
 * Per-walk isolation of a `Comprehension`'s index values, WITHOUT a separate
 * binding scope.
 *
 * The index values must live in the comprehension's own `localScope` bindings
 * — the scope every subexpression of the body resolves against. A scoped
 * subexpression (a `Block`, a scoped big-op, a nested comprehension) follows
 * its canonical parent chain, which reaches `localScope` but would never
 * reach a runtime-created sibling scope: binding the indices anywhere else
 * makes those subexpressions evaluate BLIND to the indices (an applied
 * function literal whose piecewise guard was then undecidable escaped with
 * its parameters permanently free — wrong values, not just wasted work).
 *
 * But `localScope` is created once at canonicalization and outlives every
 * walk, and walks interleave (paused `each()` generators, a dependent
 * `.count` read mid-iteration), so concurrent walks writing their indices
 * into it directly would clobber each other. The isolation contract: each
 * walk brackets every synchronous advance with save → install its own
 * current values → advance → capture → restore. Since an advance never
 * spans a `yield`, no other walk can observe the installed values.
 */
class ComprehensionIndexFrame {
  private ce: ComputeEngine;
  private defs: (BoxedValueDefinition | undefined)[];
  /** This walk's current index values, persisted across advances. */
  private mine: (Expression | undefined)[];
  private saved: (Expression | undefined)[] = [];

  constructor(ce: ComputeEngine, scope: Scope | undefined, names: string[]) {
    this.ce = ce;
    this.defs = names.map((name) => {
      const def = scope?.bindings.get(name);
      return def !== undefined && isValueDef(def) && !def.value.isConstant
        ? def.value
        : undefined;
    });
    this.mine = names.map(() => undefined);
  }

  /** Save the scope's current index values and install this walk's. */
  install(): void {
    this.saved = this.defs.map((d) => d?.value);
    // Ephemeral index writes: bump `_anyVersion` and the per-def
    // `_writeVersion`, not `_semanticVersion` — installing/restoring a
    // walk's indices is not a semantic mutation of the document.
    this.ce._ephemeralWriteDepth += 1;
    try {
      this.defs.forEach((d, i) => {
        // Skip no-op writes: the `value` setter bumps `ce._anyVersion`, and a
        // gratuitous bump invalidates generation-keyed caches engine-wide.
        if (d && d.value !== this.mine[i]) d.value = this.mine[i];
      });
    } finally {
      this.ce._ephemeralWriteDepth -= 1;
    }
  }

  /** Capture the (possibly advanced) index values, then restore the saved
   * ones. Call in a `finally` paired with `install()`. */
  captureAndRestore(): void {
    this.mine = this.defs.map((d) => d?.value);
    this.ce._ephemeralWriteDepth += 1;
    try {
      this.defs.forEach((d, i) => {
        if (d && d.value !== this.saved[i]) d.value = this.saved[i];
      });
    } finally {
      this.ce._ephemeralWriteDepth -= 1;
    }
  }

  /** This walk's current index values as a substitution map (C2), or
   * `undefined` if no index has a value yet. */
  subs(names: string[]): Record<string, Expression> | undefined {
    let subs: Record<string, Expression> | undefined;
    this.mine.forEach((v, i) => {
      if (v !== undefined) (subs ??= {})[names[i]] = v;
    });
    return subs;
  }
}

/**
 * Stream a `Comprehension`'s body values one at a time.
 *
 * The comprehension's own scope is pushed — and this walk's index values
 * installed in it (see `ComprehensionIndexFrame`) — ONLY around each
 * synchronous `inner.next()` advance: the step that assigns the next index
 * and evaluates the body. Both are undone BEFORE the value is yielded. So
 * neither the eval-context stack nor the installed index values are ever held
 * across a `yield`: a consumer that stops early or abandons the iterator
 * leaves nothing pushed to leak (this is safe even though `each()` does not
 * forward `.return()` to us), and interleaved walks of the same comprehension
 * cannot observe each other's indices. Because each element is produced on
 * demand, iterating an infinite domain and taking only a prefix (e.g. `Take`,
 * `First`) works without hitting the iteration limit; a full drive of an
 * infinite domain still terminates via the iteration-limit
 * `CancellationError` from `runNested`.
 */
function* comprehensionStream(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const ce = expr.engine;
  const body = expr.ops[0] ?? ce.Nothing;
  const elements = expr.ops.slice(1);

  const scope = isFunction(expr) && expr.isScoped ? expr.localScope : undefined;
  const indexNames = comprehensionIndexNames(elements);
  // The index values are installed in the comprehension's OWN `localScope`
  // bindings for the duration of each advance (see ComprehensionIndexFrame):
  // that is the scope every subexpression of the body — including scoped
  // ones like a `Block` or a big-op, whose canonical parent chains never
  // reach a runtime-created scope — resolves against, so the body evaluates
  // with the indices actually visible.
  const frame = new ComprehensionIndexFrame(ce, scope, indexNames);
  const state: LoopState = { stopped: false, count: 0 };
  const inner = runNestedElements(body, elements, ce, state, () => {});
  while (true) {
    let r: IteratorResult<Expression>;
    // Capture this iteration's index values BY VALUE while they are still
    // installed (C2): a materialized body that is a function literal captures
    // its free variables by reference against the scope active at apply time,
    // so without the substitution below every element of
    // `[x ↦ x + i for i in 1..3]` would share one `i` (resolving to its
    // final value, or to nothing once the walk completes) instead of closing
    // over 1, 2, 3. Substituting the index values into the element is a
    // no-op for a body that already resolved them.
    //
    // The substitution reaches only the occurrences that DENOTE this
    // comprehension's index (`substituteBinderValues`, ruled 2026-09-21).
    // An occurrence of the same name that denotes a global keeps the global:
    // with `w` valueless and `W := x ↦ [w x, x]`,
    // `[W(w)[1] for w in [1, 2, 3]]` answers `[w, 2w, 3w]`, exactly what the
    // spelling `[W(k)[1] for k in [1, 2, 3]]` answers. Substituting by name
    // gave `[1, 4, 9]`. The comprehension's own scope is passed because it
    // has left the ambient chain by this point.
    let subs: Record<string, Expression> | undefined;
    if (scope) ce._pushEvalContext(scope, undefined, { ambient: true });
    frame.install();
    // The scopes nested in the comprehension (an inner `Block` of the body,
    // a `Sum` in it) are shared by every walk of this comprehension, like
    // the index scope above. A walk can run outside any application of the
    // function whose body contains the comprehension — a lazy comprehension
    // is walked when its value is read, often after that function has
    // returned — so a recursive call made from the body is not re-entrant
    // for the function-application check. Marking the nested scopes as in
    // use for the duration of the advance makes that inner application (and
    // any inner walk of the same comprehension) save and restore them. See
    // `enterNestedBodyScopes`.
    const nested = enterNestedBodyScopes(expr);
    try {
      r = inner.next();
    } finally {
      exitNestedBodyScopes(ce, nested);
      frame.captureAndRestore();
      if (scope) ce._popEvalContext();
    }
    if (r.done) {
      // A clause domain that is an error value makes the error the value of
      // the whole comprehension, also after some elements were given: the
      // walk records that it failed, in the pull of its consumer that met
      // the error (`noteFailedWalk()`). A consumer that reads the walk
      // (`Length`, `Count`, `Sum`, a materialization) then answers the
      // error, and the element memo does not keep the walk.
      if (state.domainError !== undefined) noteFailedWalk(state.domainError);
      return;
    }
    if (indexNames.length > 0) subs = frame.subs(indexNames);
    const value =
      subs !== undefined && r.value.has(indexNames)
        ? substituteBinderValues(r.value, subs, () => scope)
        : r.value;
    yield value;
  }
}

/**
 * A comprehension is DEPENDENT when a later clause's collection references an
 * index bound by an earlier clause (e.g. `Element(j, Range(1, i))` after
 * `Element(i, …)`). This is a purely structural test — it does NOT evaluate the
 * clauses, so it is immune to any stale index binding a previous iteration may
 * have left in the persistent loop scope (which would otherwise make a
 * re-evaluated dependent range report a bogus finite count).
 */
function comprehensionIsDependent(clauses: ReadonlyArray<Expression>): boolean {
  const seen: string[] = [];
  for (const clause of clauses) {
    if (!isFunction(clause, 'Element')) return true;
    const coll = clause.ops[1];
    // `has(seen)` is true iff the collection references ANY earlier index.
    if (coll && seen.length > 0 && coll.has(seen)) return true;
    const idx = clause.ops[0];
    if (idx && isSymbol(idx) && idx.symbol !== 'Nothing') seen.push(idx.symbol);
    // A destructuring index (`for (p, q) in pairs`) binds each pattern leaf,
    // so a later clause's domain mentioning any leaf makes it dependent.
    else if (isFunction(idx, 'Tuple')) seen.push(...tuplePatternNames(idx));
  }
  return false;
}

/**
 * Count the elements of a dependent comprehension by traversing its iterator
 * DOMAINS only — the nested iteration is driven with a trivial (`Nothing`) body,
 * so reading `.count` never evaluates (or re-runs the side effects of) the real
 * comprehension body. Returns `undefined` if the domain is unbounded (the
 * iteration-limit cancellation); a genuine time-budget cancellation propagates.
 */
function comprehensionEnumeratedCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const ce = expr.engine;
  const elements = expr.ops.slice(1);
  // The count drive binds the indices in the shared `localScope` (where
  // dependent clause domains resolve them), bracketed by a
  // ComprehensionIndexFrame: reading `.count` while another walk is paused
  // must not clobber that walk's indices — the frame restores the scope's
  // values when the (fully synchronous) drive completes.
  const scope = expr.isScoped ? expr.localScope : undefined;
  const frame = new ComprehensionIndexFrame(
    ce,
    scope,
    comprehensionIndexNames(elements)
  );
  if (scope) ce._pushEvalContext(scope, undefined, { ambient: true });
  frame.install();
  try {
    let n = 0;
    const state: LoopState = { stopped: false, count: 0 };
    // Synchronous full drive under one push/pop — no external yield, so the
    // scope is balanced; the `Nothing` body makes each leaf side-effect-free.
    for (const _ of runNestedElements(
      ce.Nothing,
      elements,
      ce,
      state,
      () => {}
    ))
      n += 1;
    // A clause domain that is an error value: the count is not known, and
    // the error is the value of the comprehension (see `comprehensionStream`).
    if (state.domainError !== undefined) {
      noteFailedWalk(state.domainError);
      return undefined;
    }
    return n;
  } catch (e) {
    if (
      e instanceof CancellationError &&
      e.cause === 'iteration-limit-exceeded'
    )
      return undefined;
    throw e;
  } finally {
    frame.captureAndRestore();
    if (scope) ce._popEvalContext();
  }
}

/** The independent-clause tally: whether any clause is empty / unknown-count /
 * infinite, and the product of the finite clause counts. `undefined` if a
 * clause is not a collection. Shared by `count` and `isFinite` so the two never
 * disagree — every clause is examined (order-independent), and an empty clause
 * is recorded even when it appears after an unknown or infinite one. */
function scanIndependentClauses(
  expr: Expression
):
  | { empty: boolean; unknown: boolean; infinite: boolean; product: number }
  | undefined {
  if (!isFunction(expr)) return undefined;
  const ce = expr.engine;
  const clauses = expr.ops.slice(1);
  const scoped = expr.isScoped && expr.localScope !== undefined;
  if (scoped)
    ce._pushEvalContext(expr.localScope!, undefined, { ambient: true });
  try {
    let empty = false;
    let unknown = false;
    let infinite = false;
    let product = 1;
    for (const clause of clauses) {
      if (!isFunction(clause, 'Element')) return undefined;
      const coll = clause.ops[1]?.evaluate();
      // A domain that is an error value: the error is the value of the
      // comprehension (see `comprehensionStream`).
      if (coll?.operator === 'Error') {
        noteFailedWalk(coll);
        return undefined;
      }
      if (!coll?.isCollection) return undefined;
      // A count that is not a safe integer (a `bigint`) is read as unknown:
      // `Number.isFinite()` below would read it as infinite.
      const c = smallCount(coll);
      if (coll.isEmptyCollection === true || c === 0) empty = true;
      else if (c === undefined) unknown = true;
      else if (!Number.isFinite(c)) infinite = true;
      else product *= c;
    }
    return { empty, unknown, infinite, product };
  } finally {
    if (scoped) ce._popEvalContext();
  }
}

/**
 * Element count of a `Comprehension`. An INDEPENDENT comprehension gets a cheap
 * product of its clause counts WITHOUT materializing. Precedence (independent of
 * clause order): an empty clause ⇒ 0; else an unknown-count clause ⇒ undefined;
 * else an infinite clause ⇒ Infinity; else the product. A DEPENDENT
 * comprehension has no closed form, so it is counted by a domain-only traversal.
 */
function comprehensionCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const clauses = expr.ops.slice(1);
  if (clauses.length === 0) return undefined;
  if (comprehensionIsDependent(clauses))
    return comprehensionEnumeratedCount(expr);

  const s = scanIndependentClauses(expr);
  if (s === undefined) return undefined;
  if (s.empty) return 0;
  if (s.unknown) return undefined;
  // A GUARDED clause (`Element(x, xs, cond)`) keeps only the elements its
  // guard accepts, so the product of the domain counts is an upper bound,
  // not the count. Over finite domains the count is the domain-only
  // traversal, which applies the guard; over an infinite domain nothing
  // decides how many elements the guard keeps.
  const guarded = comprehensionHasGuard(clauses);
  if (s.infinite) return guarded ? undefined : Infinity;
  return guarded ? comprehensionEnumeratedCount(expr) : s.product;
}

/** Whether any clause carries a guard, a third `Element` operand. */
function comprehensionHasGuard(clauses: ReadonlyArray<Expression>): boolean {
  return clauses.some(
    (clause) =>
      isFunction(clause, 'Element') &&
      clause.nops >= 3 &&
      sym(clause.ops[2]) !== 'Nothing'
  );
}

/**
 * Finiteness of a `Comprehension`. For an INDEPENDENT one it is read from the
 * clauses without materializing (finite iff every clause is a finite collection;
 * an empty clause makes it finite-empty even if another clause is infinite) —
 * so a finite-but-astronomically-large comprehension whose count would overflow
 * a JS number is still correctly reported finite. A DEPENDENT one can't be
 * judged structurally (a later range's size depends on an earlier index), so a
 * finite enumerated count is the evidence.
 */
function comprehensionIsFinite(expr: Expression): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  const clauses = expr.ops.slice(1);
  if (clauses.length === 0) return undefined;
  if (comprehensionIsDependent(clauses)) {
    const c = comprehensionCount(expr);
    return c === undefined ? undefined : Number.isFinite(c);
  }

  const s = scanIndependentClauses(expr);
  if (s === undefined) return undefined;
  if (s.empty) return true; // 0 elements ⇒ finite
  if (s.unknown) return undefined;
  // A guard over an infinite domain may keep finitely many elements or
  // infinitely many; nothing here can tell. Over finite domains it keeps a
  // subset, which is finite.
  if (s.infinite) return comprehensionHasGuard(clauses) ? undefined : false;
  return true;
}

/**
 * Lazy indexed-collection handlers for `Comprehension`. `count`/`isEmpty`/
 * `isFinite` are answered from the (independent) clause counts without walking
 * elements; iteration STREAMS one element at a time and a positive `at(n)`
 * fills the shared element-memo prefix up to `n`. A negative index needs the
 * length, so it materializes — but only once the comprehension is known
 * finite. An unread comprehension touches none of these, so binding it is
 * O(1).
 *
 * Element memoization (Tycho items 23.1/38, generalized in item 126) is NOT
 * implemented here: the `elementMemo` flag opts into the shared per-instance
 * memo applied at the `BoxedFunction.each()`/`at()` seam
 * (`boxed-expression/collection-element-memo.ts`) — two-axis invalidation,
 * transitive dependencies, impure-body draw-set coherence. Only the
 * fill-to-n prefix path is invoked directly, because a comprehension has no
 * random access of its own (`at(i)` for i = 1…n without a prefix cache is
 * O(n²), the original item-23 regression).
 */
/**
 * Whether a `Comprehension` can produce its elements: every clause domain the
 * stream walks must be enumerable.
 *
 * A DEPENDENT clause — one naming an index bound by an earlier clause — cannot
 * be judged here: its index is declared-but-unassigned in the local scope, so
 * `Range(1, i)` reads as symbolic-bound though it enumerates fine once the walk
 * binds `i` per iteration. Such a clause contributes `undefined`, not `false`,
 * so a walkable comprehension is never declared inert.
 *
 * The clauses BEFORE the first dependent one are still judged, and that is what
 * catches the shape a whole-comprehension `undefined` used to miss:
 * `[x + y for x in xs for y in 1..x]` over a valueless `xs` walks to nothing,
 * evaluates to `[]`, and had `Any(…)` answering `False` — the caller's
 * evaluate-fallback sees a collection-shaped result and cannot tell. The
 * leading `x in xs` clause is independent, so a `false` from it decides the
 * whole comprehension.
 */
function comprehensionIsEnumerable(expr: Expression): boolean | undefined {
  if (!isFunction(expr)) return undefined;
  const clauses = expr.ops.slice(1);
  if (clauses.length === 0) return undefined;

  // Index names bound so far; a clause whose domain mentions one of them is
  // dependent (same test `comprehensionIsDependent` applies, per clause).
  const bound: string[] = [];
  let unknown = false;
  for (const clause of clauses) {
    if (!isFunction(clause, 'Element')) return undefined;
    const coll = clause.ops[1];
    if (coll === undefined) return undefined;

    if (bound.length > 0 && coll.has(bound)) {
      // Dependent domain: unjudgeable, but a LATER clause cannot rescue an
      // earlier `false`, so keep scanning rather than bailing out.
      unknown = true;
    } else {
      const e = coll.isEnumerableCollection;
      if (e === false) return false;
      if (e === undefined) unknown = true;
    }

    const idx = clause.ops[0];
    if (idx && isSymbol(idx) && idx.symbol !== 'Nothing')
      bound.push(idx.symbol);
    // A destructuring index (`for (p, q) in pairs`) binds each pattern leaf,
    // so a later clause's domain mentioning any leaf is a dependent domain.
    else if (isFunction(idx, 'Tuple')) bound.push(...tuplePatternNames(idx));
  }
  return unknown ? undefined : true;
}

function comprehensionCollectionHandlers(): CollectionHandlers {
  return {
    isLazy: () => true,
    elementMemo: true,

    count: (expr) => comprehensionCount(expr),

    isEmpty: (expr) => {
      const c = comprehensionCount(expr);
      if (c !== undefined) return c === 0;
      // A GUARDED comprehension over an infinite (or unknown-count) domain
      // has no count, but its emptiness is decided by the first element the
      // guard accepts, as `Filter` decides it: walk until one element is
      // produced. The walk stops at the iteration limit — a guard that never
      // accepts leaves emptiness unknown rather than looping — and a domain
      // that cannot be enumerated is not probed at all (the walk would find
      // nothing and report a definite `true`). Without this, `Take(c, 3)` over
      // such a comprehension stayed symbolic: materialization declines a view
      // whose emptiness is unknown.
      if (!isFunction(expr)) return undefined;
      const clauses = expr.ops.slice(1);
      if (!comprehensionHasGuard(clauses)) return undefined;
      if (comprehensionIsEnumerable(expr) !== true) return undefined;
      try {
        for (const _ of expr.each()) return false;
        return true;
      } catch (e) {
        if (
          e instanceof CancellationError &&
          e.cause === 'iteration-limit-exceeded'
        )
          return undefined;
        throw e;
      }
    },

    isFinite: (expr) => comprehensionIsFinite(expr),

    isEnumerable: (expr) => comprehensionIsEnumerable(expr),

    iterator: (expr) => comprehensionStream(expr),

    at: (expr, index) => {
      if (typeof index !== 'number' || !Number.isInteger(index) || index === 0)
        return undefined;
      if (index > 0) {
        // Beyond the cache cap: stream directly rather than pinning a huge
        // prefix in memory.
        if (index > ELEMENT_MEMO_CAP) {
          let i = 0;
          const iter = comprehensionStream(expr);
          try {
            let r = iter.next();
            while (!r.done) {
              if (++i === index) return r.value;
              r = iter.next();
            }
            return undefined;
          } finally {
            // Close the stream (and its nested source iterators) when the
            // element was found before exhaustion.
            if (i === index) iter.return?.(undefined);
          }
        }
        const elements = elementMemoFillTo(expr, index, () =>
          comprehensionStream(expr)
        );
        return elements[index - 1];
      }
      // Negative index (from the end) needs the length: decline unless the
      // comprehension is provably finite, so we never try to materialize an
      // infinite domain just to index from the end. `each()` serves (and, on
      // a full drain, commits) the shared element memo.
      if (comprehensionIsFinite(expr) !== true) return undefined;
      const all = [...expr.each()];
      const target = all.length + index;
      return target >= 0 ? all[target] : undefined;
    },
  };
}

/**
 * Set up the fresh loop scope (index vars pre-declared) and drive the nested
 * iteration. Shared by `runLoop`, `comprehensionStream`, and
 * `comprehensionEnumeratedCount`; the per-result behaviour is supplied via
 * `onLeaf` (and each result is also yielded).
 */
function* runNestedElements(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  ce: ComputeEngine,
  state: LoopState,
  onLeaf: (result: Expression) => void
): Generator<Expression> {
  // Iterate in the loop's OWN lexical scope — the current eval context. The
  // scoped `Loop`/`Comprehension` pushed this scope before its evaluate handler
  // ran, and `canonicalLoopLike` already declared the Element index names in
  // it. We must NOT push a shadowing child scope here: a `Block` body resolves
  // its free variables against its *lexical* parent (this loop scope), not the
  // dynamic runtime context. A child scope would capture `ce.assign(name,
  // value)` below while the body kept reading the (unset) lexical binding,
  // leaving the loop variable symbolic in a `Loop(Block(…), Element…)`. The
  // index names are popped with the loop scope, so they don't leak.
  // Declare-if-absent keeps a non-canonical direct call working.
  for (const elem of elements) {
    if (!isFunction(elem, 'Element')) continue;
    const idx = elem.ops[0];
    if (idx && isSymbol(idx) && idx.symbol !== 'Nothing') {
      if (!ce.context.lexicalScope.bindings.has(idx.symbol))
        ce.declare(idx.symbol, 'unknown');
    }
    // A destructuring loop variable declares one binding per pattern leaf.
    if (isFunction(idx, 'Tuple'))
      for (const name of tuplePatternNames(idx))
        if (!ce.context.lexicalScope.bindings.has(name))
          ce.declare(name, 'unknown');
  }
  yield* runNested(body, elements, 0, ce, state, onLeaf);
}

/**
 * Recursive nested iteration over Element clauses. At each leaf, the body is
 * evaluated and handed to `onLeaf`, which may stop the walk by setting
 * `state.stopped`. `yield`s once per body evaluation for interruptibility.
 */
function* runNested(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  index: number,
  ce: ComputeEngine,
  state: LoopState,
  onLeaf: (result: Expression) => void
): Generator<Expression> {
  if (state.stopped) return;

  if (index === elements.length) {
    const result = body.evaluate();
    state.count += 1;
    if (state.count > ce.iterationLimit)
      throw new CancellationError({ cause: 'iteration-limit-exceeded' });
    onLeaf(result);
    yield result;
    return;
  }

  const elem = elements[index];
  if (!isFunction(elem, 'Element')) {
    // Malformed Element — skip (canonicalization should have handled this).
    return;
  }
  const indexExpr = elem.ops[0];
  const collExpr = elem.ops[1];

  const pattern = isFunction(indexExpr, 'Tuple') ? indexExpr : undefined;
  if (
    !indexExpr ||
    (!isSymbol(indexExpr) && pattern === undefined) ||
    !collExpr
  )
    return;
  const name = isSymbol(indexExpr) ? indexExpr.symbol : '';

  // Re-evaluate the collection on each entry so that dependent bindings
  // (e.g. `Element(y, Range(1, x))`) see the current value of `x`.
  const collection = collExpr.evaluate();
  // The Epsil interpreter's hook (see `evaluateStatements`,
  // `function-utils.ts`) also receives the value of a loop or comprehension
  // header written in the source. No statement holds that value, so a failed
  // cell in it (`for x in [1, g("a"), 3]`) would otherwise not be reported
  // when the body does not use the index.
  if (
    ce._epsilStatementResultHook !== undefined &&
    collExpr.sourceOffsets !== undefined
  )
    ce._epsilStatementResultHook(collExpr, collection);
  // A collection that evaluates to an error value (a local read before it
  // has a value, `for i in t { … }; t = [1]` in a function body) stops the
  // walk. The error is not given as an element: the caller decides what it
  // is the value of (`LoopState.domainError`). Without this, the error was
  // not a collection, so the walk had no iteration and the error was lost.
  if (collection?.operator === 'Error') {
    state.stopped = true;
    state.domainError = collection;
    return;
  }
  // A collection head keeps a failed operand in place instead of becoming the
  // error: `1..t` with `t` read before it has a value evaluates to
  // `Range(1, <error>)`, which is not a collection. The error in it is the
  // value of the domain.
  if (collection !== undefined && !collection.isCollection) {
    const embedded = errorValue(collection);
    if (embedded !== undefined) {
      state.stopped = true;
      state.domainError = embedded;
      return;
    }
  }
  if (!collection?.isCollection) {
    // Not a collection — nothing to iterate.
    return;
  }

  // Skip assigning to the wildcard `Nothing`. canonicalLoopLike already
  // filters these out of the pre-declaration pass, so without this guard a
  // stray non-canonical `Loop(body, Element('Nothing', coll))` would walk to
  // the parent scope looking for a binding to assign into.
  const skipAssign = name === 'Nothing';
  for (const value of collection.each()) {
    if (pattern !== undefined) {
      // A DESTRUCTURING loop variable (`for (p, q) in pairs { … }`): match the
      // element against the pattern and bind one leaf at a time. An element
      // that is not a tuple of the pattern's arity is the same shape-mismatch
      // error value `let (p, q) = v` produces. It takes the place of the
      // body value for this element, as the error of a guard does: a loop
      // stops on it and it becomes the loop's value (`onLeaf`, matching how
      // `evaluateStatements` treats a fault), and a comprehension keeps it as
      // the failed cell of this element and goes on with the next element,
      // as `Map` does with a destructuring callback
      // (`[p + q for (p, q) in [(1, 2), 5, (3, 4)]]` is `[3, <error>, 7]`).
      const pairs: [name: string, value: Expression][] = [];
      const err = collectTuplePattern(pattern, value.evaluate(), pairs);
      if (err) {
        state.count += 1;
        if (state.count > ce.iterationLimit)
          throw new CancellationError({ cause: 'iteration-limit-exceeded' });
        onLeaf(err);
        yield err;
        if (state.stopped) return;
        continue;
      }
      // Ephemeral index write, as in the single-name branch below.
      for (const [leaf, v] of pairs) assignLoopIndex(ce, leaf, v);
    } else if (!skipAssign) {
      // Ephemeral index write: bumps `_anyVersion` and the index def's
      // `_writeVersion`, not `_semanticVersion` (see `assignLoopIndex`).
      assignLoopIndex(ce, name, value);
    }
    // A guarded clause, `Element(x, xs, cond)`: the element is visited only
    // when the guard evaluates to `True` with the index bound to it. A
    // `False` guard skips the element; so does one that stays undecided (a
    // symbolic comparison) or is not a boolean at all — a comprehension is a
    // value, and an element it cannot decide to keep is not in it.
    const guard = elem.ops[2];
    if (guard !== undefined && sym(guard) !== 'Nothing') {
      const verdict = guard.evaluate();
      // A guard that evaluates to an error (the index holds a failed cell of
      // the domain, `[x for x in [1, <error>] if x > 0]`) neither keeps nor
      // skips the element: the error takes the place of the body value, as a
      // `Filter` keeps the error of its predicate in place. A loop then stops
      // on it, as on an error of its body.
      const guardError = errorValue(verdict);
      if (guardError !== undefined) {
        state.count += 1;
        if (state.count > ce.iterationLimit)
          throw new CancellationError({ cause: 'iteration-limit-exceeded' });
        onLeaf(guardError);
        yield guardError;
        if (state.stopped) return;
        continue;
      }
      if (sym(verdict) !== 'True') {
        // A rejected element is an iteration too: it counts against the
        // iteration limit, or a guard that never accepts over an infinite
        // domain (`[x for x in 1..oo if x < 0]`) would never reach the body,
        // whose evaluation is where the limit is otherwise enforced, and the
        // walk would never end.
        state.count += 1;
        if (state.count > ce.iterationLimit)
          throw new CancellationError({ cause: 'iteration-limit-exceeded' });
        continue;
      }
    }
    yield* runNested(body, elements, index + 1, ce, state, onLeaf);
    if (state.stopped) return;
  }
}
