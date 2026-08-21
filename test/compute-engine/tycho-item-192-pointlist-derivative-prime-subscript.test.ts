import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 192.
 *
 * (a) Differentiating a `PointList` body.
 *
 * `PointList` is the explicit point-container head that importers emit. It
 * evaluates to a `Tuple` when all its components are scalars, and to a `List`
 * of tuples when one or more component is a collection (it zips them). Either
 * way d/dt acts componentwise, so `PointList` must differentiate elementwise
 * exactly like `Tuple`/`List` (the rule added for item 174).
 *
 * The bug only showed on the route that differentiates an UNEVALUATED body: a
 * function literal stored as a symbol's VALUE (`p := (t) |-> PointList(…)`,
 * reached through `Derivative(p, 1)` — the parse of `p'(0.25)`). An operator
 * definition (`g(t) := …`) is resolved by applying and EVALUATING it, which
 * had already turned the `PointList` into a `Tuple`, so `g'` worked. The
 * broken route produced inert `Apply(Derivative("PointList", …), …)` nodes
 * from the generic chain rule, i.e. it differentiated the `PointList`
 * OPERATOR.
 *
 * (b) Parsing a prime written BEFORE a subscript.
 *
 * `F'_0(t)` / `F^{\prime}_0(t)` (both emitted by Desmos) must mean the same as
 * `F_0'(t)`: the derivative of the function named `F_0`. They used to parse as
 * `Multiply(t, Subscript(Prime(F), 0))` — the prime bound to the bare `F`, the
 * subscript then applied to the derivative, and `(t)` degraded to an invisible
 * product.
 */

describe('Tycho 192(a) Derivative of a PointList-bodied lambda', () => {
  // `p'(0.25)` for a value-definition function literal. The expected value is
  // (cos 0.25, -sin 0.25, 1).
  const COS = Math.cos(0.25);
  const SIN = Math.sin(0.25);

  function pointComponents(expr: any): number[] {
    expect(expr.operator).toBe('Tuple');
    return expr.ops.map((x) => x.N().re);
  }

  test('value-definition lambda: p′(0.25) is componentwise', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    ce.assign(
      'p',
      ce.box(['Function', ['PointList', ['Sin', 't'], ['Cos', 't'], 't'], 't'])
    );
    const r = ce.parse("p'(0.25)").evaluate();
    // Non-vacuity: before the fix this was an `Add` of
    // `Apply(Derivative("PointList", …), …)` terms, not a Tuple.
    expect(r.has('PointList')).toBe(false);
    const [x, y, z] = pointComponents(r);
    expect(x).toBeCloseTo(COS, 12);
    expect(y).toBeCloseTo(-SIN, 12);
    expect(z).toBeCloseTo(1, 12);
  });

  test('operator-definition lambda g′(0.25) agrees with the value-definition route', () => {
    const ce = new ComputeEngine();
    ce.parse(
      'g(t) \\coloneq \\operatorname{PointList}(\\sin t, \\cos t, t)'
    ).evaluate();
    const g = ce.parse("g'(0.25)").evaluate();

    ce.declare('p', 'function');
    ce.assign(
      'p',
      ce.box(['Function', ['PointList', ['Sin', 't'], ['Cos', 't'], 't'], 't'])
    );
    const p = ce.parse("p'(0.25)").evaluate();

    expect(p.toString()).toEqual(g.toString());
  });

  test('the `\\mapsto` parse of the same lambda differentiates componentwise', () => {
    const ce = new ComputeEngine();
    ce.parse(
      'm \\coloneq (t) \\mapsto \\operatorname{PointList}(\\sin t, \\cos t, t)'
    ).evaluate();
    expect(ce.parse("m'(t)").evaluate().toString()).toEqual(
      '(cos(t), -sin(t), 1)'
    );
  });

  test('`Derivative(p, 1)` keeps the PointList head in the lifted literal', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    ce.assign(
      'p',
      ce.box(['Function', ['PointList', ['Sin', 't'], ['Cos', 't'], 't'], 't'])
    );
    const d = ce.box(['Derivative', 'p', 1]).evaluate();
    // `PointList` is load-bearing downstream (plot lowering), so the container
    // head must survive differentiation rather than degrade to `Tuple`.
    expect(d.toString()).toEqual('(t) => PointList(cos(t), -sin(t), 1)');
  });

  test('second derivative of a PointList body', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    ce.assign(
      'p',
      ce.box(['Function', ['PointList', ['Sin', 't'], ['Cos', 't'], 't'], 't'])
    );
    const [x, y, z] = pointComponents(ce.parse("p''(0.25)").evaluate());
    expect(x).toBeCloseTo(-SIN, 12);
    expect(y).toBeCloseTo(-COS, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  test('list-valued components: derivative commutes with the point-list zip', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'function');
    // `PointList(t*[1,2], t^2)` zips to the two points (t, t²) and (2t, t²).
    ce.assign(
      'r',
      ce.box([
        'Function',
        ['PointList', ['Multiply', 't', ['List', 1, 2]], ['Power', 't', 2]],
        't',
      ])
    );
    const viaDerivative = ce.box(['Apply', ['Derivative', 'r', 1], 3]).evaluate();
    // Independent check: differentiate the ALREADY-ZIPPED list of points and
    // evaluate at t = 3, i.e. [(1, 2t), (2, 2t)] -> [(1, 6), (2, 6)].
    const viaZipped = ce
      .box([
        'D',
        [
          'List',
          ['Pair', 't', ['Power', 't', 2]],
          ['Pair', ['Multiply', 2, 't'], ['Power', 't', 2]],
        ],
        't',
      ])
      .evaluate()
      .subs({ t: 3 })
      .evaluate();
    expect(viaDerivative.toString()).toEqual(viaZipped.toString());
    expect(viaDerivative.toString()).toEqual('[(1, 6),(2, 6)]');
  });

  test('a Tuple body is unchanged (item 174 regression guard)', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'function');
    ce.assign(
      'q',
      ce.box(['Function', ['Tuple', ['Sin', 't'], ['Cos', 't'], 't'], 't'])
    );
    expect(ce.parse("q'(t)").evaluate().toString()).toEqual(
      '(cos(t), -sin(t), 1)'
    );
  });
});

