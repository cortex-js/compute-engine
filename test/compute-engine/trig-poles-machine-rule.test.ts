import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import {
  isMachineTrigPole,
  TRIG_POLE_ARGUMENT_CAP,
  TRIG_POLE_EPSILON,
} from '../../src/compute-engine/numerics/numeric';

//
// THE POLE RULE OF `Tan`, `Cot`, `Sec` AND `Csc` AT MACHINE PRECISION
//
// A machine value `y` at the angle `x` is the unsigned pole `~oo` when `y`
// is infinite or `|y|·min(|x|, 2⁴⁰)·100·2⁻⁵³ ≥ 1`: the argument is then
// within 100 ulps (its own rounding error with two decimal digits of guard)
// of a pole. The allowed error is relative to the argument, as the rounding
// error of a double is: the double nearest to `kπ` is a pole of `Cot` for
// every `k`. The cap `2⁴⁰` keeps the allowed error below about `1.2·10⁻²`
// radians, so a huge argument such as `10²²` is not a pole. The big-decimal
// rule uses `min(1, |x|)` instead, because there a large argument can be an
// exact integer that is reduced exactly. The interpreter, the machine-list
// kernels and compiled JavaScript and Python apply the same rule, so that
// every route gives the same value.
//
// Before, the rule was a fixed limit: a value of more than a million in
// magnitude was the pole. `Cot(1e-13)` was `~oo` (the value is `1e13`) and
// `Tan(1.5707954)` was `~oo` (the value is `1078987.38…`).
//
// A later rule used `min(1, |x|)` in place of `min(|x|, 2⁴⁰)`, an absolute
// allowed error for `|x| ≥ 1`. The double nearest to `kπ` for a large `k` was
// then outside it: `Cot(1000π)` was `−3.1·10¹²`, not `~oo`.
//

const HEADS = ['Tan', 'Cot', 'Sec', 'Csc'] as const;

const PRIMITIVES: Record<(typeof HEADS)[number], (x: number) => number> = {
  Tan: Math.tan,
  Cot: (x) => 1 / Math.tan(x),
  Sec: (x) => 1 / Math.cos(x),
  Csc: (x) => 1 / Math.sin(x),
};

function isPole(v: Expression): boolean {
  return (
    v.symbol === 'ComplexInfinity' || (v.re === Infinity && v.im === Infinity)
  );
}

function machineEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  return ce;
}

/** 200 arguments: the special cases, arguments near every pole in
 * `[-2π, 2π]` at several distances, and pseudo-random ones. */
function sweepArguments(): number[] {
  const xs = [
    1e-13,
    -1e-13,
    1e-7,
    -1e-7,
    0,
    1.5707963267948966,
    -1.5707963267948966,
    1.5707954,
    1.5707962,
    Math.PI,
    -Math.PI,
    3.1415926535897936,
    1e10,
    0.5,
    1e18,
    1e22,
    -1e22,
  ];
  for (const k of [10, 100, 1000, 1e4, 1e6, 1e9, -1000])
    xs.push(k * Math.PI, ((2 * k + 1) * Math.PI) / 2);
  for (let k = -4; k <= 4; k++) {
    const p = (k * Math.PI) / 2;
    for (const d of [1e-15, 1e-14, 1e-13, 1e-10, 1e-7, 1e-6])
      xs.push(p + d, p - d);
  }
  let seed = 20260924;
  while (xs.length < 200) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    xs.push((seed / 2147483648 - 0.5) * 20);
  }
  return xs;
}

