import {
  evaluateStatements,
  resolveEscapingLambda,
} from '../function-utils.js';
import { checkConditions } from '../boxed-expression/rules.js';
import { widen } from '../../common/type/utils.js';
import { parseType } from '../../common/type/parse.js';
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
} from '../global-types.js';
import { spellCheckMessage } from '../boxed-expression/validate.js';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/utils.js';
import { evaluateMatch } from '../boxed-expression/match-dispatch.js';

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
      // The else branch is optional: `If(cond, expr)` evaluates to `Nothing`
      // when the condition is false.
      type: ([_cond, ifTrue, ifFalse]) =>
        widen(ifTrue.type.type, ifFalse?.type.type ?? 'nothing'),
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
      evaluate: ([cond, ifTrue, ifFalse], { engine }) => {
        const evaluated = cond.evaluate();
        const evaluatedCond = sym(evaluated);
        if (evaluatedCond === 'True')
          return ifTrue?.evaluate() ?? engine.Nothing;
        if (evaluatedCond === 'False')
          return ifFalse?.evaluate() ?? engine.Nothing;
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
      signature: '(body:expression, iterators:expression*) -> any',
      type: ([body]) => {
        if (!body) return 'nothing';
        // A `Loop` is evaluated for effect: its value is `Nothing` unless the
        // body can short-circuit with a value (`Break v` / `Return`).
        return loopBodyYieldsValue(body) ? 'unknown' : 'nothing';
      },
      canonical: (ops, options) => canonicalLoopLike('Loop', ops, options),
      evaluate: (ops, { engine: ce }) =>
        run(runLoop(ops[0], ops.slice(1), ce), ce._timeRemaining),
      evaluateAsync: async (ops, { engine: ce, signal }) =>
        runAsync(runLoop(ops[0], ops.slice(1), ce), ce._timeRemaining, signal),
    },

    Comprehension: {
      description:
        'Value-producing comprehension: evaluate `body` in nested iteration ' +
        'over one or more `Element` clauses and collect the results into an ' +
        'indexed collection (a `List`). Later clauses see earlier bindings; ' +
        'independent clauses produce a Cartesian product.',
      lazy: true,
      signature:
        '(body:expression, iterators:expression+) -> indexed_collection',
      type: ([body]) => {
        if (!body) return 'nothing';
        // Result is an indexed collection of body.type values. The body's
        // type may itself be parametric (e.g. a tuple) — wrap in
        // indexed_collection<...>.
        return parseType(`indexed_collection<${String(body.type)}>`);
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
          return ce._fn('When', [
            inner,
            ce._fn('And', [innerCond, cond.canonical]),
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
        // Indeterminate: hold
        return ce._fn('When', [expr, c]);
      },
    },

    Which: {
      description: 'Return the value for the first condition that is true.',
      keywords: ['piecewise'],
      lazy: true,
      signature: '(expression+) -> unknown',
      type: (args) => {
        if (args.length % 2 !== 0) return 'nothing';
        return widen(
          ...args.filter((_, i) => i % 2 === 1).map((x) => x.type.type)
        );
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

    // Structural pattern matching (Cortex `match`). See
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
function isBooleanishCondition(evaluated: Expression): boolean {
  if (evaluated.type.matches('boolean')) return true;
  if (!evaluated.isCollection || !evaluated.isFiniteCollection) return false;
  const items = Array.from(evaluated.each()) as Expression[];
  return items.length > 0 && items.every((x) => x.type.matches('boolean'));
}

function evaluateWhich(
  args: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression | undefined {
  let i = 0;
  while (i < args.length - 1) {
    const evaluated = args[i].evaluate();
    const cond = sym(evaluated);
    if (cond === 'True') {
      if (!args[i + 1]) return options.engine.symbol('Undefined');
      return args[i + 1].evaluate(options);
    } else if (cond !== 'False' && cond !== 'Undefined') {
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
  // chain. Bindings carrying a value or an explicit type are kept (e.g.
  // locals from a previous evaluation of this block — reset by `Declare`'s
  // statement-redeclare path, not here).
  const scope = ce.context.lexicalScope;
  for (const [name, def] of [...scope.bindings]) {
    if (
      'value' in def &&
      def.value.inferredType &&
      def.value.value === undefined
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

  // Variadic Element form: bound names must not leak. Mirror canonicalBigop.
  const loopScope: Scope = scope ?? {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
  };
  loopScope.noAutoDeclare = true;
  ce.pushScope(loopScope);

  let canonicalIterators: Expression[];
  let canonicalBody: Expression;
  try {
    // Canonicalize each Element clause in order. Earlier clauses declare
    // their index in `loopScope` (via `ce.declare(name, 'unknown')`) before
    // later clauses are canonicalized — so a later collection expression
    // referencing an earlier name binds to the loop-scoped symbol rather
    // than triggering auto-declaration in the enclosing scope.
    canonicalIterators = iterators.map((it) => {
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
      return ce._fn('Element', [indexExpr.canonical, collExpr.canonical]);
    });
    canonicalBody = canonicalStatement(ce, body);
  } finally {
    ce.popScope();
    loopScope.noAutoDeclare = false;
  }

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
    // Any other result (including Continue) simply continues.
  });

  if (state.stopped && state.value !== undefined) return state.value;
  return ce.Nothing;
}

/**
 * A fresh, per-walk binding scope for a `Comprehension`'s index variables.
 *
 * Every independent traversal of a comprehension — an `each()` stream, an
 * `at(n)`, or a dependent-`.count` enumeration — must bind its index variables
 * in its OWN scope, NOT in the shared, persistent `expr.localScope`. The loop
 * scope is created once at canonicalization and outlives every walk, so if two
 * walks assigned their indices into it they would clobber each other: a paused
 * generator, resumed after another walk advanced, would re-read an index the
 * other walk overwrote (interleaved iterators; reading `.count` mid-iteration).
 *
 * The fresh scope's parent IS `expr.localScope`, so `where`-clause captures and
 * every enclosing binding still resolve up the chain, and dependent clauses
 * (`Element(j, Range(1, i))`) still see this walk's own `i`. The pre-declared
 * index names are re-declared per walk by `runNestedElements`' declare-if-absent
 * pass (into this child scope, the current lexical scope), and `ce.assign`
 * therefore writes them here — isolated from every other walk.
 */
function comprehensionWalkScope(expr: Expression): Scope | undefined {
  if (!isFunction(expr)) return undefined;
  if (!(expr.isScoped && expr.localScope !== undefined)) return undefined;
  return { parent: expr.localScope, bindings: new Map() };
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

/** Snapshot the CURRENT value of every index bound in a walk scope, as a
 * substitution map. Reads the per-walk bindings directly (each holds this
 * iteration's index value), so it must be called while the walk scope is still
 * live. Returns `undefined` when no index has a value yet. */
function comprehensionIndexSubs(
  walkScope: Scope
): Record<string, Expression> | undefined {
  let subs: Record<string, Expression> | undefined;
  for (const [name, def] of walkScope.bindings) {
    if (isValueDef(def) && def.value.value !== undefined)
      (subs ??= {})[name] = def.value.value;
  }
  return subs;
}

/**
 * Stream a `Comprehension`'s body values one at a time.
 *
 * A fresh per-walk index scope (see `comprehensionWalkScope`) is pushed ONLY
 * around each synchronous `inner.next()` advance — the step that assigns the
 * next index and evaluates the body — and popped again BEFORE the value is
 * yielded. So the eval-context stack is never held across a `yield`: a consumer
 * that stops early or abandons the iterator leaves nothing pushed to leak (this
 * is safe even though `each()` does not forward `.return()` to us), and there is
 * no interference if evaluation happens between `.next()` calls. Because each
 * element is produced on demand, iterating an infinite domain and taking only a
 * prefix (e.g. `Take`, `First`) works without hitting the iteration limit; a
 * full drive of an infinite domain still terminates via the iteration-limit
 * `CancellationError` from `runNested`.
 */
function* comprehensionStream(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const ce = expr.engine;
  const body = expr.ops[0] ?? ce.Nothing;
  const elements = expr.ops.slice(1);

  const walkScope = comprehensionWalkScope(expr);
  const indexNames = comprehensionIndexNames(elements);
  const state: LoopState = { stopped: false, count: 0 };
  const inner = runNestedElements(body, elements, ce, state, () => {});
  while (true) {
    let r: IteratorResult<Expression>;
    // Capture this iteration's index values BY VALUE while the walk scope is
    // still live (C2): a materialized body that is a function literal captures
    // its free variables by reference against the scope active at apply time,
    // so without this every element of `[x ↦ x + i for i in 1..3]` would share
    // one `i` (resolving to its final value, or to nothing once the walk scope
    // is gone) instead of closing over 1, 2, 3. Substituting the index values
    // into the element is a no-op for a body that already resolved them.
    let subs: Record<string, Expression> | undefined;
    if (walkScope) ce._pushEvalContext(walkScope);
    try {
      r = inner.next();
      if (!r.done && walkScope && indexNames.length > 0)
        subs = comprehensionIndexSubs(walkScope);
    } finally {
      if (walkScope) ce._popEvalContext();
    }
    if (r.done) return;
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
  // Count in a FRESH per-walk scope, never the shared `localScope`: reading
  // `.count` while another walk is paused must not clobber that walk's indices.
  const walkScope = comprehensionWalkScope(expr);
  if (walkScope) ce._pushEvalContext(walkScope);
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
    if (walkScope) ce._popEvalContext();
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
 * Prefix element cache for a materialized `Comprehension` (Tycho item 23.1).
 *
 * Without memoization, every `at(n)` and every `each()` re-walks the whole
 * domain, so a document that reads a comprehension's elements repeatedly pays
 * O(domain) per read (`at(100)` called 100× on a 200-element body ≈ 5 s here).
 * `elements` holds the materialized prefix (`elements[i-1]` is the 1-based
 * `at(i)`); `complete` is set once the whole finite domain has been drained.
 */
interface ComprehensionCache {
  /** `ce._generation` snapshot taken AFTER the prefix was filled. */
  generation: number;
  elements: Expression[];
  complete: boolean;
}

/**
 * Keyed on the boxed comprehension instance. A `WeakMap` so an unreferenced
 * comprehension (and its cached elements) is collectable.
 */
const comprehensionCaches = new WeakMap<Expression, ComprehensionCache>();

/**
 * Cap the memoized prefix. Beyond this many elements we stop caching and fall
 * back to streaming, so an enormous (or effectively unbounded) finite domain
 * cannot pin an arbitrarily large array in memory.
 */
const COMPREHENSION_CACHE_CAP = 100_000;

/**
 * Correctness: the cache is invalidated whenever `ce._generation` differs from
 * the stamped value. `_generation` is bumped by every `ce.assign`/`declare`/
 * `assume`/`forget`, so rebinding a FREE variable the comprehension reads (the
 * `[k*n for n in 1..3]` → reassign `k` case) invalidates the memo. This is
 * sound even though the walk ITSELF bumps `_generation` (it assigns the index
 * variables per iteration): a cache HIT performs no walk, so the generation is
 * stable across hits, and the stamp is taken AFTER a (re)fill, so the walk's
 * own bumps are absorbed. Any external rebind between reads is the only thing
 * that can move the generation while the cache is untouched.
 */
function comprehensionValidCache(
  expr: Expression
): ComprehensionCache | undefined {
  const entry = comprehensionCaches.get(expr);
  if (entry && entry.generation === expr.engine._generation) return entry;
  return undefined;
}

/**
 * Ensure the cache holds at least the first `n` elements (or the whole domain,
 * if shorter). Re-walks from the start on a miss or an invalidation; the stream
 * is not resumable, so extending a valid-but-short prefix also restarts — fine
 * for the reported pattern (repeated reads at a stable index). Returns the
 * (possibly still short, if capped) cache entry.
 */
function comprehensionFillTo(expr: Expression, n: number): ComprehensionCache {
  const ce = expr.engine;
  let entry = comprehensionValidCache(expr);
  if (entry && (entry.complete || entry.elements.length >= n)) return entry;

  const limit = Math.min(n, COMPREHENSION_CACHE_CAP);
  const elements: Expression[] = [];
  let complete = false;
  const stream = comprehensionStream(expr);
  while (elements.length < limit) {
    const r = stream.next();
    if (r.done) {
      complete = true;
      break;
    }
    elements.push(r.value);
  }
  // Stamp AFTER the walk (the walk bumped `_generation` via its index assigns).
  entry = { generation: ce._generation, elements, complete };
  comprehensionCaches.set(expr, entry);
  return entry;
}

/**
 * Iterate a comprehension's elements, serving from (and populating) the prefix
 * cache. A complete, still-valid cache streams straight from memory; otherwise
 * the underlying stream is walked once, buffered up to the cap, and committed
 * as `complete` only if fully drained without overflowing. Early abandonment
 * (e.g. `Take`/`First`) suspends before the commit, so it never caches a
 * partial buffer as complete.
 */
function* comprehensionCachedStream(
  expr: Expression
): Generator<Expression, undefined, any> {
  const cached = comprehensionValidCache(expr);
  if (cached?.complete) {
    yield* cached.elements;
    return;
  }
  const ce = expr.engine;
  const buffer: Expression[] = [];
  let overflow = false;
  for (const el of comprehensionStream(expr)) {
    if (buffer.length < COMPREHENSION_CACHE_CAP) buffer.push(el);
    else overflow = true;
    yield el;
  }
  if (!overflow)
    comprehensionCaches.set(expr, {
      generation: ce._generation,
      elements: buffer,
      complete: true,
    });
}

/**
 * Lazy indexed-collection handlers for `Comprehension`. `count`/`isEmpty`/
 * `isFinite` are answered from the (independent) clause counts without walking
 * elements; iteration STREAMS one element at a time (serving a memoized prefix,
 * see `comprehensionCachedStream`) and a positive `at(n)` fills the prefix cache
 * up to `n`. A negative index needs the length, so it materializes — but only
 * once the comprehension is known finite. An unread comprehension touches none
 * of these, so binding it is O(1).
 */
function comprehensionCollectionHandlers(): CollectionHandlers {
  return {
    isLazy: () => true,

    count: (expr) => comprehensionCount(expr),

    isEmpty: (expr) => {
      const c = comprehensionCount(expr);
      return c === undefined ? undefined : c === 0;
    },

    isFinite: (expr) => comprehensionIsFinite(expr),

    iterator: (expr) => comprehensionCachedStream(expr),

    at: (expr, index) => {
      if (typeof index !== 'number' || !Number.isInteger(index) || index === 0)
        return undefined;
      if (index > 0) {
        // Beyond the cache cap: stream directly rather than pinning a huge
        // prefix in memory.
        if (index > COMPREHENSION_CACHE_CAP) {
          let i = 0;
          for (const el of comprehensionStream(expr))
            if (++i === index) return el;
          return undefined;
        }
        const entry = comprehensionFillTo(expr, index);
        return entry.elements[index - 1];
      }
      // Negative index (from the end) needs the length: decline unless the
      // comprehension is provably finite, so we never try to materialize an
      // infinite domain just to index from the end.
      if (comprehensionIsFinite(expr) !== true) return undefined;
      const all = [...comprehensionCachedStream(expr)];
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
    if (!skipAssign) ce.assign(name, value);
    yield* runNested(body, elements, index + 1, ce, state, onLeaf);
    if (state.stopped) return;
  }
}
