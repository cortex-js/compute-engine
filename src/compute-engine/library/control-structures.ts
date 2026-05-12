import { applicable, evaluateStatements } from '../function-utils';
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
      signature: '(expression, expression, expression) -> any',
      type: ([_cond, ifTrue, ifFalse]) =>
        widen(ifTrue.type.type, ifFalse.type.type),
      canonical: ([cond, ifTrue, ifFalse], { engine }) =>
        engine._fn('If', [cond.canonical, ifTrue.canonical, ifFalse.canonical]),
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
        'Evaluate a body expression in nested iteration over Element clauses. ' +
        'Later clauses see earlier bindings; independent clauses produce a ' +
        'Cartesian product.',
      lazy: true,
      signature: '(body:expression, iterators:expression*) -> any',
      type: ([body]) => {
        if (!body) return 'nothing';
        // Result is an indexed collection of body.type values. The body's
        // type may itself be parametric (e.g. a tuple) — wrap in
        // indexed_collection<...>.
        return parseType(`indexed_collection<${String(body.type)}>`);
      },
      canonical: canonicalLoop,
      evaluate: (ops, { engine: ce }) =>
        run(runLoop(ops[0], ops.slice(1), ce), ce._timeRemaining),
      evaluateAsync: async (ops, { engine: ce, signal }) =>
        runAsync(runLoop(ops[0], ops.slice(1), ce), ce._timeRemaining, signal),
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
  options: EvaluateOptions & { engine: ComputeEngine }
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
  { engine: ce }
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
 * Canonicalize a Loop expression.
 *
 * Two forms are supported:
 *
 * - Variadic Element form (new): `Loop(body, Element(x, L1), Element(y, L2), ...)`.
 *   Push a fresh scope with `noAutoDeclare = true`, declare each Element's
 *   index variable in that scope, and canonicalize each clause + body inside
 *   the scope. Mirrors `canonicalBigop` so that free variables in the body
 *   and collection expressions are auto-declared in the enclosing scope, not
 *   leaking the iteration variable names.
 *
 * - Legacy single-collection form: `Loop(body, collection)` where the second
 *   argument is *not* an `Element` clause. Pass through unchanged (with each
 *   operand canonicalized) — preserves backwards compatibility with the
 *   former arity-2 signature, including the existing compile path.
 */
function canonicalLoop(
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
): Expression | null {
  const { engine: ce, scope } = options;
  if (ops.length === 0) return null;
  if (ops.length === 1) {
    // Body-only Loop: canonicalize and pass through.
    return ce._fn('Loop', [ops[0].canonical]);
  }

  const body = ops[0];
  const iterators = ops.slice(1);

  const allElement = iterators.every((it) => it.operator === 'Element');

  if (!allElement) {
    // Legacy form — pass through, canonicalizing operands.
    return ce._fn(
      'Loop',
      ops.map((op) => op.canonical)
    );
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
        return ce._fn('Element', [
          ce.error('missing').canonical,
          ce.error('missing').canonical,
        ]);
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

  return ce._fn('Loop', [canonicalBody, ...canonicalIterators], {
    scope: loopScope,
  });
}

function* runLoop(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  ce: ComputeEngine
): Generator<Expression> {
  body ??= ce.Nothing;
  if (sym(body) === 'Nothing') return body;

  if (elements.length === 0) {
    // Body-only Loop: yield body's eval once.
    const result = body.evaluate();
    yield result;
    return result;
  }

  // Backwards-compat: a single non-Element argument is treated as a plain
  // collection (the old arity-2 form). This preserves the prior semantics of
  // `Loop(body, collection)` where body is `applicable(...)` to each element.
  if (elements.length === 1 && elements[0].operator !== 'Element') {
    return yield* runLoopLegacy(body, elements[0], ce);
  }

  // Variadic Element form: nested iteration producing a flat indexed
  // collection of body evaluations.
  const results: Expression[] = [];
  const state: {
    stopped: boolean;
    broke: boolean;
    value?: Expression;
    count: number;
  } = { stopped: false, broke: false, count: 0 };

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
    yield* runLoopNested(body, elements, 0, ce, results, state);
  } finally {
    ce._popEvalContext();
  }

  if (state.stopped && state.value !== undefined) {
    // Return propagation: forward the Return expression unchanged.
    if (!state.broke) return state.value;
    // Break: return the broken-out value as the Loop's result directly.
    return state.value;
  }

  // Build the resulting indexed collection of body evaluations.
  return ce.function('List', results);
}

/**
 * Recursive nested iteration over Element clauses, producing a flat list of
 * body evaluations. Stops early on Break/Return by mutating `state.stopped`.
 */
function* runLoopNested(
  body: Expression,
  elements: ReadonlyArray<Expression>,
  index: number,
  ce: ComputeEngine,
  results: Expression[],
  state: {
    stopped: boolean;
    broke: boolean;
    value?: Expression;
    count: number;
  }
): Generator<Expression> {
  if (state.stopped) return;

  if (index === elements.length) {
    const result = body.evaluate();
    state.count += 1;
    if (state.count > ce.iterationLimit)
      throw new CancellationError({ cause: 'iteration-limit-exceeded' });
    if (isFunction(result, 'Break')) {
      state.stopped = true;
      state.broke = true;
      state.value = result.op1;
      return;
    }
    if (result.operator === 'Return') {
      state.stopped = true;
      state.value = result;
      return;
    }
    results.push(result);
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

  // Skip assigning to the wildcard `Nothing`. canonicalLoop already filters
  // these out of the pre-declaration pass, so without this guard a stray
  // non-canonical `Loop(body, Element('Nothing', coll))` would walk to the
  // parent scope looking for a binding to assign into.
  const skipAssign = name === 'Nothing';
  for (const value of collection.each()) {
    if (!skipAssign) ce.assign(name, value);
    yield* runLoopNested(body, elements, index + 1, ce, results, state);
    if (state.stopped) return;
  }
}

function* runLoopLegacy(
  body: Expression,
  collection: Expression,
  ce: ComputeEngine
): Generator<Expression> {
  if (collection?.isCollection) {
    //
    // Iterate over the elements of a collection
    //
    let result: Expression | undefined = undefined;
    const fn = applicable(body);
    let i = 0;

    for (const x of collection.each()) {
      result = fn([x]) ?? ce.Nothing;
      if (isFunction(result, 'Break')) return result.op1;
      if (result.operator === 'Return') return result;
      i += 1;
      yield result;
      if (i > ce.iterationLimit)
        throw new CancellationError({ cause: 'iteration-limit-exceeded' });
    }
    return result;
  }

  //
  // No collection: infinite loop
  //
  let i = 0;
  while (true) {
    const result = body.evaluate();
    if (isFunction(result, 'Break')) return result.op1;
    if (result.operator === 'Return') return result;
    i += 1;
    yield result;
    if (i > ce.iterationLimit)
      throw new CancellationError({ cause: 'iteration-limit-exceeded' });
  }
}
