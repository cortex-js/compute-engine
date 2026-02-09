import { ComputeEngine } from '../../src/compute-engine';
const ce = new ComputeEngine();

test('cosh(|x+2|)', () => {
  const r = ce.parse('\\cosh(|x+2|)').simplify();
  console.log('cosh(|x+2|) ->', r.latex, 'json:', JSON.stringify(r.json));
});
test('|sinh(x)|', () => {
  const r = ce.parse('|\\sinh(x)|').simplify();
  console.log('|sinh(x)| ->', r.latex, 'json:', JSON.stringify(r.json));
});
test('|arcsin(x)|', () => {
  const r = ce.parse('|\\arcsin(x)|').simplify();
  console.log('|arcsin(x)| ->', r.latex, 'json:', JSON.stringify(r.json));
});
test('|arsinh(x)|', () => {
  const r = ce.parse('|\\arsinh(x)|').simplify();
  console.log('|arsinh(x)| ->', r.latex, 'json:', JSON.stringify(r.json));
});
test('|artanh(x)|', () => {
  const r = ce.parse('|\\artanh(x)|').simplify();
  console.log('|artanh(x)| ->', r.latex, 'json:', JSON.stringify(r.json));
});
