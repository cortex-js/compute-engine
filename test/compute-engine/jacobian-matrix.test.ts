import { ComputeEngine } from '../../src/compute-engine';

const L = (ce: ComputeEngine, ...src: string[]) =>
  ce.box(['List', ...src.map((s) => ce.parse(s).json)] as any);
const S = (ce: ComputeEngine, ...names: string[]) =>
  ce.box(['List', ...names] as any);
const J = (ce: ComputeEngine, fs: any, vars?: any) =>
  (vars === undefined
    ? ce.function('JacobianMatrix', [fs])
    : ce.function('JacobianMatrix', [fs, vars])
  ).evaluate();

describe('JacobianMatrix', () => {
  test('a system yields one row per function, one column per variable', () => {
    const ce = new ComputeEngine();
    expect(J(ce, L(ce, 'x^2 y', 'x+z'), S(ce, 'x', 'y', 'z')).toString()).toBe(
      '[[2x * y,x^2,0],[1,0,1]]'
    );
  });

  // A single (non-list) function is the gradient case: a flat vector, directly
  // usable as one, rather than a 1×n matrix.
  test('a single function yields the gradient vector', () => {
    const ce = new ComputeEngine();
    expect(J(ce, ce.parse('x^2 y + z'), S(ce, 'x', 'y', 'z')).toString()).toBe(
      '[2x * y,x^2,1]'
    );
  });

  test('the variable list may be omitted (lexicographic order)', () => {
    const ce = new ComputeEngine();
    expect(J(ce, L(ce, 'x^2 y', 'x+z')).toString()).toBe(
      '[[2x * y,x^2,0],[1,0,1]]'
    );
    expect(J(ce, ce.parse('a b + c')).toString()).toBe('[b,a,1]');
  });

  test('a square system composes with Determinant', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .function('Determinant', [J(ce, L(ce, 'x^2 y', 'x+z'), S(ce, 'x', 'z'))])
        .evaluate()
        .toString()
    ).toBe('2x * y');
  });

  test('static type follows the operand shape', () => {
    const ce = new ComputeEngine();
    expect(
      ce.function('JacobianMatrix', [L(ce, 'x^2'), S(ce, 'x')]).type.matches('matrix')
    ).toBe(true);
    expect(
      ce.function('JacobianMatrix', [ce.parse('x^2'), S(ce, 'x')]).type.matches('list<number>')
    ).toBe(true);
  });

  // A differentiation variable that ALSO carries a global value (`x := 5`) is
  // contradictory: the Jacobian must still treat it as a variable, not
  // substitute the value. Differentiating against a fresh unbound symbol keeps
  // the result symbolic.
  test('a value-bound differentiation variable is not substituted', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    expect(J(ce, ce.parse('x^2 y'), S(ce, 'x', 'y')).toString()).toBe(
      '[2x * y,x^2]'
    );
  });

  // Runtime gates: the static type cannot refute these, so the handler must.
  test.each([
    ['a nested collection operand', (ce: ComputeEngine) =>
      J(ce, ce.box(['List', ['List', 'a', 'b']] as any), S(ce, 'x'))],
    ['a non-symbol variable', (ce: ComputeEngine) =>
      J(ce, ce.parse('x^2'), ce.box(['List', 3] as any))],
    ['no free variables to infer', (ce: ComputeEngine) => J(ce, ce.parse('42'))],
  ])('declines %s', (_label, build) => {
    const ce = new ComputeEngine();
    expect(build(ce).operator).toBe('JacobianMatrix');
  });

  test('round-trips through LaTeX', () => {
    const ce = new ComputeEngine();
    const j = ce.function('JacobianMatrix', [L(ce, 'x^2'), S(ce, 'x')]);
    expect(ce.parse(j.latex).evaluate().toString()).toBe('[[2x]]');
  });

  // The case this operator was added for: the Jacobian of the
  // Jacobian-conjecture counterexample map has constant determinant -2.
  test('counterexample map: constant determinant', () => {
    const ce = new ComputeEngine();
    const fs = L(
      ce,
      '(1 + x y)^3 z + y^2 (1 + x y) (4 + 3 x y)',
      'y + 3 x (1 + x y)^2 z + 3 x y^2 (4 + 3 x y)',
      '2 x - 3 x^2 y - x^3 z'
    );
    const det = ce
      .function('Determinant', [J(ce, fs, S(ce, 'x', 'y', 'z'))])
      .simplify();
    expect(det.isSame(-2)).toBe(true);
  });
});

