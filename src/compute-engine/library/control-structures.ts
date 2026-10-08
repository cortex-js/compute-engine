import { BoxedType } from '../../common/type/boxed-type.js';
import {
  enterNestedBodyScopes,
  evaluateStatements,
  evaluateStatementsAsync,
  exitNestedBodyScopes,
  resolveEscapingLambda,
} from '../function-utils.js';
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
} from '../collection-utils.js';
import { parseType } from '../../common/type/parse.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
  isValidType,
} from '../../common/type/primitive.js';
import { reduceType } from '../../common/type/reduce.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  CancellationError,
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
} from '../global-types.js';
import { errorValue } from '../boxed-expression/error-value.js';
import { describeBoundSymbol } from '../boxed-expression/operand-descriptor.js';
import {
  isFunction,
  isNumber,
  isSymbol,
  isString,
  sym,
} from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/utils.js';
import { widenAssignedType } from '../boxed-expression/boxed-value-definition.js';
import {
  elementMemoFillTo,
  ELEMENT_MEMO_CAP,
} from '../boxed-expression/collection-element-memo.js';
import { evaluateMatch } from '../boxed-expression/match-dispatch.js';
import {
  assignLoopIndex,
  bindIndexAuthoritatively,
  substituteBinderValues,
} from './utils.js';
import { journalCheckpointMapEntry } from '../checkpoint-journal.js';
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
 * True when the branch of a conditional is a bare symbol whose type is not
 * known (an untyped parameter `s`). Such a branch makes the result of the
 * conditional `unknown`: `widen` drops `unknown` from a join, so
 * `If(n = 0, s, [1, 2])` claimed `vector<integer^2>` while `f(0, 5)` with
 * `f(n, s) = s if n == 0 else f(n - 1, [1, 2])` is `5`.
 *
 * Only a SYMBOL counts. An application typed `unknown` keeps the join of the
 * other branches, for two reasons. A `Return` branch yields no value in
 * place (it leaves the enclosing function), so `If(c, Return(1), 2)` is an
 * `integer` where it is read. And a recursive call `f(n - 1)` reads the
 * signature of `f` while that signature is derived, where its result is the
 * placeholder `unknown`: the join of the other branches is the seed of the
 * fixpoint, and `f(n) = If(n = 0, 1, f(n - 1))` is typed `integer` through
 * it. A symbol's `unknown` is not a placeholder: nothing refines it later
 * at this site.
 */
