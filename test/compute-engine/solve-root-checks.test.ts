import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// The roots of the equation `s` in `x`, as strings, or `null` when the
// equation is not solved.
function roots(s: string, x = 'x'): string[] | null {
  return (
    ce
      .parse(s)
      .solve(x)
      ?.map((r) => r.toString()) ?? null
  );
}

// The numeric value of `lhs - rhs` of the equation `s` at each root.
function residuals(s: string, x = 'x'): number[] {
  const eq = ce.parse(s);
  const solutions = eq.solve(x);
  expect(solutions).not.toBeNull();
  if (eq.operator !== 'Equal' || !('op1' in eq) || !('op2' in eq))
    throw new Error('not an equation');
  return solutions!.map((root) => {
    const value = eq.op1
      .sub(eq.op2)
      .subs({ [x]: root })
      .N();
    return Math.hypot(value.re, value.im);
  });
}

// The principal square root takes the values with a positive real part and
// the values `i·t` with a real `t ≥ 0`. The condition of `√u = r` for a
// constant `r` that is not real is decided from this range, not kept as
// `0 ≤ r`.
describe('Solve of a square root equal to a constant that is not real', () => {
  test('√x = i has the root -1', () => {
    expect(roots('\\sqrt{x} = i')).toEqual(['-1']);
    expect(ce.parse('\\sqrt{-1}').evaluate().toString()).toBe('i');
  });

  test('√x = -i has no root', () => {
    expect(roots('\\sqrt{x} = -i')).toEqual([]);
  });

  test('a right side with a positive real part', () => {
    expect(roots('\\sqrt{x} = 1+i')).toEqual(['2i']);
    expect(residuals('\\sqrt{x} = 1+i')[0]).toBeLessThan(1e-12);
  });

  test('a right side with a negative real part has no root', () => {
    expect(roots('\\sqrt{x} = -1+i')).toEqual([]);
  });

  test('a scaled square root and a compound radicand', () => {
    expect(roots('2\\sqrt{x} = 3i')).toEqual(['-9/4']);
    expect(roots('\\sqrt{x+1} = i')).toEqual(['-2']);
  });

  test('an unknown declared complex', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    expect(engine.parse('\\sqrt{z} = i').solve('z')?.map(String)).toEqual([
      '-1',
    ]);
    expect(engine.parse('\\sqrt{z} = -i').solve('z')?.map(String)).toEqual([]);
  });

  test('a symbolic right side keeps its condition', () => {
    expect(
      ce
        .parse('\\sqrt{x} = a')
        .solve('x')
        ?.map((r) => JSON.stringify(r.json))
    ).toEqual(['["When",["Power","a",2],["LessEqual",0,"a"]]']);
  });
});

// A float residual is compared with the size of the quantities of the
// equation at the candidate. With an absolute tolerance, the residual of an
// extraneous candidate of an equation whose terms are all small was read as
// zero.
describe('Solve checks a float residual relative to the size of the terms', () => {
  test('an extraneous root of a squared equation with small terms', () => {
    // Squaring `√x = x - 2` gives the candidates 1 and 4. At x = 1, the
    // residual is 2·10^-30.
    expect(
      roots('1.0\\times10^{-30}\\sqrt{x} = 1.0\\times 10^{-30}(x-2)')
    ).toEqual(['4']);
    expect(
      roots('\\sqrt{1.0\\times10^{-60}x} = 1.0\\times10^{-30}(x-2)')
    ).toEqual(['4']);
  });

  test('a candidate near a small constant', () => {
    // The roots of `u² - u - 2·10^-30 = 0` (`u = √x`) are about `1` and
    // `-2·10^-30`. The second one is not a square root.
    expect(roots('\\sqrt{x} = x - 2.0\\times10^{-30}')).toEqual(['1']);
    // `x² - x - 2·10^-30 = 0` has the roots about `1` and `-2·10^-30`. The
    // second one is negative, and a square root is not negative.
    expect(roots('\\sqrt{x+2.0\\times10^{-30}} = x')).toEqual(['1']);
  });

  test('a root where each term is near zero is kept', () => {
    // `x(x - 10^-30) = 1` has the root about `1 + 5·10^-31`: the two terms
    // are about `0` and `-10^-30` there.
    expect(roots('\\ln(x)+\\ln(x-1.0\\times10^{-30}) = 0')).toEqual(['1']);
    // The two roots are about `10^-30`.
    expect(roots('|x - 1.0\\times10^{-30}| = 0.5 \\times 10^{-30}x')).toEqual([
      '1e-30',
    ]);
  });

  test('the size of a square root is not the size of its argument', () => {
    // Squaring gives the candidate `10^40`, where `√x` is `10^20` and the
    // residual is `2·10^20`. With the size `10^40` of the argument, the
    // residual was read as zero, but the equation has no root.
    expect(roots('\\sqrt{x} = -1.0\\times10^{-20}x - 1')).toEqual([]);
  });

  test('roots of equations with ordinary terms are unchanged', () => {
    expect(roots('x^{-0.5} = 4')).toEqual(['0.0625']);
    expect(roots('x^{-0.5} = 10^{-30}')).toEqual(['1e+60']);
    expect(roots('x^{2.0} + 3x + 2 = 0')).toEqual(['-1', '-2']);
  });
});

