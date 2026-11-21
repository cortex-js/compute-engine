import { ComputeEngine } from '../../src/compute-engine';

// CE-1603: the comparison operators and `.isEqual()`, `.isLess()` and the
// other comparison methods have no tolerance. A double is compared as it is,
// a big decimal or an exact number at the working precision. `ce.tolerance`
// is read by `Chop`, `ApproxEqual`, `.is()` and the numeric algorithms.
//
// The expected values are hand calculations: each pair below differs, or is
// equal at 21 digits, as its comment says.

const ce = new ComputeEngine();
const verdict = (json: unknown) =>
  ce.box(json as never).evaluate().json as unknown;

describe('CE-1603: COMPARISONS HAVE NO TOLERANCE', () => {
  test('small numbers are ordered', () => {
    expect(verdict(['Greater', 1e-11, 1e-12])).toBe('True');
    expect(verdict(['Greater', 9.5e-11, 0])).toBe('True');
    expect(verdict(['LessEqual', 9.5e-11, 0])).toBe('False');
    expect(verdict(['Greater', 1e-300, 0])).toBe('True');
    expect(verdict(['Less', -1e-11, 0])).toBe('True');
    expect(verdict(['Equal', 1.6e-19, 6.6e-34])).toBe('False');
    expect(verdict(['NotEqual', 1.6e-19, 0])).toBe('True');
  });

  test('a float beside an exact number is compared at the working precision', () => {
    // 1/10 is 0.1, and π at 21 digits is 3.14159265358979323846.
    expect(verdict(['Equal', ['Rational', 1, 10], 0.1])).toBe('True');
    expect(
      verdict(['Equal', 'Pi', { num: '3.14159265358979323846' }])
    ).toBe('True');
    // The double of π is 3.141592653589793, below π.
    expect(verdict(['Greater', 'Pi', 3.141592653589793])).toBe('True');
    // 3·(1/3.0) is 0.999999999999999999999 at 21 digits.
    expect(
      verdict(['Equal', ['Multiply', ['Divide', 1, { num: '3.0' }], 3], 1])
    ).toBe('False');
    expect(verdict(['Equal', ['Sin', 'Pi'], 0])).toBe('True');
  });

  test('exactly one of <, = and > holds', () => {
    const pairs: [unknown, unknown][] = [
      [1e-12, 0],
      [1, 1 + 1e-11],
      ['Pi', { num: '3.14159265358979323846' }],
      ['Pi', 3.141592653589793],
      [['Rational', 1, 3], { num: '0.333333333333333333333' }],
      [['Subtract', ['Rational', 1, 2], ['Power', 10, -30]], 0.5],
    ];
    for (const [a, b] of pairs) {
      const x = ce.box(a as never);
      const y = ce.box(b as never);
      const answers = [x.isLess(y), x.isEqual(y), x.isGreater(y)];
      expect(answers.filter((v) => v === true).length).toBe(1);
      expect(answers.filter((v) => v === false).length).toBe(2);
    }
  });

  test('an expression with an exact value is ordered', () => {
    const engine = new ComputeEngine();
    engine.assign('x', 2);
    // x + 1 is 3.
    expect(engine.box(['Add', 'x', 1]).isLess(5)).toBe(true);
    expect(engine.box(['Add', 'x', 1]).isGreater(5)).toBe(false);
    // The length of "abc" is 3.
    expect(engine.box(['Length', { str: 'abc' }]).isLess(4)).toBe(true);
    // 3x is 1 with x := 1/3, although 3 · 0.333… is 0.999… at 21 digits.
    engine.assign('y', engine.box(['Rational', 1, 3]));
    expect(engine.box(['Multiply', 3, 'y']).isEqual(1)).toBe(true);
    expect(engine.box(['Multiply', 3, 'y']).isLess(1)).toBe(false);
    expect(
      engine.box(['Multiply', 3, 'y']).isEqual(engine.box({ num: '1.0' }))
    ).toBe(true);
    // sin(1) has no exact real value: sin(x) with x := 1 is a float, below
    // sin(1) + 10^-15.
    engine.assign('z', 1);
    const s = engine.box(['Sin', 'z']);
    const above = engine.box(['Add', ['Sin', 1], ['Power', 10, -15]]);
    expect(s.isLess(above)).toBe(true);
    expect(s.isEqual(above)).toBe(false);
  });

  test('a constant declared with a float is a float', () => {
    const engine = new ComputeEngine();
    engine.declare('g', { type: 'real', isConstant: true, value: 9.81 } as never);
    // 981000000000001/10^14 is 9.81000000000001.
    expect(
      engine
        .symbol('g')
        .isEqual(engine.box(['Rational', 981000000000001, 100000000000000]))
    ).toBe(false);
    expect(engine.symbol('g').isEqual(9.81)).toBe(true);
    // g + 1 is 10.81; 1081000000000001/10^14 is 10.81000000000001.
    expect(
      engine
        .box(['Add', 'g', 1])
        .isEqual(engine.box(['Rational', 1081000000000001, 100000000000000]))
    ).toBe(false);
  });

  test('ce.tolerance applies to Chop, ApproxEqual and .is()', () => {
    expect(verdict(['Chop', 1e-12])).toEqual({ num: '0.0' });
    expect(verdict(['ApproxEqual', 1e-12, 0])).toBe('True');
    expect(ce.box(['Add', 1e-12, ['Sin', 0]]).is(0)).toBe(true);
    expect(ce.number(1e-12).isEqual(0)).toBe(false);
  });
});

