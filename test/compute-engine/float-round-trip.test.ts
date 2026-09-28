import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// An integer-valued float (an inexact number whose value is an integer) is
// written with a fraction part, so that it is read back as a float (user
// decision of 2026-09-28). The exactness of a number literal follows its
// spelling: a literal with a fraction part (`2.0`, `{num: "2.0"}`) is a
// float, and an integer literal (`2`, `{num: "2"}`, the JSON number `2`) is
// exact. Before this decision a float `2` was written `2` in MathJSON and in
// LaTeX, and was read back as the exact `2`: `Sin(2.0)` numericized under
// `evaluate()`, but its round trip `Sin(2)` stayed symbolic.

function engine(precision: 'auto' | 'machine'): ComputeEngine {
  const ce = new ComputeEngine();
  if (precision === 'machine') ce.precision = 'machine';
  return ce;
}

// The value read back from the MathJSON and from the LaTeX of `x`
function roundTrips(ce: ComputeEngine, x: Expression): Expression[] {
  return [ce.box(x.json), ce.parse(x.latex)];
}

describe.each(['auto', 'machine'] as const)(
  'FLOAT ROUND TRIP at %s precision',
  (precision) => {
    const ce = engine(precision);

    test.each([
      ['2.0', { num: '2.0' }, '2.0'],
      ['-2.0', { num: '-2.0' }, '-2.0'],
      ['0.0', { num: '0.0' }, '0.0'],
      ['1000.0', { num: '1000.0' }, '1\\,000.0'],
      ['\\sqrt{4.0}', { num: '2.0' }, '2.0'],
      ['2.0^2', { num: '4.0' }, '4.0'],
      [
        '2.0+3.0i',
        ['Complex', { num: '2.0' }, { num: '3.0' }],
        '2.0+3.0\\imaginaryI',
      ],
      ['3.0i', ['Complex', { num: '0.0' }, { num: '3.0' }], '3.0\\imaginaryI'],
      // A float `±1.0` imaginary part with no real part keeps its coefficient
      ['1.0i', ['Complex', { num: '0.0' }, { num: '1.0' }], '1.0\\imaginaryI'],
      [
        '-1.0i',
        ['Complex', { num: '0.0' }, { num: '-1.0' }],
        '-1.0\\imaginaryI',
      ],
      [
        '2.0+1.0i',
        ['Complex', { num: '2.0' }, { num: '1.0' }],
        '2.0+\\imaginaryI',
      ],
      // A part that is not an integer makes the value a float: the other
      // part keeps its integer spelling
      ['-1.1i', ['Complex', 0, -1.1], '-1.1\\imaginaryI'],
      ['1.5+2.0i', ['Complex', 1.5, 2], '1.5+2\\imaginaryI'],
    ])('%s', (latex, json, printed) => {
      const x = ce.parse(latex).evaluate();
      expect(x.isExact).toBe(false);
      expect(x.json).toEqual(json);
      expect(x.latex).toBe(printed);
      for (const y of roundTrips(ce, x)) {
        expect(y.isExact).toBe(false);
        expect(y.isSame(x)).toBe(true);
      }
    });

    test('a float past the safe integers', () => {
      // A JSON number past the safe integers is read back as a float, so it
      // stays a JSON number. Its LaTeX has a fraction part.
      const x = ce.box(1e21);
      expect(x.isExact).toBe(false);
      expect(x.json).toBe(1e21);
      expect(x.latex).toBe('1.0\\cdot10^{21}');
      for (const y of roundTrips(ce, x)) {
        expect(y.isExact).toBe(false);
        expect(y.isSame(x)).toBe(true);
      }
    });

    test('an exact integer is written without a fraction part', () => {
      for (const x of [ce.parse('2'), ce.parse('-2'), ce.parse('0')]) {
        expect(x.isExact).toBe(true);
        expect(typeof x.json).toBe('number');
        expect(x.latex).toBe(x.re.toString());
        for (const y of roundTrips(ce, x)) {
          expect(y.isExact).toBe(true);
          expect(y.isSame(x)).toBe(true);
        }
      }
      const i = ce.parse('2+3i');
      expect(i.isExact).toBe(true);
      expect(i.json).toEqual(['Complex', 2, 3]);
      expect(i.latex).toBe('2+3\\imaginaryI');
    });

    test('Sin(2.0) round-trips to an expression that numericizes', () => {
      const x = ce.parse('\\sin(2.0)');
      expect(x.json).toEqual(['Sin', { num: '2.0' }]);
      expect(x.latex).toBe('\\sin(2.0)');
      for (const y of roundTrips(ce, x)) {
        const v = y.evaluate();
        expect(v.isNumberLiteral).toBe(true);
        expect(v.isExact).toBe(false);
        expect(v.re).toBeCloseTo(Math.sin(2), 12);
      }
      // The exact `Sin(2)` stays symbolic
      expect(ce.parse('\\sin(2)').evaluate().operator).toBe('Sin');
    });
  }
);