function untypedSymbolArm(branch: OperandDescriptor): boolean {
  return branch.type === 'unknown' && branch.structureOf?.()?.kind === 'symbol';
}

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
      description: 'Conditional branch: evaluate one of two expressions.',
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
        // A condition that is provably a boolean indexed collection selects
        // element-wise (see `evaluateElementwiseSelection`): the result is a
        // list of the branches' element types.
        const shape = elementwiseConditionShape([cond?.type]);
        const armList = [ifTrue, ifFalse]
          .filter((x) => x !== undefined)
          .map((x) => x.type);
        if (shape)
          return BoxedType.forResult(
            elementwiseResultType(
              armList,
              shape.length,
              // The else branch IS the default clause: without one, unselected
              // positions are the `NaN` no-match cell.
              ifFalse !== undefined
            ),
            context.engine._typeResolver
          );
        // A condition that is only POSSIBLY a boolean collection selects
        // element-wise for some of its runtime values and picks a single arm
        // for the others, so the honest result is `broadcastable` of the
        // element-wise cell type. Without an else branch the scalar outcome is
        // `Missing`, which `broadcastable` does not cover, so keep that arm.
        if (possiblyElementwiseCondition([cond?.type])) {
          const broadcast: Type = {
            kind: 'broadcastable',
            elements: elementwiseCellType(armList, ifFalse !== undefined),
          };
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
        if (ifFalse === undefined)
          return BoxedType.forResult(
            reduceType({
              kind: 'union',
              types: [ifTrue.type, 'missing'],
            }),
            context.engine._typeResolver
          );
        if (untypedSymbolArm(ifTrue) || untypedSymbolArm(ifFalse))
          return BoxedType.forResult('unknown', context.engine._typeResolver);
        return BoxedType.forResult(
          widen(ifTrue.type, ifFalse.type),
          context.engine._typeResolver
        );
      },
      canonical: (ops, { engine }) =>
        engine._fn(
          'If',
          // The condition (op 0) is an ordinary expression, checked for a
          // provably non-boolean type (`conditionOperand`); the then/else
          // branches (ops 1+) are statement positions, so reject a bare
          // `Break`/`Continue` symbol there.
          ops.map((op, i) =>
            i === 0
              ? conditionOperand(engine, op.canonical)
              : canonicalStatement(engine, op)
          )
        ),
      evaluate: (ops, options) => evaluateIf(ops, options),
      evaluateAsync: (ops, options) => evaluateIfAsync(ops, options),
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
        { engine: ce, signal, effects, expression, _contextStack }
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
              _contextStack
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
        const c = cond.evaluate();

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
      description: 'Return the value for the first condition that is true.',
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
        // A condition that is provably a boolean indexed collection selects
        // element-wise (see `evaluateElementwiseSelection`): the result is a
        // list of the arms' element types.
        const shape = elementwiseConditionShape(conds.map((c) => c?.type));
        if (shape)
          return BoxedType.forResult(
            elementwiseResultType(
              arms.map((x) => x.type),
              shape.length,
              // A literal `True` condition is the default clause: it matches
              // every position, so the `NaN` no-match cell is unreachable.
              dflt >= 0
            ),
            context.engine._typeResolver
          );
        // A condition that is only POSSIBLY a boolean collection selects
        // element-wise for some of its runtime values and picks a single arm
        // for the others: `broadcastable` of the element-wise cell type is the
        // type that covers both.
        // Without a literal-`True` default clause no arm may be selected and
        // the value is `Missing` — keep that arm in the type, as the
        // else-less `If` does, and outside `widen` (which joins toward a
        // common supertype and would dissolve the absence marker). The
        // possibly-element-wise branch carries the arm too: such a condition
        // may resolve to a scalar `False` at runtime, and the `Which` then
        // answers the scalar `Missing`.
        if (possiblyElementwiseCondition(conds.map((c) => c?.type))) {
          const broadcast: Type = {
            kind: 'broadcastable',
            elements: elementwiseCellType(
              arms.map((x) => x.type),
              dflt >= 0
            ),
          };
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
        const armType = arms.some(untypedSymbolArm)
          ? 'unknown'
          : widen(...arms.map((x) => x.type));
        if (dflt >= 0)
          return BoxedType.forResult(armType, context.engine._typeResolver);
        return BoxedType.forResult(
          reduceType({ kind: 'union', types: [armType, 'missing'] }),
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
      description: 'Iterate a function until a fixed point is reached.',
      lazy: true,
      signature: '(any) -> unknown',
    },
  },
];

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
 * The relational heads whose operands a branch condition compares. A `NaN`
 * operand of one of these is UNDECIDED evidence for the branch: IEEE 754
 * answers `False` to every ordered comparison with NaN and `True` to
 * `NotEqual`, and neither answer says anything about which arm applies.
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
 * Two shapes carry the flag:
 * - a scalar `True`/`False` that rests on a NaN operand;
 * - the absent marker `Missing` that a whole-collection comparison answers
 *   when its element recursion meets a pair with no answer (user ruling of
 *   2026-09-21). That marker reports an undecided comparison, not absent
 *   condition DATA, which is why it takes no arm instead of raising the
 *   absent-condition error a `Missing` condition otherwise raises. The
 *   marker survives `Not` and the connectives through their ordinary Kleene
 *   evaluation, so the flag has to survive them too.
 */
type EvaluatedCondition = { value: Expression; undecided: boolean };

