import { ComputeEngine } from '../../src/compute-engine';
import {
  MPoly,
  mpolyFromBoxed,
  mpolyToBoxed,
} from '../../src/compute-engine/boxed-expression/multivariate-poly';
import { multivariateGCD } from '../../src/compute-engine/boxed-expression/multivariate-gcd';

// A fresh engine: the shared test engine assigns single-letter symbols.
const ce = new ComputeEngine();
const expand = (s: string) => ce.expr(['Expand', ce.parse(s)]).evaluate();
const P = (s: string, vars: string[]) => mpolyFromBoxed(ce, ce.parse(s), vars)!;
const same = (a: unknown, b: string) =>
  (a as ReturnType<typeof ce.expr>).isSame(expand(b));

describe('MPoly kernel', () => {
  test('round-trips a multivariate polynomial', () => {
    const p = P('3x^2 y + x - 5 z^3 + 7', ['x', 'y', 'z']);
    expect(same(mpolyToBoxed(ce, p), '3x^2 y + x - 5 z^3 + 7')).toBe(true);
  });

  test('clears rational coefficients to an integer primitive part', () => {
    const pp = P('(2x+3y)/2', ['x', 'y']).primitivePartInteger();
    expect(same(mpolyToBoxed(ce, pp), '2x+3y')).toBe(true);
  });

  test('add / sub / mul agree with Expand', () => {
    const a = P('x+2y', ['x', 'y']);
    const b = P('3x-y', ['x', 'y']);
    expect(same(mpolyToBoxed(ce, a.add(b)), '4x+y')).toBe(true);
    expect(same(mpolyToBoxed(ce, a.sub(b)), '-2x+3y')).toBe(true);
    expect(same(mpolyToBoxed(ce, a.mul(b)), '(x+2y)(3x-y)')).toBe(true);
  });

  test('content and primitive part', () => {
    const p = P('6x^2 y + 9 x y - 3 y', ['x', 'y']);
    expect(p.contentInteger()).toBe(3n);
    expect(
      same(mpolyToBoxed(ce, p.primitivePartInteger()), '2x^2 y + 3x y - y')
    ).toBe(true);
  });

  test('exact division (and rejection of a non-divisor)', () => {
    const v = ['x', 'y'];
    const q = MPoly.tryDivide(P('x^2 - y^2', v), P('x - y', v));
    expect(q && same(mpolyToBoxed(ce, q), 'x+y')).toBe(true);
    expect(MPoly.tryDivide(P('x^2+1', v), P('x+1', v))).toBeNull();
  });

  test('evaluation and coefficient views round-trip', () => {
    const p = P('x^2 y + 3 x y^2 - x + 5', ['x', 'y']);
    // y = 3 → 3x² + 27x − x + 5 = 3x² + 26x + 5
    expect(same(mpolyToBoxed(ce, p.evalVar(1, 3n)), '3x^2 + 26x + 5')).toBe(
      true
    );
    const cs = p.coeffsInVar(0);
    expect(MPoly.fromVarCoeffs(cs, 0, ['x', 'y']).equals(p)).toBe(true);
  });
});

describe("Brown's modular multivariate GCD", () => {
  // `multivariateGCD` returns a boxed expression (or null). Each case asserts
  // the GCD has the expected value and exactly divides both inputs (the kernel's
  // own soundness contract).
  const gcd = (a: string, b: string, vars: string[]) =>
    multivariateGCD(ce, expand(a), expand(b), vars);
  const divides = (g: ReturnType<typeof ce.expr>, s: string, vars: string[]) =>
    MPoly.tryDivide(P(s, vars), mpolyFromBoxed(ce, g, vars)!) !== null;

  test.each([
    ['(x+y)(x-y)', '(x+y)(x+2y)', ['x', 'y'], 'x+y'],
    ['(x+y+1)^2', '(x+y+1)(x-y+2)', ['x', 'y'], 'x+y+1'],
    ['x^3-y^3', 'x^2-y^2', ['x', 'y'], 'x-y'],
    ['(2x+3y)(x+y)', '(2x+3y)(x-y)', ['x', 'y'], '2x+3y'],
    ['(x+y+z)(x-z)', '(x+y+z)(y+2z)', ['x', 'y', 'z'], 'x+y+z'],
    ['(x y+z)(x+y+z)', '(x y+z)(x-z)', ['x', 'y', 'z'], 'x y+z'],
    ['(2x+y+z)(x-z)', '(2x+y+z)(y+2z)', ['x', 'y', 'z'], '2x+y+z'],
    ['(w+x+y+z)(w-x)', '(w+x+y+z)(y-z)', ['w', 'x', 'y', 'z'], 'w+x+y+z'],
  ])('gcd(%s, %s)', (a, b, vars, want) => {
    const g = gcd(a, b, vars as string[]);
    expect(g).not.toBeNull();
    expect(same(g!, want as string)).toBe(true);
    expect(divides(g!, a, vars as string[])).toBe(true);
    expect(divides(g!, b, vars as string[])).toBe(true);
  });

  test('coprime inputs yield a constant (trivial) gcd', () => {
    const g = gcd('x+y', 'x+2y', ['x', 'y']);
    // 1 (constant) — the operator layer defers this to keep gcd(x,6) unevaluated.
    expect(g === null || g.unknowns.length === 0).toBe(true);
  });
});
