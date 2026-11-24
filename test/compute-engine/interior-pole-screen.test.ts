import { ComputeEngine } from '../../src/compute-engine';
import {
  interiorPoleScreen,
  interiorPoleVerdict,
} from '../../src/compute-engine/symbolic/interior-pole';

/**
 * `interiorPoleScreen` skips the points of the scan for a moving pole of a
 * multiple integral where no divisor has a zero near the range. It must
 * never skip a point where `interiorPoleVerdict` finds a pole.
 */

const ce = new ComputeEngine();

describe('THE SCREEN AGREES WITH THE VERDICT', () => {
  const integrands: [string, unknown][] = [
    ['(y − x)⁻²', ['Power', ['Subtract', 'y', 'x'], -2]],
    ['1/(y − x)', ['Divide', 1, ['Subtract', 'y', 'x']]],
    ['1/(y² − x)', ['Divide', 1, ['Subtract', ['Power', 'y', 2], 'x']]],
    [
      '1/((y − x)(y + x − 1))',
      [
        'Divide',
        1,
        [
          'Multiply',
          ['Subtract', 'y', 'x'],
          ['Subtract', ['Add', 'y', 'x'], 1],
        ],
      ],
    ],
    [
      '((x − ½)² + (y − ½)²)^(−1/2)',
      [
        'Power',
        [
          'Add',
          ['Power', ['Subtract', 'x', ['Rational', 1, 2]], 2],
          ['Power', ['Subtract', 'y', ['Rational', 1, 2]], 2],
        ],
        ['Rational', -1, 2],
      ],
    ],
    ['1/(y − 2x)²', ['Power', ['Subtract', 'y', ['Multiply', 2, 'x']], -2]],
  ];

  test.each(integrands)('%s', (name, json) => {
    const body = ce.box(json as any);
    const screen = interiorPoleScreen(body, 'y', ce);
    expect(screen).toBeDefined();
    let skipped = 0;
    let proven = 0;
    for (let i = 0; i < 40; i++) {
      const x = -0.5 + (i + 0.37) / 20;
      const verdict = interiorPoleVerdict(
        body.subs({ x: ce.number(x) }),
        'y',
        0,
        1,
        ce
      );
      const maybe = screen!({ x }, 0, 1);
      if (verdict !== undefined) {
        expect(maybe).toBe(true);
        proven += 1;
      }
      if (!maybe) skipped += 1;
    }
    // The screen skips the points with no zero near the range.
    expect(skipped).toBeGreaterThan(0);
    // The singular point of the distance is at no point of the grid.
    if (!name.startsWith('((x')) expect(proven).toBeGreaterThan(0);
  });

  test('a zero of the divisor inside the range', () => {
    const body = ce.box(['Power', ['Subtract', 'y', 'x'], -2]);
    const screen = interiorPoleScreen(body, 'y', ce)!;
    expect(screen({ x: 0.5 }, 0, 1)).toBe(true);
    expect(screen({ x: 3 }, 0, 1)).toBe(false);
    // Near a bound, or at it: the verdict decides.
    expect(screen({ x: 1 + 1e-6 }, 0, 1)).toBe(true);
  });

  test('a leading coefficient that is rounding noise', () => {
    // `3x − 0.3` at `x = 0.1` is about 5.5e-17: the root near
    // `−c₀/c₁ = 0.38` must not be lost to cancellation.
    const body = ce.box([
      'Divide',
      1,
      [
        'Add',
        [
          'Multiply',
          ['Subtract', ['Multiply', 3, 'x'], 0.3],
          ['Power', 'y', 2],
        ],
        ['Multiply', 0.716, 'y'],
        -0.27208,
      ],
    ]);
    const screen = interiorPoleScreen(body, 'y', ce)!;
    expect(
      interiorPoleVerdict(body.subs({ x: ce.number(0.1) }), 'y', 0.2, 0.8, ce)
    ).toBeDefined();
    expect(screen({ x: 0.1 }, 0.2, 0.8)).toBe(true);
  });

  test('two roots of very different sizes', () => {
    // `(y − x)(y − 10²⁰)` at `x = 1.5`: a root at 1.5, inside `[1, 2]`.
    const body = ce.box([
      'Divide',
      1,
      ['Multiply', ['Subtract', 'y', 'x'], ['Subtract', 'y', 1e20]],
    ]);
    expect(interiorPoleScreen(body, 'y', ce)!({ x: 1.5 }, 1, 2)).toBe(true);
  });

  test('a divisor with a very small common factor', () => {
    // `10⁻²⁰⁰·(y² − 3y + 2)`, zero at `y = 1`.
    const body = ce.box([
      'Divide',
      1,
      ['Multiply', 'x', ['Add', ['Power', 'y', 2], ['Multiply', -3, 'y'], 2]],
    ]);
    expect(interiorPoleScreen(body, 'y', ce)!({ x: 1e-200 }, 0.9, 1.1)).toBe(
      true
    );
  });

  test('an exponential with the other variable', () => {
    const body = ce.box([
      'Divide',
      ['Exp', ['Negate', 'x']],
      ['Subtract', 'y', 'x'],
    ]);
    const screen = interiorPoleScreen(body, 'y', ce)!;
    expect(screen).toBeDefined();
    expect(screen({ x: 0.5 }, 0, 1)).toBe(true);
    expect(screen({ x: 3 }, 0, 1)).toBe(false);
  });

  test('a divisor with a symbol that has no value: the verdict decides', () => {
    const body = ce.box(['Power', ['Subtract', 'y', 'a'], -2]);
    expect(interiorPoleScreen(body, 'y', ce)!({ x: 3 }, 0, 1)).toBe(true);
  });
});

describe('THE FORMS THAT THE SCREEN DOES NOT COVER', () => {
  test.each([
    ['a pole lattice', ['Tan', ['Multiply', 'x', 'y']]],
    ['an exponent with a variable', ['Power', ['Subtract', 'y', 'x'], 'x']],
    [
      'a divisor of degree 3',
      ['Divide', 1, ['Subtract', ['Power', 'y', 3], 'x']],
    ],
    ['a logarithmic divisor', ['Divide', 1, ['Ln', ['Multiply', 'x', 'y']]]],
  ])('%s', (_name, json) => {
    expect(interiorPoleScreen(ce.box(json as any), 'y', ce)).toBeUndefined();
  });
});