// Over the real numbers, the solve of `Solve` over a domain is the solve of
// an unknown declared real. An empty list from it is an answer as it is for
// such an unknown.
describe('Solve over the real numbers gives the proven empty list', () => {
  test('a fractional power equal to a negative number', () => {
    expect(
      ce
        .box(['Solve', ['Equal', ['Power', 'x', 2.5], -4], 'x', 'RealNumbers'])
        .evaluate()
        .toString()
    ).toBe('[]');
    expect(
      ce
        .parse('\\operatorname{Solve}(x^{2.5} = -4, x, \\R)')
        .evaluate()
        .toString()
    ).toBe('[]');
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    expect(engine.parse('y^{2.5} = -4').solve('y')).toEqual([]);
  });

  test('over the complex numbers, the two roots are given', () => {
    const result = ce
      .box(['Solve', ['Equal', ['Power', 'x', 2.5], -4], 'x', 'ComplexNumbers'])
      .evaluate();
    expect(result.nops).toBe(2);
    // The roots are `4^{0.4}·e^{±2πi/5}`: `2.5·(±2π/5) = ±π`.
    for (const root of result.ops!) {
      const v = root.N();
      expect(Math.hypot(v.re, v.im)).toBeCloseTo(4 ** 0.4, 12);
      expect(Math.abs(Math.atan2(v.im, v.re))).toBeCloseTo(
        (2 * Math.PI) / 5,
        12
      );
    }
  });

  test('a positive right side gives the real root', () => {
    expect(
      ce
        .box(['Solve', ['Equal', ['Power', 'x', 2.5], 4], 'x', 'RealNumbers'])
        .evaluate()
        .ops!.map((r) => r.N().re)
    ).toEqual([expect.closeTo(4 ** 0.4, 12)]);
  });

  test('an equation that the solver cannot solve stays unevaluated', () => {
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Add', 'x', ['Exp', 'x']], 0],
          'x',
          'RealNumbers',
        ])
        .evaluate().operator
    ).toBe('Solve');
  });
});

