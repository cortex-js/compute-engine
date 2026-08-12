import {
  evaluateStatements,
  resolveEscapingLambda,
} from '../function-utils.js';
import { checkConditions } from '../boxed-expression/rules.js';
import { indexingSetSites } from '../boxed-expression/binding-sites.js';
import {
  broadcastElementType,
  collectionElementType,
  resolveTypeForCompilation,
  widen,
} from '../../common/type/utils.js';
import {
  MAX_SIZE_EAGER_COLLECTION,
  broadcastLengthMismatch,
  isBroadcastableCollection,
  isFiniteIndexedCollection,
  isTuple,
} from '../collection-utils.js';
import { parseType } from '../../common/type/parse.js';
import { reduceType } from '../../common/type/reduce.js';
import type { Type } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  CancellationError,
  run,
  runAsync,
} from '../../common/interruptible.js';
import type {
  Expression,
  SymbolDefinitions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  CollectionHandlers,
  BoxedValueDefinition,
} from '../global-types.js';
import { spellCheckMessage } from '../boxed-expression/validate.js';
import {
  isFunction,
  isSymbol,
  isAbsentValue,
  sym,
} from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/utils.js';
import {
  elementMemoFillTo,
  ELEMENT_MEMO_CAP,
} from '../boxed-expression/collection-element-memo.js';
import { evaluateMatch } from '../boxed-expression/match-dispatch.js';
import { assignLoopIndex } from './utils.js';