describe('Tycho 192(b) prime written before a subscript', () => {
  // Each entry: the prime-first spelling and the reference spelling it must
  // match. Fresh engines per parse, so no symbol inference leaks between them.
  const json = (latex: string, canonical: boolean) =>
    JSON.stringify(
      new ComputeEngine().parse(latex, { canonical }).toMathJson()
    );

  test.each([
    ["F'_{0}(t)", "F_{0}'(t)"],
    ['F^{\\prime}_{0}(t)', "F_{0}'(t)"],
    ["F''_{0}(t)", "F_{0}''(t)"],
    ["F'_{0}", "F_{0}'"],
    ["f'_1(x)", "f_1'(x)"],
    // A subscript that is an expression keeps the `Subscript` reading in both
    // spellings.
    ["F'_{n+1}(t)", "F_{n+1}'(t)"],
    ["\\alpha'_{i+1}", "\\alpha_{i+1}'"],
    // A trigger-spelled base (`\alpha`) does not fold the subscript into the
    // name, in either spelling.
    ["\\alpha'_1(x)", "\\alpha_1'(x)"],
    // An EMPTY braced subscript is meaningless decoration that the
    // subscript-absorbing scan swallows without changing the name. That scan
    // still moves the parser past the `_{}`, so the prime-first spelling must
    // not then re-read the following token as a subscript: `F'_{}(t)` used to
    // parse as `Subscript(Prime(F), t)` with a stray `)` error.
    ["F'_{}(t)", "F_{}'(t)"],
    ["F'_{}", "F_{}'"],
  ])('%s parses like %s', (primeFirst, reference) => {
    expect(json(primeFirst, false)).toEqual(json(reference, false));
    expect(json(primeFirst, true)).toEqual(json(reference, true));
  });

  test("F'_{0}(t) is an application of the derivative of F_0", () => {
    expect(
      new ComputeEngine().parse("F'_{0}(t)", { canonical: false }).toMathJson()
    ).toEqual(['Apply', ['Derivative', 'F_0', 1], 't']);
  });

  test("F'_{}(t) is an application of the derivative of F", () => {
    // Non-vacuity for the empty-subscript row above: pin the shape, not just
    // the agreement of the two spellings.
    expect(
      new ComputeEngine().parse("F'_{}(t)", { canonical: false }).toMathJson()
    ).toEqual(['Apply', ['Derivative', 'F', 1], 't']);
  });

  test('spellings without a subscript are unchanged', () => {
    expect(
      new ComputeEngine().parse("f'(x)", { canonical: false }).toMathJson()
    ).toEqual(['Apply', ['Derivative', 'f', 1], 'x']);
    expect(
      new ComputeEngine().parse("x'", { canonical: false }).toMathJson()
    ).toEqual(['Prime', 'x']);
    expect(
      new ComputeEngine().parse("y''", { canonical: false }).toMathJson()
    ).toEqual(['Prime', 'y', 2]);
    expect(
      new ComputeEngine().parse('F^{\\prime}', { canonical: false }).toMathJson()
    ).toEqual(['Prime', 'F']);
  });

  test("F'_{0}(t) differentiates once F_0 is defined", () => {
    const ce = new ComputeEngine();
    ce.parse('F_0(t) \\coloneq t^2').evaluate();
    expect(ce.parse("F'_{0}(3)").evaluate().re).toBeCloseTo(6, 12);
  });
});