// "System or gradient?" is decided on what the operand *denotes*, not on its
// syntax. A purely syntactic `List` check sent a user-function call down the
// gradient path and returned the TRANSPOSE — which a determinant test cannot
// catch, since det A = det Aᵀ.
describe('JacobianMatrix: system detection is semantic', () => {
  const expected = '[[2x * y,x^2],[1,1]]';

  test('a syntactic list literal', () => {
    const ce = new ComputeEngine();
    expect(J(ce, L(ce, 'x^2 y', 'x + y'), S(ce, 'x', 'y')).toString()).toBe(expected);
  });

  test('a user-defined function returning a list', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('(u, v) \\mapsto \\lbrack u^2 v, u + v\\rbrack'));
    expect(
      J(ce, ce.box(['G', 'x', 'y']), S(ce, 'x', 'y')).toString()
    ).toBe(expected);
  });

  test('a symbol bound to a list', () => {
    const ce = new ComputeEngine();
    ce.assign('g', L(ce, 'x^2 y', 'x + y'));
    expect(J(ce, ce.symbol('g'), S(ce, 'x', 'y')).toString()).toBe(expected);
  });

  // The static type is decided the same way, so a directly-nested
  // `Determinant(JacobianMatrix(F(…), …))` for a list-returning user function
  // typechecks. (A syntactic-only type handler reported `vector` here, and the
  // determinant's `matrix` requirement then rejected it — masked when the
  // matrix went through a `let` binding first.)
  test('the static type of a function-call system is a matrix', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('(u, v) \\mapsto \\lbrack u^2 v, u + v\\rbrack'));
    const jm = ce.function('JacobianMatrix', [ce.box(['G', 'x', 'y']), S(ce, 'x', 'y')]);
    expect(jm.type.matches('matrix')).toBe(true);
    expect(
      ce.function('Determinant', [jm]).evaluate().toString()
    ).toBe('-x^2 + 2x * y');
  });

  test('all three routes agree (not transposed)', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('(u, v) \\mapsto \\lbrack u^2 v, u + v\\rbrack'));
    const literal = J(ce, L(ce, 'x^2 y', 'x + y'), S(ce, 'x', 'y'));
    const call = J(ce, ce.box(['G', 'x', 'y']), S(ce, 'x', 'y'));
    expect(call.isSame(literal)).toBe(true);
  });
});

