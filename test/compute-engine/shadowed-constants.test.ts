import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types.ts';

// A user declaration can give the name of a library constant another value
// (`ce.declare('Pi', { value: 3 })`). The code that recognizes π by its name
// (the special values of the trigonometric functions, the angle of
// `e^{iθ}`) must then read the value of the user binding, as `.N()` does.
// Each case uses its own engine: the declaration stays in the scope.
describe('A USER BINDING OF Pi', () => {
  const cases: [Expression, string][] = [
    [['Sin', 'Pi'], 'sin(3)'],
    [['Cos', 'Pi'], 'cos(3)'],
    [['Sin', ['Divide', 'Pi', 6]], 'sin(1/2)'],
    [['Tan', ['Divide', 'Pi', 4]], 'tan(3/4)'],
    [['Sin', ['Multiply', 2, 'Pi']], 'sin(6)'],
    [['Add', 'Pi', 1], '4'],
  ];
  for (const [input, expected] of cases) {
    test(`evaluate ${JSON.stringify(input)}`, () => {
      const ce = new ComputeEngine();
      ce.declare('Pi', { value: 3 });
      const expr = ce.expr(input);
      expect(expr.evaluate().toString()).toBe(expected);
      expect(expr.evaluate().N().re).toBeCloseTo(expr.N().re, 12);
    });
  }

  test('e^{iπ} is e^{3i}', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    const expr = ce.parse('e^{i\\pi}');
    expect(expr.evaluate().toString()).toBe('i * sin(3) + cos(3)');
    expect(expr.N().re).toBeCloseTo(Math.cos(3), 12);
    expect(expr.N().im).toBeCloseTo(Math.sin(3), 12);
  });

  test('e^{0.5iπ} is not i', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    const value = ce
      .expr(['Power', 'ExponentialE', ['Multiply', 'ImaginaryUnit', 0.5, 'Pi']])
      .evaluate();
    expect(value.re).toBeCloseTo(Math.cos(1.5), 12);
    expect(value.im).toBeCloseTo(Math.sin(1.5), 12);
  });

  test('the parse route reads the user binding', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    expect(ce.parse('\\sin(\\pi)').evaluate().toString()).toBe('sin(3)');
    expect(ce.parse('\\sin(\\pi)').simplify().toString()).toBe('sin(pi)');
  });

  test('without a user binding, π keeps its special values', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sin(\\pi)').evaluate().toString()).toBe('0');
    expect(ce.parse('\\cos(\\pi)').evaluate().toString()).toBe('-1');
    expect(ce.parse('e^{i\\pi}').evaluate().toString()).toBe('-1');
  });

  // An exact special value that holds π (`arcsin(1) = π/2`) was built with
  // the library constant: its `.N()` was 1.5707…, but its MathJSON names
  // `Pi`, and boxed again it read the user value (`.N()` 1.5). With a user
  // value of `Pi`, these calls stay symbolic.
  const inverses: Expression[] = [
    ['Arcsin', 1],
    ['Arccos', 0],
    ['Arctan', 1],
    ['Arccos', ['Rational', 1, 2]],
    ['Arcsec', -1],
    ['Arccot', -1],
    ['Arcosh', 0],
    ['Arcosh', -1],
    ['Arcosh', ['Rational', 1, 2]],
    ['Arcoth', 0],
  ];
  for (const input of inverses) {
    test(`evaluate ${JSON.stringify(input)} holds no π`, () => {
      const ce = new ComputeEngine();
      ce.declare('Pi', { value: 3 });
      const expr = ce.expr(input);
      const value = expr.evaluate();
      expect(value.json).toEqual(expr.json);
      expect(value.has('Pi')).toBe(false);
      // The value boxed again from its MathJSON is the same number
      const reboxed = ce.expr(value.json).N();
      expect(reboxed.re).toBeCloseTo(expr.N().re, 12);
      expect(reboxed.im).toBeCloseTo(expr.N().im, 12);
    });
  }

  test('a special value with no π is kept', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    expect(ce.expr(['Arcsin', 0]).evaluate().json).toBe(0);
    expect(ce.expr(['Arctan', 0]).evaluate().json).toBe(0);
    expect(ce.expr(['Arcosh', 1]).evaluate().json).toBe(0);
    expect(ce.expr(['Arcoth', 1]).evaluate().toString()).toBe('+oo');
  });

  test('without a user binding, the inverse functions keep their special values', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Arcsin', 1]).evaluate().toString()).toBe('1/2 * pi');
    expect(ce.expr(['Arcosh', 0]).evaluate().toString()).toBe('1/2i * pi');
    expect(ce.expr(['Arcoth', 0]).evaluate().toString()).toBe('1/2i * pi');
  });

  // Other exact values built with the library constant (`ce.Pi`): the
  // argument of a negative number, the values at an infinite argument, the
  // conversion of degrees to radians, the exact complex roots. With a user
  // value of `Pi`, the value boxed again from its MathJSON must be the same
  // number, and is the value of the call computed with the library π.
  const pi = Math.PI;
  const builtWithPi: [Expression, re: number, im: number][] = [
    [['Argument', -1], pi, 0],
    [['Arg', -1], pi, 0],
    [['Argument', ['Complex', 0, 1]], pi / 2, 0],
    [['Argument', ['Add', ['Sqrt', 2], -5]], pi, 0],
    [['Degrees', 30], pi / 6, 0],
    [['Degrees', 180], pi, 0],
    [['Degrees', ['Sqrt', 2]], (Math.SQRT2 * pi) / 180, 0],
    [['DMS', 30, 15], (30.25 * pi) / 180, 0],
    [['SinIntegral', 'PositiveInfinity'], pi / 2, 0],
    [['CosIntegral', 'NegativeInfinity'], 0, pi],
    [['Arctan', 'PositiveInfinity'], pi / 2, 0],
    [['Arctan', 'NegativeInfinity'], -pi / 2, 0],
    [['Artanh', 'PositiveInfinity'], 0, -pi / 2],
    [['Arsech', 'PositiveInfinity'], 0, pi / 2],
    [['Arccot', 'NegativeInfinity'], pi, 0],
    [['Arcsec', 'PositiveInfinity'], pi / 2, 0],
    [['Arctan2', 1, 0], pi / 2, 0],
    [['Arctan2', 0, -1], pi, 0],
    [['Arctan2', 1, -1], (3 * pi) / 4, 0],
    [['Arctan2', 'PositiveInfinity', 'PositiveInfinity'], pi / 4, 0],
    [['EllipticK', 0], pi / 2, 0],
    [['EllipticE', 0], pi / 2, 0],
  ];
  for (const [input, re, im] of builtWithPi) {
    test(`evaluate ${JSON.stringify(input)} keeps its value through MathJSON`, () => {
      const ce = new ComputeEngine();
      ce.declare('Pi', { value: 3 });
      const value = ce.expr(input).evaluate();
      expect(value.has('Pi')).toBe(false);
      const reboxed = ce.expr(value.json).N();
      expect(reboxed.re).toBeCloseTo(re, 12);
      expect(reboxed.im).toBeCloseTo(im, 12);
      expect(value.N().re).toBeCloseTo(re, 12);
      expect(value.N().im).toBeCloseTo(im, 12);
    });
  }

  test('the exact complex roots keep their value through MathJSON', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    // The 7th roots of unity are not closed forms: the call stays symbolic
    const roots = ce.expr(['ComplexRoots', 1, 7]).evaluate();
    expect(roots.has('Pi')).toBe(false);
    const reboxed = ce.expr(roots.json).N();
    expect(reboxed.ops![1].re).toBeCloseTo(Math.cos((2 * Math.PI) / 7), 12);
    expect(reboxed.ops![1].im).toBeCloseTo(Math.sin((2 * Math.PI) / 7), 12);
    // Roots with no π are returned
    expect(ce.expr(['ComplexRoots', 1, 4]).evaluate().toString()).toBe(
      '[1,i,-1,-i]'
    );
  });

  // `canEnumerate` must give the same answer as the evaluate handler: a call
  // that stays symbolic is not an enumerable collection.
  test('the exact complex roots that stay symbolic are not enumerable', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    expect(ce.expr(['ComplexRoots', 1, 7]).isEnumerableCollection).toBe(false);
    expect(ce.expr(['ComplexRoots', -1, 7]).isEnumerableCollection).toBe(false);
    expect(
      ce.expr(['At', ['ComplexRoots', 1, 7], 1]).evaluate().toString()
    ).toBe('At(ComplexRoots(1, 7), 1)');
    // Roots with no π: enumerable, and returned
    for (const [z, n] of [
      [-8, 3],
      [1, 4],
      [0, 7],
    ]) {
      const expr = ce.expr(['ComplexRoots', z, n]);
      expect(expr.isEnumerableCollection).toBe(true);
      expect(expr.evaluate().operator).toBe('List');
    }
    // Without a user binding of `Pi`, the 7th roots of unity are enumerable
    expect(
      new ComputeEngine().expr(['ComplexRoots', 1, 7]).isEnumerableCollection
    ).toBe(true);
    // In degrees the angles hold no π (`cos(360/7)`): enumerable
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    deg.declare('Pi', { value: 3 });
    expect(deg.expr(['ComplexRoots', 1, 7]).isEnumerableCollection).toBe(true);
    expect(deg.expr(['ComplexRoots', 1, 7]).evaluate().operator).toBe('List');
  });

  test('e^{iθ} in degrees keeps its value through MathJSON', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('Pi', { value: 3 });
    for (const input of ['e^{i\\pi}', 'e^{2i}']) {
      const expr = ce.parse(input);
      const value = expr.evaluate();
      expect(value.has('Pi')).toBe(false);
      const reboxed = ce.expr(value.json).N();
      expect(reboxed.re).toBeCloseTo(expr.N().re, 12);
      expect(reboxed.im).toBeCloseTo(expr.N().im, 12);
    }
    // `e^{iπ}` is `e^{3i}`: `π` is the user value 3
    expect(ce.parse('e^{i\\pi}').N().re).toBeCloseTo(Math.cos(3), 12);
  });

  test('ce.Pi times an exact 0 is 0', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    expect(ce.Pi.mul(ce.Zero).json).toBe(0);
    expect(ce.Pi.mul(0).json).toBe(0);
    expect(ce.Zero.mul(ce.Pi.div(2)).json).toBe(0);
    // The user variable `Pi` has a value: `0·Pi` is held, as for any
    // variable with a value
    expect(ce.symbol('Pi').mul(0).toString()).toBe('0pi');
  });

  test('without a user binding, the values built with π are unchanged', () => {
    const ce = new ComputeEngine();
    const cases: [Expression, string][] = [
      [['Argument', -1], 'pi'],
      [['Argument', ['Complex', 0, 1]], '1/2 * pi'],
      [['Degrees', 30], '1/6 * pi'],
      [['DMS', 30, 15], '121/720 * pi'],
      [['SinIntegral', 'PositiveInfinity'], '1/2 * pi'],
      [['CosIntegral', 'NegativeInfinity'], 'i * pi'],
      [['Arctan', 'PositiveInfinity'], '1/2 * pi'],
      [['Artanh', 'PositiveInfinity'], '-1/2i * pi'],
      [['Arccot', 'NegativeInfinity'], 'pi'],
      [['Arctan2', 1, -1], '3/4 * pi'],
      [['Arctan2', 'PositiveInfinity', 'PositiveInfinity'], '1/4 * pi'],
    ];
    for (const [input, expected] of cases)
      expect(ce.expr(input).evaluate().toString()).toBe(expected);
    expect(ce.expr(['ComplexRoots', 1, 7]).evaluate().ops![1].toString()).toBe(
      'i * sin(2/7 * pi) + cos(2/7 * pi)'
    );
    expect(ce.Pi.mul(0).json).toBe(0);
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    expect(deg.parse('e^{2i}').evaluate().toString()).toBe(
      'i * sin(360 / pi) + cos(360 / pi)'
    );
  });
});

