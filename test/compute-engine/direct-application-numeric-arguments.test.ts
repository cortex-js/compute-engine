import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// Under `.N()`, the direct application of a function literal (`Apply`, a
// call of a user function, an inline `(x ↦ …)(a)`) has the value of its
// body with the arguments AS WRITTEN in place of the parameters, evaluated
// under the numeric request, as a lazy `Map` does for each element
// (`lazy-map-numeric-arguments.test.ts`). Before, the parameter was bound
// to the float of the argument, which loses the exact structure the body
// reads: at machine precision `Apply(x ↦ Sin(x), Pi).N()` was
// `1.2246467991473532e-16` (correct: `0`), and with `v = (25! − 1)/24!`,
// `Apply(x ↦ Numerator(x), v).N()` was `25` (correct: the numerator of the
// exact `v`).
//
// Also: under `.N()`, a broadcast of an operator over a lazy `Map` operand
// reads the operand through its numeric callback, so the elements are not
// computed exactly first (`Sin(Map(Sin, [H])).N()` with
// `H = Sum(1/k, k, 1, 6000)` computed the exact `H`).
//
// `Spy(a)` is a host function that records the request it was evaluated
// with, so a test can count the reads of an argument and see whether each
// one was exact or numeric.
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

const V: MathJsonExpression = [
  'Divide',
  ['Subtract', ['Factorial', 25], 1],
  ['Factorial', 24],
];
const NUMERATOR_V = '15511210043330985983999999';

ce.box(['Assign', 'fSin', ['Function', ['Sin', 'x'], 'x']]).evaluate();
ce.box(['Assign', 'fNum', ['Function', ['Numerator', 'x'], 'x']]).evaluate();
ce.box(['Assign', 'fFloor', ['Function', ['Floor', 'x'], 'x']]).evaluate();
ce.box(['Assign', 'vGlobal', V]).evaluate();
// The operator-definition route: `g(x) := …`.
ce.parse('g(x) := \\sin(x)').evaluate();

function atMachinePrecision<T>(f: () => T): T {
  const saved = ce.precision;
  ce.precision = 'machine';
  try {
    return f();
  } finally {
    ce.precision = saved;
  }
}