describe('the rule', () => {
  test('the constants are 100·2⁻⁵³ and 2⁴⁰', () => {
    expect(TRIG_POLE_EPSILON).toBe(50 * Number.EPSILON);
    expect(String(TRIG_POLE_EPSILON)).toBe('1.1102230246251565e-14');
    expect(TRIG_POLE_ARGUMENT_CAP).toBe(1099511627776);
  });

  test('the limit is relative to the argument', () => {
    // The limit is `1/(|x|·TRIG_POLE_EPSILON)`: about `9.0e13` at `|x| = 1`,
    // `4.5e13` at `|x| = 2` and `9.0e10` at `|x| = 1000`.
    expect(isMachineTrigPole(9.1e13, 1)).toBe(true);
    expect(isMachineTrigPole(8.9e13, 1)).toBe(false);
    expect(isMachineTrigPole(4.6e13, 2)).toBe(true);
    expect(isMachineTrigPole(4.4e13, 2)).toBe(false);
    expect(isMachineTrigPole(9.1e10, -1000)).toBe(true);
    expect(isMachineTrigPole(8.9e10, -1000)).toBe(false);
    // Above `2⁴⁰` the limit stays `1/(2⁴⁰·TRIG_POLE_EPSILON)`, about 82.
    expect(isMachineTrigPole(83, 1e22)).toBe(true);
    expect(isMachineTrigPole(81, 1e22)).toBe(false);
    expect(isMachineTrigPole(83, 2 ** 40)).toBe(true);
    expect(isMachineTrigPole(81, 2 ** 40)).toBe(false);
    // At a small argument the limit grows as `1/|x|`.
    expect(isMachineTrigPole(1e13, 1e-13)).toBe(false);
    expect(isMachineTrigPole(1e28, 1e-13)).toBe(true);
    expect(isMachineTrigPole(Infinity, 0)).toBe(true);
    expect(isMachineTrigPole(-Infinity, 1)).toBe(true);
    expect(isMachineTrigPole(NaN, 1)).toBe(false);
  });
});

describe('the interpreter at machine precision', () => {
  const ce = machineEngine();
  const N = (json: any) => ce.box(json).N();

  test('a value far from a pole relative to its argument is the double', () => {
    expect(N(['Cot', 1e-13]).re).toBe(1 / Math.tan(1e-13));
    expect(N(['Cot', 1e-7]).re).toBe(1 / Math.tan(1e-7));
    expect(N(['Tan', 1.5707954]).re).toBe(Math.tan(1.5707954));
    expect(N(['Tan', 1.5707962]).re).toBe(Math.tan(1.5707962));
  });

  test('an argument within its rounding error of a pole is the pole', () => {
    expect(isPole(N(['Tan', 1.5707963267948966]))).toBe(true);
    expect(isPole(N(['Sec', 1.5707963267948966]))).toBe(true);
    expect(isPole(N(['Cot', Math.PI]))).toBe(true);
    expect(isPole(N(['Csc', 0]))).toBe(true);
    expect(isPole(N(['Csc', -Math.PI]))).toBe(true);
  });

  test('the double nearest to kπ is a pole for every k', () => {
    // `k·π` in doubles is within a few ulps of `kπ`, so the value is about
    // `1/(|kπ|·2⁻⁵³)` and `|y|·|x|·100·2⁻⁵³` is between 45 and 1800 for
    // every `k` below. With an absolute allowed error, `Cot(1000π)` was
    // `−3.1·10¹²`.
    for (const k of [1, 10, 100, 1000, 1e4, 1e6, 1e9, -1, -1000]) {
      const x = k * Math.PI;
      expect([k, isPole(N(['Cot', x]))]).toEqual([k, true]);
      expect([k, isPole(N(['Csc', x]))]).toEqual([k, true]);
      const h = ((2 * k + 1) * Math.PI) / 2;
      expect([k, isPole(N(['Tan', h]))]).toEqual([k, true]);
      expect([k, isPole(N(['Sec', h]))]).toEqual([k, true]);
    }
  });

  test('a huge argument is not a pole', () => {
    // `10²²` and `10¹⁸` are exact doubles, and their values are far from a
    // pole: the allowed error is capped at `2⁴⁰·100·2⁻⁵³` radians.
    const c22 = N(['Cot', 1e22]).re;
    expect(c22).toBe(1 / Math.tan(1e22));
    expect(c22).toBeCloseTo(-0.614, 3);
    expect(N(['Cot', 1e18]).re).toBe(1 / Math.tan(1e18));
    expect(N(['Cot', -1e22]).re).toBe(1 / Math.tan(-1e22));
  });

  test('expressions built on the value', () => {
    expect(N(['Divide', 1, ['Tan', 1.5707954]]).re).toBe(
      1 / Math.tan(1.5707954)
    );
    const d = N(['Subtract', ['Tan', 1.5707962], 1e7]).re;
    expect(d).toBe(Math.tan(1.5707962) - 1e7);
    expect(d).toBeLessThan(-2e6);
    // `Sin(x)/Cos(x)` and `Tan(x)` agree near the pole.
    const x = 1.5707954;
    const q = N(['Divide', ['Sin', x], ['Cos', x]]).re;
    const t = N(['Tan', x]).re;
    expect(Math.abs(q - t) / Math.abs(t)).toBeLessThan(1e-15);
  });

  test('every value is the double, except at a pole', () => {
    for (const head of HEADS) {
      for (const x of sweepArguments()) {
        const v = N([head, x]);
        const y = PRIMITIVES[head](x);
        if (isPole(v))
          expect([head, x, isMachineTrigPole(y, x)]).toEqual([head, x, true]);
        else expect([head, x, v.re]).toEqual([head, x, y]);
      }
    }
  });
});

