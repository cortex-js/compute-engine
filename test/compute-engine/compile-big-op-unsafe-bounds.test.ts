import { ComputeEngine, compile } from '../../src/compute-engine';

// A `Sum` whose constant bounds are not safe integers (magnitude above
// 2^53 − 1) cannot be enumerated: at 2^53, `k + 1` is `k` again. Each target
// unrolled such a sum with `k++` and never stopped. The interpreter answers
// `out-of-range` for these bounds, and the compile now declines the same way
// (`BaseCompiler.assertSafeBigOpBounds`). A bound known only at run time is
// tested by the loop-entry guard of the JavaScript and interval targets,
// which answer NaN and `entire`.
const ce = new ComputeEngine();
const UNSAFE = '\\sum_{k=9007199254740992}^{9007199254740994} \\sin(x+k)';

const ALL_TARGETS = ['javascript', 'glsl', 'interval-js'] as const;

/** Compile with no fallback. Answer `success`, and the reason and the code
 *  on a decline. */
function tryCompile(
  latex: string,
  to: string
): {
  success: boolean;
  reason: string;
  code?: string;
  run?: (v: object) => unknown;
} {
  try {
    const result = compile(ce.parse(latex), { to, fallback: false } as any);
    return {
      success: result.success,
      reason: (result as any).error ?? '',
      run: (result as any).run,
    };
  } catch (e) {
    return {
      success: false,
      reason: (e as Error).message,
      code: (e as { diagnostic?: { code?: string } }).diagnostic?.code,
    };
  }
}

function expectOutOfRange(latex: string, to: string): void {
  const result = tryCompile(latex, to);
  expect(result.success).toBe(false);
  // The IR pipeline declines such a bound with the generic code of its
  // profile.
  expect(result.code).toBe('outside-profile');
}

describe('A Sum with bounds that are not safe integers', () => {
  test('the interpreter answers out-of-range', () => {
    expect(ce.parse(UNSAFE).evaluate().toString()).toContain('out-of-range');
  });

  test('the interpreter answers out-of-range for a bound expression', () => {
    expect(
      ce.parse('\\sum_{k=2^{53}}^{2^{53}+2} \\sin(x+k)').evaluate().toString()
    ).toContain('out-of-range');
  });

  for (const to of ALL_TARGETS) {
    test(`${to}: the compile declines with out-of-range`, () =>
      expectOutOfRange(UNSAFE, to));

    test(`${to}: a Product declines with out-of-range`, () =>
      expectOutOfRange(
        '\\prod_{k=9007199254740992}^{9007199254740994} \\sin(x+k)',
        to
      ));

    test(`${to}: a nested Sum declines with out-of-range`, () =>
      expectOutOfRange(
        '\\sum_{j=1}^{2}\\sum_{k=9007199254740992}^{9007199254740994} \\sin(x+k+j)',
        to
      ));

    // `bigOpBoundConstant` answers `undefined` for a folded value that is
    // not a safe integer, so these took the loop form, which did not end.
    for (const bounds of [
      ['2^{53}', '2^{53}+2'],
      ['1', '10^{20}'],
      ['e^{40}', 'e^{40}+2'],
    ])
      test(`${to}: a bound expression ${bounds[0]}..${bounds[1]} declines with out-of-range`, () =>
        expectOutOfRange(
          `\\sum_{k=${bounds[0]}}^{${bounds[1]}} \\sin(x+k)`,
          to
        ));

    test(`${to}: a sum with small bounds still compiles`, () => {
      expect(tryCompile('\\sum_{k=1}^{3} \\sin(x+k)', to).success).toBe(true);
    });

    test(`${to}: a non-integer bound still compiles`, () => {
      expect(tryCompile('\\sum_{k=1.5}^{3.7} \\sin(x+k)', to).success).toBe(
        true
      );
    });
  }

  for (const to of ALL_TARGETS) {
    test(`${to}: bounds of magnitude 2^53 − 1 still compile`, () => {
      expect(
        tryCompile(
          '\\sum_{k=9007199254740990}^{9007199254740991} \\sin(x+k)',
          to
        ).success
      ).toBe(true);
      expect(
        tryCompile(
          '\\sum_{k=-9007199254740991}^{-9007199254740990} \\sin(x+k)',
          to
        ).success
      ).toBe(true);
    });
  }

  test('javascript: bounds of magnitude 2^53 − 1 give the interpreter value', () => {
    const result = tryCompile(
      '\\sum_{k=9007199254740990}^{9007199254740991} k',
      'javascript'
    );
    expect(result.run!({})).toBe(2 * 9007199254740990 + 1);
  });

  test('interval-js: a run-time bound of 2^53 returns entire at once', () => {
    const result = tryCompile('\\sum_{k=m}^{m+2} \\sin(x+k)', 'interval-js');
    expect(result.success).toBe(true);
    expect(result.run!({ m: 2 ** 53, x: 1 })).toEqual({ kind: 'entire' });
  });
});