// The `n` roots of `k·xⁿ + c = 0` are given by a direct formula. Before, the
// check of each root against the equation took most of the time:
// `x^{256} = 2` took about 15 s.
describe('Solve of a pure power with a large degree', () => {
  // Each root `z` of `xⁿ = c` has `|z|ⁿ = |c|` and `n·arg(z) = arg(c)`
  // modulo 2π, and the `n` roots are different.
  function checkPowerRoots(s: string, n: number, c: number): void {
    const solutions = ce.parse(s).solve('x')!;
    expect(solutions.length).toBe(n);
    const seen = new Set<string>();
    for (const root of solutions) {
      const v = root.N();
      const m = Math.hypot(v.re, v.im) ** n;
      const a = Math.atan2(v.im, v.re) * n;
      expect(Math.hypot(m * Math.cos(a) - c, m * Math.sin(a))).toBeLessThan(
        1e-9 * Math.abs(c)
      );
      seen.add(`${v.re.toFixed(9)},${v.im.toFixed(9)}`);
    }
    expect(seen.size).toBe(n);
  }

  test('x^256 = 2 and x^1000 = 2', () => {
    checkPowerRoots('x^{256} = 2', 256, 2);
    checkPowerRoots('x^{1000} = 2', 1000, 2);
  });

  test('a scaled power with a negative constant', () => {
    checkPowerRoots('2x^{999} + 6 = 0', 999, -3);
  });

  test('the small degrees keep their exact roots', () => {
    expect(roots('x^3 = 8')).toEqual(['2', '-1 + sqrt(3)i', '-1 - sqrt(3)i']);
    expect(roots('x^4 = 16')).toEqual(['-2', '2', '2i', '-2i']);
  });

  test('a real unknown keeps the real roots', () => {
    const engine = new ComputeEngine();
    engine.declare('r', 'real');
    expect(engine.parse('r^{100} = 2').solve('r')?.map(String)).toEqual([
      '-root(100)(2)',
      'root(100)(2)',
    ]);
    expect(engine.parse('r^{4} = -2').solve('r')).toEqual([]);
  });

  test('an integer-valued float exponent above 64 is a degree', () => {
    // Before, the exponent was read as a degree only up to 64, and
    // `x^{100.0} = 2^{100}` gave only the real roots `±2.0`.
    checkPowerRoots('x^{65.0} = 2', 65, 2);
    checkPowerRoots('x^{100.0} = 2^{100}', 100, 2 ** 100);
    const solutions = ce.parse('x^{100.0} = 2^{100}').solve('x')!;
    expect(solutions.every((r) => r.isExact === false)).toBe(true);
  });

  test('a constant with an assigned value of 0 gives one root', () => {
    // The roots of a pure power are not checked against the equation. A
    // symbol with an assigned value has no unknowns, so `x^3 = a` with
    // `a := 0` gave three roots `0`.
    const engine = new ComputeEngine();
    engine.assign('a', 0);
    engine.assign('b', 8);
    expect(engine.parse('x^3 = a').solve('x')?.map(String)).toEqual(['0']);
    expect(engine.parse('x^3 = b').solve('x')?.map(String)).toEqual([
      '2',
      '-1 + sqrt(3)i',
      '-1 - sqrt(3)i',
    ]);
    expect(engine.parse('x^3 = \\infty').solve('x')).toEqual([]);
  });
});

// A polynomial of a high degree with no closed form has its roots found
// numerically, with the Aberth iteration above the degree 12. Before, the
// degree was limited to 12, and an integer-valued float exponent was read as
// a degree only up to 64: `x^{65.0} + x = 2` gave no answer.
describe('Solve of a polynomial with a high degree', () => {
  // Each root is a root of the polynomial with the terms `terms` (pairs of a
  // degree and a coefficient), within the rounding error of the
  // evaluation, and the roots are different. The polynomial is evaluated
  // with machine numbers, independently of the engine.
  function checkPolynomialRoots(s: string, terms: [number, number][]): void {
    const n = Math.max(...terms.map(([k]) => k));
    const solutions = ce.parse(s).solve('x')!;
    expect(solutions).not.toBeNull();
    expect(solutions.length).toBe(n);
    const seen = new Set<string>();
    for (const root of solutions) {
      const z = root.N();
      let re = 0;
      let im = 0;
      let size = 0;
      const r = Math.hypot(z.re, z.im);
      const t = Math.atan2(z.im, z.re);
      for (const [k, a] of terms) {
        re += a * r ** k * Math.cos(k * t);
        im += a * r ** k * Math.sin(k * t);
        size += Math.abs(a) * r ** k;
      }
      expect(Math.hypot(re, im) / size).toBeLessThan(1e-12);
      seen.add(`${z.re.toFixed(8)},${z.im.toFixed(8)}`);
    }
    expect(seen.size).toBe(n);
  }

  test('an integer-valued float exponent above 64 in a polynomial', () => {
    const terms: [number, number][] = [
      [65, 1],
      [1, 1],
      [0, -2],
    ];
    checkPolynomialRoots('x^{65.0} + x = 2', terms);
    const solutions = ce.parse('x^{65.0} + x = 2').solve('x')!;
    expect(solutions.every((r) => r.isExact === false)).toBe(true);
  });

  test('the degrees 100 and 500', () => {
    checkPolynomialRoots('2x^{100} - x^{99} + 5 = 0', [
      [100, 2],
      [99, -1],
      [0, 5],
    ]);
    checkPolynomialRoots('x^{500} + 3x^2 - x + 7 = 0', [
      [500, 1],
      [2, 3],
      [1, -1],
      [0, 7],
    ]);
  });

  test('a degree 30 with all its terms', () => {
    const terms = Array.from({ length: 31 }, (_, k): [number, number] => [
      k,
      (k % 7) + 1,
    ]);
    checkPolynomialRoots(
      `${terms.map(([k, a]) => `${a}x^{${k}}`).join('+')} = 0`,
      terms
    );
  });

  test('above the limits, there is no answer', () => {
    // The check of each root takes a time that grows as the square of the
    // degree, and as the product of the degree and the number of terms
    expect(ce.parse('x^{1001.0} + x = 2').solve('x')).toBeNull();
    const terms = Array.from({ length: 151 }, (_, k) => `x^{${k}}`).join('+');
    expect(ce.parse(`${terms} = 2`).solve('x')).toBeNull();
  });
});

