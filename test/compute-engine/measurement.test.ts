import { ComputeEngine } from '../../src/compute-engine';
import { toAsciiMath } from '../../src/compute-engine/boxed-expression/ascii-math';

// A fresh engine so the `ce.assign('x', …)` cases don't leak into the shared
// test engine.
const ce = new ComputeEngine();

const M = (v: number, e: number) => ce.function('Measurement', [v, e]);

/** Nominal value of a (possibly evaluated) Measurement, as a float. */
function nominal(expr: ReturnType<typeof M>): number {
  return expr.operator === 'Measurement' ? (expr.op1.re ?? NaN) : (expr.re ?? NaN);
}

/** 1σ error of a Measurement, as a float (0 for a bare value). */
function error(expr: ReturnType<typeof M>): number {
  return expr.operator === 'Measurement' ? (expr.op2.re ?? NaN) : 0;
}

describe('Measurement — canonicalization', () => {
  test('Measurement(v, 0) collapses to the bare value', () => {
    const m = M(7, 0);
    expect(m.isSame(7)).toBe(true);
    expect(m.operator).not.toBe('Measurement');
  });

  test('error is canonicalized to its absolute value', () => {
    const m = M(5, -0.2);
    expect(m.operator).toBe('Measurement');
    expect(m.op2.re).toBeCloseTo(0.2, 12);
  });
});