describe('a subscripted name that keeps its `Subscript` reading is primed like the bare name', () => {
  // `\alpha_1'` folds the subscript into the symbol and is the primed
  // VARIABLE `Prime(alpha_1)`. A subscript that cannot fold (`\alpha_{i+1}`,
  // `A_{i,j}`) is still a name, not an expression to differentiate, so it
  // asks the same variable-or-function question as the bare symbol — decided
  // by its base. Read as an expression it became
  // `Derivative(Subscript(alpha, i+1))`, which canonicalization then lifted
  // into a lambda over `alpha`.
  const raw = (latex: string, setup?: (ce: ComputeEngine) => void) => {
    const ce = new ComputeEngine();
    setup?.(ce);
    return ce.parse(latex, { canonical: false }).toMathJson();
  };

  test('an unknown base is a primed variable', () => {
    expect(raw("\\alpha_{i+1}'")).toEqual([
      'Prime',
      ['Subscript', 'alpha', ['Add', 'i', 1]],
    ]);
    expect(raw("x_{n+1}''")).toEqual([
      'Prime',
      ['Subscript', 'x', ['Add', 'n', 1]],
      2,
    ]);
    expect(raw("A_{i,j}'")).toEqual([
      'Prime',
      ['Subscript', 'A', ['Delimiter', ['Sequence', 'i', 'j'], ',']],
    ]);
  });

  test('the canonical form keeps the name, and is valid', () => {
    const e = new ComputeEngine().parse("\\alpha_{i+1}'");
    expect(e.operator).toBe('Prime');
    expect(e.op1.operator).toBe('Subscript');
    expect(e.isValid).toBe(true);
  });

  test('a base declared as a function is still differentiated', () => {
    const fn = (ce: ComputeEngine) => ce.declare('f', '(number) -> number');
    expect(raw("f_{n+1}'", fn)).toEqual([
      'Derivative',
      ['Subscript', 'f', ['Add', 'n', 1]],
    ]);
  });

  test('an applied prime and a parenthesized expression are unchanged', () => {
    expect(raw("\\alpha_{i+1}'(t)")).toEqual([
      'Apply',
      ['Derivative', ['Subscript', 'alpha', ['Add', 'i', 1]], 1],
      't',
    ]);
    expect(raw("(x^2)'")).toEqual([
      'Derivative',
      ['Delimiter', ['Square', 'x']],
    ]);
  });

  test('a subscript on a parenthesized expression is still differentiated', () => {
    // The generic `_` parselet attaches a subscript to any expression, so a
    // `Subscript` head does not by itself mean a name: only one whose base
    // is a symbol follows the symbol rule.
    expect(raw("(x^2)_n'")).toEqual([
      'Derivative',
      ['Subscript', ['Delimiter', ['Square', 'x']], 'n'],
    ]);
  });
});
