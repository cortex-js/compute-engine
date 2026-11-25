import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// A lone symbol that holds a formula, as the operand of the implicit form of
// `Integrate`, `Limit`, `NLimit`, `ND` or `NIntegrate` (no variable written),
// is read as its value, and the variable is chosen from the symbols of the
// value (`loneSymbolFormula()`, `docs/SCOPING-MODEL.md`, "The variable of a
// formula").

const ONE_MINUS_COS_1 = 1 - Math.cos(1);

function engineWithG(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('G', ce.parse('\\sin(x)'));
  return ce;
}

describe('A lone symbol that holds a formula', () => {
  test('definite integral with no variable written', () => {
    const ce = engineWithG();
    expect(ce.parse('\\int_0^1 G').N().re).toBeCloseTo(ONE_MINUS_COS_1, 12);
    expect(
      ce.box(['Integrate', 'G', ['Limits', 'Nothing', 0, 1]]).N().re
    ).toBeCloseTo(ONE_MINUS_COS_1, 12);
  });

  test('indefinite integral with no variable written', () => {
    const ce = engineWithG();
    expect(ce.parse('\\int G').evaluate().toString()).toBe('-cos(x)');
  });

  test('Limit, NLimit, ND and NIntegrate with no variable written', () => {
    const ce = engineWithG();
    expect(ce.box(['Limit', 'G', 0]).evaluate().re).toBe(0);
    expect(ce.box(['Limit', 'G', 0]).N().re).toBe(0);
    expect(ce.box(['NLimit', 'G', 0]).evaluate().re).toBeCloseTo(0, 10);
    expect(ce.box(['ND', 'G', 1]).evaluate().re).toBeCloseTo(Math.cos(1), 8);
    expect(ce.box(['NIntegrate', 'G', 0, 1]).evaluate().re).toBeCloseTo(
      ONE_MINUS_COS_1,
      10
    );
  });

  test('the value is read at evaluation: boxed before the assignment', () => {
    const ce = new ComputeEngine();
    const integral = ce.parse('\\int_0^1 G');
    const limit = ce.box(['Limit', 'G', 0]);
    const nd = ce.box(['ND', 'G', 1]);
    ce.assign('G', ce.parse('\\sin(x)'));
    expect(integral.N().re).toBeCloseTo(ONE_MINUS_COS_1, 12);
    expect(limit.N().re).toBe(0);
    expect(nd.evaluate().re).toBeCloseTo(Math.cos(1), 8);
  });

  test('the variable is bound: a value of x does not change it', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 4);
    ce.assign('G', ce.parse('\\sin(x)'));
    expect(ce.parse('\\int_0^1 G').N().re).toBeCloseTo(ONE_MINUS_COS_1, 12);
  });

  test('two limits with no variable take two variables of the value', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.parse('x y'));
    // ∫₀² ∫₀¹ x·y dx dy = 1/2 · 2 = 1
    expect(
      ce
        .box([
          'Integrate',
          'P',
          ['Limits', 'Nothing', 0, 1],
          ['Limits', 'Nothing', 0, 2],
        ])
        .N().re
    ).toBeCloseTo(1, 12);
  });

  test('the integral reads G: G is free for subs()', () => {
    const ce = engineWithG();
    const integral = ce.parse('\\int_0^1 G');
    expect(integral.subs({ G: 2 }).N().re).toBeCloseTo(2, 12);
  });

  test('a named variable keeps its reading', () => {
    const ce = engineWithG();
    // ∫₀¹ G dG names G as the variable.
    expect(ce.parse('\\int_0^1 G\\,dG').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('\\int_0^1 G\\,dx').N().re).toBeCloseTo(
      ONE_MINUS_COS_1,
      12
    );
  });

  test('a symbol that names a function keeps its reading', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t) := t^2').evaluate();
    expect(ce.box(['Limit', 'g', 2]).N().re).toBe(4);
    expect(ce.box(['NIntegrate', 'g', 0, 1]).evaluate().re).toBeCloseTo(
      1 / 3,
      10
    );
    expect(ce.box(['ND', 'Sin', 1]).evaluate().re).toBeCloseTo(
      Math.cos(1),
      8
    );
  });

  test('a symbol with no formula keeps its reading', () => {
    const ce = new ComputeEngine();
    // No value: the symbol is its own variable, ∫₀¹ u du.
    expect(ce.parse('\\int_0^1 u').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('\\int u').evaluate().toString()).toBe('1/2 * u^2');
    // A value with no candidate for the variable: a constant.
    ce.assign('c', 5);
    expect(ce.box(['Limit', 'c', 0]).N().re).toBe(5);
  });

  test('a value that is a symbol is its own variable', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.box('x'));
    expect(ce.box(['ND', 'G', 1]).evaluate().re).toBeCloseTo(1, 8);
    expect(ce.box(['NIntegrate', 'G', 0, 1]).evaluate().re).toBeCloseTo(
      0.5,
      10
    );
    expect(ce.box(['Limit', 'G', 3]).N().re).toBe(3);
    expect(ce.parse('\\int_0^1 G').N().re).toBeCloseTo(0.5, 12);
  });

  test('a chain of symbols is read to its formula', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.box('H'));
    ce.assign('H', ce.parse('\\sin(x)'));
    expect(ce.box(['ND', 'G', 1]).evaluate().re).toBeCloseTo(Math.cos(1), 8);
    expect(ce.box(['Limit', 'G', 0]).N().re).toBe(0);
    expect(ce.box(['NIntegrate', 'G', 0, 1]).evaluate().re).toBeCloseTo(
      ONE_MINUS_COS_1,
      10
    );
    expect(ce.parse('\\int_0^1 G').N().re).toBeCloseTo(ONE_MINUS_COS_1, 12);
  });

  test('a chain that ends at a constant, or a cycle, gives no formula', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.box('H'));
    ce.assign('H', 5);
    // `G` does not hold a formula: it is not read as `H ↦ H`, but as the
    // constant 5.
    expect(ce.box(['Limit', 'G', 0]).N().re).toBe(5);
    expect(ce.box(['ND', 'G', 1]).evaluate().re).toBeCloseTo(0, 8);

    const ce2 = new ComputeEngine();
    ce2.assign('G', ce2.box('H'));
    ce2.assign('H', ce2.box('G'));
    expect(() => ce2.parse('\\int_0^1 G').N()).not.toThrow();
  });

  test('ND of a lone point or list formula stays unevaluated', () => {
    // The type of `ND(G, 1)` is `number`: a value that is a point or a list
    // would contradict it.
    for (const value of [
      ['Tuple', ['Cos', 't'], ['Sin', 't']],
      ['List', ['Cos', 't'], ['Sin', 't']],
    ]) {
      const ce = new ComputeEngine();
      ce.assign('G', ce.box(value as any));
      const nd = ce.box(['ND', 'G', 1]);
      expect(nd.type.toString()).toBe('number');
      expect(nd.evaluate().operator).toBe('ND');
    }
  });

  test('a parameter is not read through the argument of a call', () => {
    const ce = new ComputeEngine();
    // At definition, `t` is the variable: f is the constant ∫₀¹ t dt.
    ce.parse('f(t) := \\int_0^1 t').evaluate();
    expect(ce.parse('f(\\sin(x))').N().re).toBeCloseTo(0.5, 12);
    expect(ce.parse('f(y)').N().re).toBeCloseTo(0.5, 12);
  });

  test('Epsil: a local that holds a formula', () => {
    const value = (source: string) =>
      executeEpsil(new ComputeEngine(), source).value?.re ?? NaN;
    expect(value('let G = sin(x); ND(G, 1)')).toBeCloseTo(Math.cos(1), 8);
    expect(value('let G = sin(x); NIntegrate(G, 0, 1)')).toBeCloseTo(
      ONE_MINUS_COS_1,
      10
    );
    expect(value('let G = sin(x); NLimit(G, 0)')).toBeCloseTo(0, 10);
    expect(value('let G = sin(x); limit(G, 0)')).toBe(0);
  });
});
