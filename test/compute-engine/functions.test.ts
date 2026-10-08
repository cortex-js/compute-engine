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
      `["Function", ["Add", "_1_0", 1], "_1_0"]`
    )); // @fixme
  test('Missing Param JS Function', () =>
    expect(evaluate(['f3'])).toMatchInlineSnapshot(`NaN`)); // NaN is correct
  test('Missing Param Declared JS Function', () =>
    expect(evaluate(['f4'])).toMatchInlineSnapshot(
      `["Error", "'missing'", ["ErrorTrace", ["ErrorFrame", "'f4'", 1]]]`
    )); // Error is correct (rung 3: the missing-argument error bubbles out)
});

describe('Anonymous function with too many params', () => {
  test('Too many params: Function', () =>
    expect(() => evaluate(['f1', 10, 20])).toThrowErrorMatchingInlineSnapshot(
      `Too many arguments for function "(q) => q + 1": expected 1, got 2`
    ));

  test('Too many params: Expression', () =>
    expect(() => evaluate(['f2', 10, 20])).toThrow());

  test('Too many params: JS Function', () =>
    expect(evaluate(['f3', 10, 20])).toMatchInlineSnapshot(`11`));

  test('Too many params: Declared JS Function: arguments are checked by Compute Engine', () =>
    expect(evaluate(['f4', 10, 20])).toMatchInlineSnapshot(`
      [
        "Error",
        "unexpected-argument",
        "'20'",
        ["ErrorTrace", ["ErrorFrame", "'f4'", 2]]
      ]
    `)); // Error is correct (rung 3: the arity error bubbles out)
});

