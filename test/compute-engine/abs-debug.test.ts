import { ComputeEngine } from '../../src/compute-engine';
import { simplifyEvenFunctionAbs, simplifyAbs } from '../../src/compute-engine/symbolic/simplify-abs';

const ce = new ComputeEngine();

test('simplifyEvenFunctionAbs called directly on Cosh(Abs(x+2))', () => {
  const expr = ce.parse('\\cosh(|x+2|)');
  console.log('Input expr:', expr.toString(), 'operator:', expr.operator);
  console.log('op1:', expr.op1?.toString(), 'op1.operator:', expr.op1?.operator);
  
  const result = simplifyEvenFunctionAbs(expr);
  console.log('Direct call result:', result?.value?.toString(), result?.because);
});

test('simplifyAbs called directly on Abs(Sinh(x))', () => {
  const expr = ce.parse('|\\sinh(x)|');
  console.log('Input expr:', expr.toString(), 'operator:', expr.operator);
  console.log('op1:', expr.op1?.toString(), 'op1.operator:', expr.op1?.operator);
  
  const result = simplifyAbs(expr);
  console.log('Direct call result:', result?.value?.toString(), result?.because);
});

test('simplifyAbs called on Abs(Arcsin(x))', () => {
  const expr = ce.parse('|\\arcsin(x)|');
  console.log('Input expr:', expr.toString(), 'operator:', expr.operator);
  console.log('op1:', expr.op1?.toString(), 'op1.operator:', expr.op1?.operator);
  
  const result = simplifyAbs(expr);
  console.log('Direct call result:', result?.value?.toString(), result?.because);
});
