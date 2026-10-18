import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

// The roots of the equation `s` in `x`, as MathJSON strings, or `null` when
// the equation is not solved.
function roots(s: string): string[] | null {
  return (
    ce
      .parse(s)
      .solve('x')
      ?.map((r) => JSON.stringify(r.json)) ?? null
  );
}

// Each root of `s`, put back in the equation, gives the same numeric value on
// the two sides.
function checkRoots(s: string): number {
  const eq = ce.parse(s);
  const solutions = eq.solve('x') as ReadonlyArray<Expression> | null;
  expect(solutions).not.toBeNull();
  if (!('op1' in eq) || !('op2' in eq)) throw new Error('not an equation');
  const [lhs, rhs] = [eq.op1 as Expression, eq.op2 as Expression];
  for (const root of solutions!) {
    const value = root.N();
    const left = lhs.subs({ x: value }).N();
    const right = rhs.subs({ x: value }).N();
    expect(Math.abs(left.re - right.re)).toBeLessThan(1e-12);
    expect(Math.abs(left.im - right.im)).toBeLessThan(1e-12);
  }
  return solutions!.length;
}

// An integer-valued float exponent is a degree (user decision 2026-10-18):
// for an integer `n`, `z^{n.0}` is `z^n` for each complex `z`. Thus
// `x^{2.0} = 4` has the two roots `±2.0`, as `x^2 = 4` has the roots `±2`,
// and `x^{4.0} = 16` has the four roots of `x^4 = 16`. The roots are floats,
// because the exponent is a float.
describe('Solve reads an integer-valued float exponent as a degree', () => {
  test('an even float exponent', () => {
    expect(roots('x^{2.0} = 4')).toEqual(['{"num":"2.0"}', '{"num":"-2.0"}']);
    expect(roots('2x^{2.0} = 8')).toEqual(['{"num":"2.0"}', '{"num":"-2.0"}']);
    // Before, the complex roots `±2.0i` were not given.
    expect(roots('x^{4.0} = 16')).toEqual([
      '{"num":"-2.0"}',
      '{"num":"2.0"}',
      '["Complex",{"num":"0.0"},{"num":"2.0"}]',
      '["Complex",{"num":"0.0"},{"num":"-2.0"}]',
    ]);
    expect(checkRoots('x^{2.0} = 4')).toBe(2);
    expect(checkRoots('x^{4.0} = 16')).toBe(4);
  });

  test('an odd float exponent', () => {
    // Before, the complex roots `1 ± √3·i` were not given.
    expect(roots('x^{3.0} = -8')).toEqual([
      '{"num":"-2.0"}',
      '["Complex",1,{"num":"1.732050807568877293527446"}]',
      '["Complex",1,{"num":"-1.732050807568877293527446"}]',
    ]);
    expect(checkRoots('x^{3.0} = -8')).toBe(3);
  });

  test('a quadratic', () => {
    // Before, these equations were not solved: the quadratic templates did
    // not read `2.0` as a degree.
    expect(roots('x^{2.0} + 3x + 2 = 0')).toEqual([
      '{"num":"-1.0"}',
      '{"num":"-2.0"}',
    ]);
    expect(checkRoots('x^{2.0} + 3x + 2 = 0')).toBe(2);
    expect(checkRoots('x^{2.0} + x + 1 = 0')).toBe(2);
    expect(checkRoots('2.5x^{2.0} - x = 0')).toBe(2);
    expect(
      ce.box(['Solve', ce.parse('x^{2.0} + 3x + 2 = 0'), 'x']).evaluate().json
    ).toEqual(['List', { num: '-1.0' }, { num: '-2.0' }]);
  });

  test('a cubic and a biquadratic', () => {
    expect(roots('x^{3.0} - 6x^{2.0} + 11x - 6 = 0')).toEqual([
      '{"num":"1.0"}',
      '{"num":"2.0"}',
      '{"num":"3.0"}',
    ]);
    expect(roots('x^{4.0} - 5x^{2.0} + 4 = 0')).toEqual([
      '{"num":"-2.0"}',
      '{"num":"-1.0"}',
      '{"num":"1.0"}',
      '{"num":"2.0"}',
    ]);
    expect(checkRoots('x^{3.0} - 6x^{2.0} + 11x - 6 = 0')).toBe(3);
    expect(checkRoots('x^{4.0} - 5x^{2.0} + 4 = 0')).toBe(4);
    // A product of polynomial factors.
    expect(checkRoots('(x^{2.0} - 1)(x - 3) = 0')).toBe(3);
  });

  test('over a domain', () => {
    const solveIn = (s: string, domain: string) =>
      ce.box(['Solve', ce.parse(s), 'x', domain]).evaluate().json;
    expect(solveIn('x^{2.0} + 3x + 2 = 0', 'RealNumbers')).toEqual([
      'List',
      { num: '-1.0' },
      { num: '-2.0' },
    ]);
    // A polynomial equation with no real root. Before, there was no answer.
    expect(solveIn('x^{2.0} = -4', 'RealNumbers')).toEqual(['List']);
    expect(solveIn('x^{2.0} = 2', 'Integers')).toEqual(['List']);
  });

  test('a real unknown', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    const realRoots = (s: string) =>
      engine
        .parse(s)
        .solve('y')
        ?.map((r) => JSON.stringify(r.json)) ?? null;
    expect(realRoots('y^{2.0} + 3y + 2 = 0')).toEqual([
      '{"num":"-1.0"}',
      '{"num":"-2.0"}',
    ]);
    expect(realRoots('y^{3.0} = -8')).toEqual(['{"num":"-2.0"}']);
    // An even power of a real base is never negative. Before, there was no
    // answer.
    expect(realRoots('(y+1)^{2.0} = -4')).toEqual([]);
    expect(realRoots('y^{4.0} + 1 = 0')).toEqual([]);
  });

  test('a float exponent that is not an integer is not a degree', () => {
    expect(roots('x^{2.5} + 3x + 2 = 0')).toBeNull();
  });

  // `x^{2.5} = 4` has three roots: `4^{0.4}` and `4^{0.4}·e^{±0.8πi}`, where
  // the principal value of `x^{2.5}` is `4·e^{±2πi} = 4`. Before, only the
  // real root was given.
  test('a float exponent that is not an integer gives all the roots', () => {
    const list = roots('x^{2.5} = 4');
    expect(list?.length).toBe(3);
    expect(list?.[0]).toBe('{"num":"1.74110112659224827827"}');
    expect(checkRoots('x^{2.5} = 4')).toBe(3);
  });

  test('the exact exponents are unchanged', () => {
    expect(roots('x^{2} = 4')).toEqual(['2', '-2']);
    expect(
      ce
        .parse('x^{3} = -8')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual(['-2', '1 + sqrt(3)i', '1 - sqrt(3)i']);
    expect(roots('x^{-2} = 4')).toEqual([
      '["Rational",1,2]',
      '["Rational",-1,2]',
    ]);
    expect(roots('(x+1)^{2} = 4')).toEqual(['1', '-3']);
  });
});

