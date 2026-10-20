import { ComputeEngine } from '../../src/compute-engine';

// A sum of quantities where at least one operand is a temperature with an
// offset (`degC`, `degF`) converts each operand to kelvin, with its offset,
// and adds the values in kelvin. The result is a quantity in `K`. An exact
// magnitude stays exact: `degF` to `K` is `(F + 459.67)·5/9`, and `degC` to
// `K` is `C + 27315/100`.
//
// A negated operand (`Negate(…)`, the canonical form of a subtraction, or a
// product with a negative number coefficient, the canonical form of
// `a - 2b`) is converted to kelvin first and then negated, so a difference
// of two temperatures is the difference of their values in kelvin.

const ce = new ComputeEngine();

function evaluate(expr: unknown): string {
  return ce
    .box(expr as Parameters<typeof ce.box>[0])
    .evaluate()
    .toString();
}

function numeric(expr: unknown): string {
  return ce
    .box(expr as Parameters<typeof ce.box>[0])
    .N()
    .toString();
}

describe('A SUM WITH A TEMPERATURE THAT HAS AN OFFSET IS A SUM IN KELVIN', () => {
  test('0 degC + 0 degF is 273.15 K + 255.372… K, exact', () => {
    const expr = ['Add', ['Quantity', 0, 'degC'], ['Quantity', 0, 'degF']];
    // 27315/100 + 45967/180 = 47567/90
    expect(evaluate(expr)).toBe('47567/90 K');
    expect(numeric(expr)).toMatch(/^528\.5222+\d* K$/);
  });

  test('two temperatures in degC give a value in kelvin', () => {
    const expr = ['Add', ['Quantity', 10, 'degC'], ['Quantity', 10, 'degC']];
    expect(evaluate(expr)).toBe('5663/10 K');
    expect(numeric(expr)).toBe('566.3 K');
  });

  test('two temperatures in degF give a value in kelvin', () => {
    const expr = ['Add', ['Quantity', 32, 'degF'], ['Quantity', 32, 'degF']];
    expect(evaluate(expr)).toBe('5463/10 K');
  });

  test('a temperature in K and one in degC', () => {
    const expr = ['Add', ['Quantity', 10, 'K'], ['Quantity', 10, 'degC']];
    expect(evaluate(expr)).toBe('5863/20 K');
    expect(numeric(expr)).toBe('293.15 K');
  });

  test('a temperature in mK and one in degC', () => {
    const expr = ['Add', ['Quantity', 10, 'mK'], ['Quantity', 0, 'degC']];
    expect(evaluate(expr)).toBe('6829/25 K');
  });

  test('a float magnitude gives a float', () => {
    const expr = ['Add', ['Quantity', 1.5, 'degC'], ['Quantity', 10, 'degF']];
    // 274.65 + 469.67·5/9 = 535.5777…
    const r = ce.box(expr as Parameters<typeof ce.box>[0]).evaluate();
    expect(r.operator).toBe('Quantity');
    expect(r.op2.toString()).toBe('K');
    expect(r.op1.re).toBeCloseTo(274.65 + (469.67 * 5) / 9, 10);
  });

  test('a symbolic magnitude', () => {
    expect(
      evaluate(['Add', ['Quantity', 'x', 'degC'], ['Quantity', 0, 'degF']])
    ).toBe('(x + 47567/90) K');
  });

  test('a Measurement magnitude keeps its error', () => {
    expect(
      evaluate([
        'Add',
        ['Quantity', ['Measurement', 10, 0.5], 'degC'],
        ['Quantity', 0, 'degF'],
      ])
    ).toBe('(48467/90 ± 0.5) K');
  });

  test('a Measurement magnitude in degF is scaled exactly', () => {
    // 32 degF is 273.15 K, and the error 1 degF is 5/9 K.
    const expr = [
      'Add',
      ['Quantity', ['Measurement', 32, 1], 'degF'],
      ['Quantity', 32, 'degF'],
    ];
    expect(evaluate(expr)).toBe('(5463/10 ± 5/9) K');
    expect(numeric(expr)).toBe('(546.30 ± 0.56) K');
  });

  test('the unit K is not declared as a variable', () => {
    const ce2 = new ComputeEngine();
    ce2
      .box(['Add', ['Quantity', 0, 'degC'], ['Quantity', 0, 'degF']])
      .evaluate();
    expect(ce2.lookupDefinition('K')).toBeUndefined();
  });

  test('the parse route', () => {
    expect(
      ce.parse('0\\,\\mathrm{degC}+0\\,\\mathrm{degF}').evaluate().toString()
    ).toBe('47567/90 K');
  });
});