describe('A MIXED COMPLEX', () => {
  test('["Complex", 0, -1.1] is read back as a float, unchanged', () => {
    const ce = new ComputeEngine();
    const x = ce.box(['Complex', 0, -1.1]);
    expect(x.isExact).toBe(false);
    expect(x.json).toEqual(['Complex', 0, -1.1]);
    for (const y of roundTrips(ce, x)) {
      expect(y.isExact).toBe(false);
      expect(y.isSame(x)).toBe(true);
    }
  });
});

describe('A BIG FLOAT', () => {
  const ce = new ComputeEngine();

  test('1.0e800', () => {
    const x = ce.parse('1.0e800');
    expect(x.isExact).toBe(false);
    expect(x.json).toEqual({ num: '1.0e+800' });
    expect(x.latex).toBe('1.0\\cdot10^{800}');
    for (const y of roundTrips(ce, x)) {
      expect(y.isExact).toBe(false);
      expect(y.isSame(x)).toBe(true);
    }
  });

  test('an exponent literal without a fraction part is exact', () => {
    const x = ce.box({ num: '1e+800' });
    expect(x.isExact).toBe(true);
    expect(x.json).toEqual({ num: '1e+800' });
  });

  test('an integer-valued float with more digits than a double', () => {
    const x = ce.parse('123456789012345678901234.0');
    expect(x.isExact).toBe(false);
    expect(x.json).toEqual({ num: '123456789012345678901234.0' });
    expect(x.latex).toBe(
      '1.234\\,567\\,890\\,123\\,456\\,789\\,012\\,34\\cdot10^{23}'
    );
    for (const y of roundTrips(ce, x)) {
      expect(y.isExact).toBe(false);
      expect(y.isSame(x)).toBe(true);
    }
  });

  test('a float with a negative exponent', () => {
    // `10^{-30}` would be read back as the exact rational `1/10^30`
    const x = ce.box({ num: '1e-30' });
    expect(x.isExact).toBe(false);
    expect(x.latex).toBe('1.0\\cdot10^{-30}');
    expect(ce.parse(x.latex).isExact).toBe(false);
    expect(ce.parse(x.latex).isSame(x)).toBe(true);
  });
});

describe('SERIALIZATION OPTIONS', () => {
  const ce = new ComputeEngine();
  const x = ce.parse('2.0');

  test('MathJSON', () => {
    expect(x.toMathJson()).toEqual({ num: '2.0' });
    expect(x.toMathJson({ shorthands: [] })).toEqual({ num: '2.0' });
    expect(x.toMathJson({ digits: 'auto' })).toEqual({ num: '2.0' });
    expect(x.toMathJson({ digits: { fractional: 2 } })).toEqual('2.00');
    // A request for no fractional digits is honored
    expect(x.toMathJson({ digits: { fractional: 0 } })).toEqual('2');
    // The `latex` metadata is written from the float spelling
    expect(x.toMathJson({ metadata: ['latex'] })).toEqual({
      num: '2.0',
      latex: '2.0',
    });
  });

  test('LaTeX', () => {
    expect(x.toLatex({ fractionalDigits: 2 })).toBe('2.0');
    // A request for no fractional digits is honored, with no truncation
    // marker since only a zero is dropped
    expect(x.toLatex({ fractionalDigits: 0 })).toBe('2');
    expect(x.toLatex({ decimalSeparator: '{,}' })).toBe('2{,}0');
    expect(x.toLatex({ notation: 'scientific' })).toBe('2.0');
    expect(x.toLatex({ notation: 'engineering' })).toBe('2.0');
    const big = ce.parse('1234567.0');
    expect(big.toLatex({ notation: 'scientific' })).toBe(
      '1.234\\,567\\cdot10^{6}'
    );
    // The exact integers of the engineering notation keep their spelling
    expect(ce.parse('42').toLatex({ notation: 'engineering' })).toBe('42');
    expect(ce.parse('1.0e800').toLatex({ notation: 'engineering' })).toBe(
      '100.0\\cdot10^{798}'
    );
  });
});