// The special values of `LogGamma` and `ClausenCl`, and the periodic roots of
// `Solve` over a bounded domain, hold π. With a user value of `Pi`, they
// must not read the name `Pi` as π, and must not return an exact value that
// holds the library π.
describe('A USER BINDING OF Pi IN SPECIAL VALUES AND SOLVE', () => {
  test('LogGamma(1/2) stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    const expr = ce.expr(['LogGamma', ['Rational', 1, 2]]);
    const value = expr.evaluate();
    // It was ln(3)/2: the name `Pi` was boxed and read as the user value
    expect(value.json).toEqual(expr.json);
    expect(value.has('Pi')).toBe(false);
    expect(ce.expr(value.json).N().re).toBeCloseTo(Math.log(Math.PI) / 2, 12);
  });

  test('ClausenCl of the user Pi is not a value at π', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    // Cl₂(3) = Σ sin(3k)/k² ≈ 0.0980262, not Cl₂(π) = 0
    const atPi = ce.expr(['ClausenCl', 2, 'Pi']);
    expect(atPi.evaluate().toString()).toBe('ClausenCl(2, 3)');
    expect(atPi.N().re).toBeCloseTo(0.0980262093913, 10);
    // Cl₂(3/2) ≈ 0.9392186, not Cl₂(π/2) = Catalan's constant
    const atHalfPi = ce.expr([
      'ClausenCl',
      2,
      ['Multiply', ['Rational', 1, 2], 'Pi'],
    ]);
    expect(atHalfPi.evaluate().toString()).toBe('ClausenCl(2, 3/2)');
    expect(atHalfPi.N().re).toBeCloseTo(0.939218592754, 10);
  });

  // The roots of a periodic equation in a bounded interval are its principal
  // roots plus multiples of a period that holds the library π. With a user
  // value of `Pi`, that list was built with a period of 3 (`2·Pi`), so only
  // the principal roots were kept: `sin(x) = 0` in [0, 10] gave `[0]`. The
  // `Solve` now stays unevaluated.
  const periodic: Expression[] = [
    ['Equal', ['Sin', 'x'], 0],
    ['Equal', ['Sin', ['Multiply', 2, 'x']], 1],
    ['Equal', ['Tan', 'x'], 1],
    ['Equal', ['Add', ['Sin', 'x'], ['Cos', 'x']], 0],
  ];
  for (const eq of periodic) {
    test(`Solve ${JSON.stringify(eq)} over an interval stays unevaluated`, () => {
      const ce = new ComputeEngine();
      ce.declare('Pi', { value: 3 });
      const value = ce
        .expr(['Solve', eq, ['Element', 'x', ['Interval', 0, 10]]])
        .evaluate();
      expect(value.operator).toBe('Solve');
    });
  }

  test('Solve over an integer range enumerates the domain', () => {
    const ce = new ComputeEngine();
    ce.declare('Pi', { value: 3 });
    const value = ce
      .expr([
        'Solve',
        ['Equal', ['Sin', 'x'], 0],
        ['Element', 'x', ['Range', 0, 20]],
      ])
      .evaluate();
    expect(value.toString()).toBe('[0]');
  });

  test('without a user binding, the values are unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .expr(['LogGamma', ['Rational', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('1/2 * ln(pi)');
    expect(ce.expr(['ClausenCl', 2, 'Pi']).evaluate().toString()).toBe('0');
    expect(
      ce
        .expr(['ClausenCl', 2, ['Multiply', ['Rational', 1, 2], 'Pi']])
        .evaluate()
        .toString()
    ).toBe('"CatalanConstant"');
    expect(
      ce
        .expr([
          'Solve',
          ['Equal', ['Sin', 'x'], 0],
          ['Element', 'x', ['Interval', 0, 10]],
        ])
        .evaluate()
        .toString()
    ).toBe('[0,pi,2pi,3pi]');
  });
});
