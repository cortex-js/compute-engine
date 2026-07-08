import { evaluateStatements } from '../function-utils';
import { checkConditions } from '../boxed-expression/rules';
import { widen } from '../../common/type/utils';
import { parseType } from '../../common/type/parse';
import { CancellationError, run, runAsync } from '../../common/interruptible';
import type {
  Expression,
  SymbolDefinitions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types';
import { spellCheckMessage } from '../boxed-expression/validate';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards';

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
          ops.map((op) => op.canonical)
        ),
      evaluate: ([cond, ifTrue, ifFalse], { engine }) => {
        const evaluatedCond = sym(cond.evaluate());
        if (evaluatedCond === 'True')
          return ifTrue?.evaluate() ?? engine.Nothing;
        if (evaluatedCond === 'False')
          return ifFalse?.evaluate() ?? engine.Nothing;
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
      canonical: (ops, options) => canonicalLoopLike('Comprehension', ops, options),
      evaluate: (ops, { engine: ce }) =>
        run(runComprehension(ops[0], ops.slice(1), ce), ce._timeRemaining),
      evaluateAsync: async (ops, { engine: ce, signal }) =>
        runAsync(
          runComprehension(ops[0], ops.slice(1), ce),
          ce._timeRemaining,
          signal
        ),
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
      type: ([expr]) => expr.type,
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
      evaluate: ([expr, cond], { engine: ce }) => {
        const c = cond.evaluate();
        const cs = sym(c);
        if (cs === 'True') return expr.evaluate();
        if (cs === 'False') return ce.symbol('Undefined');
        // Indeterminate: hold
        return ce._fn('When', [expr, c]);
      },
    },

    Which: {
      description: 'Return the value for the first condition that is true.',
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

    FixedPoint: {
      description: 'Iterate a function until a fixed point is reached.',
      lazy: true,
      signature: '(any) -> unknown',
    },
  },
];

function evaluateWhich(
  args: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> & { engine: ComputeEngine }
): Expression {
  let i = 0;
  while (i < args.length - 1) {
    const cond = sym(args[i].evaluate());
    if (cond === 'True') {
      if (!args[i + 1]) return options.engine.symbol('Undefined');
      return args[i + 1].evaluate(options);
    } else if (cond !== 'False') {
      throw new Error(
        `Condition must evaluate to "True" or "False". ${spellCheckMessage(
          args[i]
        )}`
      );
    }
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
  return evaluateStatements(ce, ops);
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

  // We canonicalize the statements in the local scope
  const result = ce._fn(
    'Block',
    ce._inScope(scope, () => ops.map((op) => op.canonical)),
    { scope }
  );
  return result;
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
    return ce._fn('Loop', [body.canonical]);
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
    canonicalBody = body.canonical;
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
 * Value-producing `Comprehension`: collect each body evaluation into a flat
 * `List`. Control-flow inside a comprehension is a category error and is not
 * intercepted — body values are collected as-is.
 */
function* runComprehension(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  ce: ComputeEngine
): Generator<Expression> {
  body ??= ce.Nothing;

  const results: Expression[] = [];
  const state: LoopState = { stopped: false, count: 0 };
  yield* runNestedElements(body, elements, ce, state, (result) => {
    results.push(result);
  });

  return ce.function('List', results);
}

/**
 * Set up the fresh loop scope (index vars pre-declared) and drive the nested
 * iteration. Shared by `runLoop` and `runComprehension`; the per-result
 * behaviour is supplied via `onLeaf`.
 */
function* runNestedElements(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  ce: ComputeEngine,
  state: LoopState,
  onLeaf: (result: Expression) => void
): Generator<Expression> {
  // Build a fresh loop scope per evaluation so repeated evaluations don't
  // accumulate state. The parent is the current scope at evaluation time.
  // Element index variables are pre-declared into this scope so subsequent
  // `ce.assign(name, value)` updates the binding inside the loop scope
  // rather than leaking to the enclosing one.
  const freshScope: Scope = {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
  };

  ce._pushEvalContext(freshScope);
  try {
    for (const elem of elements) {
      if (!isFunction(elem, 'Element')) continue;
      const idx = elem.ops[0];
      if (idx && isSymbol(idx) && idx.symbol !== 'Nothing') {
        if (!freshScope.bindings.has(idx.symbol))
          ce.declare(idx.symbol, 'unknown');
      }
    }
    yield* runNested(body, elements, 0, ce, state, onLeaf);
  } finally {
    ce._popEvalContext();
  }
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
