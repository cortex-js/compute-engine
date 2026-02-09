import { ComputeEngine } from '../../src/compute-engine';
const ce = new ComputeEngine();

test('trace cosh(|x+2|) simplification', () => {
  const expr = ce.parse('\\cosh(|x+2|)');
  // Use the rule-based simplification with tracing
  const rules = ce.getRuleSet('standard-simplification')!;
  const { replace } = require('../../src/compute-engine/boxed-expression/rules');
  
  const steps = replace(expr, rules, { recursive: false, canonical: true, useVariations: false });
  console.log('Steps count:', steps.length);
  for (const step of steps) {
    console.log('Step:', step.value.toString(), 'because:', step.because);
  }
});

test('trace |sinh(x)| simplification', () => {
  const expr = ce.parse('|\\sinh(x)|');
  const rules = ce.getRuleSet('standard-simplification')!;
  const { replace } = require('../../src/compute-engine/boxed-expression/rules');
  
  const steps = replace(expr, rules, { recursive: false, canonical: true, useVariations: false });
  console.log('Steps count:', steps.length);
  for (const step of steps) {
    console.log('Step:', step.value.toString(), 'because:', step.because);
  }
});
