import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

export const ce = new ComputeEngine();

describe('TAUTOLOGY a = 1', () => {
  test(`a.value`, () => {
    expect(ce.expr('a').evaluate()).toMatchInlineSnapshot(`"a"`);
  });
});

describe('ReplaceAll', () => {
  test('single symbol rule substitutes and evaluates', () => {
    const r = ce.parse('\\mathrm{ReplaceAll}(x^2+x, x\\to 2)').evaluate();
    expect(r.re).toBe(6);
  });

  test('a Set of rules is applied simultaneously (order-independent)', () => {
    const r = ce.parse('\\mathrm{ReplaceAll}(x+y, \\{x\\to 1, y\\to 2\\})').evaluate();
    expect(r.re).toBe(3);
    const r2 = ce.parse('\\mathrm{ReplaceAll}(x+y, \\{y\\to 2, x\\to 1\\})').evaluate();
    expect(r2.re).toBe(3);
  });

  test('Rule form is accepted', () => {
    const r = ce.box(['ReplaceAll', ['Add', ['Power', 'x', 2], 'x'], ['Rule', 'x', 3]]).evaluate();
    expect(r.re).toBe(12);
  });

  test('with no matching symbol the target is returned evaluated', () => {
    const r = ce.box(['ReplaceAll', ['Add', 'y', 1], ['To', 'x', 2]]).evaluate();
    expect(r.isSame(ce.box(['Add', 'y', 1]))).toBe(true);
  });
});

describe('N / Evaluate nesting collapse', () => {
  // Shape pins use `.json` (no evaluation).

  test('N(Evaluate(x)) keeps the OUTER N (the numericization)', () => {
    expect(ce.box(['N', ['Evaluate', 'Pi']]).json).toEqual(['N', 'Pi']);
    // …and still numericizes: collapsing to `Evaluate(x)` returned exact pi.
    expect(ce.box(['N', ['Evaluate', 'Pi']]).evaluate().isNumberLiteral).toBe(
      true
    );
  });

  test('N(Evaluate(x), p) drops the redundant Evaluate, keeps the precision', () => {
    expect(ce.box(['N', ['Evaluate', 'Pi'], 50]).json).toEqual(['N', 'Pi', 50]);
  });

  test('N(N(x)) collapses; N(N(x), p) does not (different rounding)', () => {
    expect(ce.box(['N', ['N', 'Pi']]).json).toEqual(['N', 'Pi']);
    expect(ce.box(['N', ['N', 'Pi'], 5]).json).toEqual(['N', ['N', 'Pi'], 5]);
  });

  test('Evaluate(Evaluate(x)) and Evaluate(N(x)) keep the INNER node', () => {
    expect(ce.box(['Evaluate', ['Evaluate', 'Pi']]).json).toEqual([
      'Evaluate',
      'Pi',
    ]);
    expect(ce.box(['Evaluate', ['N', 'Pi']]).json).toEqual(['N', 'Pi']);
  });

  test('mixed chains normalize to a single wrapper', () => {
    expect(ce.box(['N', ['Evaluate', ['N', 'Pi']]]).json).toEqual(['N', 'Pi']);
    expect(ce.box(['Evaluate', ['N', ['Evaluate', 'Pi']]]).json).toEqual([
      'N',
      'Pi',
    ]);
  });
});

