// Quick test to verify exact numeric folding during canonicalization
import { ComputeEngine } from './src/compute-engine';

const ce = new ComputeEngine();

console.log('=== Exact Numeric Folding During Canonicalization ===\n');

// Test Multiply folding
console.log('1. Multiply(2, x, 5):');
const mult1 = ce.parse('2 \\cdot x \\cdot 5');
console.log('   Canonical:', mult1.toString());
console.log('   Expected: 10*x');
console.log('   Match:', mult1.toString() === '10*x' ? '✓' : '✗');

// Test Add folding
console.log('\n2. Add(2, x, 5):');
const add1 = ce.parse('2 + x + 5');
console.log('   Canonical:', add1.toString());
console.log('   Expected: x + 7');
console.log('   Match:', add1.toString() === 'x+7' ? '✓' : '✗');

// Test Divide with multiplication in numerator
console.log('\n3. Divide(Multiply(2, x, 5), y):');
const div1 = ce.parse('\\frac{2 \\cdot x \\cdot 5}{y}');
console.log('   Canonical:', div1.toString());
console.log('   Expected: (10*x)/y or 10*x/y');
console.log('   Contains folded coefficient:', div1.toString().includes('10') ? '✓' : '✗');

// Test rational folding
console.log('\n4. Add(1/3, x, 2/3):');
const add2 = ce.parse('\\frac{1}{3} + x + \\frac{2}{3}');
console.log('   Canonical:', add2.toString());
console.log('   Expected: x + 1');
console.log('   Match:', add2.toString() === 'x+1' ? '✓' : '✗');

// Test that machine floats are NOT folded
console.log('\n5. Add(1.5, x, 0.5) [machine floats]:');
const add3 = ce.parse('1.5 + x + 0.5');
console.log('   Canonical:', add3.toString());
console.log('   Expected: NOT folded (should see 1.5 and 0.5 separately)');
console.log('   Has separate floats:', add3.toString().includes('1.5') && add3.toString().includes('0.5') ? '✓' : '✗');

// Test radical folding
console.log('\n6. Add(√2, x, √2):');
const add4 = ce.parse('\\sqrt{2} + x + \\sqrt{2}');
console.log('   Canonical:', add4.toString());
console.log('   Expected: x + 2√2 (or similar with radical folded)');
console.log('   Radicals folded:', !add4.toString().match(/√2.*√2/) ? '✓' : '✗');

// Test multiply identity elimination
console.log('\n7. Multiply(1/2, x, 2):');
const mult2 = ce.parse('\\frac{1}{2} \\cdot x \\cdot 2');
console.log('   Canonical:', mult2.toString());
console.log('   Expected: x');
console.log('   Match:', mult2.toString() === 'x' ? '✓' : '✗');

console.log('\n=== Summary ===');
console.log('Exact numeric folding during canonicalization is the DOCUMENTED policy.');
console.log('This includes: integers, rationals, and radicals.');
console.log('Machine floats (non-exact) are NOT folded.');
