import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

//
// Tests for the nonlinear least-squares operators `FindFit` and `FindRoot`
// (design: docs/plans/2026-07-21-findfit-design.md § 7).
//
// Every reference value is verified empirically: synthetic data is generated
// from known ground-truth parameters (exact model evaluation) and the fit is
// asserted to recover them to tolerance; the linear case is cross-checked
// against `LinearRegression`.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// --- helpers ---------------------------------------------------------------

/** A `List` of `(x, y)` tuples. */
function dataset(pts: [number, number][]): BoxedExpression {
  return ce.function(
    'List',
    pts.map(([x, y]) => ce.tuple(ce.number(x), ce.number(y)))
  );
}

/** Run `FindFit` and return the result record. */
function findFit(
  data: BoxedExpression,
  model: any,
  params: any,
  vars: any
): BoxedExpression {
  return ce
    .function('FindFit', [
      data,
      ce.box(model),
      ce.box(params),
      typeof vars === 'string' ? ce.symbol(vars) : ce.box(vars),
    ])
    .evaluate();
}

/** Run `FindRoot` and return the result record. */
function findRoot(equations: any, params: any): BoxedExpression {
  return ce.function('FindRoot', [ce.box(equations), ce.box(params)]).evaluate();
}

const param = (rec: BoxedExpression, name: string): number =>
  Number(rec.get('parameters')?.get(name)?.re);
const converged = (rec: BoxedExpression): boolean =>
  rec.get('converged')?.symbol === 'True';
const residualNorm = (rec: BoxedExpression): number =>
  Number(rec.get('residualNorm')?.re);
const iterations = (rec: BoxedExpression): number =>
  Number(rec.get('iterations')?.re);

