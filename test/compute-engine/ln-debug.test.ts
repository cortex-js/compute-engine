import { ComputeEngine } from '../../src/compute-engine';
const ce = new ComputeEngine();

test('ln(x^sqrt(2)) simplifies', () => {
  const expr = ce.parse('\\ln(x^{\\sqrt{2}})');
  const result = expr.simplify();
  console.log('input:', expr.latex);
  console.log('result:', result.latex);
  expect(result.latex).toBe('\\sqrt{2}\\ln(x)');
});