/**
 * Evaluate the condition of an `If`/`Which` for branch selection.
 *
 * A comparison with NaN carries no evidence for either arm, so a condition
 * decided by a NaN operand selects none (ruled 2026-09-03; the compiled
 * lanes answer their numeric absence marker there,
 * `BaseCompiler.conditionDecidability`). The comparison itself keeps its
 * IEEE value everywhere else — `Greater(NaN, 0)` still evaluates to
 * `False` — only the branch selection changes, which is why the NaN
 * evidence is read where it still exists, on the relation's OPERANDS, and
 * reported beside the value rather than in place of it.
 *
 * The walk reproduces the ordinary evaluation of the condition and adds
 * nothing but the flag:
 * - A relation evaluates its operands left to right and then itself over
 *   the values; an error in an operand propagates through the relation as
 *   it always did, and a collection-shaped operand gives the element-wise
 *   list the relation always gave (a NaN CELL then takes the else cell on
 *   both lanes, measured 2026-09-03 — `evaluateElementwiseSelection` owns
 *   that contract). Only a scalar `True`/`False` over a NaN operand is
 *   flagged.
 * - `And`/`Or` keep their short-circuit contract (`evaluateShortCircuit`,
 *   `library/logic.ts`): operands are evaluated left to right and the walk
 *   stops at the first decider (`False` for `And`, `True` for `Or`) or the
 *   first error, so an operand a decided one guards is never evaluated. A
 *   decider that itself rests on NaN does not stop the walk: it decides
 *   nothing. The survivors are then combined three-valued, as the compiled
 *   lowering does: a decided `False` decides an `And` whatever its siblings
 *   are, a decided `True` decides an `Or`; all-decided survivors fold with a
 *   flag if any of them rested on NaN; a survivor that is still symbolic (a
 *   relation with a free variable) keeps the whole connective inert, spelled
 *   with the ORIGINAL sub-conditions so that a later binding can still
 *   decide it and the NaN evidence is not folded away; a collection-shaped
 *   survivor hands the connective to its ordinary element-wise evaluation.
 *   `Nand`, `Nor` and `Implies` are the same walk through their `And`/`Or`
 *   spelling, `Not` flips its operand and keeps the flag.
 * - Anything else evaluates as before, unflagged. `Xor` and the remaining
 *   heads are not three-valued here: a NaN evidence under them is lost as
 *   it was before the ruling.
 */
