import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// Under `.N()`, a lazy `Map` applies its callback to each element AS
// WRITTEN, and evaluates that application under the numeric request:
// `Map(f, [v]).N()` is `[f(v).N()]` for every callback (route parity). The
// element is not evaluated exactly first, which is slow for an element such
// as `H = Sum(1/k, k, 1, 6000)` (an exact rational with thousands of
// digits), and it is not evaluated numerically first, which loses the exact
// structure that a function reads under `.N()`: `Sin(Pi).N()` is `0`,
// `Floor((25! − 1)/24!).N()` is `24`, and `Numerator(v).N()` is the
// numerator of the exact `v` (ROADMAP entry "`Map(Sin, [H]).N()` of a large
// exact rational takes 5.7 seconds").
//
// The element `Spy(1/3)` is a host function that records the request it was
// evaluated with, so each test can see whether the `Map` read the element
// exactly (`evaluate()`) or numerically (`.N()`).
//

const ce = new ComputeEngine();
const requests: boolean[] = [];
ce.declare('Spy', {
  signature: '(number) -> number',
  evaluate: (ops, { numericApproximation }) => {
    requests.push(numericApproximation === true);
    return numericApproximation ? ops[0].N() : ops[0];
  },
});
// A function by name whose body applies no jump function, one that applies
// `Floor`, one that applies `Floor` through another function, and a host
// function whose body cannot be read.
ce.box([
  'Assign',
  'smooth',
  ['Function', ['Add', ['Sin', 'x'], 1], 'x'],
]).evaluate();
ce.box(['Assign', 'jumpy', ['Function', ['Floor', 'x'], 'x']]).evaluate();
ce.box([
  'Assign',
  'viaJumpy',
  ['Function', ['Add', ['jumpy', 'x'], 1], 'x'],
]).evaluate();
ce.declare('hostFn', {
  signature: '(number) -> number',
  evaluate: ([x]) => x,
});

const SPY: MathJsonExpression = ['List', ['Spy', ['Rational', 1, 3]]];

/** The requests the element was read with when `expr` is evaluated with
 * `.N()`, and the value. */
function readsOf(expr: MathJsonExpression): {
  value: string;
  numeric: boolean[];
} {
  requests.length = 0;
  const value = ce.box(expr).N().toString();
  return { value, numeric: [...requests] };
}