describe('compiled JavaScript agrees with the interpreter', () => {
  const ce = machineEngine();

  test.each(HEADS)('%s on 200 arguments', (head) => {
    const f = compile(ce.box([head, 'x']));
    expect(f.success).toBe(true);
    let poles = 0;
    for (const x of sweepArguments()) {
      const expected = ce.box([head, x]).N();
      const actual = f.run!({ x }) as number;
      if (isPole(expected)) {
        poles += 1;
        expect([head, x, actual]).toEqual([head, x, Infinity]);
      } else expect([head, x, actual]).toEqual([head, x, expected.re]);
    }
    // The sweep reaches the pole branch of the rule.
    expect(poles).toBeGreaterThan(0);
  });

  test('a literal argument folds with the same rule', () => {
    expect(compile(ce.box(['Cot', 1e-13])).code).toBe(
      String(1 / Math.tan(1e-13))
    );
    expect(compile(ce.box(['Tan', 1.5707954])).code).toBe(
      String(Math.tan(1.5707954))
    );
  });
});

describe('the machine-list kernel agrees with the scalar route', () => {
  const ce = machineEngine();
  test.each(HEADS)('%s', (head) => {
    const xs = [1e-13, 1.5707954, 1.5707963267948966, 0.5, Math.PI];
    const list = ce.box([head, ['List', ...xs]]).N();
    const actual = [...list.each()].map((v) => v.json);
    const expected = xs.map((x) => ce.box([head, x]).N().json);
    expect(actual).toEqual(expected);
  });
});

describe('compiled Python has the same rule and constant', () => {
  const py = new PythonTarget();
  const ce = machineEngine();
  test.each(HEADS)('%s', (head) => {
    const code = py.compileLambda(ce.box([head, 'x']), ['x']);
    expect(code).toContain(
      'np.abs(_y) * np.minimum(np.abs(_x), 1099511627776.0) * 1.1102230246251565e-14 >= 1'
    );
    expect(code).toContain('np.isinf(_y)');
    expect(code).not.toContain('1e6');
  });
});

describe('shaders have no pole rule', () => {
  // GLSL and WGSL compute in 32-bit floats. The largest finite value of
  // `tan`, `sec`, `cot` or `csc` there, at the float nearest a pole, is about
  // `2e7` for `|x| ≥ 1`, and `|y·x|` is about 1 near the pole at 0. The
  // machine rule `|y|·min(|x|, 2⁴⁰)·100·2⁻⁵³ ≥ 1` is made for the rounding
  // error of a double, not of a 32-bit float, so the shaders do not apply
  // it, and they have no fixed limit either.
  const ce = new ComputeEngine();
  test.each(['glsl', 'wgsl'] as const)('%s', (to) => {
    for (const head of HEADS) {
      const code = compile(ce.box([head, 'x']), { to }).code;
      expect(code).not.toMatch(/1e6|1000000|1\.0e6/);
    }
  });
});
