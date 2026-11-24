import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// `D`, `Integrate`, `Limit`, `Series`, `ND`, `NIntegrate` and `NLimit` read
// the value of a free symbol that holds a formula in their variable; an
// occurrence of the variable's name in that value denotes the variable. The
// iteration binders keep the lexical reading (`docs/SCOPING-MODEL.md`, "The
// variable of a formula").

function engineWithG(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('G', ce.box(['Sin', 'x']));
  return ce;
}

describe('A symbol that holds a formula in the variable', () => {
  test('D reads the value', () => {
    const ce = engineWithG();
    expect(ce.box(['D', 'G', 'x']).evaluate().toString()).toBe('cos(x)');
    expect(
      ce
        .box(['D', ['Multiply', 2, 'G'], 'x'])
        .evaluate()
        .toString()
    ).toBe('2cos(x)');
    expect(
      ce
        .box(['D', ['Power', 'G', 2], 'x'])
        .evaluate()
        .isSame(ce.parse('2\\sin(x)\\cos(x)'))
    ).toBe(true);
  });

  test('D with respect to another variable of the value', () => {
    const ce = new ComputeEngine();
    ce.assign('H', ce.box(['Multiply', 'y', ['Sin', 'x']]));
    expect(ce.box(['D', 'H', 'y']).evaluate().toString()).toBe('sin(x)');
  });

  test('Integrate reads the value', () => {
    const ce = engineWithG();
    expect(ce.box(['Integrate', 'G', 'x']).evaluate().toString()).toBe(
      '-cos(x)'
    );
    expect(
      ce
        .box(['Integrate', 'G', ['Limits', 'x', 0, 1]])
        .evaluate()
        .isSame(ce.parse('1-\\cos(1)'))
    ).toBe(true);
    expect(
      ce.box(['Integrate', 'G', ['Limits', 'x', 0, 1]]).N().re
    ).toBeCloseTo(1 - Math.cos(1), 12);
  });

  test('Limit reads the value', () => {
    const ce = engineWithG();
    expect(ce.parse('\\lim_{x\\to 0} G').evaluate().toString()).toBe('0');
  });

  // CE-1433: `Limit(f, x, a)` names its variable also when `f` does not
  // contain `x` by syntax. Before, `x` was read as the point and `0` as the
  // direction.
  test('Limit with its variable and its point reads the value', () => {
    const ce = engineWithG();
    expect(ce.box(['Limit', 'G', 'x', 0]).evaluate().toString()).toBe('0');
    expect(
      ce
        .box(['Limit', ['Add', 'G', 0], 'x', 0])
        .evaluate()
        .toString()
    ).toBe('0');
    expect(
      ce
        .box(['Limit', ['Divide', 'G', 'x'], 'x', 0])
        .evaluate()
        .toString()
    ).toBe('1');
    expect(
      executeEpsil(
        new ComputeEngine(),
        'let G = sin(x); limit(G + 0, x, 0)'
      ).value.toString()
    ).toBe('0');
    expect(
      executeEpsil(
        new ComputeEngine(),
        'let G = sin(x); limit(G, x, 0)'
      ).value.toString()
    ).toBe('0');
  });

  test('Limit with a variable that the expression does not read', () => {
    const ce = new ComputeEngine();
    // The limit of a constant in `x` is that constant.
    expect(ce.box(['Limit', 'u', 'x', 0]).evaluate().toString()).toBe('u');
    // A symbol of type `any` can be a number: `x` is its variable.
    ce.declare('h', 'any');
    expect(ce.box(['Limit', 'h', 'x', 0]).json).toEqual([
      'Limit',
      ['Function', ['Block', 'h'], 'x'],
      0,
    ]);
    // A constant is never the variable: `Pi` is the point.
    expect(
      ce
        .box(['Limit', ['Divide', 1, 'x'], 'Pi', 1])
        .evaluate()
        .toString()
    ).toBe('1 / pi');
    expect(
      ce
        .box(['Limit', ['Divide', 'Pi', 'x'], 'Pi', 1])
        .evaluate()
        .toString()
    ).toBe('1');
    // A symbol that names a function keeps the implicit form: the second
    // operand is the point.
    expect(ce.box(['Limit', 'Sin', 'a', 1]).json).toEqual([
      'Limit',
      'Sin',
      'a',
      1,
    ]);
  });

  test('Series reads the value', () => {
    const ce = engineWithG();
    expect(ce.box(['Series', 'G', 'x', 0, 3]).evaluate().toString()).toBe(
      'x - 1/6 * x^3 + BigO(x^5)'
    );
  });

  // CE-1434: the numerical operators read the value as the symbolic ones do.
  test('ND, NIntegrate and NLimit read the value', () => {
    const ce = engineWithG();
    expect(ce.box(['ND', ['Function', 'G', 'x'], 1]).N().re).toBeCloseTo(
      Math.cos(1),
      8
    );
    expect(
      ce.box(['ND', ['Function', ['Multiply', 2, 'G'], 'x'], 1]).N().re
    ).toBeCloseTo(2 * Math.cos(1), 8);
    expect(
      ce.box(['NIntegrate', ['Function', 'G', 'x'], 0, 1]).N().re
    ).toBeCloseTo(1 - Math.cos(1), 12);
    expect(
      ce.box(['NLimit', ['Function', ['Divide', 'G', 'x'], 'x'], 0]).N().re
    ).toBeCloseTo(1, 8);
    // A symbol in the value is read too.
    ce.assign('K', ce.box(['Add', 'G', 1]));
    expect(
      ce.box(['NIntegrate', ['Function', 'K', 'x'], 0, 1]).N().re
    ).toBeCloseTo(2 - Math.cos(1), 12);
  });

  test('ND and NIntegrate do not read an assigned value of the variable', () => {
    const ce = engineWithG();
    ce.assign('x', 5);
    expect(ce.box(['ND', ['Function', 'G', 'x'], 1]).N().re).toBeCloseTo(
      Math.cos(1),
      8
    );
    expect(
      ce.box(['NIntegrate', ['Function', 'G', 'x'], 0, 1]).N().re
    ).toBeCloseTo(1 - Math.cos(1), 12);
  });

  test('ND reads no value that does not mention its variable', () => {
    const ce = new ComputeEngine();
    ce.assign('H', ce.box(['Sin', 'y']));
    ce.assign('y', 2);
    // `H` is a constant of `t`: its value `sin(2)` is the slope.
    expect(
      ce.box(['ND', ['Function', ['Multiply', 'H', 't'], 't'], 1]).N().re
    ).toBeCloseTo(Math.sin(2), 8);
  });

  test('a symbol in the value is read too', () => {
    const ce = engineWithG();
    ce.assign('K', ce.box(['Add', 'G', 1]));
    expect(ce.box(['D', 'K', 'x']).evaluate().toString()).toBe('cos(x)');
  });

  test('an assigned value of the variable is not read', () => {
    const ce = engineWithG();
    ce.assign('x', 5);
    expect(ce.box(['D', 'G', 'x']).evaluate().toString()).toBe('cos(x)');
    expect(ce.box(['Integrate', 'G', 'x']).evaluate().toString()).toBe(
      '-cos(x)'
    );
  });

  test('a new value of the symbol gives a new derivative', () => {
    const ce = engineWithG();
    const d = ce.box(['D', 'G', 'x']);
    expect(d.evaluate().toString()).toBe('cos(x)');
    ce.assign('G', ce.box(['Power', 'x', 2]));
    expect(d.evaluate().toString()).toBe('2x');
  });

  test('a value that reaches its own symbol again is not read', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.box(['Add', 'Q', 'x']));
    ce.assign('Q', ce.box('P'));
    expect(ce.box(['Integrate', 'P', 'x']).evaluate().toString()).toBe('P * x');
    expect(ce.box(['D', 'P', 'x']).evaluate().toString()).toBe('0');
    // `K` is not in the cycle: its value is read, with `P` kept as a symbol.
    ce.assign('K', ce.box(['Add', ['Sin', 'x'], 'P']));
    expect(ce.box(['D', 'K', 'x']).evaluate().toString()).toBe('cos(x)');
  });

  test('Limit and Series read a parameter of the running call', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Apply',
          ['Function', ['Limit', ['Function', 'f', 'x'], 0], 'f'],
          ['Add', ['Cos', 'x'], 1],
        ])
        .evaluate()
        .toString()
    ).toBe('2');
    expect(
      ce
        .box([
          'Apply',
          ['Function', ['Series', 'f', 'x', 0, 3], 'f'],
          ['Sin', 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe('x - 1/6 * x^3 + BigO(x^5)');
  });

  test('Sum keeps the lexical reading of its index', () => {
    const ce = engineWithG();
    expect(ce.parse('\\sum_{x=1}^{3} G').evaluate().toString()).toBe('3sin(x)');
    ce.assign('a', ce.parse('n+1'));
    expect(ce.parse('\\sum_{n=1}^{3} a').evaluate().toString()).toBe('3n + 3');
  });

  test('Epsil: the derivative of a variable that holds a formula', () => {
    const run = (source: string) =>
      executeEpsil(new ComputeEngine(), source).value?.toString();
    expect(run('let G = sin(x); D(G, x)')).toBe('cos(x)');
    expect(run('let G = sin(x); D(2*G, x)')).toBe('2cos(x)');
    expect(run('let G = sin(x); integrate(G, x)')).toBe('-cos(x)');
    const value = (source: string) =>
      executeEpsil(new ComputeEngine(), source).value?.re ?? NaN;
    expect(value('let G = sin(x); ND(x => G, 1)')).toBeCloseTo(Math.cos(1), 8);
    expect(value('let G = sin(x); NIntegrate(x => G, 0, 1)')).toBeCloseTo(
      1 - Math.cos(1),
      12
    );
    expect(
      executeEpsil(
        new ComputeEngine(),
        'let F = cdf(normalDistribution(0, 1), x); D(F, x)'
      )
        .value?.N()
        .subs({ x: 0 })
        .N().re
    ).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
  });
});