// Before, the general power template matched only a positive float exponent
// on the unknown itself: these equations gave no solution.
describe('Solve with a negative float exponent or a compound base', () => {
  test('a negative float exponent', () => {
    expect(roots('x^{-0.5} = 4')).toEqual(['0.0625']);
    expect(roots('x^{-2.0} = 4')).toEqual(['0.5', '-0.5']);
    expect(roots('x^{-1.0} = 4')).toEqual(['0.25']);
    expect(roots('x^{-3.0} = -8')).toEqual([
      '-0.5',
      '["Complex",0.25,{"num":"0.4330127018922193233818616"}]',
      '["Complex",0.25,{"num":"-0.4330127018922193233818616"}]',
    ]);
    // The real root `4^{-0.4}` and the two roots `4^{-0.4}·e^{±0.8πi}`.
    // Before, only the real root was given.
    expect(roots('x^{-2.5} = 4')?.[0]).toBe(
      '{"num":"0.574349177498517503399"}'
    );
    expect(checkRoots('x^{-2.5} = 4')).toBe(3);
    for (const s of [
      'x^{-0.5} = 4',
      'x^{-2.0} = 4',
      'x^{-2.5} = 4',
      'x^{-3.0} = -8',
    ])
      checkRoots(s);
  });

  test('a compound base', () => {
    expect(roots('(x+1)^{2.0} = 4')).toEqual([
      '{"num":"1.0"}',
      '{"num":"-3.0"}',
    ]);
    // `x + 1` is each of the three roots of `u^{2.5} = 4`. Before, only the
    // real root was given.
    expect(roots('(x+1)^{2.5} = 4')?.[0]).toBe(
      '{"num":"0.74110112659224827827"}'
    );
    expect(roots('(2x+1)^{2.0} = 9')).toEqual([
      '{"num":"1.0"}',
      '{"num":"-2.0"}',
    ]);
    expect(checkRoots('(x+1)^{2.0} = 4')).toBe(2);
    expect(checkRoots('(x+1)^{2.5} = 4')).toBe(3);
    expect(checkRoots('(2x+1)^{2.0} = 9')).toBe(2);
    expect(checkRoots('(x-1)^{3.0} = -8')).toBe(3);
  });

  test('a compound base with a negative float exponent', () => {
    expect(checkRoots('(x+1)^{-2.0} = 4')).toBe(2);
    expect(checkRoots('(x+1)^{-0.5} = 2')).toBe(1);
    expect(checkRoots('3(x-2)^{-1.5} + 1 = 7')).toBe(1);
  });

  // The constant is compared with 0 exactly, not within the engine
  // tolerance: before, `10^{-30}` and `1/10^{12}` counted as 0 and the
  // equations were not solved.
  test('a small exact constant is not 0', () => {
    for (const [s, expected, rhs] of [
      ['x^{-0.5} = 10^{-30}', 1e60, 1e-30],
      ['x^{-0.5} = \\frac{1}{10^{12}}', 1e24, 1e-12],
    ] as const) {
      const eq = ce.parse(s);
      const solutions = eq.solve('x') as ReadonlyArray<Expression> | null;
      expect(solutions).not.toBeNull();
      expect(solutions!.length).toBe(1);
      const root = solutions![0].N().re;
      expect(Math.abs(root / expected - 1)).toBeLessThan(1e-12);
      // The root put back in the equation gives the right side.
      const lhs = (eq as Expression & { op1: Expression }).op1;
      const value = lhs.subs({ x: solutions![0] }).N().re;
      expect(Math.abs(value / rhs - 1)).toBeLessThan(1e-12);
    }
  });

  // The principal square root `B^{0.5}` is never a negative real number,
  // also for a complex `B`, and neither is `B^{-0.5} = 1/B^{0.5}`. Before,
  // `x^{-0.5} = -4` had no answer.
  test('a square root equal to a negative number has no root', () => {
    expect(roots('x^{-0.5} = -4')).toEqual([]);
    expect(roots('(x+1)^{-0.5} = -2')).toEqual([]);
    expect(roots('(x+1)^{0.5} = -4')).toEqual([]);
    expect(roots('2x^{0.5} + 8 = 0')).toEqual([]);
    expect(
      ce.box(['Solve', ce.parse('x^{-0.5} = -4'), 'x']).evaluate().json
    ).toEqual(['List']);
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    expect(engine.parse('y^{-0.5} = -4').solve('y')).toEqual([]);
    // A positive right side has a root.
    expect(roots('x^{-0.5} = 4')).toEqual(['0.0625']);
  });

  test('a real unknown keeps only the real roots', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    expect(
      engine
        .parse('(y^2+1)^{2.0} = 4')
        .solve('y')
        ?.map((r) => JSON.stringify(r.json))
    ).toEqual(['{"num":"-1.0"}', '{"num":"1.0"}']);
  });
});