/** Deterministic LCG so the "random" non-convergence data is reproducible. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// --- § 7.1 Linear sanity ---------------------------------------------------

describe('FindFit linear sanity (§ 7.1)', () => {
  test('reproduces LinearRegression coefficients', () => {
    const pts: [number, number][] = [
      [1, 2.1],
      [2, 4.3],
      [3, 5.9],
      [4, 8.2],
      [5, 9.8],
    ];
    const data = dataset(pts);
    const lr = ce.function('LinearRegression', [data]).N();
    const b0 = Number(lr.op1.re);
    const b1 = Number(lr.op2.re);

    const rec = findFit(
      data,
      ['Add', 'b0', ['Multiply', 'b1', 'x']],
      ['List', ['Tuple', 'b0', 0], ['Tuple', 'b1', 1]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'b0')).toBeCloseTo(b0, 6);
    expect(param(rec, 'b1')).toBeCloseTo(b1, 6);
  });
});

// --- § 7.2 Corpus shapes ---------------------------------------------------

describe('FindFit corpus shapes (§ 7.2)', () => {
  test('a·e^{b·x}', () => {
    const A = 4,
      B = 0.3;
    const xs = [0, 1, 2, 3, 4, 5];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.exp(B * x)])),
      ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
  });

  test('a·e^{b·x} + c (not log-linearizable)', () => {
    const A = 2,
      B = 0.5,
      C = 1;
    const xs = [0, 0.5, 1, 1.5, 2, 2.5, 3];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.exp(B * x) + C])),
      ['Add', ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]], 'c'],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1], ['Tuple', 'c', 0]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
    expect(param(rec, 'c')).toBeCloseTo(C, 5);
  });

  test('a·x^b', () => {
    const A = 3,
      B = 1.5;
    const xs = [1, 2, 3, 4, 5, 6];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.pow(x, B)])),
      ['Multiply', 'a', ['Power', 'x', 'b']],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
  });

  test('Gaussian a·exp(−(x−b)²/(2c²))', () => {
    const A = 2,
      B = 3,
      C = 1.5;
    const xs = [0, 1, 2, 3, 4, 5, 6];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.exp(-((x - B) ** 2) / (2 * C ** 2))])),
      [
        'Multiply',
        'a',
        [
          'Exp',
          [
            'Divide',
            ['Negate', ['Power', ['Subtract', 'x', 'b'], 2]],
            ['Multiply', 2, ['Power', 'c', 2]],
          ],
        ],
      ],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 2], ['Tuple', 'c', 1]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
    expect(Math.abs(param(rec, 'c'))).toBeCloseTo(C, 5);
  });

  test('cosine a·cos(b·x + c)', () => {
    const A = 2,
      B = 1.5,
      C = 0.5;
    const xs = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.cos(B * x + C)])),
      ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]],
      // Start near ground truth (cosine has many local minima).
      ['List', ['Tuple', 'a', 1.5], ['Tuple', 'b', 1.4], ['Tuple', 'c', 0.4]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
    expect(param(rec, 'c')).toBeCloseTo(C, 5);
  });
});

// --- § 7.3 Box constraints -------------------------------------------------

describe('FindFit box constraints (§ 7.3)', () => {
  const A = 2,
    B = 0.5,
    C = 1;
  const xs = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const model = ['Add', ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]], 'c'];
  const data = () => dataset(xs.map((x) => [x, A * Math.exp(B * x) + C]));

  test('unconstrained minimizer outside the box → converged at the bound', () => {
    // True b = 0.5, box caps it at 0.3.
    const rec = findFit(
      data(),
      model,
      [
        'List',
        ['Tuple', 'a', 1],
        ['Tuple', 'b', 0.1, -10, 0.3],
        ['Tuple', 'c', 0],
      ],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'b')).toBeCloseTo(0.3, 8);
  });

  test('interior box → same answer as unconstrained', () => {
    const rec = findFit(
      data(),
      model,
      [
        'List',
        ['Tuple', 'a', 1, 0, 10],
        ['Tuple', 'b', 0.4, 0, 2],
        ['Tuple', 'c', 0, -5, 5],
      ],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
    expect(param(rec, 'c')).toBeCloseTo(C, 5);
  });
});

// --- § 7.4 Joint / system form ---------------------------------------------

describe('FindFit joint form (§ 7.4)', () => {
  test('shared parameter: joint fit differs from independent fits', () => {
    // m1 = a·x from a=2 data; m2 = a·x² from a=3 data.
    const d1 = dataset([
      [1, 2],
      [2, 4],
      [3, 6],
    ]);
    const d2 = dataset([
      [1, 3],
      [2, 12],
      [3, 27],
    ]);
    const params = ['List', ['Tuple', 'a', 1]];

    // Independent fits recover 2 and 3 respectively.
    const f1 = findFit(d1, ['Multiply', 'a', 'x'], params, 'x');
    const f2 = findFit(d2, ['Multiply', 'a', ['Power', 'x', 2]], params, 'x');
    expect(param(f1, 'a')).toBeCloseTo(2, 6);
    expect(param(f2, 'a')).toBeCloseTo(3, 6);

    // Joint fit is the least-squares compromise 322/112 = 2.875.
    const joint = findFit(
      ce.function('List', [d1, d2]),
      ['List', ['Multiply', 'a', 'x'], ['Multiply', 'a', ['Power', 'x', 2]]],
      params,
      'x'
    );
    expect(converged(joint)).toBe(true);
    expect(param(joint, 'a')).toBeCloseTo(2.875, 6);
  });

  test('several shared parameters across several models (scaled 6/9 analogue)', () => {
    // Three parameters a, b, c shared by two models, consistent data.
    const a = 2,
      b = 1,
      c = -3;
    const xs = [1, 2, 3, 4];
    const d1 = dataset(xs.map((x) => [x, a * x + b]));
    const d2 = dataset(xs.map((x) => [x, a * x * x + c]));
    const joint = findFit(
      ce.function('List', [d1, d2]),
      [
        'List',
        ['Add', ['Multiply', 'a', 'x'], 'b'],
        ['Add', ['Multiply', 'a', ['Power', 'x', 2]], 'c'],
      ],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 0], ['Tuple', 'c', 0]],
      'x'
    );
    expect(converged(joint)).toBe(true);
    expect(param(joint, 'a')).toBeCloseTo(a, 6);
    expect(param(joint, 'b')).toBeCloseTo(b, 6);
    expect(param(joint, 'c')).toBeCloseTo(c, 6);
  });
});

// --- § 7.5 FindRoot --------------------------------------------------------

describe('FindRoot (§ 7.5)', () => {
  test('scalar root: cos(x) − x = 0', () => {
    const rec = findRoot(['Subtract', ['Cos', 'x'], 'x'], [
      'List',
      ['Tuple', 'x', 0.5],
    ]);
    expect(converged(rec)).toBe(true);
    // Dottie number.
    expect(param(rec, 'x')).toBeCloseTo(0.7390851332151607, 8);
  });

  test('2×2 nonlinear system: x²+y²=1, x=y', () => {
    const rec = findRoot(
      ['List', ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 1], ['Equal', 'x', 'y']],
      ['List', ['Tuple', 'x', 0.5], ['Tuple', 'y', 0.9]]
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'x')).toBeCloseTo(Math.SQRT1_2, 7);
    expect(param(rec, 'y')).toBeCloseTo(Math.SQRT1_2, 7);
  });

  test('equation and residual spellings are equivalent', () => {
    const start = ['List', ['Tuple', 'x', 1]];
    const eqForm = findRoot(['Equal', ['Power', 'x', 2], 2], start);
    const resForm = findRoot(['Subtract', ['Power', 'x', 2], 2], start);
    expect(param(eqForm, 'x')).toBeCloseTo(Math.SQRT2, 8);
    expect(param(resForm, 'x')).toBeCloseTo(Math.SQRT2, 8);
    expect(param(eqForm, 'x')).toBeCloseTo(param(resForm, 'x'), 12);
  });
});

// --- § 7.6 Diagnostics: non-convergence ------------------------------------

describe('FindFit diagnostics (§ 7.6)', () => {
  test('non-converging fit returns converged:False with finite best-so-far', () => {
    // Two-tone sinusoid fit to pseudo-random data from a poor start: the rough
    // multimodal landscape does not settle within the 200-iteration cap.
    const rnd = lcg(42);
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) pts.push([i * 0.3, rnd() * 2 - 1]);
    const rec = findFit(
      dataset(pts),
      [
        'Add',
        ['Multiply', 'a', ['Sin', ['Add', ['Multiply', 'b', 'x'], 'c']]],
        ['Multiply', 'p', ['Sin', ['Add', ['Multiply', 'q', 'x'], 'r']]],
      ],
      [
        'List',
        ['Tuple', 'a', 1],
        ['Tuple', 'b', 1],
        ['Tuple', 'c', 0],
        ['Tuple', 'p', 1],
        ['Tuple', 'q', 2],
        ['Tuple', 'r', 0],
      ],
      'x'
    );
    expect(converged(rec)).toBe(false);
    // It either exhausts the 200-iteration cap or bails earlier on a detected
    // stall (accepted step underflows / trust region collapses) — both are
    // non-convergence with a finite best-so-far returned.
    expect(iterations(rec)).toBeGreaterThan(0);
    expect(iterations(rec)).toBeLessThanOrEqual(200);
    expect(Number.isFinite(residualNorm(rec))).toBe(true);
    for (const name of ['a', 'b', 'c', 'p', 'q', 'r'])
      expect(Number.isFinite(param(rec, name))).toBe(true);
    // It is a record, not an error.
    expect(rec.operator).toBe('Dictionary');
  });
});

// --- Scale invariance (design § 5) -----------------------------------------

describe('FindFit scale invariance (§ 5)', () => {
  test('data scaled by 1e4 still converges to the scaled ground truth', () => {
    // Same a·e^{b·x} problem as § 7.2, but the observations (and hence the
    // residuals) are scaled by 1e4: ground truth a = 2e4, b = 0.5. The
    // Marquardt-scaled damping is parameter/residual-scale invariant, so this
    // must converge within the same iteration budget as the unscaled fit.
    //
    // Regression guard for the λ-initialization fix: with the old
    // scale-dependent init (λ = 1e-3·max diag A, quadratic in the residual
    // scale) the first steps underflow and this does NOT converge.
    const A = 2e4,
      B = 0.5;
    const xs = [0, 1, 2, 3, 4, 5];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.exp(B * x)])),
      ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]],
      ['List', ['Tuple', 'a', 1e4], ['Tuple', 'b', 1]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    // Relative tolerance on the scaled amplitude; b is O(1).
    expect(param(rec, 'a') / 1e4).toBeCloseTo(A / 1e4, 4);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
  });
});

// --- § 7.7 Inert / error cases ---------------------------------------------

describe('FindFit inert and error cases (§ 7.7)', () => {
  test('symbolic data stays inert', () => {
    const rec = ce
      .function('FindFit', [
        ce.box(['List', ['Tuple', 'u', 'v']]),
        ce.box(['Multiply', 'a', 'x']),
        ce.box(['List', ['Tuple', 'a', 1]]),
        ce.symbol('x'),
      ])
      .evaluate();
    expect(rec.operator).toBe('FindFit');
  });

  test('malformed 3-tuple parameter spec is an error', () => {
    const rec = findFit(
      dataset([
        [1, 1],
        [2, 2],
      ]),
      ['Multiply', 'a', 'x'],
      ['List', ['Tuple', 'a', 1, 0]],
      'x'
    );
    expect(rec.operator).toBe('Error');
  });

  test('NaN / non-finite value at the starting point is an error', () => {
    // 1/b at b = 0 is non-finite.
    const rec = findRoot(['Subtract', ['Divide', 1, 'b'], 2], [
      'List',
      ['Tuple', 'b', 0],
    ]);
    expect(rec.operator).toBe('Error');
  });
});

// --- § 7.8 Jacobian finite-difference fallback -----------------------------

describe('FindFit Jacobian fallback (§ 7.8)', () => {
  test('model with a non-differentiable component fits via finite differences', () => {
    // ∂/∂b of a·Zeta(b·x) has no closed form CE can evaluate, so that column
    // uses a forward finite difference; the ∂/∂a column stays analytic.
    const A = 3,
      B = 1.2;
    const xs = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Number(ce.box(['Zeta', B * x]).N().re)])),
      ['Multiply', 'a', ['Zeta', ['Multiply', 'b', 'x']]],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
  });
});

// --- § 7.9 Deadline --------------------------------------------------------

describe('FindFit deadline (§ 7.9)', () => {
  test('withTimeLimit cancels a long fit with the standard cancellation', () => {
    const rnd = lcg(42);
    const pts: [number, number][] = [];
    for (let i = 0; i < 400; i++) pts.push([i * 0.03, rnd() * 2 - 1]);
    const data = dataset(pts);
    const model = ce.box([
      'Add',
      ['Multiply', 'a', ['Sin', ['Add', ['Multiply', 'b', 'x'], 'c']]],
      ['Multiply', 'p', ['Sin', ['Add', ['Multiply', 'q', 'x'], 'r']]],
    ]);
    const params = ce.box([
      'List',
      ['Tuple', 'a', 1],
      ['Tuple', 'b', 1],
      ['Tuple', 'c', 0],
      ['Tuple', 'p', 1],
      ['Tuple', 'q', 2],
      ['Tuple', 'r', 0],
    ]);

    let err: unknown;
    const t0 = Date.now();
    try {
      ce.withTimeLimit({ ms: 2, label: 'test:fit-deadline' }, () =>
        ce.function('FindFit', [data, model, params, ce.symbol('x')]).evaluate()
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CancellationError);
    expect((err as CancellationError).cause).toBe('timeout');
    expect((err as CancellationError).attribution).toBe('test:fit-deadline');
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

// --- Lazy handling of seeded parameter symbols -----------------------------

describe('FindFit lazy parameter handling', () => {
  test('a document value seeded onto a parameter symbol does not corrupt the fit', () => {
    // Tycho seeds parameter symbols with prior values before re-solving. The
    // operator is lazy, so these values must NOT be substituted into the model.
    ce.assign('a', 999);
    ce.assign('b', -7);
    ce.assign('c', 42);
    ce.assign('x', 3);
    const A = 2,
      B = 0.5,
      C = 1;
    const xs = [0, 0.5, 1, 1.5, 2, 2.5, 3];
    const rec = findFit(
      dataset(xs.map((x) => [x, A * Math.exp(B * x) + C])),
      ['Add', ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]], 'c'],
      ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1], ['Tuple', 'c', 0]],
      'x'
    );
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(A, 5);
    expect(param(rec, 'b')).toBeCloseTo(B, 5);
    expect(param(rec, 'c')).toBeCloseTo(C, 5);
  });
});

// --- Route parity: raw MathJSON box + LaTeX parse --------------------------

describe('FindFit / FindRoot route parity', () => {
  // The consumer uses `ce.box(<raw MathJSON>)` and `ce.parse(<latex>)`, not
  // pre-boxed canonical args. Both operators are `lazy`, so the operands arrive
  // held and unbound — the handler must canonicalize them (resolving parse
  // sugar and binding collections) before lowering.

  test('box route: tuple param specs (verbatim repro)', () => {
    const data = [
      'List',
      ...[0, 1, 2, 3, 4, 5].map((j) => ['Tuple', j, 2 * Math.exp(0.5 * j)]),
    ];
    const rec = ce
      .box([
        'FindFit',
        data,
        ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]],
        ['List', ['Tuple', 'a', 1], ['Tuple', 'b', 1]],
        'x',
      ])
      .evaluate();
    expect(rec.operator).toBe('Dictionary');
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(2, 5);
    expect(param(rec, 'b')).toBeCloseTo(0.5, 5);
  });

  test('box route: bare-symbol param specs', () => {
    const data = [
      'List',
      ...[0, 1, 2, 3, 4, 5].map((j) => ['Tuple', j, 2 * Math.exp(0.5 * j)]),
    ];
    const rec = ce
      .box([
        'FindFit',
        data,
        ['Multiply', 'a', ['Exp', ['Multiply', 'b', 'x']]],
        ['List', 'a', 'b'], // bare symbols → start 1, unbounded
        'x',
      ])
      .evaluate();
    expect(rec.operator).toBe('Dictionary');
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(2, 5);
    expect(param(rec, 'b')).toBeCloseTo(0.5, 5);
  });

  test('LaTeX parse route: model juxtaposition resolves (verbatim repro)', () => {
    const rec = ce
      .parse(
        '\\operatorname{FindFit}(\\lbrack(0,2),(1,3.297),(2,5.437)\\rbrack, a\\exp(b x), \\lbrack a, b\\rbrack, x)'
      )
      .evaluate();
    expect(rec.operator).toBe('Dictionary');
    expect(converged(rec)).toBe(true);
    // Data rounded to 3 decimals, so tolerance is looser than the synthetic
    // exact-recovery cases.
    expect(param(rec, 'a')).toBeCloseTo(2, 2);
    expect(param(rec, 'b')).toBeCloseTo(0.5, 2);
  });

  test('LaTeX parse route: FindRoot with a juxtaposed product', () => {
    const rec = ce
      .parse('\\operatorname{FindRoot}(2 a = 6, \\lbrack a \\rbrack)')
      .evaluate();
    expect(rec.operator).toBe('Dictionary');
    expect(converged(rec)).toBe(true);
    expect(param(rec, 'a')).toBeCloseTo(3, 8);
  });
});

// --- LaTeX round-trip ------------------------------------------------------

describe('FindFit / FindRoot LaTeX round-trip', () => {
  test('FindFit serializes with \\operatorname and re-parses to the same head', () => {
    const expr = ce.box(
      ['FindFit', ['List'], 'x', ['List', 'a'], 'x'],
      { canonical: false }
    );
    const latex = expr.latex;
    expect(latex).toContain('\\operatorname{FindFit}');
    const reparsed = ce.parse(latex, { canonical: false });
    expect(reparsed.operator).toBe('FindFit');
  });

  test('FindRoot serializes with \\operatorname and re-parses to the same head', () => {
    const expr = ce.box(['FindRoot', 'x', ['List', 'a']], {
      canonical: false,
    });
    const latex = expr.latex;
    expect(latex).toContain('\\operatorname{FindRoot}');
    const reparsed = ce.parse(latex, { canonical: false });
    expect(reparsed.operator).toBe('FindRoot');
  });
});

// --- Empty model / equation lists (Finding 3) ------------------------------

describe('FindFit / FindRoot empty lists', () => {
  test('empty model list is an error, not a throw', () => {
    let rec: BoxedExpression;
    expect(() => {
      rec = findFit(
        dataset([
          [1, 1],
          [2, 2],
        ]),
        ['List'],
        ['List', ['Tuple', 'a', 1]],
        'x'
      );
    }).not.toThrow();
    expect(rec!.operator).toBe('Error');
    expect(rec!.isValid).toBe(false);
  });

  test('empty equation list is an error, not a throw', () => {
    let rec: BoxedExpression;
    expect(() => {
      rec = findRoot(['List'], ['List', ['Tuple', 'x', 1]]);
    }).not.toThrow();
    expect(rec!.operator).toBe('Error');
    expect(rec!.isValid).toBe(false);
  });
});

// --- Joint form with plain-y per-model datasets (Finding 4) -----------------

describe('FindFit joint plain-y datasets', () => {
  test('per-model plain-y lists fit jointly (verbatim repro)', () => {
    // FindFit(List(List(2,4,6), List(3,12,27)), List(a·x, a·x²), (a,1), x).
    // Each sub-list is a plain-y dataset (x = 1, 2, 3). Joint least-squares
    // compromise a = 322/112 = 2.875 (matches the § 7.4 tuple-form joint fit).
    const joint = findFit(
      ce.function('List', [ce.box(['List', 2, 4, 6]), ce.box(['List', 3, 12, 27])]),
      ['List', ['Multiply', 'a', 'x'], ['Multiply', 'a', ['Power', 'x', 2]]],
      ['List', ['Tuple', 'a', 1]],
      'x'
    );
    expect(converged(joint)).toBe(true);
    expect(param(joint, 'a')).toBeCloseTo(2.875, 6);
  });

  test('two-element per-model y-lists are NOT misread as shared (x, y) rows', () => {
    // Each per-model dataset has exactly two y-values — the shape that the old
    // code silently misread as (x, y) rows of a single shared dataset. Correct
    // joint interpretation: model1 = a·x over (1,2),(2,4); model2 = a·x² over
    // (1,3),(2,12). Joint a·(Σx² + Σx⁴) = Σx·y1 + Σx²·y2 → a·22 = 61.
    const joint = findFit(
      ce.function('List', [ce.box(['List', 2, 4]), ce.box(['List', 3, 12])]),
      ['List', ['Multiply', 'a', 'x'], ['Multiply', 'a', ['Power', 'x', 2]]],
      ['List', ['Tuple', 'a', 1]],
      'x'
    );
    expect(converged(joint)).toBe(true);
    expect(param(joint, 'a')).toBeCloseTo(61 / 22, 6);
    // The old shared-dataset misread converged near 1.527; guard against it.
    expect(param(joint, 'a')).not.toBeCloseTo(1.527, 2);
  });
});

// --- Infinite start (Finding 6) --------------------------------------------

describe('FindFit / FindRoot input validation', () => {
  test('an infinite start is an error (infinities allowed only as bounds)', () => {
    const rec = findRoot(['Subtract', 'a', 3], [
      'List',
      ['Tuple', 'a', 'PositiveInfinity'],
    ]);
    expect(rec.operator).toBe('Error');
    expect(rec.isValid).toBe(false);
  });
});
