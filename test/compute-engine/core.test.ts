import { ComputeEngine } from '../../src/compute-engine';

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