// The `n` roots of a pure power are not all built for an unknown declared
// real: only the real roots are. Above the degree 10000, the roots of a pure
// power of a complex unknown are not given: `x^{100000} = 2` took about one
// minute.
describe('Solve of a pure power with a very large degree', () => {
  const engine = new ComputeEngine();
  engine.declare('r', 'real');
  const realRoots = (s: string): string[] | undefined =>
    engine
      .parse(s)
      .solve('r')
      ?.map((r) => r.toString());

  test('a real unknown gets its real roots only', () => {
    expect(realRoots('r^{1000} = 2')).toEqual([
      '-root(1000)(2)',
      'root(1000)(2)',
    ]);
    expect(realRoots('r^{100000} = 2')).toEqual([
      '-root(100000)(2)',
      'root(100000)(2)',
    ]);
    expect(realRoots('r^{1001} = -2')).toEqual(['-root(1001)(2)']);
    expect(realRoots('r^{1000} = -2')).toEqual([]);
    expect(realRoots('r^{3} = 2i')).toEqual([]);
    expect(realRoots('r^{100000.0} = 2')).toEqual([
      '-1.00000693149582830565',
      '1.00000693149582830565',
    ]);
  });

  test('a real domain gets the real roots only', () => {
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Power', 'x', 100000], 2],
          ['Element', 'x', 'RealNumbers'],
        ])
        .evaluate()
        .toString()
    ).toBe('[-root(100000)(2),root(100000)(2)]');
  });

  test('a complex unknown above the degree 10000 gets no answer', () => {
    expect(ce.parse('x^{10001} = 2').solve('x')).toBeNull();
    expect(
      ce.parse('\\operatorname{Solve}(x^{100000} = 2, x)').evaluate().operator
    ).toBe('Solve');
    // Before, the two real roots `±2^{1/20000}` were the answer
    expect(ce.parse('x^{20000.0} = 2').solve('x')).toBeNull();
    expect(ce.parse('x^{40000} - 3x^{20000} + 2 = 0').solve('x')).toBeNull();
  });
});

// A step that changes only the exactness of a number changes the state of
// the equation: the curation of `explain('solve')` keeps it.
describe("explain('solve') keeps a step that changes the exactness", () => {
  test('a float exponent', () => {
    const ex = ce.parse('x^{2.0} + 3x + 2 = 0').explain('solve');
    expect(ex.steps.map((s) => s.id)).toEqual([
      'solve.harmonize',
      'solve.quadratic-formula',
      'solve.roots',
    ]);
    expect(JSON.stringify(ex.steps[0].value.json)).toBe(
      '["Equal",["Add",["Power","x",2],["Multiply",3,"x"],2],0]'
    );
    expect(JSON.stringify(ex.steps.at(-1)!.value.json)).toBe(
      '["List",["Equal","x",{"num":"-1.0"}],["Equal","x",{"num":"-2.0"}]]'
    );
    expect(JSON.stringify(ex.result.json)).toBe(
      '["List",{"num":"-1.0"},{"num":"-2.0"}]'
    );
  });

  test('an exact equation is unchanged', () => {
    const ex = ce.parse('x^2 + 3x + 2 = 0').explain('solve');
    expect(ex.steps.map((s) => s.id)).toEqual(['solve.quadratic-formula']);
  });
});