describe('Anonymous function with anonymous parameters', () => {
  // f5/f6 are the `["Function", body]` spelling (no explicit parameter list);
  // f8/f9 are the bare-expression shorthand. The two must agree: the
  // anonymous parameters used by the body ARE the parameter list.
  // These two snapshots read `11` until 0e8c11b9 replaced
  // `canonicalFunctionExpression` (which derived the wildcard parameters from
  // the body) with `canonicalFunctionLiteral`; they then absorbed the
  // regression as `["Add", "_", 1]` — the literal had become a NULLARY
  // function that never bound its argument.
  test('Anon Param: F5', () =>
    expect(evaluate(['f5', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F6', () =>
    expect(evaluate(['f6', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F8', () =>
    expect(evaluate(['f8', 10])).toMatchInlineSnapshot(`11`));
  test('Anon Param: F9', () =>
    expect(evaluate(['f9', 10])).toMatchInlineSnapshot(`11`));

  test('`["Function", body]` ≡ the bare shorthand, on every route', () => {
    const ce = new ComputeEngine();
    // A body with wildcards makes them the parameters...
    expect(ce.box(['Apply', ['Function', ['Add', '_', 1]], 10]).evaluate().re).toBe(
      11
    );
    expect(
      ce.box(['Apply', ['Function', ['Add', '_1', '_2']], 3, 4]).evaluate().re
    ).toBe(7);
    // ...but a body with NO wildcard stays a nullary thunk (`["Function", 42]`
    // and `["Function", ["Add", "x", 1]]` are not unary functions).
    expect(ce.box(['Function', 42]).type.toString()).toBe(
      '() -> integer'
    );
    expect(ce.box(['Apply', ['Function', ['Add', 'x', 1]]]).evaluate().toString()).toBe(
      'x + 1'
    );
  });

  test('a wildcard lambda round-trips through its own serialization', () => {
    // `toMathJson()` serializes a wildcard-parameter lambda by DROPPING the
    // parameter list, so `["Function", body]` is the engine's OWN output and
    // has to canonicalize back to the same lambda.
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Greater', '_1', 5], '_1']);
    const json = f.toMathJson();
    expect(JSON.stringify(json)).toMatchInlineSnapshot(
      `["Function",["Less",5,"_1"]]`
    );
    expect(ce.box(['Apply', ce.box(json as Expression), 7]).evaluate().symbol).toBe(
      'True'
    );
  });

  test('collection predicates accept the `["Function", body]` spelling', () => {
    const ce = new ComputeEngine();
    const xs: Expression = ['List', 5, 2, 10, 18];
    const pred: Expression = ['Function', ['Greater', '_', 5]];
    expect(ce.box(['CountIf', xs, pred]).evaluate().re).toBe(2);
    expect(ce.box(['Position', xs, pred]).evaluate().toString()).toBe('[3,4]');
    expect(ce.box(['Find', xs, pred]).evaluate().re).toBe(10);
    expect(ce.box(['IndexWhere', xs, pred]).evaluate().re).toBe(3);
    expect(
      ce.box(['Filter', xs, ['Function', ['Less', '_', 10]]]).evaluate().toString()
    ).toBe('[5,2]');
    expect(ce.box(['Any', xs, ['Function', ['Greater', '_', 15]]]).evaluate().symbol).toBe(
      'True'
    );
    expect(ce.box(['All', xs, ['Function', ['Greater', '_', 5]]]).evaluate().symbol).toBe(
      'False'
    );
  });
});

// GitHub issue #381: a `Function` with no parameter list takes its
// parameters from the anonymous slots (`_`, `_1`…`_9`) of its body. A slot
// inside a NESTED shorthand `Function` literal belongs to that literal and is
// not a parameter of the enclosing one. A nested literal WITH a parameter
// list binds only the names it declares: another slot in its body refers to
// the enclosing literal.
describe('Anonymous parameters stop at a nested Function literal', () => {
  test('a nested literal applied in place', () => {
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Add', '_1', [['Function', ['Multiply', '_1', '_2']], 2, 3]],
    ];
    expect(ce.box(f).ops!.slice(1).map(String)).toEqual(['_1']);
    expect(
      ce
        .box([f, 5] as Expression)
        .evaluate()
        .toString()
    ).toBe('11');
  });

  test('the bare `_` in both literals', () => {
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Add', '_', [['Function', ['Multiply', '_', 10]], 2]],
    ];
    expect(ce.box(f).ops!.slice(1).map(String)).toEqual(['_1']);
    expect(
      ce
        .box([f, 1] as Expression)
        .evaluate()
        .toString()
    ).toBe('21');
  });

  test('a nested literal whose explicit parameters are `_` and `_1`', () => {
    // Renaming the outer `_` to `_1` must not rename the inner parameter `_`,
    // or the inner literal would have two parameters named `_1`.
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      [
        'Add',
        '_',
        ['Apply', ['Function', ['Subtract', '_', '_1'], '_', '_1'], 5, 2],
      ],
    ];
    expect(
      ce
        .box([f, 1] as Expression)
        .evaluate()
        .toString()
    ).toBe('4');
  });

  test('a nested literal that declares `_1` uses the outer `_`', () => {
    // The outer `_` is not renamed `_1`: inside the nested literal, `_1` is
    // that literal's parameter, so the renamed symbol would refer to it.
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Apply', ['Function', ['Add', '_1', '_'], '_1'], 2],
    ];
    expect(ce.box(f).ops!.slice(1).map(String)).toEqual(['_']);
    expect(ce.box(['Apply', f, 5]).evaluate().toString()).toBe('7');
  });

  test('a nested literal that is not applied in place', () => {
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Map', ['Function', ['Add', '_1', '_1']], ['List', 1, 2]],
    ];
    expect(ce.box(f).nops).toBe(1);
    expect(
      ce
        .box([f] as Expression)
        .evaluate()
        .toString()
    ).toBe('[2,4]');
  });

  test('a nested literal with its own parameter list', () => {
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Map', ['Function', ['Add', 'x', '_1'], '_1'], ['List', 1, 2]],
    ];
    expect(ce.box(f).nops).toBe(1);
  });

  test('a slot that a nested literal does not declare is the outer parameter', () => {
    // The inner literal declares only `x`, so its `_1` is the parameter of
    // the outer shorthand literal: (5 * 2).
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Apply', ['Function', ['Multiply', '_1', 'x'], 'x'], 2],
    ];
    expect(ce.box(f).ops!.slice(1).map(String)).toEqual(['_1']);
    expect(ce.box(['Apply', f, 5]).evaluate().toString()).toBe('10');
  });

  test('a bare `_` that a nested literal does not declare is the outer parameter', () => {
    const ce = new ComputeEngine();
    const f: Expression = [
      'Function',
      ['Apply', ['Function', ['Multiply', '_', 'x'], 'x'], 2],
    ];
    expect(ce.box(['Apply', f, 5]).evaluate().toString()).toBe('10');
  });

  test('a shorthand pipe stage whose nested literal uses `_1` is unary', () => {
    // The `_1` belongs to the nested shorthand literal, so the stage has the
    // one parameter `_` and the pipe canonicalizes it to a unary literal.
    const ce = new ComputeEngine();
    const pipe = ce.box([
      'Pipe',
      ['List', 1, 2],
      [
        'Function',
        ['Add', '_', ['Apply', ['Function', ['Multiply', '_1', 10]], 1]],
      ],
    ]);
    expect(pipe.op2.operator).toBe('Function');
    expect(pipe.op2.nops).toBe(2);
    expect(pipe.op2.toString()).toBe('(_) => _ + Apply((_) => 10 * _, 1)');
    expect(pipe.evaluate().toString()).toBe('[11,12]');
  });

  test('the shorthand body of a callback', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Map',
          ['Add', '_', ['Apply', ['Function', ['Multiply', '_1', 10]], 1]],
          ['List', 1, 2],
        ])
        .evaluate()
        .toString()
    ).toBe('[11,12]');
  });

  test('a pipe stage whose only slot is in a nested literal gets the topic', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Pipe', ['List', 1, 2], ['Map', ['Function', ['Add', '_', 1]]]])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
  });

  test('the LaTeX `()\\mapsto` spelling', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse(
          '(()\\mapsto\\operatorname{\\_1}+(()\\mapsto\\operatorname{\\_1}\\operatorname{\\_2})(2,3))(5)'
        )
        .evaluate()
        .toString()
    ).toBe('11');
  });

  test('a parameter used only in a nested literal keeps the parameter list', () => {
    // The serializer drops a parameter list only when boxing reads it back.
    // `_2` here is used only inside the nested literal, so boxing
    // `["Function", body]` would give one parameter, not two.
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', '_1', ['Apply', ['Function', ['Multiply', '_2', 3], '_2'], 4]],
      '_1',
      '_2',
    ]);
    const json = f.toMathJson({ prettify: true });
    expect(JSON.stringify(json)).toBe(
      '["Function",["Add","_1",["Apply",["Function",["Multiply",3,"_2"],"_2"],4]],"_1","_2"]'
    );
    expect(ce.box(json as Expression).nops).toBe(3);
  });
});

