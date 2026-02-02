// Polynomial Factoring Examples
// Demonstrates the new polynomial factoring capabilities
// Run with: npx tsx examples/polynomial-factoring.ts

import { ComputeEngine } from '../src/compute-engine/index.ts';
import {
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
} from '../src/compute-engine/boxed-expression/factor.ts';

const ce = new ComputeEngine();

console.log('='.repeat(60));
console.log('POLYNOMIAL FACTORING EXAMPLES');
console.log('='.repeat(60));

console.log('\n1. Perfect Square Trinomials');
console.log('-'.repeat(40));
console.log('sqrt(x² + 2x + 1) =', ce.parse('\\sqrt{x^2 + 2x + 1}').simplify().latex);
console.log('sqrt(x² - 2x + 1) =', ce.parse('\\sqrt{x^2 - 2x + 1}').simplify().latex);
console.log('sqrt(a² + 2ab + b²) =', ce.parse('\\sqrt{a^2 + 2ab + b^2}').simplify().latex);
console.log('sqrt(a² - 2ab + b²) =', ce.parse('\\sqrt{a^2 - 2ab + b^2}').simplify().latex);

console.log('\n2. Perfect Squares with Coefficients');
console.log('-'.repeat(40));
console.log('sqrt(4x² + 12x + 9) =', ce.parse('\\sqrt{4x^2 + 12x + 9}').simplify().latex);
console.log('sqrt(4x² - 12x + 9) =', ce.parse('\\sqrt{4x^2 - 12x + 9}').simplify().latex);
console.log('sqrt(9x² + 6x + 1) =', ce.parse('\\sqrt{9x^2 + 6x + 1}').simplify().latex);

console.log('\n3. Non-Perfect Squares (unchanged)');
console.log('-'.repeat(40));
console.log('sqrt(x² + 3x + 1) =', ce.parse('\\sqrt{x^2 + 3x + 1}').simplify().latex);
console.log('sqrt(x² + x + 1) =', ce.parse('\\sqrt{x^2 + x + 1}').simplify().latex);

console.log('\n4. Issue #180 Examples');
console.log('-'.repeat(40));
console.log('Expanded form: sqrt(x² + 2x + 1) =', ce.parse('\\sqrt{x^2+2x+1}').simplify().latex);
console.log('Factored form: sqrt((x+1)²) =', ce.parse('\\sqrt{(x+1)^2}').simplify().latex);
console.log('Both now simplify to: |x+1|');

console.log('\n5. Using the factorPolynomial Function');
console.log('-'.repeat(40));

const expr1 = ce.parse('x^2 + 2x + 1');
console.log('x² + 2x + 1 factored:', factorPerfectSquare(expr1)?.latex || 'null');

const expr2 = ce.parse('x^2 - 4');
console.log('x² - 4 factored:', factorDifferenceOfSquares(expr2)?.latex || 'null');

const expr3 = ce.parse('x^2 + 5x + 6');
console.log('x² + 5x + 6 factored:', factorQuadratic(expr3, 'x')?.latex || 'null');

const expr4 = ce.parse('4x^2 + 12x + 9');
console.log('4x² + 12x + 9 factored:', factorPolynomial(expr4)?.latex || 'null');

console.log('\n' + '='.repeat(60));
console.log('All examples completed successfully!');
console.log('='.repeat(60));