describe('A FLOAT EXPONENT OR COEFFICIENT', () => {
  // The serializer rewrites `x^2` as `Square`, `x^{-1}` as `1/x` and `-1·x`
  // as a negation. Those rewrites write an exact operand, so they apply only
  // to an exact one: a float operand is written as it is.
  const ce = new ComputeEngine();
  test.each([
    ['x^{2.0}', ['Power', 'x', { num: '2.0' }], 'x^{2.0}'],
    ['x^{-1.0}', ['Power', 'x', { num: '-1.0' }], 'x^{-1.0}'],
    ['x^{0.5}', ['Power', 'x', 0.5], 'x^{0.5}'],
    ['2^{-1.0}', ['Power', 2, { num: '-1.0' }], '2^{-1.0}'],
    ['-1.0x', ['Multiply', { num: '-1.0' }, 'x'], '-1.0x'],
    // A float coefficient of a radical is not folded into an exact radical
    [
      '-1.0\\sqrt{2}',
      ['Multiply', { num: '-1.0' }, ['Sqrt', 2]],
      '-1.0\\sqrt{2}',
    ],
    ['2.0\\sqrt{2}', ['Multiply', { num: '2.0' }, ['Sqrt', 2]], '2.0\\sqrt{2}'],
  ])('%s', (latex, json, printed) => {
    const x = ce.parse(latex);
    expect(x.json).toEqual(json);
    expect(x.toMathJson()).toEqual(json);
    expect(x.latex).toBe(printed);
    for (const y of roundTrips(ce, x)) expect(y.json).toEqual(x.json);
  });

  test('an exact operand is still rewritten', () => {
    expect(ce.parse('x^{2}').latex).toBe('x^2');
    expect(ce.parse('x^{-1}').latex).toBe('\\frac{1}{x}');
    expect(ce.parse('-x').latex).toBe('-x');
    expect(ce.parse('2\\sqrt{2}').isNumberLiteral).toBe(true);
  });
});

describe('A POWER OF TEN', () => {
  // The mantissa `1` is written: `10^{30}` is read back as a power, not as a
  // number literal
  const ce = new ComputeEngine();
  test.each([
    [{ num: '1e+22' }, '1\\cdot10^{22}'],
    [{ num: '1e+30' }, '1\\cdot10^{30}'],
  ])('exact %j', (json, printed) => {
    const x = ce.box(json);
    expect(x.isExact).toBe(true);
    expect(x.latex).toBe(printed);
    const y = ce.parse(x.latex);
    expect(y.isNumberLiteral).toBe(true);
    expect(y.isExact).toBe(true);
    expect(y.isSame(x)).toBe(true);
  });

  test('a float keeps its mantissa', () => {
    expect(ce.box({ num: '1.5e300' }).latex).toBe('1.5\\cdot10^{300}');
    expect(ce.box({ num: '1.25e800' }).latex).toBe('1.25\\cdot10^{800}');
    const x = ce.box({ num: '1.25e800' });
    expect(ce.parse(x.latex).isSame(x)).toBe(true);
    expect(ce.parse(x.latex).isExact).toBe(false);
  });
});

describe('COMPILED MAP ELEMENTS', () => {
  // A lazy `Map` above a hundred elements computes its elements with
  // compiled code. Each element must be the value, and have the exactness,
  // that the interpreter's `N()` gives for that element: `N(x^2)` at `4` is
  // the exact `16`, `N(Sign(x))` the exact `1`, `N(Sec(1e-13·x))` the exact
  // `1` at `0` and the float `1.0` at `1`.
  test.each([
    ['x^2', ['Power', 'x', 2]],
    ['Sqrt(x)', ['Sqrt', 'x']],
    ['Sign(x)', ['Sign', 'x']],
    ['Sec(1e-13 x)', ['Sec', ['Multiply', 1e-13, 'x']]],
  ] as const)('%s over the squares', (_name, body) => {
    const ce = engine('machine');
    const xs = Array.from({ length: 200 }, (_, i) => i * i);
    ce.declare('L', { value: ce.box(['List', ...xs]) });
    const fn = ['Function', body, 'x'] as const;
    const lazy = ce.box(['Map', fn, 'L'] as any).N();
    const actual = [...lazy.each()].slice(0, 6).map((e) => e.json);
    const expected = xs.slice(0, 6).map((x) => ce.box([fn, x] as any).N().json);
    expect(actual).toEqual(expected);
  });

  // A lazy `Map` above a hundred elements computes its elements with
  // compiled code. An element of an `N()` map is a float, as in the
  // interpreter, even when its value is an integer: `sec(1e-13)` is `1.0`.
  test('an integer-valued element is a float', () => {
    const ce = engine('machine');
    const xs = Array.from({ length: 200 }, (_, i) => 0.1 + i * 0.01);
    xs[0] = 1e-13;
    ce.declare('L', { value: ce.box(['List', ...xs]) });
    const first = [...ce.box(['Sec', 'L']).N().each()][0];
    expect(first.isExact).toBe(false);
    expect(first.json).toEqual({ num: '1.0' });
  });
});
