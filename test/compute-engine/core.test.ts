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

describe('N / Evaluate nesting collapse', () => {
  // Shape pins use `.json` (no evaluation): evaluating `N(x, p)` with p above
  // the engine's precision raises the process-global precision and leaves it
  // raised.

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
