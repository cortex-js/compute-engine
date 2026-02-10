import { ComputeEngine } from '../../src/compute-engine';

describe('Workflow Entrypoints', () => {
  test('parseSimplify() parses then simplifies', () => {
    const ce = new ComputeEngine();
    const result = ce.parseSimplify('1+1');

    expect(result?.toString()).toBe('2');
  });

  test('parseEvaluate() parses then evaluates with context values', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);

    const result = ce.parseEvaluate('x+2');

    expect(result?.toString()).toBe('5');
  });

  test('parseNumeric() parses then computes a numeric approximation', () => {
    const ce = new ComputeEngine();
    const result = ce.parseNumeric('\\sqrt{2}');

    expect(result).not.toBeNull();
    expect(result?.isNumber).toBe(true);
    expect(result?.toString()).not.toBe('Sqrt(2)');
  });

  test('workflow entrypoints propagate null parse input', () => {
    const ce = new ComputeEngine();

    expect(ce.parseSimplify(null)).toBeNull();
    expect(ce.parseEvaluate(null)).toBeNull();
    expect(ce.parseNumeric(null)).toBeNull();
  });
});