describe('Currying', () => {
  test('f7 expects two arguments. Only one provided', () =>
    // The renamed parameters are printed: the parameter-less shorthand is
    // reserved for `_1`, `_2`, … (what boxing reads back off the body), and
    // `["Function", ["Add", "_2_0", …]]` alone would box as a function of no
    // argument.
    expect(evaluate(['f10', 5])).toMatchInlineSnapshot(
      `["Function", ["Add", "_2_0", ["Divide", 5, "_1_0"]], "_1_0", "_2_0"]`
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
        ["ErrorCode", "incompatible-type", "'function'", "'36'"],
        "'36'"
      ]
    `);

    engine.assign('f', ['Add', '_', 1]);

    expect(evaluate(['f', 42])).toMatchInlineSnapshot(`43`);
  });

  // These assert clean-engine contracts (the shared `engine` has `f` bound by
  // an earlier test), so they use a fresh engine.

  // A string function operand used to crash `makeLambda` with an uncaught
  // `Error: Invalid function literal`; it now declines and `apply` falls
  // through to the symbolic form.
  test('a string operand does not crash', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Apply', { str: 'abc' }, 5]).evaluate().toString()).toBe(
      'Apply("abc", 5)'
    );
  });

  // A function-valued expression (not a `Function` literal) DENOTES a function
  // and cannot be beta-reduced: applying it stays symbolic instead of
  // substituting the argument for its free symbol.
  test('applying InverseFunction(f) stays symbolic', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Apply', ['InverseFunction', 'f'], 2]).evaluate().toString()
    ).toBe('Apply(InverseFunction(f), 2)');
  });

  // Regression: an unresolved symbolic derivative applied to an argument must
  // stay symbolic (beta-reducing it recurses forever — stack overflow).
  test('applying Derivative(f, 1) stays symbolic', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Apply', ['Derivative', 'f', 1], 0]).evaluate().toString()
    ).toBe('Apply(Derivative(f, 1), 0)');
  });

  // Same class as InverseFunction: an `NDSolveFunction` that declines to
  // evaluate (symbolic coefficient `a`) is a function-typed residual, not a
  // shorthand lambda body.
  test('applying an unevaluated NDSolveFunction stays symbolic', () => {
    const ce = new ComputeEngine();
    const residual = [
      'NDSolveFunction',
      ['Equal', ['Derivative', 'y', 1], ['Multiply', 'a', 'y']],
      'y',
      ['Tuple', 0, 1],
      1,
    ];
    expect(ce.box(['Apply', residual, 0.5]).evaluate().toString()).toBe(
      'Apply(NDSolveFunction(Derivative(y, 1) == a * y, y, Limits("Nothing", 0, 1), 1), 0.5)'
    );
  });

  // A shorthand body with a wildcard is a genuine lambda and still reduces.
  test('a wildcard shorthand still beta-reduces', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Apply', ['Add', '_', 1], 5]).evaluate().toString()).toBe(
      '6'
    );
  });

  // `Apply` keeps the constant-nullary shorthand contract. `Map` no longer
  // shares it: a parameterless operand at a CALLBACK slot is rejected across
  // the whole collection family (ruled 2026-08-09), which is what makes
  // `Map(3, xs)` agree with `Sort(xs, 3)` and `CountIf(xs, 3)` — all three
  // used to disagree. `Apply(3, 5)` is not a callback slot: it is the explicit
  // "apply this thing" operator, and applying a constant is its documented
  // shorthand.
  test('a non-function literal operand is a constant nullary for `Apply`', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Apply', 3, 5]).evaluate().toString()).toBe('3');
    expect(
      ce.box(['Map', 3, ['List', 1, 2]]).errors[0]?.toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "function", "3"), 3)'
    );
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
    expect(engine.box(['Pipe', 5, 'Sin']).N().re).toBeCloseTo(Math.sin(5), 10));

  // `x |> f` must behave exactly like `f(x)`, so a LAZY `f` receives `x`
  // unevaluated — Pipe holds its operands. Evaluating `x` eagerly stripped a
  // bare function reference of its definition, so `Pipe(F, JacobianMatrix)`
  // could not see F's body.
  test('a lazy right-hand side receives its argument unevaluated', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'F',
      ce.parse('(x, y, z) \\mapsto \\lbrack x^2 y, x + z, y\\rbrack')
    );
    const piped = ce.box(['Pipe', 'F', 'JacobianMatrix']).evaluate();
    const direct = ce.function('JacobianMatrix', [ce.symbol('F')]).evaluate();
    expect(piped.isSame(direct)).toBe(true);
  });

  test('a chain ending in a lazy stage reduces fully', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'F',
      ce.parse('(x, y, z) \\mapsto \\lbrack x^2 y, x + z, y\\rbrack')
    );
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
        [
          'Pipe',
          ['List', ['List', 'a', 'b'], ['List', 'c', 'd']],
          'Determinant',
        ],
        'Simplify',
      ])
    ).toMatchInlineSnapshot(
      `["Subtract", ["Multiply", "a", "d"], ["Multiply", "b", "c"]]`
    ));

  // A shorthand-lambda placeholder in the pipe STAGE is that stage's
  // parameter, not a reference to a same-named global. `Pipe` canonicalizes
  // its held right operand in the caller's scope, so a VALUED global `_1`
  // used to capture it: `Map`'s canonical handler saw a non-collection source
  // and declined, leaving the whole pipe unevaluated.
  test('a placeholder shadows a valued global of the same name', () => {
    const ce = new ComputeEngine();
    const pipe = () =>
      ce.box([
        'Pipe',
        ['List', 1, 2, 3],
        ['Map', ['Function', ['Square', 'k'], 'k'], '_1'],
      ]);
    // `Map` is a lazy collection: `toString` materializes it.
    expect(pipe().evaluate().toString()).toBe('[1,4,9]');
    ce.box(['Assign', '_1', 7]).evaluate();
    expect(pipe().evaluate().toString()).toBe('[1,4,9]');
    // ...and the global is untouched.
    expect(ce.box('_1').evaluate().re).toEqual(7);
  });

  // A statically-refutable rhs (number/string/boolean literal) can never be a
  // function, so `Pipe` rejects it with an `incompatible-type` error — at
  // canonicalization in strict mode and at evaluation otherwise. (This is
  // stricter than `Apply`, which treats a non-function literal as a constant
  // nullary — a deliberate, accepted asymmetry.)
  test('a number literal rhs is rejected (strict canonical route)', () => {
    const piped = engine.box(['Pipe', 5, 3]);
    expect(piped.isValid).toBe(false);
    expect(exprToString(piped)).toMatchInlineSnapshot(`
      [
        "Pipe",
        5,
        [
          "Error",
          ["ErrorCode", "incompatible-type", "'function'", "'3'"],
          "'3'"
        ]
      ]
    `);
  });

  // The rhs error is BUBBLED, not frozen into the `Pipe`: applying something
  // that is itself an `Error` evaluates to that error (rung 2 of
  // `docs/LANGUAGE-MODEL.md`).
  test('a number literal rhs is rejected (evaluate route)', () =>
    expect(evaluate(['Pipe', 5, 3])).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'function'", "'3'"],
        "'3'"
      ]
    `));

  test('a string literal rhs is rejected without crashing', () =>
    expect(evaluate(['Pipe', 5, { str: 'abc' }])).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'function'", "'string'"],
        ""abc""
      ]
    `));

  test('a boolean literal rhs is rejected', () => {
    const piped = engine.box(['Pipe', 5, true]);
    expect(piped.isValid).toBe(false);
  });

  // The parse route (`|>` / `\rhd`) is exercised because a lazy operator can
  // break on box/parse routes while passing `ce.function`-only tests.
  test('parse route rejects a refutable rhs', () => {
    const piped = engine.parse('5 \\rhd 3');
    expect(piped.isValid).toBe(false);
    expect(exprToString(piped)).toContain('incompatible-type');
  });

  // A symbol rhs is NOT refutable: its definition may arrive later, so the
  // pipe defers (stays symbolic) and reduces once the symbol is assigned.
  test('a symbol rhs defers and reduces after assignment', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Pipe', 5, 'g']).evaluate().toString()).toBe('g(5)');
    ce.assign('g', ce.parse('x \\mapsto x + 1'));
    expect(ce.box(['Pipe', 5, 'g']).evaluate().toString()).toBe('6');
  });
});

// Pipe-stage sugar (2026-08-13). Two of the three rules live in the ENGINE
// (`pipeStageWithImplicitTopic` / `pipeImplicitMap`, `library/core.ts`), so
// they hold on the `ce.box()` route probed here, not just on the Epsil
// surface (the Epsil-route pins are in `test/epsil/execute.test.ts`). The
// third — reading an operator-written placeholder expression (`_^2`) as a
// lambda — is a PARSER rewrite; on the box route `["Power", "_", 2]` keeps
// its topic-placeholder meaning, and the last test pins that divergence.
describe('Pipe — stage sugar (box route)', () => {
  test('a stage lifted from a pair with a non-string key is an error value, not a throw', () => {
    // `KeyValuePair(x, x^2)` canonicalizes with an `incompatible-type` error
    // in its key slot. The pipe lifts the stage into `x ↦ KeyValuePair(…)`,
    // and re-binding `x` to the lifted parameter rebuilds the body `Block`
    // around that error. The rebuild must keep the Block's scope: without it,
    // applying the lambda threw "Function body must be a scoped Block
    // expression" (the Epsil `1..5 |> x -> x^2` typo reached this route).
    const ce = new ComputeEngine();
    const result = ce
      .box(['Pipe', ['Range', 1, 5], ['KeyValuePair', 'x', ['Power', 'x', 2]]])
      .evaluate();
    expect(result.isValid).toBe(false);
    expect(result.json).toEqual([
      'KeyValuePair',
      [
        'Error',
        ['ErrorCode', "'incompatible-type'", "'string'", "'number'"],
        ['Range', 1, 5],
      ],
      ['Power', ['Range', 1, 5], 2],
    ]);
  });

  test('implicit topic argument fills an incomplete call', () => {
    const ce = new ComputeEngine();
    // Take(10) is missing its collection: the topic becomes the first arg.
    expect(
      ce
        .box(['Pipe', ['Range', 1, 10], ['Take', 3]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
    // Same for a callback slot: Map(f) over the piped collection.
    ce.assign('f', ce.parse('x \\mapsto 2x'));
    expect(
      ce
        .box(['Pipe', ['List', 1, 2, 3], ['Map', 'f']])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a complete call whose value is not a function is an error', () => {
    const ce = new ComputeEngine();
    // Max(3) is a complete call, so the implicit topic does not apply. Its
    // value, 3, is not a function: the pipe does not ignore the piped value
    // (user decision 2026-09-30), it gives the error of a literal stage.
    expect(ce.box(['Pipe', 5, ['Max', 3]]).evaluate().json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'function'", "'3'"],
      "'3'",
    ]);
  });

  test('a stage with no slot whose value is not a function is an error', () => {
    const ce = new ComputeEngine();
    const pipe = (stage: Expression) =>
      ce.box(['Pipe', ['List', 1, 2], stage]).evaluate().json;
    const error = (type: string, value: string) => [
      'Error',
      ['ErrorCode', "'incompatible-type'", "'function'", `'${type}'`],
      `'${value}'`,
    ];
    // Folded to a literal at canonicalization.
    expect(pipe(['Add', 10, 3])).toEqual(error('13', '13'));
    // A number only when evaluated: it used to give 13, the piped value
    // ignored.
    expect(pipe(['Add', 10, ['At', ['List', 3, 4], 1]])).toEqual(
      error('13', '13')
    );
    // The `_` belongs to the inner pipe, so the outer stage has no slot: it
    // used to give [16,18].
    expect(
      pipe(['Add', 10, ['Pipe', ['List', 3, 4], ['Multiply', '_', 2]]])
    ).toEqual(error('vector<integer^2>', '[16,18]'));
    // The LaTeX route parses to the same `Pipe`.
    expect(
      ce
        .parse(
          '[1,2] \\triangleright 10 + ([3,4] \\triangleright \\_ \\times 2)'
        )
        .evaluate().json
    ).toEqual(error('vector<integer^2>', '[16,18]'));
    // Stages that are functions are unchanged.
    expect(pipe('Sum')).toBe(3);
    expect(pipe(['Function', 7])).toBe(7);
    expect(ce.box(['Pipe', 5, ['Add', 'y', 1]]).evaluate().json).toBe(6);
    expect(pipe(['Multiply', '_', 2])).toEqual(['List', 2, 4]);
    // A stage whose value is typed `unknown` can still be a function (here
    // an undefined function `Compose`), so the pipe stays unevaluated, as it
    // does for an undefined symbol.
    expect(pipe(['Compose', 'Sqrt', 'Sqrt'])).toEqual([
      'Pipe',
      ['List', 1, 2],
      ['Compose', 'Sqrt', 'Sqrt'],
    ]);
    // A held symbol is a value, not a function: the piped value would be
    // ignored.
    expect((pipe(['Hold', 'Sin']) as any)[0]).toBe('Error');
  });

  test('an explicit placeholder disables the implicit topic argument', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Pipe', ['Range', 1, 10], ['Take', '_', 3]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
  });

  test('a unary lambda stage maps over a collection topic', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Pipe',
          ['List', 1, 2, 3],
          ['Function', ['Power', 'x', 2], 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
    // The wildcard spelling of the same literal maps too.
    expect(
      ce
        .box(['Pipe', ['List', 1, 2, 3], ['Function', ['Power', '_', 2]]])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
  });

  test('a unary lambda stage over a non-collection topic applies', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Pipe', 4, ['Function', ['Power', '_', 2]]])
        .evaluate()
        .toString()
    ).toBe('16');
  });

  // The implicit `Map` changes the pipe's TYPE, not just its value: the stage
  // returns a scalar but the pipe is a collection of those scalars. Reading
  // the stage's declared result type alone (what `Pipe` did before) described
  // the element, so the whole pipe fell back to `unknown` and every consumer
  // downstream — arithmetic broadcast in particular — saw a scalar. These
  // pins read `.type` on the UNEVALUATED pipe, then check it against the
  // evaluated value's type: the static answer must be the collection type,
  // and must be the one the expression actually reduces to.
  test('a mapping stage types the pipe as the mapped COLLECTION', () => {
    const ce = new ComputeEngine();
    const pipe = ce.box([
      'Pipe',
      ['List', 1, 2, 3],
      ['Function', ['Power', 'x', 2], 'x'],
    ]);
    // The element tier is derived from the source's: a bare-parameter
    // mapping over integers squares integers, so the cells say
    // `integer<0..>` (the even-power range, since the
    // ranged-results round).
    expect(pipe.type.toString()).toBe('list<integer<0..>^3>');
    expect(pipe.evaluate().toString()).toBe('[1,4,9]');

    // Element type, not just shape: a list of boolean pairs mapped through a
    // conjunction of its components types as a list of booleans.
    const table = ce.box([
      'Pipe',
      [
        'List',
        ['Tuple', 'True', 'True'],
        ['Tuple', 'True', 'False'],
        ['Tuple', 'False', 'False'],
      ],
      [
        'Function',
        ['And', ['At', 'p', 1], ['At', 'p', 2]],
        'p',
      ],
    ]);
    // `xs |> f` is `f(xs)` (user decision 2026-09-26): `p[1]` makes `p` a
    // collection parameter, so the literal binds the list whole, as the same
    // literal called directly or under a name does.
    const call = ce.box([
      'Apply',
      ['Function', ['And', ['At', 'p', 1], ['At', 'p', 2]], 'p'],
      table.op1.json,
    ] as any);
    expect(table.type.toString()).toBe(call.type.toString());
    expect(table.evaluate().toString()).toBe(call.evaluate().toString());
    // The spelling that maps each pair destructures it: a tuple-pattern
    // parameter maps over a list of points.
    const pairs = ce.box([
      'Pipe',
      table.op1.json,
      ['Function', ['And', 'a', 'b'], ['Tuple', 'a', 'b']],
    ] as any);
    expect(pairs.evaluate().toString()).toBe('["True","False","False"]');

    // A chain types through: the inner pipe is the outer one's collection
    // topic, so the outer gate needs the inner pipe's own mapped type.
    const chained = ce.box([
      'Pipe',
      ['Pipe', ['List', 1, 2, 3], ['Function', ['Power', 'x', 2], 'x']],
      ['Function', ['Add', 'y', 1], 'y'],
    ]);
    // The outer `+1` stage joins bare tiers (a sum does not keep its
    // terms' ranges), so the inner stage's `<0..>` cells widen back.
    // The outer stage's cell type is derived over the inner pipe's element
    // type, so the inner `<0..>` range survives the `+1` as `<1..>` — the
    // same answer the equivalent explicit `Map` of a `Map` reports.
    expect(chained.type.toString()).toBe('list<integer<1..>^3>');
    // The evaluated value is a plain list, whose own type widens its cells
    // to `integer`.
    expect(chained.evaluate().toString()).toBe('[2,5,10]');
  });

  test('a stage that does NOT map keeps the applied (scalar) typing', () => {
    const ce = new ComputeEngine();
    // Each of these is an escape from the implicit `Map` — a non-collection
    // topic, a string topic, a bare function symbol, and a parameter
    // annotation claiming the whole collection — so none may be reported as a
    // collection. They type from the stage's declared result as before,
    // which for an unannotated lambda is `unknown`; what this pins is that
    // the mapping path did NOT fire, so no collection type appears.
    const scalars = [
      ce.box(['Pipe', 4, ['Function', ['Power', '_', 2]]]),
      ce.box(['Pipe', "'abc'", ['Function', 's', 's']]),
      ce.box(['Pipe', ['List', 1, 2, 3], 'Sum']),
      ce.box([
        'Pipe',
        ['List', 1, 2, 3],
        ['Function', ['Length', 'l'], ['Typed', 'l', "'list<number>'"]],
      ]),
    ];
    for (const s of scalars)
      expect(s.type.matches('collection')).toBe(false);
  });

  test('a BARE placeholder expression keeps the topic reading (divergence)', () => {
    const ce = new ComputeEngine();
    // On the box route there is no call-vs-operator surface distinction, so
    // `["Power", "_", 2]` stays a shorthand lambda applied to the topic (a
    // broadcast square of the list), NOT an implicit Map. The Epsil parser
    // is what rewrites the operator spelling `xs |> _^2` into the `Function`
    // literal probed above.
    expect(
      ce
        .box(['Pipe', ['List', 1, 2, 3], ['Power', '_', 2]])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
  });
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
      `15`
    ));

  test('ReleaseHold removes a single Hold layer, directly or via a symbol', () => {
    expect(
      evaluate(['ReleaseHold', ['Hold', ['Hold', 'x']]])
    ).toMatchInlineSnapshot(`["Hold", "x"]`);
    engine.assign('h2', ['Hold', ['Hold', 'x']]);
    expect(evaluate(['ReleaseHold', 'h2'])).toMatchInlineSnapshot(
      `["Hold", "x"]`
    );
  });

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
      engine.expr([['Function', ['Add', 'x', 'y'], 'x', 'y'], 3, 4]).evaluate()
        .re
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

  test('lambda case N((x => x/3)(2))', () =>
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
      // The element type inference writes into the literal is not part of
      // the serialized form (only a written annotation is).
      ['Function', ['Block', ['Less', 102, 'n']], 'n'],
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
      engine.function('Apply', [id, engine.box(['Hold', 'w'])]).evaluate().json
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

  // KNOWN LIMITATION, characterized rather than fixed. A pre-boxed RAW
  // argument — no `ce.box` or `ce.parse` route produces one — still
  // double-applies. It was recorded as owned by the makeLambda-frame work
  // (activation records, stage 11 of the binder-mechanism design); measured
  // there, activation records do NOT reach it, and the reason is structural:
  // the doubling comes from the RAW-NAME fallback in `bindingKeyedSubs`, and a
  // raw symbol carries no binding at all, so no amount of binding identity can
  // tell "raw `w` from the held BODY" (which must be substituted — the held
  // conditional above) from "raw `w` from the ARGUMENT" (which must not).
  // Distinguishing them needs provenance, not identity.
  test('a PRE-BOXED raw argument still double-applies (known limitation)', () => {
    const id = engine.expr(['Function', 'w', 'w']);
    // The canonical routes are correct: `w` inside the `Hold` carries a
    // binding, which is not the parameter's, so nothing is substituted.
    expect(
      engine.function('Apply', [id, engine.box(['Hold', 'w'])]).evaluate().json
    ).toEqual(['Hold', 'w']);
    expect(
      engine
        .function('Apply', [id, engine.function('Hold', [engine.symbol('w')])])
        .evaluate().json
    ).toEqual(['Hold', 'w']);
    // Built raw, the occurrence has no binding and the name is all there is.
    // The CORRECT output of both assertions below is `['Hold', 'w']`; the
    // fix needs argument provenance and is owned by the future
    // raw-name-fallback work. Current (wrong) behavior is pinned so the
    // limitation stays visible rather than silently becoming a contract.
    expect(
      engine
        .function('Apply', [id, engine.box(['Hold', 'w'], { canonical: false })])
        .evaluate().json
    ).toEqual(['Hold', ['Hold', 'w']]); // @fixme
    expect(
      engine
        .function('Apply', [
          id,
          engine.function('Hold', [engine.symbol('w', { canonical: false })]),
        ])
        .evaluate().json
    ).toEqual(['Hold', ['Hold', 'w']]); // @fixme
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
  // 20 000 terms, not more: on a continuous-integration runner these tests
  // run about eight times slower than alone on a developer machine, and
  // 60 000 terms (650 ms alone) exceeded the 5 s test timeout there.
  const LARGE = 20_000;
  // Still in flight while a poller watches it (~250ms of work)
  const BIGGER_FOR_SUSPEND = 100_000;
  // Each test here runs sums of 20 000 to 100 000 terms through the async
  // lane. Alone they take well under a second, but when other test runs share
  // the cores they can take more than the default 5 s test timeout, and the
  // result does not depend on time. So the timeout is raised for this group.
  const ASYNC_LANE_TIMEOUT = 60_000;
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
  }, ASYNC_LANE_TIMEOUT);

  test('the index does not leak into the global scope', async () => {
    const ce = new ComputeEngine();
    await ce.parse(`\\sum_{k=1}^{${LARGE}} k`).evaluateAsync();
    expect(ce.box('k').value).toBeUndefined();
  }, ASYNC_LANE_TIMEOUT);

  test('an outer binding of the same name is not clobbered', async () => {
    // The silent case: the sum returned the RIGHT answer while overwriting
    // the caller's `n`.
    const ce = new ComputeEngine();
    ce.assign('n', 7);
    const result = await ce.parse(`\\sum_{n=1}^{${LARGE}} n`).evaluateAsync();
    expect(result.toString()).toBe(String(gauss(LARGE)));
    expect(ce.box('n').value?.toString()).toBe('7');
  }, ASYNC_LANE_TIMEOUT);

  test('async matches sync, suspended or not', async () => {
    const ce = new ComputeEngine();
    for (const upper of [SMALL, LARGE]) {
      const expr = ce.box(sum('i', upper));
      expect((await expr.evaluateAsync()).toString()).toBe(
        expr.evaluate().toString()
      );
    }
  }, ASYNC_LANE_TIMEOUT);

  // Each evaluation holds its local context across the `await` on its OWN
  // copy of the evaluation-context stack (`EvaluateOptions._contextStack`),
  // so a SECOND evaluation started while the first is suspended neither sees
  // the frame of the first nor pushes its own frame above it. Each frame is
  // removed by IDENTITY from the copy that holds it, so an unwinding
  // evaluation cannot dispose a still-running one's bindings.
  //
  // HONESTY NOTE: these are CHARACTERIZATION tests, not discriminating
  // regression tests. They also passed when the frames of both evaluations
  // were on the engine's own stack: on this workload, a frame that another
  // evaluation can see, or that it removes, has no observable effect (the
  // stack still rebalances, and the sums still come out right). They pin the
  // outcome so a future change that DOES make it observable fails here. The
  // tests that fail when the two evaluations share one stack are the
  // mid-flight caller test below and the "concurrent asynchronous
  // evaluations keep their own scopes" block of
  // `evaluate-async-lazy-heads.test.ts`.
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
    }, ASYNC_LANE_TIMEOUT);

    // The adversarial spelling: the two evaluations use the SAME index name,
    // so any cross-talk between their scopes shows up as a wrong sum.
    test('a shared index name does not cross-talk', async () => {
      const { ce, settled } = await runBoth('m', 'm');
      expect(values(settled)).toEqual(expected);
      expect(ce.box('m').value).toBeUndefined();
    }, ASYNC_LANE_TIMEOUT);

    test('the engine is left clean', async () => {
      const { ce, depth } = await runBoth('q', 'w');
      expect(ce._evalContextStack.length).toBe(depth);
      expect(ce.box('q').value).toBeUndefined();
      expect(ce.box('w').value).toBeUndefined();
      expect(ce.parse('1+1').evaluate().toString()).toBe('2');
    }, ASYNC_LANE_TIMEOUT);
  });

  // While an async evaluation is suspended, its scope is NOT the engine's
  // current scope: the evaluation keeps its scopes on its own copy of the
  // evaluation-context stack (`EvaluateOptions._contextStack`), and puts that
  // copy in place of the engine's stack only while its own code runs. So code
  // that enters the engine in that window does not see the loop index, and
  // enclosing bindings resolve as usual. (Before, the scope of the suspended
  // evaluation stayed on top of the engine's stack, and this test pinned that
  // the index was visible.)
  // Generous timeout: the workload is sized so the sum is still in flight
  // while the poller watches (do NOT shrink it — see BIGGER_FOR_SUSPEND), and
  // on a loaded CI runner each poll iteration also absorbs a ~16ms runAsync
  // chunk of the suspended sum, so the default 5s can be exceeded without
  // anything being wrong.
  test('a suspended evaluation’s index is not visible to a mid-flight caller', async () => {
    const ce = new ComputeEngine();
    ce.assign('a', 42);
    let settled = false;
    const pending = ce
      .parse(`\\sum_{z=1}^{${BIGGER_FOR_SUSPEND}} z`)
      .evaluateAsync()
      .finally(() => {
        settled = true;
      });

    // Poll while the evaluation is in flight, and count the polls that saw
    // it in flight: a run in which the sum settles before the first poll
    // proves nothing.
    let pollsInFlight = 0;
    let sawIndex = false;
    let outerStayedCorrect = true;
    for (let i = 0; i < 100 && !settled; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (settled) break;
      pollsInFlight += 1;
      if (ce._evalContextStack.length !== 2) sawIndex = true;
      if (ce.box('z').value !== undefined) sawIndex = true;
      if (ce.parse('a+1').evaluate().toString() !== '43')
        outerStayedCorrect = false;
    }
    expect(pollsInFlight).toBeGreaterThan(0);
    expect(outerStayedCorrect).toBe(true);
    expect(sawIndex).toBe(false);

    expect((await pending).toString()).toBe(String(gauss(BIGGER_FOR_SUSPEND)));
    expect(ce.box('z').value).toBeUndefined();
    expect(ce._evalContextStack.length).toBe(2);
  }, 30_000);

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
  }, ASYNC_LANE_TIMEOUT);
});

describe('CANONICAL-SUGAR HEADS KEEP ARITY ERRORS ON THE INERT HEAD', () => {
  // Regression (2026-07-31): `Exp2`'s canonical handler spliced the flagged
  // args into its `Power` sugar, so `['Exp2', 11, 12]` canonicalized to a
  // malformed 3-operand `Power(2, 11, Error(…))` with a double-wrapped error.
  // The error must stay on the inert head, as `Exp` and `Rational` do.
  test('Exp2 with an extra argument stays an inert Exp2', () => {
    const expr = engine.box(['Exp2', 11, 12]);
    expect(expr.isValid).toBe(false);
    expect(expr.json).toEqual([
      'Exp2',
      11,
      ['Error', "'unexpected-argument'", "'12'"],
    ]);
  });

  test('Exp with an extra argument stays an inert Exp', () => {
    const expr = engine.box(['Exp', 11, 12]);
    expect(expr.isValid).toBe(false);
    expect(expr.operator).toBe('Exp');
  });

  test('valid Exp2 still canonicalizes to its Power sugar', () => {
    expect(engine.box(['Exp2', 11]).evaluate().toString()).toBe('2048');
  });
});

describe('INVALID EXPLICIT-BLOCK BODY STILL GETS A SCOPED BLOCK', () => {
  // Regression (2026-08-03, Tycho item 150): `get canonical` short-circuits on
  // an invalid expression, so an explicit `Block` body containing an `Error`
  // node came back from `bodyOp.canonical` unbound and UNSCOPED. The
  // parameter-declaration loop in `canonicalFunctionLiteralArguments` then
  // dereferenced `block.localScope!.bindings` and threw a bare
  // `Cannot read properties of undefined (reading 'bindings')` onto the
  // console before recovering to a non-canonical function literal.
  let errorSpy: jest.SpyInstance;
  let assertSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    assertSpy = jest.spyOn(console, 'assert').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    assertSpy.mockRestore();
  });

  test('minimal repro boxes to a canonical, invalid function literal', () => {
    const expr = engine.box(['Function', ['Block', ['Error', "'x'"]], 'W']);
    expect(expr.operator).toBe('Function');
    expect(expr.isCanonical).toBe(true);
    expect(expr.isValid).toBe(false);
    expect(expr.op1.operator).toBe('Block');
    expect(expr.op1.isScoped).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    // The `console.assert(block.isScoped)` tripwire no longer fires
    expect(assertSpy.mock.calls.filter((x) => !x[0])).toEqual([]);
  });

  test('nullary sibling gets a scoped block too', () => {
    const expr = engine.box(['Function', ['Block', ['Error', "'x'"]]]);
    expect(expr.isCanonical).toBe(true);
    expect(expr.isValid).toBe(false);
    expect(expr.op1.isScoped).toBe(true);
    expect(() => expr.evaluate()).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('an invalid function literal inside Map recovers quietly', () => {
    const expr = engine.box([
      'Map',
      [
        'Function',
        [
          'Block',
          [
            'Sum',
            [
              'Which',
              ['Equal', ['At', ['Error', "'incompatible-type'"], 'n'], 1],
              1,
              'True',
              0,
            ],
            ['Limits', 'n', 1, 'W'],
          ],
        ],
        'W',
      ],
      ['Range', 1, 10],
    ]);
    expect(expr.isCanonical).toBe(true);
    expect(expr.isValid).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('a valid explicit-Block body is unchanged', () => {
    const expr = engine.box(['Function', ['Block', ['Add', 'x', 1]], 'x']);
    expect(expr.isCanonical).toBe(true);
    expect(expr.isValid).toBe(true);
    expect(expr.op1.isScoped).toBe(true);
    expect(expr.json).toEqual(['Function', ['Block', ['Add', 'x', 1]], 'x']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('an EMPTY Block body takes the Nothing convention', () => {
    // An empty `Block` is canonical and scoped as it is (`canonicalBlock`
    // no longer declines zero operands), so the literal's body keeps its own
    // scope and evaluates to `Nothing`.
    const expr = engine.box(['Function', ['Block'], 'W']);
    expect(expr.isCanonical).toBe(true);
    expect(expr.isValid).toBe(true);
    expect(expr.op1.isScoped).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(assertSpy.mock.calls.filter((x) => !x[0])).toEqual([]);
  });
});
