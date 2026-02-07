// Polynomial Factoring Examples
// Demonstrates the new polynomial factoring capabilities

import { ComputeEngine } from '@cortex-js/compute-engine';

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

console.log('\n3. Difference of Squares');
console.log('-'.repeat(40));
console.log('sqrt((x² - 4)(x² + 4)) =', ce.parse('\\sqrt{(x^2 - 4)(x^2 + 4)}').simplify().latex);
console.log('sqrt((x - 2)(x + 2)) =', ce.parse('\\sqrt{(x - 2)(x + 2)}').simplify().latex);

console.log('\n4. Non-Perfect Squares (unchanged)');
console.log('-'.repeat(40));
console.log('sqrt(x² + 3x + 1) =', ce.parse('\\sqrt{x^2 + 3x + 1}').simplify().latex);
console.log('sqrt(x² + x + 1) =', ce.parse('\\sqrt{x^2 + x + 1}').simplify().latex);

console.log('\n5. Issue #180 Examples');
console.log('-'.repeat(40));
console.log('Expanded form: sqrt(x² + 2x + 1) =', ce.parse('\\sqrt{x^2+2x+1}').simplify().latex);
console.log('Factored form: sqrt((x+1)²) =', ce.parse('\\sqrt{(x+1)^2}').simplify().latex);
console.log('Both now simplify to: |x+1|');

console.log('\n6. Using the factorPolynomial Function');
console.log('-'.repeat(40));

// NOTE: These factor functions are internal APIs not exported from the package.
// This import path works only when running from within the repository.
import {
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
} from '../dist/compute-engine.esm.js';

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