export const CONTROL_STRUCTURES_LIBRARY: SymbolDefinitions[] = [
  {
    Block: {
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
        '`docs/architecture/actions-and-randomness.md` for the canonical recipe.',
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
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return args[args.length - 1].type;
      },
      canonical: canonicalBlock,
      evaluate: evaluateBlock,
    },

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
      signature: '(expression, expression, expression?) -> any',
      // A SELECTOR: the condition is tested and one branch is evaluated and
      // RETURNED — no position ever applies a function-valued operand. So
      // `If(c, randomF, pureF)` has no `random`: the draw fires at whatever
      // invokes the selected result. The branches are held may-evaluate
      // positions, so their own (production) effects still contribute
      // unchanged — `If(c, Random(), 0)` is still `{random}`.
      invokes: false,
      // The else branch is optional: `If(cond, expr)` evaluates to `Nothing`
      // when the condition is false.
      type: ([cond, ifTrue, ifFalse]) => {
        // A condition that is provably a boolean indexed collection selects
        // element-wise (see `evaluateElementwiseSelection`): the result is a
        // list of the branches' element types.
        const shape = elementwiseConditionShape([cond]);
        if (shape)
          return elementwiseResultType(
            [ifTrue, ifFalse].filter((x) => x !== undefined),
            shape.length,
            // The else branch IS the default clause: without one, unselected
            // positions are the `NaN` no-match cell.
            ifFalse !== undefined
          );
        // Without an else branch a false condition yields `Nothing`, and the
        // `Nothing` arm must survive in the type: `widen` treats `nothing` as
        // a join identity and would swallow it, so build the union explicitly.
        if (ifFalse === undefined)
          return reduceType({
            kind: 'union',
            types: [ifTrue.type.type, 'nothing'],
          });
        return widen(ifTrue.type.type, ifFalse.type.type);
      },
      canonical: (ops, { engine }) =>
        engine._fn(
          'If',
          // The condition (op 0) is an ordinary expression; the then/else
          // branches (ops 1+) are statement positions, so reject a bare
          // `Break`/`Continue` symbol there.
          ops.map((op, i) =>
            i === 0 ? op.canonical : canonicalStatement(engine, op)
          )
        ),
      evaluate: ([cond, ifTrue, ifFalse], options) => {
        const engine = options.engine;
        const evaluated = cond.canonical.evaluate();
        const evaluatedCond = sym(evaluated);
        if (evaluatedCond === 'True')
          return ifTrue?.evaluate() ?? engine.Nothing;
        if (evaluatedCond === 'False')
          return ifFalse?.evaluate() ?? engine.Nothing;
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
        // An UNDECIDED boolean condition — e.g. a relation with free
        // variables (`x = 4` stays symbolic under evaluate()) — leaves the
        // `If` unevaluated rather than erroring: it may become decidable
        // once the variables are bound. The throw below is reserved for
        // conditions that are not boolean at all (a number, a misspelled
        // symbol), where the spell-check hint is the useful outcome.
        if (isBooleanishCondition(evaluated)) return undefined;
        throw new Error(
          `Condition must evaluate to "True" or "False". ${spellCheckMessage(
            cond
          )}`
        );
      },
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
      type: ([body]) => {
        if (!body) return 'nothing';
        // A `Loop` is evaluated for effect: its value is `Nothing` unless the
        // body can short-circuit with a value (`Break v` / `Return`).
        return loopBodyYieldsValue(body) ? 'unknown' : 'nothing';
      },
      canonical: (ops, options) => canonicalLoopLike('Loop', ops, options),
      evaluate: (ops, { engine: ce }) =>
        run(
          runLoop(ops[0], ops.slice(1), ce),
          ce._timeRemaining,
          ce._deadlineFrame
        ),
      evaluateAsync: async (ops, { engine: ce, signal }) =>
        runAsync(
          runLoop(ops[0], ops.slice(1), ce),
          ce._timeRemaining,
          signal,
          ce._deadlineFrame
        ),
    },

    Comprehension: {
      description:
        'Value-producing comprehension: evaluate `body` in nested iteration ' +
        'over one or more `Element` clauses and collect the results into an ' +
        'indexed collection (a `List`). Later clauses see earlier bindings; ' +
        'independent clauses produce a Cartesian product.',
      lazy: true,
      // See `Loop`: each `Element` clause's index is a bound variable of this
      // node.
      scoped: indexingSetSites(1),
      signature:
        '(body:expression, iterators:expression+) -> indexed_collection',
      type: ([body]) => {
        if (!body) return 'nothing';
        // Result is an indexed collection of body.type values. The body's
        // type may itself be parametric (e.g. a tuple) — wrap in
        // indexed_collection<...>.
        return { kind: 'indexed_collection', elements: body.type.type };
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
        '  - `Undefined` when `cond` evaluates to `False` (the "masking rule"; consumers like 2D plotters skip masked points)\n' +
        '  - `When(e, cond_simplified)` when `cond` is indeterminate (holds)\n' +
        'Stacked restrictions canonicalize: `When(When(e, c1), c2)` → `When(e, And(c1, c2))`.\n' +
        'Compiles to ternary `(cond) ? (e) : NaN` in JS and GLSL.',
      lazy: true,
      signature: '(expression, boolean) -> any',
      type: ([expr, cond]) => {
        // A list/vector-of-booleans condition broadcasts: the result is a
        // list whose element type is `expr`'s type (see the broadcast branch
        // in `evaluate`). Lazy operators bypass the generic list-broadcast
        // typing wrapper, so lift the type here explicitly — but only when the
        // condition's *declared* type is a list/vector of booleans. A scalar
        // or unknown boolean condition keeps `expr`'s type.
        if (cond?.type.matches(parseType('list<boolean>')))
          return `list<${typeToString(expr.type.type)}>`;
        return expr.type;
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
          // `And` is commutative, so its canonical form flattens, folds and
          // ORDERS its operands. Skipping that left the conjunction in
          // authored order while `.json` (which goes through `structural`)
          // sorts — so `x{a}{b}` and `x{b}{a}` serialized to identical
          // MathJSON while `isSame`/`hash` disagreed, and `ce.box(e.json)`
          // was not `isSame` to `e` (Tycho item-153 seed, the 11
          // `differs-json-equal` rows).
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
        if (c.isCollection && c.isFiniteCollection) {
          const conds = Array.from(c.each()) as Expression[];
          if (
            conds.length > 0 &&
            conds.every((ci) => ci.type.matches('boolean'))
          ) {
            // If `expr` itself evaluates to a finite indexed collection, zip
            // elementwise (expr_i masked by c_i); otherwise mask the scalar
            // `expr` by each c_i. Different lengths truncate to the shorter,
            // matching `At`'s mask alignment.
            const ev = expr.evaluate(options);
            const zip = ev.isCollection && ev.isFiniteCollection;
            const elems = zip ? (Array.from(ev.each()) as Expression[]) : [];
            const n = zip ? Math.min(conds.length, elems.length) : conds.length;
            const result: Expression[] = [];
            for (let i = 0; i < n; i++) {
              const ci = conds[i];
              const cis = sym(ci);
              // The per-element expression: the zipped element, or the scalar.
              const elem = zip ? elems[i] : ev;
              if (cis === 'True') result.push(elem);
              else if (cis === 'False') result.push(ce.symbol('Undefined'));
              // Indeterminate (symbolic boolean): hold `When` on the element.
              else result.push(ce._fn('When', [zip ? elems[i] : expr, ci]));
            }
            return ce._fn('List', result);
          }
        }

        const cs = sym(c);
        if (cs === 'True') return expr.evaluate(options);
        if (cs === 'False') return ce.symbol('Undefined');
        // A guard that evaluates to `Undefined` masks (decision 9): no value,
        // treated as not-True rather than held.
        if (cs === 'Undefined') return ce.symbol('Undefined');

        // Indeterminate scalar condition over a collection value: the
        // restriction distributes elementwise (Tycho item 66), so that
        // `When(L, c)` behaves as `[When(L1, c), …, When(Ln, c)]` — the same
        // shape the list-condition branch above produces. Without this a
        // restricted list reported `isCollection === false` while its `.type`
        // already said `list<…>`. HYBRID-lazy, mirroring `PointList` (Tycho
        // item 52): at or below `MAX_SIZE_EAGER_COLLECTION` the distribution
        // is materialized into a `List`; past the threshold the held `When` is
        // kept and its `collection` handlers (see `whenCollectionHandlers`)
        // expose the same elements lazily. The type check gates the extra
        // `evaluate` so a scalar `When` keeps its held form unchanged.
        // A `Tuple` is excluded: it is a fixed-arity structure (a point), not a
        // list to broadcast over, so a restricted point must stay a point
        // rather than degrade to a `List`. Mirrors `PointList`'s
        // `isListComponent` predicate in `collections.ts`.
        // A tuple-typed value is excluded before it is evaluated: evaluating
        // it here would force every component of a value the restriction is
        // meant to keep held, changing the lazy guard semantics for a shape
        // that can never enter the distribution path anyway.
        if (expr.type.matches('collection') && !expr.type.matches('tuple')) {
          const ev = expr.evaluate(options);
          if (isFiniteIndexedCollection(ev) && !isTuple(ev)) {
            const n = ev.count ?? Infinity;
            if (n <= MAX_SIZE_EAGER_COLLECTION) {
              const result = Array.from(ev.each()).map((elem) =>
                ce._fn('When', [elem, c])
              );
              return ce._fn('List', result);
            }
            // Too large to materialize: hold the (evaluated) collection so the
            // collection handlers can walk it.
            return ce._fn('When', [ev, c]);
          }
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
      signature: '(expression+) -> unknown',
      // A SELECTOR, like `If`: conditions are tested, the first matching arm is
      // evaluated and RETURNED, and no position applies a function-valued
      // operand. Held-position (production) effects are unaffected.
      invokes: false,
      type: (args) => {
        if (args.length % 2 !== 0) return 'nothing';
        let arms = args.filter((_, i) => i % 2 === 1);
        let conds = args.filter((_, i) => i % 2 === 0);
        // Only the REACHABLE clauses contribute: a literal `True` condition is
        // the default clause, and evaluation never looks past it. The walk must
        // stop there too, or `Which(True, 1, [True, False], 2)` — which
        // evaluates to the scalar `1` — would be typed element-wise by a
        // condition that is never even evaluated.
        const dflt = conds.findIndex((c) => sym(c) === 'True');
        if (dflt >= 0) {
          conds = conds.slice(0, dflt + 1);
          arms = arms.slice(0, dflt + 1);
        }
        // A condition that is provably a boolean indexed collection selects
        // element-wise (see `evaluateElementwiseSelection`): the result is a
        // list of the arms' element types.
        const shape = elementwiseConditionShape(conds);
        if (shape)
          return elementwiseResultType(
            arms,
            shape.length,
            // A literal `True` condition is the default clause: it matches
            // every position, so the `NaN` no-match cell is unreachable.
            dflt >= 0
          );
        return widen(...arms.map((x) => x.type.type));
      },
      canonical: (args, options) => {
        if (args.length % 2 !== 0) return options.engine.Nothing;
        return options.engine._fn(
          'Which',
          args.map((x) => x.canonical)
        );
      },
      evaluate: (ops, options) => evaluateWhich(ops, options),
    },

    // Structural pattern matching (Epsil `match`). See
    // `docs/plans/2026-07-12-cortex-match-design.md` and
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
      type: (ops) => {
        // Result is the widened type of the case bodies (the last operand of
        // each `MatchCase`), mirroring `If`/`Which`. Bodies reference capture
        // names free at this scope, so most resolve to `unknown` — widen is a
        // best-effort hint.
        const bodyTypes: Type[] = [];
        for (const c of ops.slice(1)) {
          if (!isFunction(c, 'MatchCase') || c.nops < 2) continue;
          bodyTypes.push(c.ops[c.nops - 1].type.type);
        }
        if (bodyTypes.length === 0) return 'nothing';
        return widen(...bodyTypes);
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
 * Lazy indexed-collection handlers for a held `When(value, cond)` (Tycho
 * item 66).
 *
 * A restriction over a collection is elementwise: `When(L, c)` behaves as
 * `[When(L1, c), …, When(Ln, c)]`. Small collections are distributed eagerly
 * into a `List` by the `evaluate` handler; past `MAX_SIZE_EAGER_COLLECTION`
 * the `When` is held and these handlers walk the wrapped value, re-wrapping
 * each element with the condition — so the large form stays lazy but is fully
 * enumerable, and `isCollection`/`count`/`each()` agree with `.type`.
 *
 * A `When` guarding a SCALAR is not a collection: `isCollection` reports
 * `false` and every other handler reports scalar, exactly as before.
 */
function whenCollectionHandlers(): CollectionHandlers {
  // The wrapped collection value, or `undefined` when `When` guards a scalar.
  // The predicate matches the `evaluate` handler's distribution rule exactly —
  // in particular a `Tuple` (a point) is NOT list-like here, so a restricted
  // point presents as a scalar `When` wrapping the point rather than as a
  // 2-element collection.
  // Returns the wrapped collection together with a `restrict` closure that
  // re-applies the condition to one of its elements.
  const parts = (
    expr: Expression
  ):
    | { value: Expression; restrict: (elem: Expression) => Expression }
    | undefined => {
    if (!isFunction(expr, 'When')) return undefined;
    const v = expr.op1;
    if (!v.isCollection || isTuple(v)) return undefined;
    const cond = expr.op2;
    return {
      value: v,
      restrict: (elem) => expr.engine._fn('When', [elem, cond]),
    };
  };
  const value = (expr: Expression): Expression | undefined =>
    parts(expr)?.value;

  return {
    isCollection: (expr) => value(expr) !== undefined,

    isLazy: (expr) => value(expr) !== undefined,

    count: (expr) => value(expr)?.count,

    isEmpty: (expr) => value(expr)?.isEmptyCollection,

    isFinite: (expr) => value(expr)?.isFiniteCollection,

    isEnumerable: (expr) => value(expr)?.isEnumerableCollection,

    elttype: (expr) => {
      const v = value(expr);
      if (!v) return undefined;
      return collectionElementType(v.type.type) ?? 'unknown';
    },

    iterator: (expr) => {
      const p = parts(expr);
      if (!p) return undefined;
      const iter = p.value.each();
      return {
        next: () => {
          const result = iter.next();
          if (result.done) return { value: undefined, done: true as const };
          return { value: p.restrict(result.value), done: false as const };
        },
      };
    },

    at: (expr, index) => {
      // Negative indexes are normalized by the caller; string keys (records)
      // do not apply to a restricted indexed collection.
      if (typeof index !== 'number') return undefined;
      const p = parts(expr);
      const elem = p?.value.at(index);
      return elem ? p!.restrict(elem) : undefined;
    },

    indexWhere: (expr, predicate) => {
      const p = parts(expr);
      return p?.value.indexWhere((elem) => predicate(p.restrict(elem)));
    },
  };
}

/**
 * A conditional guard is "boolean-ish" — well-typed for `If`/`Which` even
 * though it did not reduce to a bare `True`/`False` — when it is a scalar
 * boolean OR a broadcast finite collection of booleans. The latter arises when
 * a predicate maps element-wise over a collection (e.g. `total(P[i..j])` where
 * `total` broadcasts over the slice, yielding `[b1, …, bn]`). Such a guard is
 * held (the conditional stays symbolic) rather than throwing the "not a
 * boolean" error: a scalar relation may become decidable once free variables
 * are bound, and crashing an enclosing `Comprehension` on a broadcast guard is
 * worse than yielding a held value. Mirrors `When`'s broadcast detection.
 */
/**
 * The catchable error for a scalar condition that evaluated to the `Missing`
 * symbol (an absent guard). Distinct from the "not a boolean at all" typo
 * throw: absence is a runtime DATA state of a correct program, so it yields
 * an error expression the host can render or catch, instead of crashing
 * `.evaluate()`.
 */
function absentConditionError(ce: ComputeEngine): Expression {
  return ce.error(
    'The condition is absent (`Missing`). Discharge absence with ' +
      '`Coalesce()` or `IsMissing()` before branching'
  );
}

function isBooleanishCondition(evaluated: Expression): boolean {
  if (evaluated.type.matches('boolean')) return true;
  if (!evaluated.isCollection || !evaluated.isFiniteCollection) return false;
  const items = Array.from(evaluated.each()) as Expression[];
  // A broadcast (list) condition is held when every cell is boolean — or ABSENT
  // (`Missing`/`NaN`), which is Kleene-undecidable, so the `Which` stays held
  // rather than crashing the surrounding comprehension. This surfaces when a
  // broadcast condition contains a Kleene-`Missing` comparison cell (§3.D,
  // amended 2026-07-24: `Missing` is Kleene, so `Equal(Missing, k)` /
  // `Less(Missing, k)` are `Missing`; a `NaN` cell is IEEE and yields a plain
  // boolean, which is already covered). A SCALAR absent condition still fails
  // closed (throws), unchanged.
  return (
    items.length > 0 &&
    items.every(
      (x) =>
        x.type.matches('boolean') ||
        x.type.matches('missing') ||
        isAbsentValue(x)
    )
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
 * The materialized cells of a condition that activates the ELEMENT-WISE
 * selection path, or `undefined` when it does not.
 *
 * The gate (§3 of `docs/plans/2026-07-27-elementwise-which-design.md`) is
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
  if (c.isFiniteCollection !== true) return undefined;
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
 * (`docs/plans/2026-07-27-elementwise-which-design.md`).
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
    if (value.isFiniteCollection !== true) return undefined;
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
  conds: ReadonlyArray<Expression | undefined>
): { length?: number } | undefined {
  let found = false;
  let length: number | undefined;
  for (const cond of conds) {
    if (!cond?.type.matches(BOOLEAN_COLLECTION_TYPE)) continue;
    // A tuple is a subtype of `indexed_collection`, but runtime lifts tuples
    // whole (tuple-atomic): a tuple-typed condition never activates the
    // element-wise path, so it must not flip the static shape either.
    const t = cond.type.type;
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
  if (typeof t === 'string') return t;
  if (t.kind === 'union')
    return widen(...t.types.map((x) => armElementType(x)));
  if (t.kind === 'list' || t.kind === 'indexed_collection')
    return broadcastElementType(t);
  return t as Type;
}

/**
 * The type of an element-wise selection: a list of the arms' element types (a
 * list-valued arm contributes its ELEMENT type, since it is indexed
 * position-wise; a scalar arm contributes its own type, since it lifts).
 *
 * `hasDefault` — a clause whose condition is literally `True` (for `If`, an
 * else branch) — decides whether the no-match cell can occur. Without one, a
 * position no clause matches is `NaN` (R4), and `finite_*` types EXCLUDE NaN
 * under the non-finite typing convention: the element type must therefore
 * join in `number`, the narrowest type that admits NaN, or a consumer
 * dispatching on `.type.matches()` would be promised a `finite_integer` cell
 * and handed a `NaN`. WITH a default clause the no-match cell is unreachable
 * and the exact join is kept — widening unconditionally would hand every
 * element-wise conditional an over-wide union, which breaks that same
 * dispatch.
 */
function elementwiseResultType(
  arms: ReadonlyArray<Expression>,
  length: number | undefined,
  hasDefault: boolean
): Type {
  const armTypes = arms.map((x) => armElementType(x.type.type));
  const elements = hasDefault
    ? widen(...armTypes)
    : widen(...armTypes, 'number');
  // The union-free clause (tensor-unification design §D3 rule 2): a
  // dimensioned `list` type IS the tensor claim (`isTensor` is exactly
  // `dimensions !== undefined`), and a heterogeneous cell population never
  // qualifies — `shapedListType` declines the shape for it. Claiming a
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

function evaluateWhich(
  args: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression | undefined {
  let i = 0;
  while (i < args.length - 1) {
    const evaluated = args[i].canonical.evaluate();
    const cond = sym(evaluated);
    if (cond === 'True') {
      if (!args[i + 1]) return options.engine.symbol('Undefined');
      return args[i + 1].evaluate(options);
    } else if (cond !== 'False' && cond !== 'Undefined') {
      // An ABSENT guard (the `Missing` symbol) is Kleene-undecidable: this
      // clause can neither be taken nor skipped (falling through to a later
      // clause would decide what absence left undecided), so the `Which` is
      // a catchable error EXPRESSION — not the typo throw below. (§3.D
      // residual, resolved 2026-07-24.)
      if (cond === 'Missing') return absentConditionError(options.engine);
      // A LIST-VALUED condition selects element-wise (§3 of
      // `docs/plans/2026-07-27-elementwise-which-design.md`). Every earlier
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
      // An UNDECIDED boolean condition (e.g. `x = 4` with a free `x`, which
      // stays symbolic under evaluate()) leaves the `Which` unevaluated:
      // picking a later branch would be wrong once the condition becomes
      // decidable. The throw is reserved for conditions that are not
      // boolean at all, where the spell-check hint is the useful outcome.
      if (isBooleanishCondition(evaluated)) return undefined;
      throw new Error(
        `Condition must evaluate to "True" or "False". ${spellCheckMessage(
          args[i]
        )}`
      );
    }
    // `False` — or `Undefined` (decision 9), treated as not-True — falls
    // through to the next clause.
    i += 2;
  }

  return options.engine.symbol('Undefined');
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
  const scope = ce.context.lexicalScope;
  for (const [name, def] of [...scope.bindings]) {
    if (
      'value' in def &&
      def.value.value === undefined &&
      (def as { _declaredByStatement?: boolean })._declaredByStatement !== true
    )
      scope.bindings.delete(name);
  }

  // If the block's final value is a bare symbol bound to a user-defined
  // function literal (`helper(x) = …` → a block-local operator definition),
  // return the underlying `Function` literal so the function escapes the
  // block as a first-class value. Resolved here, while the block scope (which
  // holds the operator definition) is still the current lexical scope.
  return resolveEscapingLambda(ce, evaluateStatements(ce, ops));
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

function canonicalBlock(
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
): Expression | null {
  const { engine: ce, scope } = options;
  // Empty block?
  if (ops.length === 0) return null;

  // A `Declare(name, …)` introduces a block-local `name` that shadows any
  // same-named constant (`i`, `e`, `Pi`, …) for the rest of the block. Push
  // those names onto the engine's shadowed-parameter stack — the same
  // mechanism used for function-literal parameters — so that e.g.
  // `Add(i, 1)` after `Declare(i, …)` keeps `i` as an ordinary variable
  // instead of folding to the imaginary unit `1 + i`. The shadow is scoped to
  // this block: it is popped once the statements are canonicalized, so an `i`
  // outside the block is the imaginary unit again.
  const declaredNames: string[] = [];
  for (const op of ops) {
    if (isFunction(op, 'Declare')) {
      const nameExpr = op.ops[0];
      if (nameExpr && isSymbol(nameExpr)) declaredNames.push(nameExpr.symbol);
    }
  }

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
  // runtime exactly as it upgrades an auto-declared binding.
  if (scope) {
    for (const name of declaredNames) {
      if (name !== 'Nothing' && !scope.bindings.has(name))
        ce._declareSymbolValue(
          name,
          { type: 'unknown', inferred: true },
          scope
        );
    }
    for (const op of ops) {
      if (!isFunction(op, 'Assign')) continue;
      const name = sym(op.ops[0]);
      if (!name || name === 'Nothing') continue;
      if (scope.bindings.has(name) || ce.lookupDefinition(name)) continue;
      ce._declareSymbolValue(name, { type: 'unknown', inferred: true }, scope);
    }
  }

  ce._pushShadowedParameters(declaredNames);
  let statements: Expression[];
  try {
    // We canonicalize the statements in the local scope
    statements = ce._inScope(scope, () =>
      ops.map((op) => canonicalStatement(ce, op))
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
function loopBodyYieldsValue(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  if (expr.operator === 'Return') return true;
  if (expr.operator === 'Break' && expr.ops.length > 0) return true;
  return expr.ops.some((op) => loopBodyYieldsValue(op));
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
    const collCanonical = collExpr.canonical;
    // These clauses are rebuilt with `_fn`, which bypasses the `Element`
    // canonical handler — so nothing narrows the iterated operand. Yet
    // iterating over a not-yet-typed symbol is collection evidence in the same
    // way `Length(x)` or `x[i]` is: narrow it, so a function parameter whose
    // only use is `for c in cs` types as a collection (and the lambda
    // auto-broadcast then binds a collection argument whole instead of mapping
    // over it).
    if (
      isSymbol(collCanonical) &&
      collCanonical.valueDefinition?.inferredType &&
      collCanonical.type.type === 'unknown'
    )
      collCanonical.infer('collection', 'narrow');
    // …and nothing typed the INDEX, either (the same bypass): the binder
    // hook declares each index `unknown`, and the body's arithmetic use
    // then widened it to `number` — so `for i in 1..3` typed `10 * i` as
    // `finite_number`, wide enough to falsely refuse an `integer`-declared
    // protocol-property write. Narrow the fresh binding to the collection's
    // ELEMENT type when it is known, BEFORE the body canonicalizes against
    // it (the `Element` canonical handler's own inference, sets.ts, which
    // this `_fn` rebuild bypasses). `.infer()` accepts an explicit-`unknown`
    // binding and carries the machinery a raw `def.type` write skips (the
    // resolve-only guard, the inference state event, the same-type no-op
    // that preserves `BoxedType` identity). The collection type is resolved
    // first so an ALIAS (`type ints = list<integer>`) contributes its
    // element type too.
    const idxCanonical = indexExpr.canonical;
    if (isSymbol(idxCanonical)) {
      const elt = collectionElementType(
        resolveTypeForCompilation(collCanonical.type.type)
      );
      if (elt !== undefined && elt !== 'any' && elt !== 'unknown')
        idxCanonical.infer(elt, 'narrow');
    }
    return ce._fn('Element', [idxCanonical, collCanonical]);
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
 * (the wildcard `Nothing` is skipped — it binds nothing). */
function comprehensionIndexNames(
  elements: ReadonlyArray<Expression>
): string[] {
  const names: string[] = [];
  for (const el of elements) {
    if (!isFunction(el, 'Element')) continue;
    const idx = el.ops[0];
    if (idx && isSymbol(idx) && idx.symbol !== 'Nothing')
      names.push(idx.symbol);
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
    let subs: Record<string, Expression> | undefined;
    if (scope) ce._pushEvalContext(scope);
    frame.install();
    try {
      r = inner.next();
    } finally {
      frame.captureAndRestore();
      if (scope) ce._popEvalContext();
    }
    if (r.done) return;
    if (indexNames.length > 0) subs = frame.subs(indexNames);
    const value =
      subs !== undefined && r.value.has(indexNames)
        ? r.value.subs(subs)
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
  if (scope) ce._pushEvalContext(scope);
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
  if (scoped) ce._pushEvalContext(expr.localScope!);
  try {
    let empty = false;
    let unknown = false;
    let infinite = false;
    let product = 1;
    for (const clause of clauses) {
      if (!isFunction(clause, 'Element')) return undefined;
      const coll = clause.ops[1]?.evaluate();
      if (!coll?.isCollection) return undefined;
      const c = coll.count;
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
  if (s.infinite) return Infinity;
  return s.product;
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
  if (s.infinite) return false;
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
      return c === undefined ? undefined : c === 0;
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

  if (!indexExpr || !isSymbol(indexExpr) || !collExpr) {
    return;
  }
  const name = indexExpr.symbol;

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
    // Ephemeral index write: bumps `_anyVersion` and the index def's
    // `_writeVersion`, not `_semanticVersion` (see `assignLoopIndex`).
    if (!skipAssign) assignLoopIndex(ce, name, value);
    yield* runNested(body, elements, index + 1, ce, state, onLeaf);
    if (state.stopped) return;
  }
}