// `JacobianMatrix(F)` — a bare function reference. Its body is the system and
// its parameters are the differentiation variables, in DECLARED order (which
// free-variable inference could not preserve).
describe('JacobianMatrix of a bare function', () => {
  const vecF = (ce: ComputeEngine) =>
    ce.assign('F', ce.parse('(x, y, z) \\mapsto \\lbrack (1 + x y)^3 z, y + z, 2 x\\rbrack'));

  test('differentiates the body w.r.t. the parameters', () => {
    const ce = new ComputeEngine();
    vecF(ce);
    expect(ce.function('JacobianMatrix', [ce.symbol('F')]).evaluate().toString()).toBe(
      '[[3y * z * (x * y + 1)^2,3x * z * (x * y + 1)^2,(x * y + 1)^3],[0,1,1],[2,0,0]]'
    );
  });

  test('agrees with the applied form', () => {
    const ce = new ComputeEngine();
    vecF(ce);
    const bare = ce.function('JacobianMatrix', [ce.symbol('F')]).evaluate();
    const applied = ce
      .function('JacobianMatrix', [ce.box(['F', 'x', 'y', 'z']), S(ce, 'x', 'y', 'z')])
      .evaluate();
    expect(bare.isSame(applied)).toBe(true);
  });

  // Column order follows the parameter list, NOT a lexicographic sort of the
  // free variables — the whole reason to prefer the bare form.
  test('columns follow parameter order', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('(z, y, x) \\mapsto \\lbrack z, y^2, x^3\\rbrack'));
    expect(ce.function('JacobianMatrix', [ce.symbol('G')]).evaluate().toString()).toBe(
      '[[1,0,0],[0,2y,0],[0,0,3x^2]]'
    );
  });

  test('a scalar-valued bare function is the gradient', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(a, b) \\mapsto a^2 b'));
    expect(ce.function('JacobianMatrix', [ce.symbol('h')]).evaluate().toString()).toBe(
      '[2a * b,a^2]'
    );
  });

  test('explicit variables rename the parameters', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.parse('(x, y, z) \\mapsto \\lbrack x^2 y, z\\rbrack'));
    expect(
      ce.function('JacobianMatrix', [ce.symbol('F'), S(ce, 'a', 'b', 'c')]).evaluate().toString()
    ).toBe('[[2a * b,a^2,0],[0,0,1]]');
  });

  test('a rename with the wrong arity declines', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.parse('(x, y, z) \\mapsto \\lbrack x^2 y, z\\rbrack'));
    expect(
      ce.function('JacobianMatrix', [ce.symbol('F'), S(ce, 'a', 'b')]).operator
    ).toBe('JacobianMatrix');
  });

  // A rename to a variable name that an inner binder already binds would be
  // captured by that binder (`subs` is not binder-aware): here the requested
  // `k` would be swallowed by the `Sum`'s bound `k`, yielding a wrong
  // derivative. The handler declines rather than corrupt the result — so it
  // stays an unevaluated symbolic `JacobianMatrix`, never a captured answer.
  test('a rename that an inner binder would capture declines', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.parse('(x) \\mapsto \\sum_{k=1}^{3} x k'));
    expect(
      ce
        .function('JacobianMatrix', [ce.symbol('F'), S(ce, 'k')])
        .evaluate().operator
    ).toBe('JacobianMatrix');
  });

  test('the static type of a bare vector function is a matrix', () => {
    const ce = new ComputeEngine();
    vecF(ce);
    expect(ce.function('JacobianMatrix', [ce.symbol('F')]).type.matches('matrix')).toBe(true);
  });

  // A symbol bound to a function value (`let g = F`) resolves through the value
  // binding to the same lambda.
  test('a symbol bound to a function value resolves', () => {
    const ce = new ComputeEngine();
    vecF(ce);
    ce.assign('g', ce.symbol('F'));
    const viaG = ce.function('JacobianMatrix', [ce.symbol('g')]).evaluate();
    const viaF = ce.function('JacobianMatrix', [ce.symbol('F')]).evaluate();
    expect(viaG.isSame(viaF)).toBe(true);
  });

  // A `Typed(x, type)` parameter must resolve to its bare name `x`, the same
  // way `betaReduceLambda` unwraps it — not silently decline the whole
  // literal (regression: `lambdaFromLiteral` used `sym()`, which returns
  // `undefined` for `Typed`).
  test('a typed-parameter function literal agrees with the bare form', () => {
    const ce = new ComputeEngine();
    vecF(ce);
    const body = ce.parse('\\lbrack (1 + x y)^3 z, y + z, 2 x\\rbrack').json;
    ce.assign(
      'FT',
      ce.box([
        'Function',
        body,
        ['Typed', 'x', "'real'"],
        ['Typed', 'y', "'real'"],
        ['Typed', 'z', "'real'"],
      ])
    );
    const typed = ce.function('JacobianMatrix', [ce.symbol('FT')]).evaluate();
    const bare = ce.function('JacobianMatrix', [ce.symbol('F')]).evaluate();
    expect(typed.isSame(bare)).toBe(true);
  });

  test('the counterexample map, from its bare name, has determinant -2', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'F',
      ce.parse(
        '(x, y, z) \\mapsto \\lbrack (1 + x y)^3 z + y^2 (1 + x y)(4 + 3 x y), y + 3 x (1 + x y)^2 z + 3 x y^2 (4 + 3 x y), 2 x - 3 x^2 y - x^3 z\\rbrack'
      )
    );
    const det = ce.function('Determinant', [ce.function('JacobianMatrix', [ce.symbol('F')])]).simplify();
    expect(det.isSame(-2)).toBe(true);
  });
});

// A symbol bound to a list whose elements mention a globally-assigned diff
// variable must not have that value substituted before differentiation.
describe('JacobianMatrix protects the differentiation variables', () => {
  test('a value-bound diff variable stays symbolic in the derivative', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('g', L(ce, 'x^2 y', 'x + y'));
    expect(
      ce.function('JacobianMatrix', [ce.symbol('g'), S(ce, 'x', 'y')]).evaluate().toString()
    ).toBe('[[2x * y,x^2],[1,1]]');
  });
});