// The arguments in `(-π, π]` of the roots of `w^n = c` for the principal
// value `w^n = |w|^n·e^{i·n·Arg(w)}`, computed without the engine. Such a
// root has the modulus `|c|^{1/n}`, thus the scan of the arguments on that
// circle finds each root: a root is a local minimum of `|e^{i·n·θ} - c/|c||`
// that is near 0.
function principalRootArguments(n: number, c: [number, number]): number[] {
  const steps = 400000;
  const modulus = Math.hypot(c[0], c[1]);
  const [ur, ui] = [c[0] / modulus, c[1] / modulus];
  const distance = (theta: number) =>
    Math.hypot(Math.cos(n * theta) - ur, Math.sin(n * theta) - ui);
  const result: number[] = [];
  for (let k = 0; k < steps; k++) {
    const theta = -Math.PI + (2 * Math.PI * (k + 1)) / steps;
    const h = (2 * Math.PI) / steps;
    const d = distance(theta);
    if (d < 1e-3 && d <= distance(theta - h) && d <= distance(theta + h))
      result.push(theta);
  }
  return result.sort((a, b) => a - b);
}

// The arguments of the roots of `s`, with a check that each root has the
// expected modulus.
function rootArguments(s: string, modulus: number): number[] {
  const list = ce.parse(s).solve('x') as ReadonlyArray<Expression> | null;
  expect(list).not.toBeNull();
  return list!
    .map((root) => {
      const v = root.N();
      expect(Math.abs(Math.hypot(v.re, v.im) / modulus - 1)).toBeLessThan(
        1e-12
      );
      return Math.atan2(v.im, v.re);
    })
    .sort((a, b) => a - b);
}

