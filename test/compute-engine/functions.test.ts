import { MathJsonExpression as Expression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { engine, exprToString } from '../utils';

function evaluate(expr: Expression) {
  return exprToString(engine.expr(expr)?.evaluate());
}

beforeAll(() => {
  engine.pushScope();
  engine.assign('f1', ['Function', ['Add', 'q', 1], 'q']);
  engine.assign('f2', ['Add', '_', 1]);

  engine.assign('h', ['Hold', ['Add', 2, 6]]);
  engine.assign('u', ['Unevaluated', ['Add', 2, 6]]);

  // Arguments are not checked by the Compute Engine
  // so we must use caution when accessing them

  engine.assign('f3', (args) => engine.number(args[0]?.re + 1));

  // With a declared function, the arguments are checked by the Compute Engine
  engine.declare('f4', {
    signature: '(number) -> number',
    evaluate: (args) => engine.number(args[0].re + 1),
  });

  // Anonymous parameters
  engine.assign('f5', ['Function', ['Add', '_', 1]]);
  engine.assign('f6', ['Function', ['Add', '_1', 1]]);
  engine.assign('f7', ['Function', ['Add', '_2', 1]]);
  engine.assign('f8', ['Add', '_', 1]);
  engine.assign('f9', ['Add', '_1', 1]);
  engine.assign('f10', ['Add', ['Divide', '_1', '_2'], '_3']);

  engine.declare('fn1', 'function');
  engine.declare('fn2', 'function');
  // Inferring the return type of a function
  engine.expr(['Add', ['fn2', 10], 1]).evaluate();
  engine.declare('fn3', 'function');
  // Inferring the arguments of a function
  engine.expr(['fn3', 10]).evaluate();

  engine.assign('fn4', ['Function', ['Add', 'x', 1], 'x']);
  engine.declare('fn5', {
    evaluate: (args) => engine.number(args[0].re + 1),
  });
});

afterAll(() => {
  engine.popScope();
});

describe('Infer function signature', () => {
  test('declared function signature', () =>
    expect(engine.expr('fn1').type.toString()).toMatchInlineSnapshot(
      `function`
    ));

  test('inferred function signature (result)', () =>
    expect(engine.expr('fn2').type.toString()).toMatchInlineSnapshot(
      `function`
    ));

  test('inferred function signature (arguments)', () =>
    expect(engine.expr('fn3').type.toString()).toMatchInlineSnapshot(
      `function`
    ));

  test('declared function signature with expression body', () =>
    expect(engine.expr('fn4').type.toString()).toMatchInlineSnapshot(
      `(unknown) -> number`
    ));

  test('declared function signature with JS body', () =>
    expect(engine.expr('fn5').type.toString()).toMatchInlineSnapshot(
      `(any*) -> unknown`
    ));
});

describe('Infer result type', () => {
  // By calling add, the result of `f1` is inferred to be a number
  test('Add', () =>
    expect(evaluate(['Add', 1, ['f1', 10]])).toMatchInlineSnapshot(`12`));
});

describe('Anonymous function', () => {
  test('Function', () =>
    expect(evaluate(['f1', 10])).toMatchInlineSnapshot(`11`));
  test('Expression', () =>
    expect(evaluate(['f2', 10])).toMatchInlineSnapshot(`11`));
  test('JS Function', () =>
    expect(evaluate(['f3', 10])).toMatchInlineSnapshot(`11`));
  test('Declared JS Function', () =>
    expect(evaluate(['f4', 10])).toMatchInlineSnapshot(`11`));
});

describe('Anonymous function with missing param', () => {
  test('Missing Param Function', () =>
    expect(evaluate(['f1'])).toMatchInlineSnapshot(
      `["Function", ["Add", "_1", 1]]`
    ));
  test('Missing Param Expression', () =>
    expect(evaluate(['f2'])).toMatchInlineSnapshot(
      `["Function", ["Add", "_1_0", 1]]`
    )); // @fixme
  test('Missing Param JS Function', () =>
    expect(evaluate(['f3'])).toMatchInlineSnapshot(`NaN`)); // NaN is correct
  test('Missing Param Declared JS Function', () =>
    expect(evaluate(['f4'])).toMatchInlineSnapshot(
      `["f4", ["Error", "'missing'"]]`
    )); // Error is correct
});

describe('Anonymous function with too many params', () => {
  test('Too many params: Function', () =>
    expect(() => evaluate(['f1', 10, 20])).toThrowErrorMatchingInlineSnapshot(
      `Too many arguments for function "(q) |-> q + 1": expected 1, got 2`
    ));

  test('Too many params: Expression', () =>
    expect(() => evaluate(['f2', 10, 20])).toThrow());

  test('Too many params: JS Function', () =>
    expect(evaluate(['f3', 10, 20])).toMatchInlineSnapshot(`11`));

  test('Too many params: Declared JS Function: arguments are checked by Compute Engine', () =>
    expect(evaluate(['f4', 10, 20])).toMatchInlineSnapshot(
      `["f4", 10, ["Error", "unexpected-argument", "'20'"]]`
    )); // Error is correct
});

describe('Anonymous function with anonymous parameters', () => {
  test('Anon Param: F5', () =>
    expect(evaluate(['f5', 10])).toMatchInlineSnapshot(`["Add", "_", 1]`));
  test('Anon Param: F6', () =>
    expect(evaluate(['f6', 10])).toMatchInlineSnapshot(`["Add", "_1", 1]`));
  test('Anon Param: F8', () =>
    expect(evaluate(['f8', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F9', () =>
    expect(evaluate(['f9', 10])).toMatchInlineSnapshot(`11`));
});

describe('Currying', () => {
  test('f7 expects two arguments. Only one provided', () =>
    expect(evaluate(['f10', 5])).toMatchInlineSnapshot(
      `["Function", ["Add", "_2_0", ["Divide", 5, "_1_0"]]]`
    ));
});

describe('Apply', () => {
  // Note: we use 'x' both as a the param, and as the argument to
  // ensure the correct definition is used. Should not create an infinite loop.
  test('Function', () =>
    expect(
      evaluate(['Apply', ['Function', 'x', 'x'], 'x'])
    ).toMatchInlineSnapshot(`x`));
  test('Function and Hold', () =>
    expect(
      evaluate(['Apply', ['Function', 'x', 'x'], ['Hold', 'x']])
    ).toMatchInlineSnapshot(`["Hold", "x"]`));

  test('Apply to non-function literal', () => {
    engine.pushScope();
    engine.declare('f', 'any');
    engine.assign('f', 36);

    expect(evaluate(['f', 42])).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'function'", "'finite_integer'"],
        "'36'"
      ]
    `);

    engine.assign('f', ['Add', '_', 1]);

    expect(evaluate(['f', 42])).toMatchInlineSnapshot(`43`);
  });
});

describe('Pipe', () => {
  test('applies a function symbol to a value', () =>
    // 5 is exact, so Sin stays symbolic per the exactness contract
    expect(evaluate(['Pipe', 5, 'Sin'])).toMatchInlineSnapshot(`["Sin", 5]`));

  test('applies a function symbol to an inexact value (numericizes)', () =>
    expect(evaluate(['Pipe', 0, 'Sin'])).toMatchInlineSnapshot(`0`));

  test('applies a lambda', () =>
    expect(
      evaluate(['Pipe', 4, ['Function', ['Add', 'x', 1], 'x']])
    ).toMatchInlineSnapshot(`5`));

  test('chains left-associate (inner stage first)', () =>
    // Pipe(Pipe(9, Sqrt), Negate) = Negate(Sqrt(9)) = -3
    expect(
      evaluate(['Pipe', ['Pipe', 9, 'Sqrt'], 'Negate'])
    ).toMatchInlineSnapshot(`-3`));

  test('N() numericizes the applied result', () =>
    expect(engine.box(['Pipe', 5, 'Sin']).N().re).toBeCloseTo(
      Math.sin(5),
      10
    ));

  // `x |> f` must behave exactly like `f(x)`, so a LAZY `f` receives `x`
  // unevaluated — Pipe holds its operands. Evaluating `x` eagerly stripped a
  // bare function reference of its definition, so `Pipe(F, JacobianMatrix)`
  // could not see F's body.
  test('a lazy right-hand side receives its argument unevaluated', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.parse('(x, y, z) \\mapsto \\lbrack x^2 y, x + z, y\\rbrack'));
    const piped = ce.box(['Pipe', 'F', 'JacobianMatrix']).evaluate();
    const direct = ce.function('JacobianMatrix', [ce.symbol('F')]).evaluate();
    expect(piped.isSame(direct)).toBe(true);
  });

  test('a chain ending in a lazy stage reduces fully', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.parse('(x, y, z) \\mapsto \\lbrack x^2 y, x + z, y\\rbrack'));
    // F |> JacobianMatrix |> Determinant |> Simplify
    const chain = ce.box([
      'Pipe',
      ['Pipe', ['Pipe', 'F', 'JacobianMatrix'], 'Determinant'],
      'Simplify',
    ]);
    expect(chain.evaluate().toString()).toBe('-2x * y');
  });

  test('a chained topic is evaluated before a lazy stage', () =>
    // Pipe(Pipe([[a,b],[c,d]], Determinant), Simplify) — the inner pipe is a
    // value that must reach Simplify evaluated.
    expect(
      evaluate([
        'Pipe',
        ['Pipe', ['List', ['List', 'a', 'b'], ['List', 'c', 'd']], 'Determinant'],
        'Simplify',
      ])
    ).toMatchInlineSnapshot(`["Subtract", ["Multiply", "a", "d"], ["Multiply", "b", "c"]]`));
});

describe('Argument Evaluation', () => {
  test('Hold expressions are not evaluated', () =>
    expect(evaluate(['Add', ['Hold', ['Add', 2, 5]], 7])).toMatchInlineSnapshot(
      `["Add", 7, ["Hold", ["Add", 2, 5]]]`
    ));

  test('Hold variables are not evaluated', () =>
    expect(evaluate(['Add', 'h', 7])).toMatchInlineSnapshot(
      `["Add", 7, ["Hold", ["Add", 2, 6]]]`
    ));

  test('To evaluate a Hold expressions it must be wrapped in ReleaseHold', () =>
    expect(
      evaluate(['Add', ['ReleaseHold', ['Hold', ['Add', 2, 5]]], 7])
    ).toMatchInlineSnapshot(`14`));

  test('To evaluate a Hold variable it must be wrapped in ReleaseHold', () =>
    expect(evaluate(['Add', ['ReleaseHold', 'h'], 7])).toMatchInlineSnapshot(
      `["Add", 7, ["Hold", ["Add", 2, 6]]]`
    ));

  test('An Unevaluated expression is unwrapped when evaluated', () =>
    expect(
      evaluate(['Add', ['Unevaluated', ['Add', 5, 11]], 7])
    ).toMatchInlineSnapshot(`23`));

  test('An Unevaluated variable is unwrapped when evaluated', () =>
    expect(evaluate(['Add', 'u', 7])).toMatchInlineSnapshot(`15`));
});

describe('Changing type from function to non-function', () => {
  test('Changing type from value to function', () => {
    engine.pushScope();
    engine.declare('f20', 'any');
    engine.assign('f20', 42);
    engine.assign('f20', ['Function', ['Multiply', 'x', 2], 'x']);

    expect(engine.expr(['f20', 42]).evaluate().re).toEqual(84);
    engine.popScope();
  });

  test('Changing type from function to value', () => {
    engine.pushScope();
    engine.declare('f20', 'any');
    engine.assign('f20', ['Function', ['Multiply', 'x', 2], 'x']);
    expect(engine.expr(['f20', 3]).evaluate().re).toEqual(6);

    // Reassigning from operator to value is allowed (#288)
    engine.assign('f20', 42);
    expect(engine.expr('f20').evaluate().re).toEqual(42);

    engine.popScope();
  });
});

// REVIEW.md G4: a function-literal head, e.g. [["Function", body, "x"], arg],
// used to throw ("The first element of an array should be a string"), even
// though the explicit ["Apply", ["Function", ...], arg] form worked. Boxing a
// function-literal head now beta-reduces, consistent with Apply.
describe('Function-literal head application (G4)', () => {
  test('[[Function, x+1, x], 5] beta-reduces to 6', () =>
    expect(
      engine.expr([['Function', ['Add', 'x', 1], 'x'], 5]).evaluate().re
    ).toBe(6));

  test('parity with explicit Apply form', () => {
    const direct = engine
      .expr([['Function', ['Add', 'x', 1], 'x'], 5])
      .evaluate();
    const viaApply = engine
      .expr(['Apply', ['Function', ['Add', 'x', 1], 'x'], 5])
      .evaluate();
    expect(direct.isSame(viaApply)).toBe(true);
  });

  test('multi-argument lambda head', () =>
    expect(
      engine
        .expr([['Function', ['Add', 'x', 'y'], 'x', 'y'], 3, 4])
        .evaluate().re
    ).toBe(7));
});

// N() must numericize through user-defined function application: the
// caller's `numericApproximation` option was dropped at the
// function-application seam, so `N(f(2))` returned an exact value (`2/3`).
// A fresh engine (rather than the shared one) is used so each assertion
// reproduces the reported bug faithfully and guards the fix.
describe('N() through user-defined function application', () => {
  const ce = new ComputeEngine();
  ce.parse('f(x) := x/3').evaluate();
  ce.parse('g(x) := 2x').evaluate();
  ce.assign('lnfn', ['Function', ['Ln', 'x'], 'x']);

  // Assert on the *returned form* (a float literal, not the exact rational
  // `2/3`); reading `.re` would numericize on access and hide the bug.
  test('N(f(2)) numericizes', () =>
    expect(ce.parse('f(2)').N().isExact).toBe(false));

  test('f(2).evaluate() stays exact', () =>
    expect(ce.parse('f(2)').evaluate().toString()).toBe('2/3'));

  test('exactness contract preserved: ln-function stays symbolic', () =>
    expect(ce.box(['lnfn', 2]).evaluate().toString()).toBe('ln(2)'));

  test('N(ln-function) numericizes', () => {
    const r = ce.box(['lnfn', 2]).N();
    expect(r.isNumberLiteral && r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(Math.log(2));
  });

  test('nested N(g(f(2)))', () => {
    const r = ce.box(['g', ['f', 2]]).N();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo((2 / 3) * 2);
  });

  test('lambda case N((x |-> x/3)(2))', () =>
    expect(
      ce.box(['Apply', ['Function', ['Divide', 'x', 3], 'x'], 2]).N().isExact
    ).toBe(false));

  test('async N(f(2)) numericizes', async () =>
    expect(
      (await ce.parse('f(2)').evaluateAsync({ numericApproximation: true }))
        .isExact
    ).toBe(false));
});

describe('MAPSTO BODY PRECEDENCE', () => {
  // The `\mapsto` body extends through comparisons and logical connectives,
  // stopping only at the comma/sequence level. Regression: at the previous
  // rhs floor (ARROW_PRECEDENCE), `n \mapsto n > 102` mis-parsed as
  // `(n \mapsto n) > 102`.
  test('comparison in body', () =>
    // (canonical form: `Block`-wrapped body, `n > 102` normalized to
    // `Less(102, n)`)
    expect(engine.parse('n \\mapsto n > 102').json).toEqual([
      'Function',
      ['Block', ['Less', 102, 'n']],
      'n',
    ]));

  test('logical connective in body', () =>
    expect(engine.parse('n \\mapsto n > 2 \\wedge n < 5').json).toEqual([
      'Function',
      ['Block', ['And', ['Less', 2, 'n'], ['Less', 'n', 5]]],
      'n',
    ]));

  test('lambda in non-final argument does not swallow the next argument', () =>
    expect(
      engine.parse(
        '\\mathrm{Map}(n \\mapsto n > 102, \\mathrm{Range}(100,105))'
      ).json
    ).toEqual([
      'Map',
      ['Function', ['Greater', 'n', 102], 'n'],
      ['Range', 100, 105],
    ]));

  test('filter with unparenthesized predicate evaluates', () =>
    expect(
      engine
        .parse('\\mathrm{Filter}(\\mathrm{Range}(100,105), n \\mapsto n > 102)')
        .evaluate()
        .toString()
    ).toBe('[103,104,105]'));
});

describe('makeLambda post-evaluation parameter substitution', () => {
  beforeAll(() => {
    engine.pushScope();
    // Undetermined boolean condition so `If`/`Which` stays symbolic (held).
    engine.declare('flm_M', 'boolean');
  });
  afterAll(() => engine.popScope());

  // Finding 1 (capture avoidance): applying `(w ↦ (w ↦ w))` to `1` must NOT
  // rewrite the INNER binder's `w`. The substitution of the outer parameter is
  // capture-avoiding, so the returned lambda `w ↦ w` is preserved verbatim.
  test('returned lambda that shadows the parameter is not captured', () => {
    const inner = engine.expr(['Function', 'w', 'w']);
    const outer = engine.expr(['Function', inner, 'w']);
    const result = engine
      .function('Apply', [outer, engine.number(1)])
      .evaluate();
    expect(result.json).toEqual(['Function', ['Block', 'w'], 'w']);
  });

  // Finding 2 (narrowed self-reference guard): applying `w ↦ If(flm_M, w, 0)`
  // (held conditional, undetermined condition) to `w + 1` must substitute the
  // held `w` even though the argument itself references `w`. Previously the
  // guard suppressed all substitution when the argument contained the same
  // symbol, leaving a bare `w` in the held branch.
  test('held conditional branch is substituted when argument shares the symbol', () => {
    const f = engine.expr(['Function', ['If', 'flm_M', 'w', 0], 'w']);
    const result = engine
      .function('Apply', [f, engine.box(['Add', 'w', 1])])
      .evaluate();
    expect(result.json).toEqual(['If', 'flm_M', ['Add', 'w', 1], 0]);
  });

  // Guard against regressing the double-wrap cases the original guard protected:
  // a body that RESOLVED the parameter to its value must not re-substitute.
  test('resolved self-referential argument is not double-wrapped', () => {
    const id = engine.expr(['Function', 'w', 'w']);
    // id(Hold(w)) stays Hold(w), not Hold(Hold(w)).
    expect(
      engine
        .function('Apply', [id, engine.box(['Hold', 'w'])])
        .evaluate().json
    ).toEqual(['Hold', 'w']);
    // (w ↦ w + 1)(w + 1) is w + 2, not w + 3.
    const inc = engine.expr(['Function', ['Add', 'w', 1], 'w']);
    expect(
      engine
        .function('Apply', [inc, engine.box(['Add', 'w', 1])])
        .evaluate()
        .toString()
    ).toBe('w + 2');
  });
});

describe('ASYNC LANE KEEPS A SCOPED HANDLER’S LOCAL SCOPE ALIVE', () => {
  // An `evaluateAsync` handler returns at its FIRST SUSPENSION POINT, not at
  // completion. The dispatcher used to pop the operator's local eval context
  // on that return, so anything the resumed handler did ran against the
  // enclosing scope. A big operator whose reduction outlives one `runAsync`
  // chunk (>16ms) then assigned its loop index globally.
  //
  // The bound counts below are chosen to straddle that 16ms chunk: the small
  // sum completes inside one chunk (never suspends), the large one does not.
  // Sized by MEASUREMENT, not margin: 20 000 terms already takes ~110ms, far
  // past the ~16ms chunk, so it reliably suspends. Bigger bounds only make the
  // suite slower — these tests time out under full-suite parallel load if they
  // are oversized.
  const SMALL = 10;
  const LARGE = 60_000;
  // Still in flight while a poller watches it (~250ms of work)
  const BIGGER_FOR_SUSPEND = 100_000;
  const sum = (index: string, upper: number): Expression => [
    'Sum',
    [index, 1, upper],
  ];
  const gauss = (n: number) => (n * (n + 1)) / 2;

  test('an index spelled `i` is the loop index, not ImaginaryUnit', async () => {
    // The loud case: global `i` is a CONSTANT (ImaginaryUnit), so the stray
    // assign threw `Cannot assign a value to the constant "i"` — and `i` is
    // the commonest summation index there is.
    const ce = new ComputeEngine();
    const result = await ce.parse(`\\sum_{i=1}^{${LARGE}} i`).evaluateAsync();
    expect(result.toString()).toBe(String(gauss(LARGE)));
    // `i` is left untouched as the imaginary unit
    expect(ce.box('i').type.toString()).toBe('imaginary');
  });

  test('the index does not leak into the global scope', async () => {
    const ce = new ComputeEngine();
    await ce.parse(`\\sum_{k=1}^{${LARGE}} k`).evaluateAsync();
    expect(ce.box('k').value).toBeUndefined();
  });

  test('an outer binding of the same name is not clobbered', async () => {
    // The silent case: the sum returned the RIGHT answer while overwriting
    // the caller's `n`.
    const ce = new ComputeEngine();
    ce.assign('n', 7);
    const result = await ce.parse(`\\sum_{n=1}^{${LARGE}} n`).evaluateAsync();
    expect(result.toString()).toBe(String(gauss(LARGE)));
    expect(ce.box('n').value?.toString()).toBe('7');
  });

  test('async matches sync, suspended or not', async () => {
    const ce = new ComputeEngine();
    for (const upper of [SMALL, LARGE]) {
      const expr = ce.box(sum('i', upper));
      expect((await expr.evaluateAsync()).toString()).toBe(
        expr.evaluate().toString()
      );
    }
  });

  // Holding the local context across the `await` means a SECOND evaluation
  // started while the first is suspended interleaves its own push, so the
  // first one's frame is no longer on top when it unwinds. (Measured: the two
  // frames do coexist — the stack reaches depth 4, and the first unwind finds
  // its own frame at index 2 of 4.) The frame is therefore removed by
  // IDENTITY, so an unwinding evaluation cannot dispose a still-running one's
  // bindings.
  //
  // HONESTY NOTE: these are CHARACTERIZATION tests, not discriminating
  // regression tests. They also pass against the pop-the-top and unwind-by-
  // depth versions: on this workload the wrong frame being disposed has no
  // observable effect (the stack still rebalances, and the sums still come out
  // right). They pin the outcome so a future change that DOES make it
  // observable fails here. Do not read a pass as proof the removal is correct.
  describe('concurrent async evaluation', () => {
    // Asymmetric ON PURPOSE: the smaller sum is started FIRST, so it settles
    // while the larger one is still mid-flight — the ordering that makes one
    // evaluation unwind through another's live frame.
    const SMALLER = 20_000;
    const BIGGER = 40_000;

    // `allSettled`, not `all`: a fast reject would leave the other evaluation
    // still looping past the assertions (and past the end of the test).
    const runBoth = async (first: string, second: string) => {
      const ce = new ComputeEngine();
      const depth = ce._evalContextStack.length;
      const settled = await Promise.allSettled([
        ce.parse(`\\sum_{${first}=1}^{${SMALLER}} ${first}`).evaluateAsync(),
        ce.parse(`\\sum_{${second}=1}^{${BIGGER}} ${second}`).evaluateAsync(),
      ]);
      return { ce, depth, settled };
    };

    const values = (settled: PromiseSettledResult<Expression>[]) =>
      settled.map((s) =>
        s.status === 'fulfilled' ? s.value.toString() : `REJECTED: ${s.reason}`
      );
    const expected = [String(gauss(SMALLER)), String(gauss(BIGGER))];

    // The invariant that actually regressed: BOTH results must be right. A
    // depth-only assertion passes even when one evaluation has corrupted the
    // other, because the stack self-heals.
    test('both evaluations still compute the correct result', async () => {
      const { settled } = await runBoth('q', 'w');
      expect(values(settled)).toEqual(expected);
    });

    // The adversarial spelling: the two evaluations use the SAME index name,
    // so any cross-talk between their scopes shows up as a wrong sum.
    test('a shared index name does not cross-talk', async () => {
      const { ce, settled } = await runBoth('m', 'm');
      expect(values(settled)).toEqual(expected);
      expect(ce.box('m').value).toBeUndefined();
    });

    test('the engine is left clean', async () => {
      const { ce, depth } = await runBoth('q', 'w');
      expect(ce._evalContextStack.length).toBe(depth);
      expect(ce.box('q').value).toBeUndefined();
      expect(ce.box('w').value).toBeUndefined();
      expect(ce.parse('1+1').evaluate().toString()).toBe('2');
    });
  });

  // KNOWN LIMITATION, pinned so a change of behavior is deliberate: while an
  // async evaluation is suspended, its scope is the engine's current one, so
  // code that enters the engine in that window can SEE the loop index. Outer
  // bindings still resolve correctly through the scope's parent chain, and the
  // index is gone once the evaluation settles. Making this invisible needs
  // per-evaluation (task-local) context propagation.
  test('a suspended evaluation’s index is visible to a mid-flight caller', async () => {
    const ce = new ComputeEngine();
    ce.assign('a', 42);
    const pending = ce
      .parse(`\\sum_{z=1}^{${BIGGER_FOR_SUSPEND}} z`)
      .evaluateAsync();

    // POLL rather than sleep a fixed interval: a single sleep races the
    // evaluation finishing, which would make this test flaky under load.
    let sawIndex = false;
    let outerStayedCorrect = true;
    for (let i = 0; i < 100 && !sawIndex; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (ce.box('z').value !== undefined) sawIndex = true;
      // Enclosing bindings resolve through the scope's parent chain throughout
      if (ce.parse('a+1').evaluate().toString() !== '43')
        outerStayedCorrect = false;
    }
    expect(outerStayedCorrect).toBe(true);
    expect(sawIndex).toBe(true);

    await pending;
    // ...and it is gone again once the evaluation settles
    expect(ce.box('z').value).toBeUndefined();
    expect(ce._evalContextStack.length).toBe(2);
  });

  test('cancellation still reports as a CancellationError', async () => {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    setTimeout(() => controller.abort('user'), 40);
    // Assert the ERROR IDENTITY, not merely that something threw: a bare
    // `toThrow()` would also accept the `Cannot assign a value to the
    // constant "i"` failure this suite exists to prevent.
    await expect(
      ce.parse('\\sum_{i=1}^{100000000} i').evaluateAsync({
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'user' });
    // ...and the engine is left usable, with `i` intact
    expect(ce.parse('1+1').evaluate().toString()).toBe('2');
    expect(ce.box('i').type.toString()).toBe('imaginary');
  });
});