describe('LAZY MAP UNDER .N() — NUMERIC READ OF THE ELEMENTS', () => {
  test.each<[string, MathJsonExpression]>([
    ['a bare library function', 'Sin'],
    [
      'a literal with one application (the fused route)',
      ['Function', ['Sin', 'x'], 'x'],
    ],
    [
      'a literal with a larger body',
      ['Function', ['Add', ['Sin', 'x'], 1], 'x'],
    ],
    ['a user function by name', 'smooth'],
  ])('%s reads the element numerically', (_, callback) => {
    const { numeric } = readsOf(['At', ['Map', callback, SPY], 1]);
    expect(numeric.length).toBeGreaterThan(0);
    expect(numeric.every((x) => x)).toBe(true);
  });

  // The callback, and the direct application of the callback to the
  // element (for a function literal, its body with the element in place of
  // the parameter).
  const S: MathJsonExpression = ['Spy', ['Rational', 1, 3]];
  test.each<[string, MathJsonExpression, MathJsonExpression]>([
    ['a bare library function', 'Sin', ['Sin', S]],
    ['a bare jump function', 'Floor', ['Floor', S]],
    [
      'a literal that applies a jump function',
      ['Function', ['Floor', 'x'], 'x'],
      ['Floor', S],
    ],
    [
      'a literal with a comparison',
      ['Function', ['Less', 'x', 1], 'x'],
      ['Less', S, 1],
    ],
    ['a literal with Mod', ['Function', ['Mod', 'x', 1], 'x'], ['Mod', S, 1]],
    [
      'a literal with a larger body',
      ['Function', ['Add', ['Sin', 'x'], 1], 'x'],
      ['Add', ['Sin', S], 1],
    ],
    ['a user function by name', 'smooth', ['smooth', S]],
    ['a user function that applies Floor', 'jumpy', ['jumpy', S]],
    [
      'a user function that applies Floor through another one',
      'viaJumpy',
      ['viaJumpy', S],
    ],
    ['a host function, whose body cannot be read', 'hostFn', ['hostFn', S]],
  ])(
    '%s reads the element as the direct application does',
    (_, callback, direct) => {
      const mapped = readsOf(['At', ['Map', callback, SPY], 1]);
      expect(mapped.numeric.length).toBeGreaterThan(0);
      expect(mapped).toEqual(readsOf(direct));
    }
  );

  test('the parse route reads the element numerically', () => {
    requests.length = 0;
    const value = ce
      .parse(
        '\\operatorname{At}(\\operatorname{Map}(\\sin, [\\operatorname{Spy}(\\frac13)]), 1)'
      )
      .N();
    expect(value.toString()).toBe(
      ce
        .box(['Sin', ['Rational', 1, 3]])
        .N()
        .toString()
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((x) => x)).toBe(true);
  });

  test('a jump callback gives the floor of the exact element', () => {
    const F: MathJsonExpression = [
      'Divide',
      ['Subtract', ['Factorial', 25], 1],
      ['Factorial', 24],
    ];
    expect(
      ce
        .box(['Map', 'Floor', ['List', F]])
        .N()
        .toString()
    ).toBe('[24]');
    expect(
      ce
        .box(['At', ['Map', 'Floor', ['List', F]], 1])
        .N()
        .toString()
    ).toBe('24');
    expect(
      ce
        .box(['At', ['Map', 'jumpy', ['List', F]], 1])
        .N()
        .toString()
    ).toBe('24');
    expect(
      ce
        .box(['At', ['Map', 'viaJumpy', ['List', F]], 1])
        .N()
        .toString()
    ).toBe('25');
  });

  test('a numeric read gives the value of the direct application', () => {
    // A harmonic number: its exact value is a rational with about 260
    // digits, and the direct `Sin([H]).N()` reads it numerically.
    const H: MathJsonExpression = [
      'Sum',
      ['Divide', 1, 'k'],
      ['Tuple', 'k', 1, 600],
    ];
    const direct = ce
      .box(['Sin', ['List', H]])
      .N()
      .toString();
    expect(
      ce
        .box(['List', ['Map', 'Sin', ['List', H]]])
        .N()
        .toString()
    ).toBe(`[${direct}]`);
  });

  test('an exact angle keeps its exact value', () => {
    const P20: MathJsonExpression = ['Multiply', ['Power', 10, 20], 'Pi'];
    const saved = ce.precision;
    try {
      for (const precision of ['machine', 30] as const) {
        ce.precision = precision;
        expect(
          ce
            .box(['Map', 'Sin', ['List', 'Pi']])
            .N()
            .toString()
        ).toBe('[0]');
        expect(
          ce
            .box([
              'Map',
              ['Function', ['Add', ['Sin', 'x'], 1], 'x'],
              ['List', 'Pi'],
            ])
            .N()
            .toString()
        ).toBe('[1]');
        expect(
          ce
            .box(['Map', 'Sin', ['List', P20]])
            .N()
            .toString()
        ).toBe(`[${ce.box(['Sin', P20]).N().toString()}]`);
      }
    } finally {
      ce.precision = saved;
    }
  });

  test('a function that reads the exact structure of the element', () => {
    const F: MathJsonExpression = [
      'Divide',
      ['Subtract', ['Factorial', 25], 1],
      ['Factorial', 24],
    ];
    for (const op of ['Numerator', 'Denominator']) {
      const direct = ce.box([op, F]).N().toString();
      expect(
        ce
          .box(['Map', ['Function', [op, 'x'], 'x'], ['List', F]])
          .N()
          .toString()
      ).toBe(`[${direct}]`);
      expect(
        ce
          .box(['Map', op, ['List', F]])
          .N()
          .toString()
      ).toBe(`[${direct}]`);
    }
    expect(ce.box(['Numerator', F]).N().toString()).toBe(
      '15511210043330985983999999'
    );
  });
});