describe('CE-1603: MEMBERSHIP AND QUANTITIES', () => {
  test('an endpoint of an Interval is compared as written', () => {
    const twoPi = ['Multiply', 2, 'Pi'];
    // 2π is in [0, 2π]; the double 6.283185307179586 is below 2π.
    expect(verdict(['Element', twoPi, ['Interval', 0, twoPi]])).toBe('True');
    expect(
      verdict(['Element', 6.283185307179586, ['Interval', 0, ['Open', twoPi]]])
    ).toBe('True');
    expect(
      verdict(['Element', ['Multiply', 3, 'Pi'], ['Interval', 0, twoPi]])
    ).toBe('False');
    // An infinity is not a real number.
    expect(
      verdict(['Element', 'PositiveInfinity', ['Interval', 0, 'PositiveInfinity']])
    ).toBe('False');
    expect(verdict(['Element', 'NegativeInfinity', 'RealNumbers'])).toBe(
      'False'
    );
  });

  test('Solve over an interval keeps a root at the end', () => {
    const r = ce
      .box([
        'Solve',
        ['Equal', ['Power', ['Sin', 'x'], 10], 0],
        ['Element', 'x', ['Interval', 0, ['Multiply', 2, 'Pi']]],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 0, 'Pi', ['Multiply', 2, 'Pi']]);
  });

  test('a float magnitude beside an exact one is compared at the working precision', () => {
    const q = (m: unknown) => ['Quantity', m, 'm'];
    // 0.5000000000000000000001 is 0.5 at 21 digits.
    expect(
      verdict([
        'Equal',
        q(['Rational', 1, 2]),
        q({ num: '0.5000000000000000000001' }),
      ])
    ).toBe('True');
    expect(
      verdict(['Equal', ['Rational', 1, 2], { num: '0.5000000000000000000001' }])
    ).toBe('True');
    expect(verdict(['Equal', q(1), q(1.000000000001)])).toBe('False');
  });

  test('a list of exact numbers under N() is compared by its exact cells', () => {
    // The third element of Range(1, 3)/3 is 1.
    expect(
      ce.box(['Less', ['Divide', ['Range', 1, 3], 3], 1]).N().json
    ).toEqual(['List', 'True', 'True', 'False']);
    const thirds = ['Divide', ['Range', 1, 3], 3];
    const exact = ['List', ['Rational', 1, 3], ['Rational', 2, 3], 1];
    expect(ce.box(['Equal', thirds, exact] as never).N().json).toBe('True');
    expect(ce.box(['NotEqual', thirds, exact] as never).N().json).toBe('False');
    expect(ce.box(thirds as never).isEqual(ce.box(exact as never))).toBe(true);
    // A variable that holds an exact list.
    const engine = new ComputeEngine();
    engine.assign('L', engine.box(['List', 1, 2, 3]));
    expect(engine.box(['Less', ['Divide', 'L', 3], 1]).N().json).toEqual([
      'List',
      'True',
      'True',
      'False',
    ]);
  });
});