// The principal value of `x^{p/q}` can be a negative number, also when the
// root template `solve.power` gives a root that is not a root. Before,
// these equations gave an empty list, which states that there is no root.
describe('Solve of a fractional power equal to a negative number', () => {
  test('a float exponent', () => {
    // `4^{0.4}·e^{±0.4πi}`: `2.5·(±0.4π) = ±π`.
    expect(
      ce
        .parse('x^{2.5} = -4')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual([
      '(0.53802983704237140917 + 1.65588557197439081707i)',
      '(0.53802983704237140917 - 1.65588557197439081707i)',
    ]);
    expect(checkRoots('x^{2.5} = -4')).toBe(2);
    expect(checkRoots('3x^{2.5} + 12 = 0')).toBe(2);
  });

  test('an exact exponent', () => {
    expect(
      ce
        .parse('x^{5/2} = -4')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual([
      '(-1/4 + sqrt(5)/4 + sqrt(2)/4i * sqrt(5 + sqrt(5))) * 2^(4/5)',
      '(-1/4 + sqrt(5)/4 - sqrt(2)/4i * sqrt(5 + sqrt(5))) * 2^(4/5)',
    ]);
    expect(checkRoots('x^{5/2} = -4')).toBe(2);
    expect(
      ce
        .parse('x^{3/2} = -8')
        .solve('x')
        ?.map((r) => r.toString())
    ).toEqual(['-2 + 2sqrt(3)i', '-2 - 2sqrt(3)i']);
    expect(checkRoots('x^{3/2} = -8')).toBe(2);
    expect(checkRoots('x^{-5/2} = -4')).toBe(2);
    // The `Solve` operator and the explanation give the same roots.
    expect(
      ce.box(['Solve', ce.parse('x^{5/2} = -4'), 'x']).evaluate().nops
    ).toBe(2);
    expect(
      ce.parse('x^{5/2} = -4').explain('solve', { variable: 'x' }).result.nops
    ).toBe(2);
  });

  test('a compound base', () => {
    expect(checkRoots('(x+1)^{5/2} = -4')).toBe(2);
    expect(checkRoots('(x+1)^{2.5} = -4')).toBe(2);
  });

  test('the real-root rule of the engine for an odd denominator', () => {
    // `(-8)^{5/3}` is `(-2)^5 = -32`: `-8` is a root, with the two roots
    // `8·e^{±3πi/5}` of the principal value.
    expect(ce.parse('(-8)^{5/3}').evaluate().toString()).toBe('-32');
    const list = ce
      .parse('x^{5/3} = -32')
      .solve('x')
      ?.map((r) => r.toString());
    expect(list?.length).toBe(3);
    expect(list?.[0]).toBe('-8');
    expect(checkRoots('x^{5/3} = -32')).toBe(3);
    // `x^{2/3}` is `(∛x)^2`, which is never a negative number.
    expect(roots('x^{2/3} = -4')).toEqual([]);
    // Unchanged: `(-8)^{2/3} = 4`.
    expect(roots('x^{2/3} = 4')).toEqual(['8', '-8']);
    expect(roots('x^{3/2} = 8')).toEqual(['4']);
  });

  test('a complex right side', () => {
    expect(checkRoots('x^{2.5} = 4i')).toBe(3);
    expect(checkRoots('x^{5/2} = 4i')).toBe(3);
  });

  test('a constant right side that is not a number literal', () => {
    // `isFinite` is not known for `-π`, `π − 4` or `√2 − 3`: the numeric
    // value of the right side decides. Before, these equations gave `null`.
    expect(checkRoots('x^{2.5} = -\\pi')).toBe(2);
    expect(checkRoots('x^{3/2} = \\pi - 4')).toBe(2);
    expect(checkRoots('x^{5/2} = \\sqrt{2} - 3')).toBe(2);
  });

  test('the roots do not depend on the angular unit', () => {
    // `Arg` gives an angle in the angular unit of the engine, and `e^{iθ}`
    // reads `θ` in radians. Before, in degrees `x^{3/2} = i` gave no root,
    // because the solver built `e^{60i}` in place of `e^{iπ/3}`.
    const numericRoots = (engine: ComputeEngine, s: string) =>
      (engine.parse(s).solve('x') ?? []).map((r) => {
        const v = (r as Expression).N();
        return [v.re, v.im];
      });
    for (const unit of ['deg', 'grad', 'turn'] as const) {
      const engine = new ComputeEngine();
      engine.angularUnit = unit;
      for (const s of [
        'x^{3/2} = i',
        'x^{5/2} = 4i',
        'x^{2.5} = 4i',
        'x^{2.5} = -4',
      ]) {
        const expected = numericRoots(ce, s);
        const actual = numericRoots(engine, s);
        expect(expected.length).toBeGreaterThan(0);
        expect(actual.length).toBe(expected.length);
        actual.forEach(([re, im], i) => {
          expect(Math.abs(re - expected[i][0])).toBeLessThan(1e-12);
          expect(Math.abs(im - expected[i][1])).toBeLessThan(1e-12);
        });
      }
    }
  });

  test('a square root equal to a negative number has no root', () => {
    expect(roots('x^{-0.5} = -4')).toEqual([]);
    expect(roots('x^{0.5} = -4')).toEqual([]);
  });

  test('no root is missing', () => {
    // The roots that the scan of the principal value finds, and the roots
    // of the solver, have the same arguments.
    for (const [s, n, c] of [
      ['x^{2.5} = -4', 2.5, [-4, 0]],
      ['x^{5/2} = -4', 2.5, [-4, 0]],
      ['x^{2.5} = 4', 2.5, [4, 0]],
      ['x^{3/2} = -8', 1.5, [-8, 0]],
      ['x^{2.5} = 4i', 2.5, [0, 4]],
      ['x^{3.7} = -2', 3.7, [-2, 0]],
      ['x^{2.5} = -\\pi', 2.5, [-Math.PI, 0]],
      ['x^{3/2} = \\pi - 4', 1.5, [Math.PI - 4, 0]],
      ['x^{5/2} = \\sqrt{2} - 3', 2.5, [Math.SQRT2 - 3, 0]],
    ] as const) {
      const modulus = Math.hypot(c[0], c[1]) ** (1 / n);
      const expected = principalRootArguments(n, [c[0], c[1]]);
      const actual = rootArguments(s, modulus);
      expect(actual.length).toBe(expected.length);
      actual.forEach((theta, i) =>
        expect(Math.abs(theta - expected[i])).toBeLessThan(1e-4)
      );
    }
  });

  test('a real unknown has no root', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    const realRoots = (s: string) =>
      engine
        .parse(s)
        .solve('y')
        ?.map((r) => r.toString()) ?? null;
    expect(realRoots('y^{2.5} = -4')).toEqual([]);
    expect(realRoots('y^{5/2} = -4')).toEqual([]);
    expect(realRoots('(y+1)^{5/2} = -4')).toEqual([]);
    // A positive right side has one real root.
    expect(realRoots('y^{5/2} = 4')).toEqual(['2^(4/5)']);
    expect(realRoots('y^{2.5} = 4')).toEqual(['1.74110112659224827827']);
  });

  test('a right side with a parameter is not changed', () => {
    expect(roots('x^{2.5} = a')).toBeNull();
    expect(roots('x^{5/2} = a')).toBeNull();
  });
});
