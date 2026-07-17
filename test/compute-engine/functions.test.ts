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