describe('Measurement — error propagation (.N())', () => {
  test('Add: M(5,0.2) + M(3,0.4) -> 8 ± √0.20', () => {
    const r = ce.function('Add', [M(5, 0.2), M(3, 0.4)]).N();
    expect(nominal(r)).toBeCloseTo(8, 12);
    expect(error(r)).toBeCloseTo(0.4472135955, 8);
  });

  test('Multiply: M(5,0.2) · M(3,0.4) -> 15 ± √4.36', () => {
    const r = ce.function('Multiply', [M(5, 0.2), M(3, 0.4)]).N();
    expect(nominal(r)).toBeCloseTo(15, 12);
    expect(error(r)).toBeCloseTo(2.0880613018, 8);
  });

  test('Divide: M(6,0.3) / M(2,0.1) -> 3 ± √0.045', () => {
    const r = ce.function('Divide', [M(6, 0.3), M(2, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(3, 12);
    expect(error(r)).toBeCloseTo(0.2121320344, 8);
  });

  test('scalar · measurement: 2 · M(5,0.2) -> 10 ± 0.4', () => {
    const r = ce.function('Multiply', [2, M(5, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(10, 12);
    expect(error(r)).toBeCloseTo(0.4, 10);
  });

  test('scalar + measurement: M(5,0.2) + 3 -> 8 ± 0.2', () => {
    const r = ce.function('Add', [M(5, 0.2), 3]).N();
    expect(nominal(r)).toBeCloseTo(8, 12);
    expect(error(r)).toBeCloseTo(0.2, 10);
  });

  test('measurement ^ scalar: M(4,0.2)^2 -> 16 ± 1.6', () => {
    const r = ce.function('Power', [M(4, 0.2), 2]).N();
    expect(nominal(r)).toBeCloseTo(16, 12);
    expect(error(r)).toBeCloseTo(1.6, 10);
  });

  test('Negate: -M(5,0.2) -> -5 ± 0.2', () => {
    const r = ce.function('Negate', [M(5, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(-5, 12);
    expect(error(r)).toBeCloseTo(0.2, 10);
  });
});

describe('Measurement — exact/symbolic error under evaluate()', () => {
  test('exact inputs keep a symbolic error under evaluate(), float under N()', () => {
    // 1/5 and 2/5 are exact rationals; the propagated error stays a symbolic
    // Sqrt under evaluate() and only numericizes under .N() (evaluate-vs-N
    // exactness contract).
    const m = ce.function('Add', [
      ce.function('Measurement', [5, ce.number([1, 5])]),
      ce.function('Measurement', [3, ce.number([2, 5])]),
    ]);
    const e = m.evaluate();
    expect(e.operator).toBe('Measurement');
    expect(e.op1.isSame(8)).toBe(true);
    // The error stays EXACT under evaluate() (here the radical √5/5, not a
    // float)...
    expect(e.op2.isExact).toBe(true);
    // ...and numericizes correctly under .N().
    expect(e.op2.N().re).toBeCloseTo(Math.hypot(1 / 5, 2 / 5), 10);
  });
});

describe('Measurement — independent semantics', () => {
  test('two distinct literals are NOT correlated: M(5,0.2) − M(5,0.2) -> 0 ± √0.08', () => {
    const r = ce.function('Subtract', [M(5, 0.2), M(5, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(0, 12);
    expect(error(r)).toBeCloseTo(0.2828427125, 8);
  });

  // Symbolic-reuse contrast / the correctness mechanism.
  //
  // Same-source reuse is meant to be resolved by symbolic canonicalization
  // BEFORE any numeric propagation: while `x` is a FREE symbol, `x - x` folds
  // to 0 and `x + x` folds to `2x`, so substituting the measurement afterwards
  // yields the correlated (correct) result — no spurious independent error.
  test('free symbol x - x folds to 0 before propagation', () => {
    expect(ce.parse('x - x').evaluate().isSame(0)).toBe(true);
  });

  test('free symbol x + x -> 2x, then substitute -> fully correlated 10 ± 0.4', () => {
    const folded = ce.parse('x + x').simplify(); // -> 2x
    const r = folded.subs({ x: M(5, 0.2) }).N();
    expect(nominal(r)).toBeCloseTo(10, 12);
    expect(error(r)).toBeCloseTo(0.4, 10);
  });

  // CAVEAT (see report): `ce.assign('x', Measurement)` binds `x` to a concrete
  // value, so `.evaluate()` substitutes it EAGERLY — the symbolic fold never
  // happens and reuse is treated as independent. This documents the actual
  // behavior; the correlation mechanism above requires keeping `x` free.
  test('assigned measurement + evaluate substitutes eagerly (independent)', () => {
    const scoped = new ComputeEngine();
    scoped.assign('x', scoped.function('Measurement', [5, 0.2]));
    const r = scoped.parse('x - x').N();
    // Independent-propagation result, NOT 0.
    expect(r.operator).toBe('Measurement');
    expect(r.op1.re).toBeCloseTo(0, 12);
    expect(r.op2.re).toBeCloseTo(0.2828427125, 8);
  });
});

describe('Measurement — elementary function propagation (.N())', () => {
  test('Sqrt: √M(4,0.2) -> 2 ± 0.05', () => {
    const r = ce.function('Sqrt', [M(4, 0.2)]).N();
    expect(nominal(r)).toBeCloseTo(2, 12);
    expect(error(r)).toBeCloseTo(0.05, 10);
  });

  test('Root: M(8,0.1)^{1/3} -> 2 ± 0.008333', () => {
    const r = ce.function('Root', [M(8, 0.1), 3]).N();
    expect(nominal(r)).toBeCloseTo(2, 12);
    expect(error(r)).toBeCloseTo(0.0083333333, 8);
  });

  test('Exp: e^M(1,0.1) -> 2.71828 ± 0.27183 (routes through Power)', () => {
    const r = ce.function('Exp', [M(1, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(2.7182818285, 8);
    expect(error(r)).toBeCloseTo(0.2718281828, 8);
  });

  test('Ln: ln M(2,0.1) -> 0.69315 ± 0.05', () => {
    const r = ce.function('Ln', [M(2, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(0.6931471806, 8);
    expect(error(r)).toBeCloseTo(0.05, 10);
  });

  test('Log base 10: log M(100,0.1) -> 2 ± 0.000434', () => {
    const r = ce.function('Log', [M(100, 0.1), 10]).N();
    expect(nominal(r)).toBeCloseTo(2, 12);
    expect(error(r)).toBeCloseTo(0.1 / (100 * Math.log(10)), 10);
  });

  test('Sin: sin M(1,0.1) -> 0.84147 ± 0.05403', () => {
    const r = ce.function('Sin', [M(1, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(0.8414709848, 8);
    expect(error(r)).toBeCloseTo(0.0540302306, 8);
  });

  test('Cos: cos M(1,0.1) -> 0.54030 ± 0.08415', () => {
    const r = ce.function('Cos', [M(1, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(0.5403023059, 8);
    expect(error(r)).toBeCloseTo(0.0841470985, 8);
  });

  test('Tan: tan M(0,0.1) -> 0 ± 0.1', () => {
    const r = ce.function('Tan', [M(0, 0.1)]).N();
    expect(nominal(r)).toBeCloseTo(0, 12);
    expect(error(r)).toBeCloseTo(0.1, 10);
  });

  // First-order (linear) propagation gives ZERO error at a stationary point:
  // cos'(0) = -sin(0) = 0, so the error collapses to 0 and the Measurement
  // canonicalizes back to the bare value 1.
  test('Cos at extremum: cos M(0,0.1) -> 1 (bare, zero slope)', () => {
    const r = ce.function('Cos', [M(0, 0.1)]).N();
    expect(r.operator).not.toBe('Measurement');
    expect(r.re).toBeCloseTo(1, 12);
  });
});

describe('Measurement — elementary functions honor evaluate-vs-N contract', () => {
  test('Sqrt of exact input keeps an EXACT error under evaluate(), float under N()', () => {
    // 1/5 is an exact rational; the propagated error √-free here is 1/20,
    // which stays exact under evaluate() and only floats under .N().
    const m = ce
      .function('Sqrt', [ce.function('Measurement', [4, ce.number([1, 5])])])
      .evaluate();
    expect(m.operator).toBe('Measurement');
    expect(m.op1.isSame(2)).toBe(true);
    expect(m.op2.isSame(ce.number([1, 20]))).toBe(true);
    expect(m.op2.isExact).toBe(true);
    expect(m.op2.N().re).toBeCloseTo(0.05, 12);
  });
});

describe('Measurement — angular-unit-aware trig propagation', () => {
  // The trig derivative is taken in the engine's angular convention: in degree
  // mode it carries the π/180 chain factor.
  test('degree mode: sin(30° ± 1°) error uses (π/180)·cos(30°)', () => {
    const scoped = new ComputeEngine();
    scoped.angularUnit = 'deg';
    const r = scoped
      .function('Sin', [scoped.function('Measurement', [30, 1])])
      .N();
    expect(r.op1.re).toBeCloseTo(0.5, 10);
    expect(r.op2.re).toBeCloseTo((Math.PI / 180) * Math.cos(Math.PI / 6), 10);
  });
});

describe('Measurement — type', () => {
  test('Measurement of real inputs is real', () => {
    expect(M(5, 0.2).type.matches('real')).toBe(true);
  });
});

describe('Measurement — \\pm parses to Measurement', () => {
  test('infix a \\pm b -> Measurement(a, b)', () => {
    expect(ce.parse('5.1 \\pm 0.2').json).toEqual(['Measurement', 5.1, 0.2]);
  });

  test('prefix \\pm b -> Measurement(0, b)', () => {
    expect(ce.parse('\\pm 0.2').json).toEqual(['Measurement', 0, 0.2]);
  });

  test('\\plusmn is an alias for \\pm', () => {
    expect(ce.parse('5.1 \\plusmn 0.2').json).toEqual([
      'Measurement',
      5.1,
      0.2,
    ]);
  });

  test('round-trip: parse then serialize back to LaTeX', () => {
    // Default display rounds the error to 2 significant figures and aligns the
    // nominal to the same decimal place, so `5.1 ± 0.2` serializes as
    // `5.10 ± 0.20` (both round-trip back to their values on re-parse).
    expect(ce.parse('5.1 \\pm 0.2').toLatex()).toBe('5.10\\pm0.20');
  });
});

describe('Measurement — error-aware display rounding', () => {
  // Default (`digits: 'auto'`): round the error to 2 significant figures, then
  // round the nominal to the error's least-significant displayed decimal place
  // (value and uncertainty share a decimal place; trailing zeros are kept).
  test('LaTeX display convention (auto = 2 sig figs on error)', () => {
    expect(M(8, 0.2236).toLatex()).toBe('8.00\\pm0.22');
    expect(M(5.134, 0.021).toLatex()).toBe('5.134\\pm0.021');
    expect(M(5.1, 0.234).toLatex()).toBe('5.10\\pm0.23');
    expect(M(1234.5, 12).toLatex()).toBe('1235\\pm12');
    expect(M(9.81, 0.037).toLatex()).toBe('9.810\\pm0.037');
  });

  test('AsciiMath display convention (auto = 2 sig figs on error)', () => {
    expect(M(8, 0.2236).toString()).toBe('8.00 ± 0.22');
    expect(M(5.134, 0.021).toString()).toBe('5.134 ± 0.021');
    expect(M(5.1, 0.234).toString()).toBe('5.10 ± 0.23');
    expect(M(1234.5, 12).toString()).toBe('1235 ± 12');
  });

  test('digits: { significant: 1 } rounds the error to 1 sig fig', () => {
    // Error 0.021 → 0.02 (1 sig fig, hundredths) → nominal aligned to hundredths.
    expect(M(5.134, 0.021).toLatex({ digits: { significant: 1 } })).toBe(
      '5.13\\pm0.02'
    );
  });

  test('digits: { significant: 3 } rounds the error to 3 sig figs', () => {
    expect(
      M(5.13456, 0.021789).toLatex({ digits: { significant: 3 } })
    ).toBe('5.1346\\pm0.0218');
  });

  test('digits: { fractional: 2 } rounds both to 2 decimal places', () => {
    expect(M(5.134, 0.021).toLatex({ digits: { fractional: 2 } })).toBe(
      '5.13\\pm0.02'
    );
  });

  test("digits: 'max' shows full precision", () => {
    expect(M(5.134, 0.021).toLatex({ digits: 'max' })).toBe('5.134\\pm0.021');
  });

  test('AsciiMath honors digits: { significant: 1 }', () => {
    expect(toAsciiMath(M(5.134, 0.021) as any, { digits: { significant: 1 } })).toBe(
      '5.13 ± 0.02'
    );
  });

  test('.json / toMathJson stays lossless (full precision)', () => {
    expect(M(5.134, 0.021).toMathJson()).toEqual(['Measurement', 5.134, 0.021]);
  });
});

describe('Measurement — PlusMinus branch migration', () => {
  test('quadratic solve returns an explicit List of the two roots', () => {
    const sol = ce
      .box(['Solve', ['Equal', ['Add', ['Square', 'x'], -1], 0], 'x'])
      .evaluate();
    // Two explicit branch values (a List), not a \pm form.
    expect(sol.operator).toBe('List');
    expect(sol.ops!.length).toBe(2);
    const roots = sol.ops!.map((r) => r.re).sort((a, b) => a! - b!);
    expect(roots[0]).toBeCloseTo(-1, 12);
    expect(roots[1]).toBeCloseTo(1, 12);
  });
});

describe('Measurement — units interaction (Phase 5)', () => {
  // A quantity Quantity(Measurement(v, e), unit).
  const QM = (v: number, e: number, unit: string) =>
    ce.box(['Quantity', ['Measurement', v, e], unit]);

  /** The (nominal, error, unit) of an evaluated measurement-quantity. */
  function qm(expr: ReturnType<typeof QM>) {
    expect(expr.operator).toBe('Quantity');
    const mag = expr.op1!;
    const unit = expr.op2!.symbol ?? expr.op2!.toString();
    return { nominal: nominal(mag), error: error(mag), unit };
  }

  test('add: (5±0.2)cm + (3±0.1)cm -> (8 ± 0.2236) cm', () => {
    const r = ce.function('Add', [QM(5, 0.2, 'cm'), QM(3, 0.1, 'cm')]).N();
    const { nominal: n, error: e, unit } = qm(r);
    expect(n).toBeCloseTo(8, 12);
    expect(e).toBeCloseTo(Math.hypot(0.2, 0.1), 8); // 0.2236…
    expect(unit).toBe('cm');
  });

  test('multiply: (5±0.2)cm · (3±0.1)cm -> (15 ± 0.7810) cm²', () => {
    const r = ce.function('Multiply', [QM(5, 0.2, 'cm'), QM(3, 0.1, 'cm')]).N();
    expect(r.operator).toBe('Quantity');
    expect(nominal(r.op1!)).toBeCloseTo(15, 12);
    // σ = √((3·0.2)² + (5·0.1)²) = √(0.36 + 0.25) = √0.61
    expect(error(r.op1!)).toBeCloseTo(Math.sqrt(0.61), 8); // 0.7810…
    // Unit is cm·cm (length²)
    expect(ce.box(['UnitDimension', r.op2!]).evaluate().toString()).toBe(
      ce.box(['UnitDimension', ['Multiply', 'cm', 'cm']]).evaluate().toString()
    );
  });

  test('UnitConvert: (5.1±0.2)cm -> m gives (0.051 ± 0.002) m', () => {
    const r = ce.box(['UnitConvert', ['Quantity', ['Measurement', 5.1, 0.2], 'cm'], 'm']).N();
    const { nominal: n, error: e, unit } = qm(r);
    expect(n).toBeCloseTo(0.051, 12);
    expect(e).toBeCloseTo(0.002, 12);
    expect(unit).toBe('m');
  });

  test('mixed units add: (5±0.2)cm + (3±0.1)m converts the error', () => {
    // Result in metres: 0.05 m + 3 m = 3.05 m; the cm error 0.2 → 0.002 m,
    // then quadrature with 0.1 m: √(0.1² + 0.002²) ≈ 0.100020.
    const r = ce.function('Add', [QM(5, 0.2, 'cm'), QM(3, 0.1, 'm')]).N();
    const { nominal: n, error: e, unit } = qm(r);
    expect(n).toBeCloseTo(3.05, 12);
    expect(e).toBeCloseTo(Math.hypot(0.1, 0.002), 8);
    expect(unit).toBe('m');
  });

  test('subtract: (5±0.2)cm - (3±0.1)cm -> (2 ± 0.2236) cm', () => {
    const r = ce.function('Subtract', [QM(5, 0.2, 'cm'), QM(3, 0.1, 'cm')]).N();
    const { nominal: n, error: e, unit } = qm(r);
    expect(n).toBeCloseTo(2, 12);
    expect(e).toBeCloseTo(Math.hypot(0.2, 0.1), 8);
    expect(unit).toBe('cm');
  });

  test('evaluate() keeps a symbolic (exact) error, .N() floats it', () => {
    const sum = ce.function('Add', [QM(5, 0.2, 'cm'), QM(3, 0.1, 'cm')]);
    const ev = sum.evaluate();
    expect(ev.operator).toBe('Quantity');
    expect(ev.op1!.operator).toBe('Measurement');
    // The error is a symbolic Sqrt under evaluate(), a float under N().
    expect(ev.op1!.op2!.operator).toBe('Sqrt');
    expect(error(sum.N().op1!)).toBeCloseTo(Math.hypot(0.2, 0.1), 8);
  });

  test('parse: (5.1 ± 0.2) cm -> Quantity(Measurement(5.1, 0.2), cm)', () => {
    const p = ce.parse('(5.1 \\pm 0.2)\\,\\mathrm{cm}');
    expect(p.json).toEqual(['Quantity', ['Measurement', 5.1, 0.2], 'cm']);
  });

  test('display: Quantity(Measurement(5.1, 0.2), cm) round-trips', () => {
    const q = ce.box(['Quantity', ['Measurement', 5.1, 0.2], 'cm']);
    // Default display rounds the error to 2 significant figures and aligns the
    // nominal to the same decimal place (`5.1 ± 0.2` → `5.10 ± 0.20`).
    expect(q.toLatex()).toBe('\\left(5.10\\pm0.20\\right)\\,\\mathrm{cm}');
    expect(q.toString()).toBe('(5.10 ± 0.20) cm');
    // Round-trip through the serialized LaTeX.
    expect(ce.parse(q.toLatex()).json).toEqual([
      'Quantity',
      ['Measurement', 5.1, 0.2],
      'cm',
    ]);
  });

  test('units display honors digits: { significant: 2 } on the error', () => {
    // (5±0.2)cm + (3±0.1)cm -> (8 ± √0.05) cm; √0.05 ≈ 0.2236, which shows as
    // 0.22 at 2 significant figures.
    const r = ce.function('Add', [QM(5, 0.2, 'cm'), QM(3, 0.1, 'cm')]).N();
    expect(r.toLatex({ digits: { significant: 2 } })).toBe(
      '\\left(8.00\\pm0.22\\right)\\,\\mathrm{cm}'
    );
  });

  test('bare (unparenthesised) notation mis-nests — documented limitation', () => {
    // `5.1 ± 0.2 cm` without parentheses: `\pm` is low precedence and the unit
    // juxtaposition binds tighter, so the unit attaches to the error operand,
    // not the whole measurement. Deferred (needs parser-precedence surgery);
    // use `(5.1 ± 0.2) cm`. This test documents the current behavior.
    const p = ce.parse('5.1 \\pm 0.2\\,\\mathrm{cm}');
    expect(p.operator).toBe('Measurement');
    expect(p.op1!.re).toBeCloseTo(5.1, 12);
    // The unit ended up inside the error operand rather than on the whole.
    expect(p.toString()).not.toBe('(5.1 ± 0.2) cm');
  });

  test('regression: plain (non-measurement) Quantity arithmetic unchanged', () => {
    const add = ce.function('Add', [
      ce.box(['Quantity', 5, 'cm']),
      ce.box(['Quantity', 3, 'cm']),
    ]);
    expect(add.evaluate().json).toEqual(['Quantity', 8, 'cm']);

    const conv = ce.box(['UnitConvert', ['Quantity', 250, 'cm'], 'm']).evaluate();
    expect(conv.operator).toBe('Quantity');
    expect(conv.op1!.re).toBeCloseTo(2.5, 12);
    expect(conv.op2!.symbol).toBe('m');
  });
});