describe('DIRECT APPLICATION UNDER .N() — ARGUMENTS AS WRITTEN', () => {
  test.each<[string, () => string]>([
    [
      'Apply, box route',
      () =>
        ce
          .box(['Apply', ['Function', ['Sin', 'x'], 'x'], 'Pi'])
          .N()
          .toString(),
    ],
    [
      'inline application, parse route',
      () => ce.parse('(x\\mapsto \\sin(x))(\\pi)').N().toString(),
    ],
    ['user function, box route', () => ce.box(['fSin', 'Pi']).N().toString()],
    [
      'user function, parse route',
      () => ce.parse('\\operatorname{fSin}(\\pi)').N().toString(),
    ],
    [
      'operator definition, parse route',
      () => ce.parse('g(\\pi)').N().toString(),
    ],
  ])('%s: sin of Pi is 0 at machine precision', (_, run) => {
    expect(atMachinePrecision(run)).toBe('0');
  });

  test('the async route gives the same value', async () => {
    const saved = ce.precision;
    ce.precision = 'machine';
    try {
      const r = await ce
        .box(['fSin', 'Pi'])
        .evaluateAsync({ numericApproximation: true });
      expect(r.toString()).toBe('0');
      const a = await ce
        .box(['Apply', ['Function', ['Sin', 'x'], 'x'], 'Pi'])
        .evaluateAsync({ numericApproximation: true });
      expect(a.toString()).toBe('0');
    } finally {
      ce.precision = saved;
    }
  });

  const NUM: MathJsonExpression = ['Function', ['Numerator', 'x'], 'x'];
  test.each<
    [string, MathJsonExpression, MathJsonExpression, MathJsonExpression]
  >([
    ['Apply of a literal', ['Apply', NUM, V], NUM, V],
    ['a user function', ['fNum', V], 'fNum', V],
    [
      'a user function and a global symbol',
      ['fNum', 'vGlobal'],
      'fNum',
      'vGlobal',
    ],
    ['Apply and a global symbol', ['Apply', NUM, 'vGlobal'], NUM, 'vGlobal'],
  ])('%s: the numerator of the exact argument', (_, expr, fn, arg) => {
    expect(ce.box(expr).N().toString()).toBe(NUMERATOR_V);
    // The same value as the lazy `Map` route.
    expect(
      ce
        .box(['Map', fn, ['List', arg]])
        .N()
        .toString()
    ).toBe(`[${NUMERATOR_V}]`);
  });

  test('the parse route gives the numerator of the exact argument', () => {
    expect(
      ce.parse('\\operatorname{fNum}(\\frac{25!-1}{24!})').N().toString()
    ).toBe(NUMERATOR_V);
  });

  test('a jump in the body reads the exact argument', () => {
    expect(ce.box(['fFloor', V]).N().toString()).toBe('24');
    expect(ce.box(['fFloor', 'vGlobal']).N().toString()).toBe('24');
    expect(
      ce
        .box(['Apply', ['Function', ['Floor', 'x'], 'x'], V])
        .N()
        .toString()
    ).toBe('24');
  });

  test('an exact evaluation is not changed', () => {
    expect(ce.box(['fSin', 'Pi']).evaluate().toString()).toBe('0');
    expect(ce.box(['fNum', V]).evaluate().toString()).toBe(NUMERATOR_V);
    expect(
      ce
        .box(['fSin', ['Rational', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('sin(1/3)');
  });

  test('a big-operator argument is approximated one time only', () => {
    // The caller approximates the argument before the application. A
    // `Sum` is not put in the body, where it would be approximated a second
    // time: `Spy` is read three times (one time per term), not six.
    requests.length = 0;
    const value = ce
      .box(['fSin', ['Sum', ['Spy', 'k'], ['Limits', 'k', 1, 3]]])
      .N()
      .toString();
    expect(value).toBe(ce.box(['Sin', 6]).N().toString());
    expect(requests.length).toBe(3);
  });

  test('a recursive body keeps its ordinary route', () => {
    ce.parse(
      'r(n) := \\operatorname{If}(n < 1, 0, \\sin(n) + r(n - 1))'
    ).evaluate();
    expect(ce.parse('r(\\frac52)').N().toString()).toBe(
      ce.parse('\\sin(\\frac52) + \\sin(\\frac32)').N().toString()
    );
  });

  test('a closure reads the scope where it was made', () => {
    // `cLoc` is a local of the `Block`. The literal reads it after the
    // `Block` returned.
    const fn = ce
      .box([
        'Block',
        ['Assign', 'cLoc', 2],
        ['Function', ['Multiply', 'cLoc', ['Sin', 'x']], 'x'],
      ])
      .evaluate();
    expect(
      ce
        .function('Apply', [fn, ce.box(['Rational', 1, 3])])
        .N()
        .toString()
    ).toBe(
      ce
        .box(['Multiply', 2, ['Sin', ['Rational', 1, 3]]])
        .N()
        .toString()
    );
  });
});

describe('BROADCAST OVER A LAZY MAP OPERAND UNDER .N()', () => {
  const SPY: MathJsonExpression = ['List', ['Spy', ['Rational', 1, 3]]];

  test('the elements are read numerically', () => {
    requests.length = 0;
    const value = ce
      .box(['Sin', ['Map', 'Sin', SPY]])
      .N()
      .toString();
    expect(value).toBe(
      `[${ce
        .box(['Sin', ['Sin', ['Rational', 1, 3]]])
        .N()
        .toString()}]`
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((x) => x)).toBe(true);
  });

  test('the async route reads the elements numerically', async () => {
    requests.length = 0;
    const value = await ce
      .box(['Sin', ['Map', 'Sin', SPY]])
      .evaluateAsync({ numericApproximation: true });
    expect(value.toString()).toBe(
      `[${ce
        .box(['Sin', ['Sin', ['Rational', 1, 3]]])
        .N()
        .toString()}]`
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((x) => x)).toBe(true);
  });

  test('the parse route reads the elements numerically', () => {
    requests.length = 0;
    ce.parse(
      '\\sin(\\operatorname{Map}(\\sin, [\\operatorname{Spy}(\\frac13)]))'
    ).N();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((x) => x)).toBe(true);
  });

  test('an exact angle keeps its exact value', () => {
    expect(
      atMachinePrecision(() =>
        ce
          .box(['Sin', ['Map', 'Sin', ['List', 'Pi']]])
          .N()
          .toString()
      )
    ).toBe('[0]');
  });

  test('a jump operator reads the exact elements', () => {
    expect(
      ce
        .box(['Floor', ['Map', ['Function', 'x', 'x'], ['List', V]]])
        .N()
        .toString()
    ).toBe('[24]');
  });

  test('an exact evaluation is not changed', () => {
    expect(
      ce
        .box(['Sin', ['Map', 'Sin', ['List', ['Rational', 1, 2]]]])
        .evaluate()
        .toString()
    ).toBe('[sin(sin(1/2))]');
  });
});