function evaluateCondition(cond: Expression): EvaluatedCondition {
  const c = cond.canonical;
  const ce = c.engine;
  if (!isFunction(c)) return { value: c.evaluate(), undecided: false };
  const op = c.operator;

  if (BRANCH_RELATIONS.has(op)) {
    const ops: Expression[] = [];
    for (const x of c.ops) {
      const v = x.evaluate();
      ops.push(v);
      // An error operand decides the relation (it propagates); the
      // remaining operands are not demanded.
      if (errorValue(v) !== undefined) break;
    }
    const value = ce.function(op, ops).evaluate();
    const s = sym(value);
    const decided = s === 'True' || s === 'False';
    // A whole-collection comparison (two or more collection operands) answers
    // the absent marker `Missing` when its element recursion meets a pair
    // with no answer — an absent cell on either side (user ruling of
    // 2026-09-21, `library/relational-operator.ts`). That marker reports an
    // UNDECIDED comparison, not absent condition DATA, so the branch takes no
    // arm, the same way a comparison resting on a NaN operand takes none. A
    // scalar `Missing` condition keeps its own answer, the catchable
    // absent-condition error: there the condition itself is the absent datum.
    const absentCollectionPair =
      s === 'Missing' && ops.filter((x) => x.isCollection).length >= 2;
    return {
      value,
      undecided:
        (decided && ops.some((x) => x.isNaN === true)) || absentCollectionPair,
    };
  }

  if (op === 'And' || op === 'Or') return evaluateConnective(c, op, c.ops);
  if (op === 'Nand' && c.nops >= 1)
    return negateCondition(evaluateConnective(c, 'And', c.ops));
  if (op === 'Nor' && c.nops >= 1)
    return negateCondition(evaluateConnective(c, 'Or', c.ops));
  if (op === 'Implies' && c.nops === 2)
    return evaluateConnective(c, 'Or', [ce.function('Not', [c.op1]), c.op2]);
  if (op === 'Not' && c.nops === 1)
    return negateCondition(evaluateCondition(c.op1));

  return { value: c.evaluate(), undecided: false };
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
 * spelling.
 */
function evaluateConnective(
  node: Expression,
  op: 'And' | 'Or',
  ops: ReadonlyArray<Expression>
): EvaluatedCondition {
  const ce = node.engine;
  const decider = op === 'And' ? 'False' : 'True';
  const survivors: { original: Expression; result: EvaluatedCondition }[] = [];
  for (const x of ops) {
    const r = evaluateCondition(x);
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
        .evaluate(),
      undecided: false,
    };
  // A symbolic survivor keeps the connective inert, spelled with the
  // original sub-conditions (a NaN-decided survivor folded to its IEEE
  // value would decide the connective the wrong way).
  // A survivor that is already FLAGGED is not symbolic: its value is the
  // absent marker `Missing` of an undecided whole-collection comparison,
  // which the connective folds by the ordinary Kleene table (`And(Missing,
  // True)` is `Missing`). Treating it as symbolic left the whole `Which`
  // inert where the compiled lane took no arm.
  const symbolic = survivors.some((s) => {
    const v = sym(s.result.value);
    return v !== 'True' && v !== 'False' && !s.result.undecided;
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
  // Every survivor is the non-deciding value (`True` for `And`, `False`
  // for `Or`), or a NaN-decided value: the connective folds to the
  // non-deciding value, flagged if any survivor rested on NaN.
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
 * The materialized cells of a condition that activates the ELEMENT-WISE
 * selection path, or `undefined` when it does not.
 *
 * The gate (§3 of `docs/BROADCAST-MODEL.md`) is
 * deliberately narrow: an indexed collection (never a `Set`, never a tuple —
 * tuples are points, not lists) of statically known finite length whose cells
 * are ALL condition values (`True`/`False`/`Missing`). A collection with a
 * symbolic or non-boolean cell, or one whose length is not yet known, does not
 * activate it — the conditional then keeps its existing behavior (inert, or
 * the spell-check throw), so every symbolic `Which` PRODUCER (Solve validity
 * guards, the conditional-value adopters) keeps round-tripping unreduced.
 */
function conditionCells(c: Expression): Expression[] | undefined {
  if (!isBroadcastableCollection(c)) return undefined;
  if (!isWalkableFiniteCollection(c)) return undefined;
  const n = c.count;
  if (n === undefined || !Number.isFinite(n)) return undefined;
  const cells = Array.from(c.each()) as Expression[];
  for (const cell of cells) {
    const s = sym(cell);
    if (s !== 'True' && s !== 'False' && s !== 'Missing') return undefined;
  }
  return cells;
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
 * `NaN` (R4); a position whose condition cell is `Missing` is the same
 * catchable "condition is absent" error the scalar form produces (R4′).
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
  first: { cond: Expression; cells: Expression[] },
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression | undefined {
  // 1/ Evaluate the conditions in clause order and materialize the
  // list-valued ones. Clauses after a lifted `True` are unreachable: their
  // conditions are not evaluated at all.
  const participants: Expression[] = [];
  // The cells of each retained clause's condition, `undefined` for a lifted
  // scalar `True`, or `'Missing'` for a lifted scalar absent condition (an
  // all-`Missing` condition row).
  const selectors: (Expression[] | 'Missing' | undefined)[] = [];
  const arms: Expression[] = [];
  for (let k = 0; k < clauses.length; k++) {
    const { cond, arm } = clauses[k];
    if (arm === undefined) return undefined;
    // The first clause's condition was evaluated and materialized by the
    // caller (it is what activated the gate): never drain it twice.
    const c = k === 0 ? first.cond : cond.canonical.evaluate();
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
      selectors.push(undefined);
      arms.push(arm);
      break;
    }
    const cells = k === 0 ? first.cells : conditionCells(c);
    if (cells === undefined) {
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
    selectors.push(cells);
    arms.push(arm);
  }

  const mismatch = broadcastLengthMismatch(ce, participants);
  if (mismatch) return mismatch;

  // The first clause's condition is the collection that activated the gate, so
  // it always contributes the result length.
  const n = first.cells.length;

  // 2/ Compute the selection: the index of the first clause that is `True` at
  // each position (`-1`: no match), and the positions whose condition is
  // absent.
  const selection = new Int32Array(n).fill(-1);
  const absent = new Uint8Array(n);
  let undecided = n;
  for (let k = 0; k < selectors.length && undecided > 0; k++) {
    const cells = selectors[k];
    for (let j = 0; j < n; j++) {
      if (selection[j] >= 0 || absent[j] === 1) continue;
      const s =
        cells === undefined
          ? 'True'
          : cells === 'Missing'
            ? 'Missing'
            : sym(cells[j]);
      if (s === 'True') {
        selection[j] = k;
        undecided -= 1;
      } else if (s === 'Missing') {
        absent[j] = 1;
        undecided -= 1;
      }
    }
  }

  // 3/ Evaluate each REACHED arm once, as a whole expression (R2).
  const reached = new Set<number>();
  for (let j = 0; j < n; j++) if (selection[j] >= 0) reached.add(selection[j]);
  const values: (Expression | Expression[])[] = [];
  for (let k = 0; k < arms.length; k++) {
    if (!reached.has(k)) continue;
    const value = arms[k].canonical.evaluate(options);
    if (!isBroadcastableCollection(value)) {
      values[k] = value;
      continue;
    }
    // A list-valued arm is a participant too: check its length before
    // materializing it, so an unbounded arm errors rather than hanging.
    const armMismatch = broadcastLengthMismatch(ce, [...participants, value]);
    if (armMismatch) return armMismatch;
    if (!isWalkableFiniteCollection(value)) return undefined;
    const cells = Array.from(value.each()) as Expression[];
    // The arm's length may only have become known by materializing it (a
    // `Filter` reports `count === undefined`): re-check through the shared
    // predicate so the diagnostic cannot drift.
    const sizeMismatch = broadcastLengthMismatch(ce, [
      ...participants,
      ce._fn('List', cells),
    ]);
    if (sizeMismatch) return sizeMismatch;
    values[k] = cells;
  }

  // 4/ Assemble the result, position by position.
  const result: Expression[] = [];
  for (let j = 0; j < n; j++) {
    if (absent[j] === 1) result.push(absentConditionError(ce));
    else if (selection[j] < 0) result.push(ce.NaN);
    else {
      const value = values[selection[j]];
      result.push(Array.isArray(value) ? value[j] : value);
    }
  }
  return ce._fn('List', result);
}

/**
 * The shape of an element-wise conditional, from the TYPES of its conditions:
 * `undefined` when no condition is provably a boolean indexed collection (the
 * scalar typing applies), otherwise the common declared length when the
 * boolean-collection conditions agree on one.
 *
 * Both spellings must be recognized: a literal condition types
 * `list<boolean^n>`, a declared or derived one `indexed_collection<boolean>`,
 * and those two do not match each other — `indexed_collection<boolean>` is the
 * supertype both are checked against.
 */
function elementwiseConditionShape(
  conds: ReadonlyArray<Type | undefined>
): { length?: number } | undefined {
  let found = false;
  let length: number | undefined;
  for (const t of conds) {
    if (t === undefined || !isSubtype(t, BOOLEAN_COLLECTION_TYPE)) continue;
    // A tuple is a subtype of `indexed_collection`, but runtime lifts tuples
    // whole (tuple-atomic): a tuple-typed condition never activates the
    // element-wise path, so it must not flip the static shape either.
    if (typeof t !== 'string' && t.kind === 'tuple') continue;
    found = true;
    if (typeof t === 'string' || t.kind !== 'list') continue;
    if (t.dimensions?.length !== 1) continue;
    if (length === undefined) length = t.dimensions[0];
    else if (length !== t.dimensions[0]) return { length: undefined };
  }
  return found ? { length } : undefined;
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
  if (t.kind === 'list' || t.kind === 'indexed_collection')
    return broadcastElementType(t);
  return t as Type;
}

/**
 * The type of ONE CELL of an element-wise selection: the join of the arms'
 * element types (a list-valued arm contributes its ELEMENT type, since it is
 * indexed position-wise; a scalar arm contributes its own type, since it
 * lifts).
 *
 * `hasDefault` — a clause whose condition is literally `True` (for `If`, an
 * else branch) — decides whether the no-match cell can occur. Without one, a
 * position no clause matches is `NaN` (R4), and `finite_*` types EXCLUDE NaN
 * under the non-finite typing convention: the element type must therefore
 * join in `number`, the narrowest type that admits NaN, or a consumer
 * dispatching on `.type.matches()` would be promised a `integer` cell
 * and handed a `NaN`. WITH a default clause the no-match cell is unreachable
 * and the exact join is kept — widening unconditionally would hand every
 * element-wise conditional an over-wide union, which breaks that same
 * dispatch.
 */
function elementwiseCellType(
  arms: ReadonlyArray<Type>,
  hasDefault: boolean
): Type {
  const armTypes = arms.map((t) => armElementType(t));
  return hasDefault ? widen(...armTypes) : widen(...armTypes, 'number');
}

/**
 * True when a condition is only POSSIBLY a boolean collection: its type is
 * `broadcastable<boolean>`, the union `boolean | indexed_collection<boolean>`
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
 * The `kind` test is load-bearing. `matches('broadcastable<boolean>')` would
 * also accept a plain scalar `boolean` condition, since a scalar is a member
 * of the union that `broadcastable<T>` abbreviates.
 */
function possiblyElementwiseCondition(
  conds: ReadonlyArray<Type | undefined>
): boolean {
  return conds.some((t) => {
    return (
      t !== undefined &&
      typeof t !== 'string' &&
      t.kind === 'broadcastable' &&
      isSubtype(t.elements, CONDITION_CELL_TYPE)
    );
  });
}

/**
 * The type of an element-wise selection: a list of `elementwiseCellType`, given
 * the statically known length of the condition (`undefined` when the length is
 * not provable, which yields an unbounded `list`).
 */
function elementwiseResultType(
  arms: ReadonlyArray<Type>,
  length: number | undefined,
  hasDefault: boolean
): Type {
  const elements = elementwiseCellType(arms, hasDefault);
  // The union-free clause (tensor-unification design §D3 rule 2): a
  // dimensioned `list` type IS the tensor claim (`isTensor` is exactly
  // `dimensions !== undefined`), and a heterogeneous cell population never
  // qualifies — the `List` shape analysis (`shapedListTypeD`,
  // `collections.ts`) declines the shape for it. Claiming a
  // dimension here for a union element type would promise a shape no
  // evaluated value can ever carry, breaking the value-vs-declared
  // assignability invariant (`evaluated.type.matches(declared)`) for the
  // no-default mixed case, whose no-match cell joins in `number`.
  const shaped =
    length !== undefined &&
    (typeof elements === 'string' || elements.kind !== 'union');
  return shaped
    ? { kind: 'list', elements, dimensions: [length!] }
    : { kind: 'list', elements };
}

/** Evaluate an `If` expression. */
function evaluateIf(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression | undefined {
  const [cond, ifTrue, ifFalse] = ops;
  const engine = options.engine;
  const { value: evaluated, undecided } = evaluateCondition(cond);
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
  // A condition decided by a NaN operand (`evaluateCondition`) selects
  // no arm: the value is `Missing`, the position-preserving absent
  // datum that an else-less `If` and a `Which` with no selected clause
  // already answer (no-selection ruling 2026-08-27). The compiled
  // lanes answer their numeric spelling of the same marker, `NaN`.
  // Unlike a free-variable condition this can never resolve, so the
  // node is not held inert; unlike an absent condition it is not a
  // program defect, so it is not an error.
  if (undecided) return engine.Missing;
  const evaluatedCond = sym(evaluated);
  if (evaluatedCond === 'True') return ifTrue?.evaluate() ?? engine.Missing;
  if (evaluatedCond === 'False') return ifFalse?.evaluate() ?? engine.Missing;
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
  // unselected positions are the no-match cell (`NaN`), not `Nothing`:
  // an element-wise result preserves positions (R4).
  const cells = conditionCells(evaluated);
  if (cells !== undefined && ifTrue !== undefined) {
    const clauses = [{ cond, arm: ifTrue }];
    if (ifFalse !== undefined)
      clauses.push({ cond: engine.True, arm: ifFalse });
    return evaluateElementwiseSelection(
      engine,
      clauses,
      { cond: evaluated, cells },
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
          options._contextStack
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
          options._contextStack
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
    const { value: evaluated, undecided } = evaluateCondition(args[i]);
    // A guard `Which` reaches is DEMANDED, so an error in it propagates —
    // the same obligation `If` discharges for its condition (see the comment
    // there): a lazy operator owns propagation for what it demands, and an
    // error left to reach the typo throw below would escape as a host
    // exception rather than as a value.
    const condError = errorValue(evaluated);
    if (condError !== undefined) return condError;
    // A guard decided by a NaN operand (`evaluateCondition`) selects no
    // clause, and falling through to a later clause would decide what the
    // NaN left undecided: the whole `Which` answers `Missing`, its
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
      const cells = conditionCells(evaluated);
      if (cells !== undefined) {
        const clauses: { cond: Expression; arm: Expression }[] = [];
        for (let k = i; k < args.length - 1; k += 2)
          clauses.push({ cond: args[k], arm: args[k + 1] });
        const result = evaluateElementwiseSelection(
          options.engine,
          clauses,
          { cond: evaluated, cells },
          options
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
 * Remove the canonicalization-time bookkeeping from the block scope that is
 * the current lexical scope — see the comment in `evaluateBlock`, which is
 * the reason this sweep exists. Shared by the synchronous and asynchronous
 * block evaluators.
 */
function sweepCanonicalizationBindings(ce: ComputeEngine): void {
  const scope = ce.context.lexicalScope;
  for (const [name, def] of [...scope.bindings]) {
    if (
      'value' in def &&
      def.value.value === undefined &&
      (def as { _declaredByStatement?: boolean })._declaredByStatement !== true
    ) {
      // Checkpoint journal (funnel 4): the block-exit sweep removes bindings
      // by direct map surgery.
      journalCheckpointMapEntry(ce, scope.bindings, name, name, 'declare');
      scope.bindings.delete(name);
    }
  }
}

/** Evaluate a Block expression. */
function evaluateBlock(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: Partial<EvaluateOptions> & { engine: ComputeEngine }
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
  // the marker and are still kept — reset by `Declare`'s statement-redeclare
  // path, not here.
  sweepCanonicalizationBindings(ce);

  // If the block's final value is a bare symbol bound to a user-defined
  // function literal (`helper(x) = …` → a block-local operator definition),
  // return the underlying `Function` literal so the function escapes the
  // block as a first-class value. Resolved here, while the block scope (which
  // holds the operator definition) is still the current lexical scope.
  return resolveEscapingLambda(ce, evaluateStatements(ce, ops));
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
  const result = await evaluateStatementsAsync(
    ce,
    ops,
    options.signal,
    options._effects,
    options._contextStack
  );
  // `resolveEscapingLambda` reads the block scope as the current lexical
  // scope. It runs after an `await`, so the context stack of this evaluation
  // (which holds the block scope) must be put in place explicitly.
  return options._effects === undefined
    ? resolveEscapingLambda(ce, result)
    : runWithEvaluationEffects(
        ce,
        options._effects,
        () => resolveEscapingLambda(ce, result),
        options._contextStack
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
 * to hoist the static type of a `let` with a literal initial value.
 */
function closedLiteralType(
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
  const declaredNames: string[] = [];
  // The statically-readable declared type of each `Declare(name, "type")`
  // statement, keyed by name. The hoisted binding (below) carries this type
  // from the CANONICAL pass on: `Declare` only registers its type at
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
  for (const op of ops) {
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
    for (const op of ops) {
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
        refused.set(op, ce.error(['variable-redeclaration', collision]));
      else for (const name of names) accepted.add(name);
    }
  }
  const hoistedNames = declaredNames.filter((name) => accepted.has(name));

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
  if (scope) {
    for (const name of hoistedNames) {
      if (name !== 'Nothing' && !scope.bindings.has(name)) {
        const hoisted = ce._declareSymbolValue(
          name,
          { type: declaredTypes.get(name) ?? 'unknown', inferred: true },
          scope
        );
        // A block local, not a free symbol: see `_blockLocal`.
        if (isValueDef(hoisted)) {
          hoisted.value._blockLocal = true;
          if (explicitlyDeclared.has(name)) markDeclaredLocal(hoisted.value);
        }
      }
    }
    for (const op of ops) {
      if (!isFunction(op, 'Assign')) continue;
      const target = op.ops[0];
      // A destructuring assignment `(x, y) := v` binds one local per pattern
      // leaf (nested patterns included, `_` positions bind nothing), on the
      // same rule as a plain symbol target: each leaf that is not visible in
      // the scope chain is a block-local. Without this the leaves were never
      // hoisted, so a read of one on a route that never evaluates — a
      // compile — saw no binding at all, and the `Assign` canonical handler
      // had no binding to record the leaf's type on.
      const names = isFunction(target, 'Tuple')
        ? tuplePatternNames(target)
        : [sym(target)];
      for (const name of names) {
        if (!name || name === 'Nothing') continue;
        if (scope.bindings.has(name) || ce.lookupDefinition(name)) continue;
        const hoisted = ce._declareSymbolValue(
          name,
          { type: 'unknown', inferred: true },
          scope
        );
        // A block local introduced by assignment: see `_blockLocal`.
        if (isValueDef(hoisted)) hoisted.value._blockLocal = true;
      }
    }
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
    for (const op of ops) {
      if (!isFunction(op, 'DefineFunction')) continue;
      const name = sym(op.ops[0]);
      if (!name || name === 'Nothing') continue;
      if (scope.bindings.has(name)) continue;
      if (ce._typeRegistry[name]?.def !== undefined) continue;
      ce._declareSymbolValue(name, { type: 'function', inferred: true }, scope);
    }
  }

  ce._pushShadowedParameters(hoistedNames);
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
        ops.map((op) => refused.get(op) ?? canonicalStatement(ce, op))
      )
    );
  } finally {
    ce._popShadowedParameters();
  }

  return ce._fn('Block', statements, { scope });
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
    const t = context.derive(head, derived);
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
            ? { kind: 'application', head, children: derived }
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
    if (r.done) return;
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
      // error value `let (p, q) = v` produces; it stops the loop and becomes
      // its value, matching how `evaluateStatements` treats a fault.
      const pairs: [name: string, value: Expression][] = [];
      const err = collectTuplePattern(pattern, value.evaluate(), pairs);
      if (err) {
        state.stopped = true;
        state.value = err;
        yield err;
        return;
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