describe('A DIFFERENCE OF TEMPERATURES IS A DIFFERENCE IN KELVIN', () => {
  test('20 degC - 10 degC is 10 K', () => {
    const expr = [
      'Subtract',
      ['Quantity', 20, 'degC'],
      ['Quantity', 10, 'degC'],
    ];
    expect(evaluate(expr)).toBe('10 K');
    expect(numeric(expr)).toBe('10 K');
  });

  test('20 degC - 10 degF is 293.15 K - 260.927… K', () => {
    const expr = [
      'Subtract',
      ['Quantity', 20, 'degC'],
      ['Quantity', 10, 'degF'],
    ];
    expect(evaluate(expr)).toBe('290/9 K');
  });

  test('20 degC - 10 K is 283.15 K', () => {
    expect(
      evaluate(['Subtract', ['Quantity', 20, 'degC'], ['Quantity', 10, 'K']])
    ).toBe('5663/20 K');
  });

  test('a Measurement difference keeps its error', () => {
    expect(
      evaluate([
        'Subtract',
        ['Quantity', ['Measurement', 20, 0.5], 'degC'],
        ['Quantity', 10, 'degC'],
      ])
    ).toBe('(10.00 ± 0.50) K');
  });

  test('a float difference adds no rounding error from the offsets', () => {
    const r = ce
      .box(['Subtract', ['Quantity', 20.1, 'degC'], ['Quantity', 10, 'degC']])
      .evaluate();
    expect(r.op2.toString()).toBe('K');
    // The offsets cancel exactly: the result is within one rounding of
    // 20.1 − 10 (adding each offset as a float gave 10.100000000000023).
    expect(Math.abs(r.op1.re - 10.1)).toBeLessThanOrEqual(2e-15);
  });

  test('a subtracted scalar multiple is the negation of a temperature', () => {
    // A scalar multiple keeps the unit: 2 · 10 degC is 20 degC.
    expect(
      evaluate([
        'Subtract',
        ['Quantity', 20, 'degC'],
        ['Multiply', 2, ['Quantity', 10, 'degC']],
      ])
    ).toBe('0 K');
    expect(
      evaluate([
        'Subtract',
        ['Quantity', 20, 'degC'],
        ['Divide', ['Quantity', 10, 'degC'], 2],
      ])
    ).toBe('15 K');
  });

  test('a subtracted scalar multiple on the parse route', () => {
    expect(
      ce
        .parse('20\\,\\mathrm{degC}-2\\cdot 10\\,\\mathrm{degC}')
        .evaluate()
        .toString()
    ).toBe('0 K');
  });

  test('a difference of assigned symbols', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('t', ce2.box(['Quantity', 10, 'degC']));
    ce2.assign('u', ce2.box(['Quantity', 20, 'degC']));
    expect(ce2.box(['Subtract', 'u', 't']).evaluate().toString()).toBe('10 K');
    expect(
      ce2
        .box(['Subtract', 'u', ['Multiply', 2, 't']])
        .evaluate()
        .toString()
    ).toBe('0 K');
  });

  test('a symbolic difference', () => {
    expect(
      evaluate([
        'Subtract',
        ['Quantity', 'x', 'degC'],
        ['Quantity', 'y', 'degC'],
      ])
    ).toBe('(x - y) K');
  });

  test('the parse route', () => {
    expect(
      ce.parse('20\\,\\mathrm{degC}-10\\,\\mathrm{degC}').evaluate().toString()
    ).toBe('10 K');
  });
});

describe('A SUM OF TEMPERATURES WITH NO OFFSET IS UNCHANGED', () => {
  test('10 K + 10 K', () => {
    expect(
      evaluate(['Add', ['Quantity', 10, 'K'], ['Quantity', 10, 'K']])
    ).toBe('20 K');
  });

  test('a temperature and a length are not added', () => {
    expect(
      evaluate(['Add', ['Quantity', 10, 'degC'], ['Quantity', 10, 'm']])
    ).toBe('10 degC + 10 m');
  });
});
