/**
 * A `Which` on the `interval-js` target evaluates each arm over the part of
 * the interval where the arm can be selected (Tycho ledger row 392, filed
 * 2026-10-18 on CE 0.156.0).
 *
 * `Which(1 ≤ x, 0, True, Arccos(x))` is defined and continuous everywhere,
 * but over [0.99, 1.01] the `Arccos` arm was evaluated over the whole
 * interval, also over (1, 1.01] where its condition is false, and the
 * result was `partial` (domain clipped). Tycho's line sampler read that as a
 * domain boundary and drew false holes on a continuous curve. The arm is now
 * compiled over `x` clamped to the part where it can be selected
 * (`narrowIntervalArm`), which does not change its value there.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('x', 'real');
});

function run(json: unknown, lo: number, hi: number): any {
  const r: any = compile(ce.box(json as any), { to: 'interval-js' });
  expect(r.success).toBe(true);
  return r.run({ x: { lo, hi } });
}

const ARCCOS = ['Which', ['LessEqual', 1, 'x'], 0, 'True', ['Arccos', 'x']];
const SQRT = [
  'Which',
  ['LessEqual', 1, 'x'],
  0,
  'True',
  ['Sqrt', ['Add', ['Negate', 'x'], 1]],
];

describe('an arm undefined only where its condition is false', () => {
  test.each([
    [0.99, 1.01],
    [0.999, 1.5],
    [0, 1.0001],
  ])('over [%d, %d] the result is an interval', (lo, hi) => {
    for (const json of [ARCCOS, SQRT])
      expect(run(json, lo, hi).kind).toBe('interval');
  });

  test('the enclosure is the one of the clamped control', () => {
    const control = run(['Arccos', ['Min', 1, 'x']], 0.99, 1.01);
    expect(run(ARCCOS, 0.99, 1.01)).toEqual(control);
  });

  test('a decided condition gives the same value as before', () => {
    expect(run(ARCCOS, 0.5, 0.9)).toEqual(run(['Arccos', 'x'], 0.5, 0.9));
    expect(run(ARCCOS, 1, 2)).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });

  test('an earlier condition narrows a later arm too', () => {
    // The `Sqrt(x)` arm is reached only where x ≥ 0.
    const json = [
      'Which',
      ['Less', 'x', 0],
      ['Sqrt', ['Negate', 'x']],
      'True',
      ['Sqrt', 'x'],
    ];
    expect(run(json, -0.5, 0.5).kind).toBe('interval');
  });

  test('an arm defined everywhere is compiled as before', () => {
    const r: any = compile(
      ce.box(['Which', ['Less', 'x', 1], ['Multiply', 2, 'x'], 'True', 'x']),
      { to: 'interval-js' }
    );
    expect(r.code).not.toContain('_IA.min');
    expect(r.code).not.toContain('_IA.max');
  });
});

describe('narrowing keeps the meaning of the expression', () => {
  test('If is narrowed as Which is', () => {
    expect(
      run(['If', ['LessEqual', 1, 'x'], 0, ['Arccos', 'x']], 0.99, 1.01).kind
    ).toBe('interval');
  });

  test('a nested Which narrows its own arms', () => {
    const json = [
      'Which',
      ['GreaterEqual', 'x', 2],
      0,
      'True',
      [
        'Which',
        ['LessEqual', 'x', 1],
        ['Sqrt', ['Subtract', 1, 'x']],
        'True',
        ['Arccos', ['Subtract', 'x', 1]],
      ],
    ];
    expect(run(json, 0.9, 1.1).kind).toBe('interval');
  });

  test.each(['e', 'i'])(
    'a bound variable named %s is clamped as its binder resolves it',
    (name) => {
      // Rebuilt from the name, `e` would be Euler's number and `i` the
      // imaginary unit.
      const json = [
        'Sum',
        [
          'Which',
          ['LessEqual', name, 2],
          ['Sqrt', ['Subtract', 2, name]],
          'True',
          0,
        ],
        ['Limits', name, 1, 5],
      ];
      const r = run(json, 0, 0);
      expect(r).toEqual({ kind: 'interval', value: { lo: 1, hi: 1 } });
      expect(ce.box(json as any).N().re).toBe(1);
    }
  );

  test('a block local is not declared by the compilation', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    compile(
      e.box([
        'Block',
        ['Declare', 'u', 'real'],
        ['Assign', 'u', ['Multiply', 2, 'x']],
        ['Which', ['LessEqual', 'u', 1], ['Arccos', 'u'], 'True', 0],
      ] as any),
      { to: 'interval-js', fallback: true }
    );
    expect(e.lookupDefinition('u')).toBe(undefined);
  });

  test('an exact bound that a double does not hold is not used', () => {
    // 1/3 is above its double, so a clamp at the double would lose x = 1/3,
    // where the inner arm is 100.
    const json = [
      'Which',
      ['LessEqual', 'x', ['Rational', 1, 3]],
      ['Which', ['Greater', 'x', 0.3333333333333333], 100, 'True', 0],
      'True',
      0,
    ];
    expect(run(json, 0.3333333333333333, 0.33333333333333337).value.hi).toBe(
      100
    );
  });

  // A decimal bound (`0.5`) is parsed at high precision, but this target
  // compiles it to a point at its double, as it does a machine float, so it
  // narrows too (Tycho ledger row 397). So does an exact bound that a double
  // holds (`1/2`).
  test.each([
    [
      '\\begin{cases}0 & x\\ge0.5\\\\ \\arccos(2x) & \\text{otherwise}\\end{cases}',
    ],
    [
      '\\begin{cases}0 & x\\ge0.5\\\\ \\sqrt{1-2x} & \\text{otherwise}\\end{cases}',
    ],
    [
      '\\begin{cases}0 & x\\ge\\frac12\\\\ \\arccos(2x) & \\text{otherwise}\\end{cases}',
    ],
  ])('a bound that compiles to a point narrows: %s', (latex) => {
    const r: any = compile(ce.parse(latex), { to: 'interval-js' });
    expect(r.success).toBe(true);
    const result = r.run({ x: { lo: 0.49, hi: 0.51 } });
    expect(result.kind).toBe('interval');
    // The hull of the arm at the boundary (0) and at x = 0.49.
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBeGreaterThanOrEqual(
      Math.min(Math.acos(0.98), Math.sqrt(0.02))
    );
  });

  test('a decimal bound that a double rounds narrows at that double', () => {
    // The double of 0.30000000000000000001 is 0.3: the condition and the
    // clamp both use it, so the arm `\sqrt{0.3 - x}` is defined over the
    // clamped part and its value at the boundary is 0.
    const r: any = compile(
      ce.parse(
        '\\begin{cases}0 & x\\ge0.30000000000000000001\\\\ \\sqrt{0.3-x} & \\text{otherwise}\\end{cases}'
      ),
      { to: 'interval-js' }
    );
    const result = r.run({ x: { lo: 0.29, hi: 0.31 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBeGreaterThanOrEqual(Math.sqrt(0.01) - 1e-15);
  });
});