describe('N gives an inexact result', () => {
  // `N` asks for a numeric approximation, so a number that it returns is a
  // float even when its value is an integer. Later exact arithmetic must not
  // use that value as exact (GitHub issue #409).
  const ce = new ComputeEngine();

  test('N(2) is an inexact 2', () => {
    const r = ce.box(['N', 2]).evaluate();
    expect(r.isNumberLiteral).toBe(true);
    expect(r.isExact).toBe(false);
    expect(r.re).toBe(2);
    expect(r.json).toEqual({ num: '2.0' });
  });

  test('N(2)/3 is a float, not the rational 2/3', () => {
    const r = ce.box(['Divide', ['N', 2], 3]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(2 / 3, 15);
  });

  test('the mean of an N list is the inexact 2.5', () => {
    const r = ce.box(['Mean', ['N', ['List', 1, 2, 3, 4], 30]]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBe(2.5);
  });

  test('the elements of an N list are inexact, also when nested', () => {
    const r = ce.box(['N', ['List', 1, 2, 3, 4], 30]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.map((x) => x.isExact)).toEqual([false, false, false, false]);
    expect(r.ops!.map((x) => x.re)).toEqual([1, 2, 3, 4]);

    const t = ce.box(['N', ['Tuple', 1, ['List', 2, 3]]]).evaluate();
    expect(t.operator).toBe('Tuple');
    expect(t.op1.isExact).toBe(false);
    expect(t.op2.ops!.map((x) => x.isExact)).toEqual([false, false]);
  });

  test('N(1/3) is unchanged', () => {
    const r = ce.box(['N', ['Rational', 1, 3]]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(1 / 3, 15);
  });

  test('N(x + 1) is unchanged: the constants of a symbolic result stay exact', () => {
    const r = ce.box(['N', ['Add', 'x', 1]]).evaluate();
    expect(r.json).toEqual(['Add', 'x', 1]);
  });

  test('N(list, p) rounds each element to p significant digits', () => {
    expect(
      ce.box(['N', ['List', ['Rational', 1, 3], 'Pi'], 4]).evaluate().json
    ).toEqual(['List', 0.3333, 3.142]);
    const t = ce
      .box(['N', ['Tuple', ['Rational', 1, 3], ['List', ['Rational', 2, 3], 7]], 3])
      .evaluate();
    expect(t.json).toEqual(['Tuple', 0.333, ['List', 0.667, { num: '7.0' }]]);
  });

  test('the elements of N of a lazy collection are inexact when they are read', () => {
    // `Range` is lazy: `N` makes each element inexact when it is read, and
    // does not walk the collection (it can be infinite).
    const r = ce.box(['Divide', ['N', ['Range', 1, 4]], 3]).evaluate();
    expect(r.ops!.map((x) => x.isExact)).toEqual([false, false, false, false]);
    expect(r.ops!.map((x) => x.re)).toEqual([1 / 3, 2 / 3, 1, 4 / 3]);

    const mean = ce.box(['Mean', ['N', ['Range', 1, 4]]]).evaluate();
    expect(mean.isExact).toBe(false);
    expect(mean.re).toBe(2.5);

    const third = ce
      .box(['At', ['N', ['Range', 1, 'PositiveInfinity']], 3])
      .evaluate();
    expect(third.isExact).toBe(false);
    expect(third.re).toBe(3);

    const rounded = ce.box(['N', ['Range', 1, 3], 2]).evaluate();
    expect([...rounded.each()].map((x) => x.isExact)).toEqual([
      false,
      false,
      false,
    ]);
  });

  test('N(list, p) rounds the elements of a lazy collection in the list', () => {
    // The digits apply to a lazy collection in a list as they do to a lazy
    // collection alone.
    const alone = ce.box(['N', ['Range', 123, 125], 2]).evaluate();
    expect([...alone.each()].map((x) => x.re)).toEqual([120, 120, 120]);

    const range = ce.box(['N', ['List', ['Range', 123, 125]], 2]).evaluate();
    expect(range.operator).toBe('List');
    expect([...range.op1.each()].map((x) => x.re)).toEqual([120, 120, 120]);
    expect([...range.op1.each()].map((x) => x.isExact)).toEqual([
      false,
      false,
      false,
    ]);

    const map = ce
      .box([
        'N',
        ['List', ['Map', ['Function', ['Divide', 'x', 3], 'x'], ['Range', 1, 3]]],
        2,
      ])
      .evaluate();
    expect([...map.op1.each()].map((x) => x.re)).toEqual([0.33, 0.67, 1]);
    expect([...map.op1.each()].map((x) => x.isExact)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('N(x, p) does not change the precision of the engine', () => {
  // GitHub issue #391. `N(x, p)` with `p` above the precision of the engine
  // computes at `p` digits, then restores the precision of the engine (and
  // of the big decimals). The result is displayed with its `p` digits. The
  // reference digits are from mpmath.
  //
  // A separate engine: the engines of this file have the default precision,
  // and every one of them sets `BigDecimal.precision` when it is
  // constructed.
  const ce = new ComputeEngine();
  const PI_30 = '3.14159265358979323846264338328';

  test('the precision is the same after N(Pi, 30)', () => {
    const precision = ce.precision;
    const bigDecimalPrecision = BigDecimal.precision;
    ce.box(['N', 'Pi', 30]).evaluate();
    expect(ce.precision).toBe(precision);
    expect(BigDecimal.precision).toBe(bigDecimalPrecision);
  });

  test('the precision is the same after an evaluation that throws', () => {
    ce.declare('ThrowsInN', {
      signature: '(number) -> number',
      evaluate: () => {
        throw new Error('evaluation failed');
      },
    });
    const precision = ce.precision;
    const bigDecimalPrecision = BigDecimal.precision;
    expect(() => ce.box(['N', ['ThrowsInN', 1], 30]).evaluate()).toThrow(
      'evaluation failed'
    );
    expect(ce.precision).toBe(precision);
    expect(BigDecimal.precision).toBe(bigDecimalPrecision);
  });

  test('the result shows its 30 digits after the precision is restored', () => {
    const r = ce.box(['N', 'Pi', 30]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.toString()).toBe(PI_30);
    expect(r.json).toEqual({ num: PI_30 });
    expect(r.latex.replace(/\\,/g, '')).toBe(PI_30);
  });

  test('an operation on the result computes at the precision of the engine', () => {
    // `N(Pi, 30) + 1` is computed at 21 digits, as for any other big decimal.
    const r = ce.box(['Add', ['N', 'Pi', 30], 1]).evaluate();
    expect(r.toString()).toBe('4.14159265358979323846');
  });

  test('the elements of a list and the parts of a complex value', () => {
    const list = ce.box(['N', ['List', 'Pi', 'ExponentialE'], 30]).evaluate();
    expect(list.ops!.map((x) => x.toString())).toEqual([
      PI_30,
      '2.71828182845904523536028747135',
    ]);
    // mpmath: 0.540302305868139717400936607443 + 0.841470984807896506652502321630i
    const z = ce.box(['N', ['Exp', 'ImaginaryUnit'], 30]).evaluate();
    expect(z.json).toEqual([
      'Complex',
      { num: '0.540302305868139717400936607443' },
      { num: '0.84147098480789650665250232163' },
    ]);
    expect(z.toString()).toBe(
      '(0.540302305868139717400936607443 + 0.84147098480789650665250232163i)'
    );
  });

  test('a nested N, and an N in a larger expression', () => {
    expect(ce.box(['N', ['N', 'Pi', 40], 30]).evaluate().toString()).toBe(
      PI_30
    );
    const inner = ce.box(['List', ['N', 'Pi', 30], 1]).evaluate();
    expect(inner.op1.toString()).toBe(PI_30);
  });

  test('the elements of a lazy collection are read with 30 digits', () => {
    const r = ce
      .box([
        'N',
        ['Map', ['Function', ['Multiply', 'x', 'Pi'], 'x'], ['Range', 1, 3]],
        30,
      ])
      .evaluate();
    // The elements are read after the precision is restored.
    expect([...r.each()].map((x) => x.toString())).toEqual([
      PI_30,
      '6.28318530717958647692528676656',
      '9.42477796076937971538793014984',
    ]);
    expect(ce.precision).toBe(21);
  });

  test('the last digit is correct: the value is computed with guard digits', () => {
    // The digits are from mpmath. Computed at exactly `p` digits, the real
    // part of `exp(i)` at 30 digits ended with ...444, `Gamma(1/3)` at 30
    // digits with ...098, and `exp(π)` at 60 digits with ...451.
    const cases: [unknown, number, string][] = [
      ['Pi', 60, '3.14159265358979323846264338327950288419716939937510582097494'],
      ['ExponentialE', 30, '2.71828182845904523536028747135'],
      ['ExponentialE', 60, '2.71828182845904523536028747135266249775724709369995957496697'],
      [['Sqrt', 2], 30, '1.41421356237309504880168872421'],
      [['Sqrt', 2], 60, '1.41421356237309504880168872420969807856967187537694807317668'],
      [['Gamma', ['Rational', 1, 3]], 30, '2.67893853470774763365569294097'],
      [['Gamma', ['Rational', 1, 3]], 60, '2.67893853470774763365569294097467764412868937795730110095043'],
      // The last digit of the mpmath value is 0.
      [['Exp', 'Pi'], 60, '23.140692632779269005729086367948547380266106242600211993445'],
    ];
    for (const [x, p, digits] of cases)
      expect(ce.box(['N', x as any, p]).evaluate().json).toEqual({ num: digits });
    expect(ce.box(['N', ['Exp', 'ImaginaryUnit'], 60]).evaluate().json).toEqual([
      'Complex',
      { num: '0.540302305868139717400936607442976603732310420617922227670097' },
      { num: '0.841470984807896506652502321630298999622563060798371065672752' },
    ]);
    // `p` equal to the precision of the engine (21): the value is computed
    // with guard digits too. Without them, the imaginary part ended with
    // ...652.
    expect(ce.box(['N', ['Exp', 'ImaginaryUnit'], 21]).evaluate().json).toEqual([
      'Complex',
      { num: '0.540302305868139717401' },
      { num: '0.841470984807896506653' },
    ]);
  });

  test('a function value computed at one precision is not used at another', () => {
    // The application of a function literal is remembered, and its key has
    // the precision: `f(2)` at 21 digits must not be the value of
    // `N(f(2), 30)`.
    ce.parse('f(x) := x \\pi').evaluate();
    expect(ce.box(['N', ['f', 2]]).evaluate().toString()).toBe(
      '6.28318530717958647693'
    );
    expect(ce.box(['N', ['f', 2], 30]).evaluate().json).toEqual({
      num: '6.28318530717958647692528676656',
    });
    expect(ce.box(['N', ['f', 2]]).evaluate().toString()).toBe(
      '6.28318530717958647693'
    );
  });

  test('at machine precision', () => {
    const saved = BigDecimal.precision;
    try {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const r = machine.box(['N', 'Pi', 30]).evaluate();
      expect(r.toString()).toBe(PI_30);
      expect(machine.precision).toBe(15);
    } finally {
      BigDecimal.precision = saved;
    }
  });
});

describe('N(x, [p, a]): a precision goal and an accuracy goal', () => {
  // GitHub issue #391. `["N", x, ["List", "PositiveInfinity", a]]` gives a
  // value with an absolute error below `10^-a`.
  const ce = new ComputeEngine();

  test('an accuracy goal of 20 digits after the decimal point', () => {
    // 10^10 (e^100 - e^(999999999999/10^10)) is about 2.688e43: the result
    // has 44 + 20 = 64 digits. The reference digits are from mpmath at 400
    // digits.
    const x = [
      'Multiply',
      ['Power', 10, 10],
      [
        'Subtract',
        ['Exp', 100],
        ['Exp', ['Divide', 999999999999, ['Power', 10, 10]]],
      ],
    ];
    const precision = ce.precision;
    const r = ce.box(['N', x, ['List', 'PositiveInfinity', 20]]).evaluate();
    // mpmath: 26881171416817295913262989743956305306485588.08379370953675983977…
    expect(r.json).toEqual({
      num: '2.688117141681729591326298974395630530648558808379370953675983977e+43',
    });
    expect(r.toString()).toBe(
      '2.688117141681729591326298974395630530648558808379370953675983977e+43'
    );
    expect(ce.precision).toBe(precision);
  });

  test('the goal that is met first gives the digits', () => {
    // 1000π = 3141.592653589…: a precision of 10 digits gives 3141.592654, an
    // accuracy of 3 digits gives 3141.593. The result has the fewer digits.
    const x = ['Multiply', 1000, 'Pi'];
    expect(ce.box(['N', x, ['List', 10, 3]]).evaluate().json).toBe(3141.593);
    expect(ce.box(['N', x, ['List', 5, 3]]).evaluate().json).toBe(3141.6);
    expect(ce.box(['N', x, ['List', 10, 'PositiveInfinity']]).evaluate().json).toBe(
      3141.592654
    );
  });

  test('a value below 10^-a is 0', () => {
    const r = ce
      .box(['N', ['Exp', -100], ['List', 'PositiveInfinity', 20]])
      .evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBe(0);
  });

  test('each element of a list has its own digits', () => {
    const r = ce
      .box([
        'N',
        ['List', 'Pi', ['Multiply', 1000, 'Pi']],
        ['List', 'PositiveInfinity', 3],
      ])
      .evaluate();
    expect(r.json).toEqual(['List', 3.142, 3141.593]);
  });

  test('a precision goal for a value that is 0: the call stays unevaluated', () => {
    // A precision goal for a value that is 0, sin²(1) + cos²(1) − 1: its
    // approximations are rounding errors, which do not agree to 30 digits
    // relative to their magnitude at any precision. They are found to be
    // the noise of 0 after three working precisions.
    const zero = [
      'Subtract',
      ['Add', ['Power', ['Sin', 1], 2], ['Power', ['Cos', 1], 2]],
      1,
    ];
    const precision = ce.precision;
    const r = ce.box(['N', zero, ['List', 30, 'PositiveInfinity']]).evaluate();
    expect(r.operator).toBe('N');
    expect(ce.precision).toBe(precision);
    // With an accuracy goal, the value is 0.
    const a = ce
      .box(['N', zero, ['List', 'PositiveInfinity', 30]])
      .evaluate();
    expect(a.isExact).toBe(false);
    expect(a.re).toBe(0);
  });

  test('a goal that is not valid', () => {
    // Three elements, or an element that is not a number: a type error.
    expect(ce.box(['N', 'Pi', ['List', 1, 2, 3]]).isValid).toBe(false);
    expect(ce.box(['N', 'Pi', ['List', "'a'", 2]]).isValid).toBe(false);
    // A precision below 1, or no goal: the call stays unevaluated.
    expect(
      ce.box(['N', 'Pi', ['List', -1, 5]]).evaluate().operator
    ).toBe('N');
    expect(
      ce
        .box(['N', 'Pi', ['List', 'PositiveInfinity', 'PositiveInfinity']])
        .evaluate().operator
    ).toBe('N');
  });
});

describe('N(x, p) and N(x, [p, a]): digits that the value has', () => {
  // GitHub issue #391. The reference digits are from mpmath.
  const ce = new ComputeEngine();
  const digitsOf = (xs: any) => [...xs.each()].map((x: any) => x.toString());

  test('the function of a lazy Map is computed at the precision of N', () => {
    // The elements are computed by the function when they are read. The
    // function is computed by the `N` of each element, at 30 digits, not at
    // the precision of the engine before `N` reads the element.
    const sqrt = [
      'Map',
      ['Function', ['Sqrt', ['Add', 'x', 0.5]], 'x'],
      ['Range', 1, 3],
    ];
    const SQRT = [
      '1.22474487139158904909864203735',
      '1.58113883008418966599944677222',
      '1.87082869338697069279187436616',
    ];
    expect(digitsOf(ce.box(['N', sqrt, 30]).evaluate())).toEqual(SQRT);
    expect(
      digitsOf(
        ce.box(['N', sqrt, ['List', 30, 'PositiveInfinity']]).evaluate()
      )
    ).toEqual(SQRT);
    expect(
      digitsOf(
        ce
          .box([
            'N',
            [
              'Map',
              ['Function', ['Multiply', 'x', ['Sin', 1.5]], 'x'],
              ['Range', 1, 3],
            ],
            30,
          ])
          .evaluate()
      )
    ).toEqual([
      '0.997494986604054430941723371141',
      '1.99498997320810886188344674228',
      '2.99248495981216329282517011342',
    ]);
    // A function with its own `N`, and a Map of a Map.
    expect(
      digitsOf(
        ce
          .box([
            'N',
            [
              'Map',
              ['Function', ['N', ['Multiply', 't', 'Pi']], 't'],
              ['Range', 1, 3],
            ],
            30,
          ])
          .evaluate()
      )
    ).toEqual([
      '3.14159265358979323846264338328',
      '6.28318530717958647692528676656',
      '9.42477796076937971538793014984',
    ]);
    expect(
      digitsOf(
        ce
          .box([
            'N',
            [
              'Map',
              ['Function', ['Sqrt', 'y'], 'y'],
              [
                'Map',
                ['Function', ['Add', 'x', 0.5], 'x'],
                ['Range', 1, 3],
              ],
            ],
            30,
          ])
          .evaluate()
      )
    ).toEqual(SQRT);
    expect(ce.precision).toBe(21);
  });

  test('a function value computed by the exact route is not used at another precision', () => {
    // `g(1)` applies `f(1)` through the exact route, also for `N(g(1))`. The
    // exact route gives the float `N(Pi)`, at 21 digits: it must not be the
    // value of `f(1)` in `N(g(1), 50)`.
    ce.declare('fPi', 'function');
    ce.declare('gPi', 'function');
    ce.assign('fPi', ce.box(['Function', ['N', 'Pi'], 't']));
    ce.assign('gPi', ce.box(['Function', ['fPi', 't'], 't']));
    expect(ce.box(['N', ['gPi', 1]]).evaluate().toString()).toBe(
      '3.14159265358979323846'
    );
    expect(ce.box(['N', ['gPi', 1], 50]).evaluate().toString()).toBe(
      '3.1415926535897932384626433832795028841971693993751'
    );
  });

  test('a float in a symbolic result shows its digits', () => {
    expect(ce.box(['N', ['Add', 'x', 'Pi'], 50]).evaluate().toString()).toBe(
      'x + 3.1415926535897932384626433832795028841971693993751'
    );
    // A float of the operand does not change.
    expect(ce.box(['N', ['Add', 'x', 0.1], 50]).evaluate().toString()).toBe(
      'x + 0.1'
    );
  });

  test('a value that does not change with the precision shows the precision of the engine', () => {
    // `w` is computed at 21 digits. Its big decimal has more digits, but
    // only about 21 of them are correct: 1/7·sin(1) is
    // 0.1202101406868423580929984... (mpmath). `N(w, 40)` shows 21 digits.
    ce.assign(
      'w',
      ce.parse('\\frac17').N().mul(ce.parse('\\sin(1)').N())
    );
    expect(ce.box(['N', 'w', 40]).evaluate().toString()).toBe(
      '0.120210140686842358093'
    );
    expect(ce.box(['N', ['Add', 'y', 'w'], 50]).evaluate().toString()).toBe(
      'y + 0.120210140686842358093'
    );
    // An exact value with a short decimal form has the same value at two
    // precisions too, and it shows all its digits: 2^-80 has 56 digits.
    expect(
      ce.box(['N', ['Power', 2, -80], 60]).evaluate().toString()
    ).toBe('8.2718061255302767487140869206996285356581211090087890625e-25');
  });

  test('a goal is not met by a value that does not change with the precision', () => {
    // The float `w`, a machine-float kernel (the `Zeta` of a complex float,
    // and an infinite sum with no closed form, whose value comes from an
    // extrapolation with machine floats): the value is the same at two
    // precisions, also its digits that are not correct. The call stays
    // unevaluated.
    const goal = ['List', 30, 'PositiveInfinity'];
    expect(ce.box(['N', 'w', ['List', 40, 'PositiveInfinity']]).evaluate().operator).toBe('N');
    // A float with fewer digits than a machine float is exact to its
    // digits: the goal is met.
    expect(ce.box(['N', 0.1, goal]).evaluate().toString()).toBe('0.1');
    expect(
      ce
        .box(['N', ['Zeta', ['Complex', 0.5, 14.134725141734693]], goal])
        .evaluate().operator
    ).toBe('N');
    const sum = ce.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2+1}');
    expect(ce.box(['N', sum.json, goal]).evaluate().operator).toBe('N');
    // `N(x, 30)` shows the digits that the value has: 17, not 30. mpmath:
    // 1.07667404746858117413405079475.
    const r = ce.box(['N', sum.json, 30]).evaluate();
    expect(r.toString().length).toBeLessThanOrEqual(18);
    expect(r.re).toBeCloseTo(1.076674047468581, 13);
    // An exact value: the goal is met.
    expect(
      ce.box(['N', ['Rational', 1, 2], goal]).evaluate().toString()
    ).toBe('0.5');
    expect(
      ce.box(['N', ['Power', 2, -80], ['List', 60, 'PositiveInfinity']]).evaluate().toString()
    ).toBe('8.2718061255302767487140869206996285356581211090087890625e-25');
    expect(ce.box(['N', 'Pi', goal]).evaluate().toString()).toBe(
      '3.14159265358979323846264338328'
    );
  });

  test('an infinite sum with a closed form has the digits of the precision', () => {
    // ζ(2) = π²/6, mpmath: 1.64493406684822643647241516665
    const sum = ce.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2}').json;
    expect(ce.box(['N', sum, 30]).evaluate().toString()).toBe(
      '1.64493406684822643647241516665'
    );
    expect(
      ce.box(['N', sum, ['List', 30, 'PositiveInfinity']]).evaluate().toString()
    ).toBe('1.64493406684822643647241516665');
  });

  test('a precision goal for a value that is 0 stops after three working precisions', () => {
    // Γ(1/3)·Γ(2/3) − 2π/√3 is 0. `CountN` counts the evaluations.
    let count = 0;
    ce.declare('CountN', {
      signature: '(number) -> number',
      evaluate: (ops) => {
        count += 1;
        return ops[0].N();
      },
    });
    const zero = [
      'Subtract',
      [
        'CountN',
        ['Multiply', ['Gamma', ['Rational', 1, 3]], ['Gamma', ['Rational', 2, 3]]],
      ],
      ['Divide', ['Multiply', 2, 'Pi'], ['Sqrt', 3]],
    ];
    const r = ce
      .box(['N', zero, ['List', 30, 'PositiveInfinity']])
      .evaluate();
    expect(r.operator).toBe('N');
    expect(count).toBe(3);
    // With an accuracy goal, the value is 0.
    const a = ce.box(['N', zero, ['List', 'PositiveInfinity', 30]]).evaluate();
    expect(a.isExact).toBe(false);
    expect(a.re).toBe(0);
  });

  test('the display digits are on a new value, not on the operand', () => {
    // A float above the largest machine float, and one below the smallest:
    // their `re` is `Infinity` or `0`. The value of `N` is rounded as a big
    // decimal, and the display of the operand does not change.
    // Rounded to 30 digits, the significand is
    // 1.23456789012345678901234567890: its last digit is 0.
    for (const [digits, rounded] of [
      [
        '1.2345678901234567890123456789012345e+400',
        '1.2345678901234567890123456789e+400',
      ],
      [
        '1.2345678901234567890123456789012345e-400',
        '1.2345678901234567890123456789e-400',
      ],
    ]) {
      const x = ce.number(ce._numericValue(ce.bignum(digits)));
      const display = x.toString();
      const r = ce.function('N', [x, ce.number(30)]).evaluate();
      expect(r.json).toEqual({ num: rounded });
      expect(x.toString()).toBe(display);
      expect(x.json).toEqual({ num: digits });
    }
    // An imaginary part below the smallest machine float is kept.
    const z = ce.number(
      ce._numericValue({ re: ce.bignum(1), im: ce.bignum('1e-400') })
    );
    expect(ce.function('N', [z, ce.number(30)]).evaluate().toString()).toBe(
      '(1 + 1e-400i)'
    );
  });

  test('a machine-precision engine gives machine floats for p at or below its precision', () => {
    const saved = BigDecimal.precision;
    try {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      for (const x of [
        machine.box(['N', ['Divide', 1, 3], 11]).evaluate(),
        machine.box(['N', ['Divide', 1, 3], 10]).evaluate(),
        machine.box(['N', 'Pi', ['List', 5, 'PositiveInfinity']]).evaluate(),
      ]) {
        expect(x.isExact).toBe(false);
        expect(x.bignumRe).toBeUndefined();
      }
      expect(machine.box(['N', ['Divide', 1, 3], 11]).evaluate().re).toBe(
        0.33333333333
      );
      expect(
        machine.box(['N', 'Pi', ['List', 5, 'PositiveInfinity']]).evaluate().re
      ).toBe(3.1416);
    } finally {
      BigDecimal.precision = saved;
    }
  });
});

describe('N(x, p) and N(x, [p, a]): lazy collections, goals and symbolic results', () => {
  // GitHub issue #391. The reference digits are from mpmath.
  const ce = new ComputeEngine();
  const digitsOf = (xs: any) => [...xs.each()].map((x: any) => x.toString());
  const SQRT_HALVES = [
    '0.707106781186547524400844362105',
    '1',
    '1.22474487139158904909864203735',
  ];

  test('the function of a lazy Map keeps the variables of its scope', () => {
    // `c` is a local of the `Block`. The function of the `Map` reads it
    // when an element is read, after the `Block` returned.
    const local = (body: unknown) => [
      'Block',
      ['Declare', 'c', "'integer'"],
      ['Assign', 'c', 2],
      ['Map', ['Function', body, 'x'], ['Range', 1, 300]],
    ];
    const r = ce.box(['N', local(['Divide', 'x', 'c'])]).evaluate();
    expect(ce.function('At', [r, ce.number(2)]).evaluate().toString()).toBe(
      '1'
    );
    expect(digitsOf(r).slice(0, 3)).toEqual(['0.5', '1', '1.5']);
    // A variable `c` of the caller is not read in place of the local `c`.
    ce.assign('c', 5);
    const s = ce.box(['N', local(['Sqrt', ['Divide', 'x', 'c']]), 30]).evaluate();
    expect(digitsOf(s).slice(0, 3)).toEqual(SQRT_HALVES);
    expect(ce.precision).toBe(21);
  });

  test('the elements of another lazy collection are computed at the precision of N', () => {
    // Before, the elements of `Reverse(Map(…))` were computed at the
    // precision of the engine (21 digits), and `N` rounded them.
    const r = ce
      .box([
        'N',
        [
          'Reverse',
          [
            'Map',
            ['Function', ['Sqrt', ['Divide', 'x', 2]], 'x'],
            ['Range', 1, 3],
          ],
        ],
        30,
      ])
      .evaluate();
    expect(digitsOf(r)).toEqual([...SQRT_HALVES].reverse());
    // A Map of a Map whose source is not a range
    const m = ce
      .box([
        'N',
        [
          'Map',
          ['Function', ['Sqrt', 'y'], 'y'],
          [
            'Map',
            ['Function', ['Divide', 'x', 2], 'x'],
            ['Reverse', ['Range', 1, 3]],
          ],
        ],
        30,
      ])
      .evaluate();
    expect(digitsOf(m)).toEqual([...SQRT_HALVES].reverse());
  });

  test('an infinite lazy collection is read by its index', () => {
    const r = ce
      .box([
        'N',
        [
          'Map',
          ['Function', ['Sqrt', ['Add', 'x', 0.5]], 'x'],
          ['Range', 1, 'PositiveInfinity'],
        ],
        30,
      ])
      .evaluate();
    expect(r.count).toBe(Infinity);
    // mpmath: sqrt(1000000.5)
    expect(
      ce.function('At', [r, ce.number(1_000_000)]).evaluate().toString()
    ).toBe('1000.00024999996875000781249756');
  });

  test('an accuracy goal for an exact number with many digits', () => {
    // Before, the parts were computed at the working precision (21 digits),
    // and the last digits of the integer were lost.
    const accuracy = ['List', 'PositiveInfinity', 5];
    const int30 = '123456789012345678901234567890';
    const int60 = int30 + int30;
    expect(ce.box(['N', { num: int30 }, accuracy]).evaluate().toString()).toBe(
      int30
    );
    expect(ce.box(['N', { num: int60 }, accuracy]).evaluate().toString()).toBe(
      int60
    );
    // mpmath: 123456789012345678901234567890123/7 is
    // 17636684144620811271604938270017.5714285714286
    expect(
      ce
        .box([
          'N',
          ['Rational', { num: '123456789012345678901234567890123' }, 7],
          accuracy,
        ])
        .evaluate()
        .toString()
    ).toBe('1.763668414462081127160493827001757143e+31');
  });

  test('a short value that is the same at two precisions meets the goal', () => {
    const goal = ['List', 30, 'PositiveInfinity'];
    // cosh(ln 2) = 5/4
    expect(ce.box(['N', ['Cosh', ['Ln', 2]], goal]).evaluate().toString()).toBe(
      '1.25'
    );
    expect(ce.box(['N', ['Abs', -0.5], goal]).evaluate().toString()).toBe(
      '0.5'
    );
    expect(ce.box(['N', ['Abs', -0.5], 50]).evaluate().toString()).toBe('0.5');
  });

  test('a float in a symbolic result is rounded to p digits', () => {
    expect(ce.box(['N', ['Add', 'x', 'Pi'], 5]).evaluate().toString()).toBe(
      'x + 3.1416'
    );
    expect(
      ce.box(['N', ['List', 'Pi', ['Add', 'x', 'Pi']], 5]).evaluate().toString()
    ).toBe('[3.1416,x + 3.1416]');
    // A `Measurement` (the value of a numeric integral) keeps its
    // uncertainty, and its value is rounded. mpmath: Si(1) is
    // 0.9460830704...
    const integral = ce
      .box([
        'N',
        ['Integrate', ['Divide', ['Sin', 'x'], 'x'], ['Limits', 'x', 0, 1]],
        5,
      ])
      .evaluate();
    expect(integral.operator).toBe('Measurement');
    expect(integral.op1.json).toBe(0.94608);
    expect(integral.op2.re).toBeLessThan(1e-10);
  });

  test('a machine-precision engine gives machine floats in a symbolic result', () => {
    const saved = BigDecimal.precision;
    try {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const floatOf = (e: any) => e.ops.find((op: any) => op.isNumberLiteral);
      for (const goal of [12, ['List', 8, 'PositiveInfinity']]) {
        const r = machine.box(['N', ['Add', 'x', 'Pi'], goal]).evaluate();
        expect(r.operator).toBe('Add');
        expect(floatOf(r).isExact).toBe(false);
        expect(floatOf(r).bignumRe).toBeUndefined();
      }
      expect(
        floatOf(machine.box(['N', ['Add', 'x', 'Pi'], 12]).evaluate()).re
      ).toBe(3.14159265359);
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test('the value at the precision of the engine is computed only when it is needed', () => {
    // `N(Pi, 50)` has 50 digits, and no float that was computed before the
    // evaluation: the operand is evaluated one time, at the working
    // precision.
    const precisions: number[] = [];
    const original = ce._withTransientPrecision.bind(ce);
    (ce as any)._withTransientPrecision = (digits: number, fn: any) => {
      precisions.push(digits);
      return original(digits, fn);
    };
    try {
      expect(ce.box(['N', 'Pi', 50]).evaluate().toString()).toBe(
        '3.1415926535897932384626433832795028841971693993751'
      );
      expect(precisions).toEqual([55]);
    } finally {
      delete (ce as any)._withTransientPrecision;
    }
  });

  test('a set is not a goal', () => {
    const r = ce.parse('N(\\pi, \\lbrace 30, 5\\rbrace)');
    expect(r.isValid).toBe(false);
    expect(ce.box(['N', 'Pi', ['Set', 30, 5]]).isValid).toBe(false);
  });
});

describe('N in the body of a Map, and the `.N()` method of a lazy Map', () => {
  // A user-written `N` in the body of a `Map` gives inexact elements on every
  // route. The `.N()` method of a lazy `Map` puts a different marker,
  // `NumericApproximation`, around the body: its elements are the values of
  // the `.N()` method, where an integer stays exact (GitHub issue #409).
  const inexact = [false, false, false];
  const exactness = (xs: any) => [...xs.each()].map((x: any) => x.isExact);
  const values = (xs: any) => [...xs.each()].map((x: any) => x.re);

  test('box, parse and function routes give inexact elements', () => {
    const ce = new ComputeEngine();
    const fn = ['Function', ['N', ['Power', 'x', 2]], 'x'] as const;
    const routes = [
      ce.box(['Map', fn, ['Range', 1, 3]]),
      ce.parse('\\operatorname{Map}(x \\mapsto N(x^2), [1, 2, 3])'),
      ce.function('Map', [ce.box(fn as any), ce.box(['Range', 1, 3])]),
    ];
    for (const route of routes) {
      const r = route.evaluate();
      expect(values(r)).toEqual([1, 4, 9]);
      expect(exactness(r)).toEqual(inexact);
      // `.N()` of a body that is already in `N` keeps the `N` operator.
      expect(exactness(route.N())).toEqual(inexact);
    }
  });

  test('the compiled route gives inexact elements', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.declare('L', {
      value: ce.box(['List', ...Array.from({ length: 200 }, (_, i) => i + 1)]),
    });
    const hits = ce._mapAutoCompileStats.compiledHits;
    const r = ce
      .box(['Map', ['Function', ['N', ['Power', 'x', 2]], 'x'], 'L'])
      .evaluate();
    const xs = [...r.each()];
    expect(ce._mapAutoCompileStats.compiledHits).toBeGreaterThan(hits);
    expect(xs.slice(0, 3).map((x) => x.json)).toEqual([
      { num: '1.0' },
      { num: '4.0' },
      { num: '9.0' },
    ]);
    expect(xs.every((x) => x.isExact === false)).toBe(true);
  });

  test('the compiled route computes an exact input above the safe integers as the interpreter does', () => {
    // The compiled code converts an exact input to a float before the
    // computation, and the float of 9007199254740993 is 9007199254740992.
    // The interpreter computes such an element with the exact value.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const big = { num: '9007199254740993' };
    ce.declare('L', {
      value: ce.box([
        'List',
        big,
        ...Array.from({ length: 199 }, (_, i) => i + 1),
      ] as any),
    });

    // A user-written `N`: `3x` at the exact `9007199254740993` is
    // `27021597764222979`, and its float is `27021597764222980`.
    const hits = ce._mapAutoCompileStats.compiledHits;
    const user = ce
      .box(['Map', ['Function', ['N', ['Multiply', 3, 'x']], 'x'], 'L'])
      .evaluate();
    const xs = [...user.each()];
    expect(ce._mapAutoCompileStats.compiledHits).toBeGreaterThan(hits);
    const expected = ce.box(['N', ['Multiply', 3, big]]).evaluate();
    expect(expected.isExact).toBe(false);
    expect(xs[0].isExact).toBe(false);
    expect(xs[0].isSame(expected)).toBe(true);
    expect(xs[1].json).toEqual({ num: '3.0' });

    // The `.N()` method: `x/2` at the exact `9007199254740993` is not an
    // integer. The compiled code gives the integer `4503599627370496`.
    const half = ce
      .box(['Map', ['Function', ['Divide', 'x', 2], 'x'], 'L'])
      .evaluate()
      .N();
    const first = [...half.each()][0];
    const reference = ce.box(['Divide', big, 2]).evaluate().N();
    expect(first.isExact).toBe(false);
    expect(first.isSame(reference)).toBe(true);
  });

  test('the `.N()` method of a lazy Map keeps an integer exact', () => {
    const ce = new ComputeEngine();
    const m = ce
      .box(['Map', ['Function', ['Power', 'x', 2], 'x'], ['Range', 1, 3]])
      .N();
    expect(values(m)).toEqual([1, 4, 9]);
    expect(exactness(m)).toEqual([true, true, true]);

    // `Sec(1e-13·x)` is the exact `1` at `0`, and the float `1.0` at `1`.
    const sec = ce
      .box([
        'Map',
        ['Function', ['Sec', ['Multiply', 1e-13, 'x']], 'x'],
        ['List', 0, 1, 2],
      ])
      .N();
    expect(exactness(sec)).toEqual([true, false, false]);
  });

  test('the marker of the `.N()` method survives a MathJSON and a LaTeX round trip', () => {
    const ce = new ComputeEngine();
    const m = ce
      .box(['Map', ['Function', ['Power', 'x', 2], 'x'], ['Range', 1, 3]])
      .N();
    for (const copy of [ce.box(m.json), ce.parse(m.latex)]) {
      const r = copy.evaluate();
      expect(values(r)).toEqual([1, 4, 9]);
      expect(exactness(r)).toEqual([true, true, true]);
    }

    // The marker gives the value of the `.N()` method: the exact 2.
    const two = ce.box(['NumericApproximation', 2]).evaluate();
    expect(two.isExact).toBe(true);
    expect(two.json).toBe(2);
  });
});

describe('N(x, [p, a]): limits of a goal, impure operands, and closures', () => {
  // GitHub issue #391. The reference digits are from mpmath.
  const ce = new ComputeEngine();
  const PI_30 = '3.14159265358979323846264338328';

  test('a goal with more digits than the largest working precision', () => {
    // The exact number would be rounded at a billion digits: the call stays
    // unevaluated.
    const int30 = { num: '123456789012345678901234567890' };
    for (const goal of [
      ['List', 1_000_000_000, 'PositiveInfinity'],
      ['List', 'PositiveInfinity', 1_000_000_000],
    ])
      expect(ce.box(['N', int30, goal]).evaluate().operator).toBe('N');
    expect(
      ce
        .box([
          'N',
          ['Rational', 1, 3],
          ['List', 'PositiveInfinity', 1_000_000_000],
        ])
        .evaluate().operator
    ).toBe('N');
    // A goal below the largest working precision is met.
    expect(
      ce
        .box(['N', int30, ['List', 995, 'PositiveInfinity']])
        .evaluate()
        .toString()
    ).toBe('123456789012345678901234567890');
  });

  test('a float 0 does not meet a precision goal', () => {
    // e^(10^-100) - 1 is 0 at 40 and at 80 digits. mpmath:
    // 1.0000000000000000000000000000e-100 (the next term is 5e-201).
    const r = ce
      .box([
        'N',
        ['Subtract', ['Exp', ['Power', 10, -100]], 1],
        ['List', 30, 'PositiveInfinity'],
      ])
      .evaluate();
    expect(r.isExact).toBe(false);
    expect(r.bignumRe?.eq(ce.bignum('1e-100'))).toBe(true);
    // A float 0 whose exact value is 0 meets the goal.
    const zero = ce
      .box(['N', { num: '0.0' }, ['List', 30, 'PositiveInfinity']])
      .evaluate();
    expect(zero.operator).not.toBe('N');
    expect(zero.re).toBe(0);
  });

  test('the floats in the body of a Sum are not rounded', () => {
    // `Sum` binds its index: its body is computed when the sum is
    // computed.
    for (const p of [3, 30]) {
      const r = ce
        .box([
          'N',
          ['Sum', ['Add', ['Sin', 'k'], 0.123456], ['Limits', 'k', 1, 'm']],
          p,
        ])
        .evaluate();
      expect(r.json).toEqual([
        'Sum',
        ['Add', ['Sin', 'k'], 0.123456],
        ['Limits', 'k', 1, 'm'],
      ]);
    }
  });

  test('a Measurement keeps its uncertainty', () => {
    expect(
      ce.box(['N', ['Measurement', 'Pi', 0.01], 30]).evaluate().json
    ).toEqual(['Measurement', { num: PI_30 }, 0.01]);
    expect(
      ce.box(['N', ['Measurement', 1.23456, 0.01], 3]).evaluate().json
    ).toEqual(['Measurement', 1.23, 0.01]);
    expect(
      ce.box(['N', ['Measurement', 1.23456, 0.01], 30]).evaluate().json
    ).toEqual(['Measurement', 1.23456, 0.01]);
  });

  test('a float of the operand meets a goal that keeps no more than its digits', () => {
    // mpmath: 2·3.141592653589793 is 6.283185307179586232...
    ce.assign('yFloat', ce.number(Math.PI));
    const twoY = ['Multiply', 2, 'yFloat'];
    expect(
      ce.box(['N', twoY, ['List', 'PositiveInfinity', 5]]).evaluate().json
    ).toBe(6.28319);
    expect(
      ce.box(['N', twoY, ['List', 16, 'PositiveInfinity']]).evaluate().re
    ).toBe(6.283185307179586);
    // The float has 16 digits: a goal of 17 digits is not met.
    expect(
      ce.box(['N', twoY, ['List', 17, 'PositiveInfinity']]).evaluate().operator
    ).toBe('N');
    expect(
      ce
        .box(['N', 0.12345678901234567, ['List', 'PositiveInfinity', 3]])
        .evaluate().json
    ).toBe(0.123);
  });

  test('an impure operand is evaluated one time', () => {
    let draws = 0;
    ce.declare('CountedDraw', {
      signature: '() -> real',
      pure: false,
      evaluate: () => {
        draws += 1;
        return ce.number(0.123456789012345);
      },
    });
    const r = ce
      .box(['N', ['CountedDraw'], ['List', 10, 10]])
      .evaluate();
    expect(draws).toBe(1);
    expect(r.json).toBe(0.123456789);
    expect(
      ce.box(['N', ['Random'], ['List', 10, 10]]).evaluate().operator
    ).not.toBe('N');
  });

  test('a goal at the largest working precision compares two values', () => {
    expect(
      ce
        .box(['N', 0.5, ['List', 'PositiveInfinity', 995]])
        .evaluate()
        .toString()
    ).toBe('0.5');
    // The value at 500 digits does not agree with the value at 1000 digits
    // to 995 digits: the goal cannot be checked.
    expect(
      ce.box(['N', 'Pi', ['List', 995, 'PositiveInfinity']]).evaluate().operator
    ).toBe('N');
  });

  test('a machine-precision engine keeps a value outside the range of a machine float', () => {
    // mpmath: e^1000 is 1.9700711140170469938...e+434, e^-1000 is
    // 5.0759588975494567652...e-435.
    const saved = BigDecimal.precision;
    try {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const goal = ['List', 5, 'PositiveInfinity'];
      expect(
        machine.box(['N', ['Exp', 1000], goal]).evaluate().toString()
      ).toBe('1.9701e+434');
      expect(
        machine.box(['N', ['Exp', -1000], goal]).evaluate().toString()
      ).toBe('5.076e-435');
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test('a lazy collection of two elements is a goal', () => {
    expect(
      ce.box(['N', 'Pi', ['Range', 4, 5]]).evaluate().json
    ).toBe(3.142);
    expect(
      ce.box(['N', 'Pi', ['Range', 4, 6]]).evaluate().operator
    ).toBe('N');
  });

  test('the `.N()` method of a lazy Map keeps the variables of the scope of its function', () => {
    // `c` is a local of the `Block`. The function of the `Map` reads it
    // when an element is read, after the `Block` returned.
    const local = (name: string, body: unknown) => [
      'Block',
      ['Assign', name, 5],
      ['Map', ['Function', body, 'x'], ['Range', 1, 300]],
    ];
    const m = ce.box(local('cLocal1', ['Divide', 'x', 'cLocal1'])).evaluate();
    expect(
      [...m.N().each()].slice(0, 3).map((x) => x.re)
    ).toEqual([0.2, 0.4, 0.6]);
    // The `.N()` method of the result does not wrap it again.
    expect(m.N().N().json).toEqual(m.N().json);
    // The source has halves: the parameter type that inference wrote
    // (`rational`) does not reject the float that the marker gives.
    const halves = ce
      .box([
        'Block',
        ['Assign', 'cLocal3', 5],
        [
          'Map',
          ['Function', ['Multiply', 'x', 'cLocal3'], 'x'],
          ['Map', ['Function', ['Divide', 'y', 2], 'y'], ['Range', 1, 300]],
        ],
      ])
      .evaluate();
    expect(
      [...halves.N().each()].slice(0, 3).map((x) => x.re)
    ).toEqual([2.5, 5, 7.5]);
    // mpmath: sqrt(2/5) is 0.63245553203367586640, sqrt(60) is
    // 7.74596669241483377035853079956
    const sqrt = local('cLocal2', ['Sqrt', ['Divide', 'x', 'cLocal2']]);
    const reverse = ce.box(['Reverse', sqrt]).evaluate().N();
    expect(reverse.at(299)!.re).toBeCloseTo(0.6324555320336759, 15);
    const r = ce.box(['N', ['Reverse', sqrt], 30]).evaluate();
    expect(r.at(1)!.toString()).toBe('7.74596669241483377035853079956');
  });

  test('the `.N()` method of a lazy Map keeps a function that is local to a Block', () => {
    // `hLocal` is a local of the `Block`, and its value is a function. The
    // call `hLocal(x)` has no operator definition: before, the function of
    // the `Map` was made again in the outer scope, where `hLocal` is not
    // defined, and the elements were `0.333…·hLocal(1)`.
    const m = ce
      .box([
        'Block',
        ['Assign', 'hLocal', ['Function', ['Multiply', 'z', 2], 'z']],
        [
          'Map',
          ['Function', ['Divide', ['hLocal', 'x'], 3], 'x'],
          ['Range', 1, 1000000],
        ],
      ])
      .evaluate();
    expect([1, 2, 3].map((i) => m.at(i)!.toString())).toEqual([
      '2/3',
      '4/3',
      '2',
    ]);
    expect([1, 2, 3].map((i) => m.N().at(i)!.re)).toEqual([
      2 / 3,
      4 / 3,
      2,
    ]);
  });

  test('a float 0 from a cancellation does not meet an accuracy goal', () => {
    // 10^100·(e^(10^-100) - 1) is 0 below about 100 digits: the terms of
    // e^(10^-100) - 1 cancel. mpmath at 400 digits: 1.0000…0 (the next term
    // is 5e-101). Before, the accuracy goal was met by the float 0.
    const r = ce
      .box([
        'N',
        [
          'Multiply',
          ['Power', 10, 100],
          ['Subtract', ['Exp', ['Power', 10, -100]], 1],
        ],
        ['List', 'PositiveInfinity', 20],
      ])
      .evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBe(1);
    // A value below 10^-20 that is not 0 meets the goal with 0. mpmath:
    // e^-100 is 3.720075976e-44.
    const small = ce
      .box(['N', ['Exp', -100], ['List', 'PositiveInfinity', 20]])
      .evaluate();
    expect(small.isExact).toBe(false);
    expect(small.re).toBe(0);
    // The float 0 of `Sin(Pi)` in a symbolic result has the exact value 0,
    // and a sum does not keep a term that is 0.
    expect(
      ce
        .box([
          'N',
          ['Add', 'x', ['Sin', 'Pi']],
          ['List', 'PositiveInfinity', 5],
        ])
        .evaluate()
        .toString()
    ).toBe('x');
  });

  test('each float of a symbolic result meets the goal', () => {
    // R = e^(π√163) − 262537412640768744. mpmath at 400 digits:
    // -7.4992740280181431112e-13. At the first working precision (20
    // digits), R was -0.001: before, a list or a sum that holds a symbol
    // returned that value, with no comparison and no rounding.
    const R = [
      'Subtract',
      ['Exp', ['Multiply', 'Pi', ['Sqrt', 163]]],
      { num: '262537412640768744' },
    ];
    const goal = ['List', 10, 'PositiveInfinity'];
    expect(ce.box(['N', R, goal]).evaluate().toString()).toBe(
      '-7.499274028e-13'
    );
    expect(ce.box(['N', ['List', R, 'x'], goal]).evaluate().toString()).toBe(
      '[-7.499274028e-13,x]'
    );
    expect(ce.box(['N', ['Add', R, 'x'], goal]).evaluate().toString()).toBe(
      'x - 7.499274028e-13'
    );
    // Before, the float had the 21 digits of the precision of the engine.
    expect(
      ce
        .box(['N', ['List', 'Pi', 'x'], ['List', 5, 'PositiveInfinity']])
        .evaluate()
        .toString()
    ).toBe('[3.1416,x]');
    // An exact number of a symbolic result stays exact: the exponent is not
    // a float.
    expect(
      ce
        .box([
          'N',
          ['Multiply', ['Power', 'x', 2], 'Pi'],
          ['List', 5, 'PositiveInfinity'],
        ])
        .evaluate()
        .json
    ).toEqual(['Multiply', 3.1416, ['Power', 'x', 2]]);
  });

  test('a symbol whose value is an impure call is evaluated one time', () => {
    // `rDraw` holds the call `CountedDrawB()`, not evaluated. `isPure` of
    // `rDraw` is true: before, each working precision evaluated the call
    // again (7 draws), the values did not agree, and the call stayed
    // unevaluated.
    let draws = 0;
    ce.declare('CountedDrawB', {
      signature: '() -> real',
      pure: false,
      evaluate: () => {
        draws += 1;
        return ce.number(0.123456789012345);
      },
    });
    ce.assign('rDraw', ce.box(['CountedDrawB']));
    const r = ce.box(['N', 'rDraw', ['List', 10, 10]]).evaluate();
    expect(draws).toBe(1);
    expect(r.json).toBe(0.123456789);
    // The same for a function whose body draws.
    ce.box([
      'Assign',
      'gDraw',
      ['Function', ['Multiply', 'z', ['CountedDrawB']], 'z'],
    ]).evaluate();
    draws = 0;
    const g = ce.box(['N', ['gDraw', 2], ['List', 10, 10]]).evaluate();
    expect(draws).toBe(1);
    expect(g.json).toBe(0.246913578);
  });
});
