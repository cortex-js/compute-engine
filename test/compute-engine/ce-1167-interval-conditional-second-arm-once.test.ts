/**
 * The interval target writes a two-arm conditional as a ternary chain over a
 * tri-state condition. When the second arm is long, the chain writes its text
 * once, through `_IA.elseArm`, instead of once in the `'false'` branch and
 * once more in the hull of the undecided branch. The values are the same in
 * the three cases of the condition, and also when the second arm calls back
 * into the same compiled code (a recursive function), which writes the same
 * condition temporary.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type IntervalRun = (vars: Record<string, { lo: number; hi: number }>) => {
  kind: string;
  value?: { lo: number; hi: number };
};

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('CE-1167: the second arm of an interval conditional is written once', () => {
  test('a long second arm occurs once in the code, and each verdict gives its value', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.parse(
      String.raw`\begin{cases} x^2 & x < 0 \\ \sin(x)\cdot e^{x} + \ln(1+x^2) & \top \end{cases}`
    );
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const code = result.code;
    expect(occurrences(code, '_IA.elseArm(')).toBe(1);
    expect(occurrences(code, '_IA.hull(')).toBe(0);
    expect(occurrences(code, '_IA.sin(')).toBe(1);
    const run = result.run as unknown as IntervalRun;

    // 'true': only the first arm.
    const neg = run({ x: { lo: -2, hi: -1 } });
    expect(neg.kind).toBe('interval');
    expect(neg.value!.lo).toBeCloseTo(1, 12);
    expect(neg.value!.hi).toBeCloseTo(4, 12);

    // 'false': only the second arm, a point at x = 1.
    const one = run({ x: { lo: 1, hi: 1 } });
    const expected = Math.sin(1) * Math.E + Math.log(2);
    expect(one.kind).toBe('interval');
    expect(one.value!.lo).toBeLessThanOrEqual(expected);
    expect(one.value!.hi).toBeGreaterThanOrEqual(expected);
    expect(one.value!.hi - one.value!.lo).toBeLessThan(1e-9);

    // 'maybe': the hull of both arms. Over [-1, 1] the first arm gives
    // [0, 1] and the second contains its value at x = 1.
    const both = run({ x: { lo: -1, hi: 1 } });
    expect(both.value!.lo).toBeLessThanOrEqual(0);
    expect(both.value!.hi).toBeGreaterThanOrEqual(expected);
  });

  test('a recursive call in the second arm does not change the branch taken', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.parse(
      String.raw`f(n) \coloneq \begin{cases} n & n < 1 \\ f(n-1) + \sin(n)^2 + \cos(n)\cdot e^{n} & \top \end{cases}`
    ).evaluate();
    const result = compile(ce.parse('f(x)'), { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(occurrences(result.preamble ?? '', '_IA.elseArm(')).toBe(1);
    const run = result.run as unknown as IntervalRun;

    // At x = 2 the condition is 'false' at the top, 'false' in f(1) and
    // 'true' in f(0): f(2) = sin(1)^2 + cos(1) e + sin(2)^2 + cos(2) e^2.
    const two = run({ x: { lo: 2, hi: 2 } });
    const f2 =
      Math.sin(1) ** 2 +
      Math.cos(1) * Math.E +
      Math.sin(2) ** 2 +
      Math.cos(2) * Math.exp(2);
    expect(two.value!.lo).toBeLessThanOrEqual(f2);
    expect(two.value!.hi).toBeGreaterThanOrEqual(f2);
    expect(two.value!.hi - two.value!.lo).toBeLessThan(1e-9);

    // Over [0.5, 1.5] the top condition is undecided and the recursive call,
    // made from the second arm, decides 'true'. The result is the hull of
    // the first arm [0.5, 1.5] and the second arm over [1, 1.5].
    const straddle = run({ x: { lo: 0.5, hi: 1.5 } });
    expect(straddle.kind).toBe('interval');
    expect(straddle.value!.lo).toBeCloseTo(0.5, 12);
    expect(straddle.value!.hi).toBeGreaterThan(1.5);
  });

  test('a short second arm keeps the spelling with the hull', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const result = compile(
      ce.parse(
        String.raw`\begin{cases} \sin(x) & x < 0 \\ x & \top \end{cases}`
      ),
      { to: 'interval-js' }
    );
    expect(result.success).toBe(true);
    expect(occurrences(result.code, '_IA.hull(')).toBe(1);
    expect(occurrences(result.code, '_IA.elseArm(')).toBe(0);
  });
});
